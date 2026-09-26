// src/validate.ts
//
// The scanner. Turns "does this claim sound more certain than its tier
// allows" from an implicit copywriting judgment into a machine-checkable
// rule, so it can run in CI and fail a build the same way a type error
// does. This is the direct generalization of the pattern that caught
// ~150 false "(verified)" labels on a live site after they had already
// shipped — see the README for the incident this is built to catch
// before it ships, not after.

import type { Claim, ProvenanceTier } from './types.js';
import {
  DEFAULT_CERTAINTY_PHRASES,
  type CertaintyPhraseInput,
  type CertaintyPhraseRule,
} from './certainty-phrases.js';

const VALID_TIERS: ProvenanceTier[] = ['verified', 'modeled', 'editorial'];

/** Why a given offense was raised. */
export type ClaimOffenseReason =
  | 'certainty_phrase_without_backing_tier'
  | 'missing_source_ref'
  | 'unknown_tier';

/** A single flagged problem with a claim. One claim can produce several. */
export interface ClaimOffense {
  /** id of the offending claim. */
  claimId: string;
  /** text of the offending claim, for context in a report. */
  claimText: string;
  /** The specific certainty phrase matched, or null for non-phrase offenses. */
  phrase: string | null;
  /** Machine-checkable reason code. */
  reason: ClaimOffenseReason;
  /** Human-readable explanation, suitable for a CI failure message. */
  message: string;
  /**
   * The claim's tier as given. A recognized tier autocompletes as a
   * `ProvenanceTier`; an unrecognized string (e.g. `"Verified"`) is echoed
   * as-is, and a missing or non-string tier is `null`.
   *
   * `(string & {})` keeps the three tier literals visible to editors while
   * still admitting arbitrary strings; a bare `| string` would collapse the
   * union to `string`.
   */
  tier: ProvenanceTier | (string & {}) | null;
}

export interface ValidateClaimsOptions {
  /**
   * Phrases that assert certainty. Defaults to a small generic starter
   * list (`DEFAULT_CERTAINTY_PHRASES`) — override freely; different
   * products need different banned-phrase lists.
   */
  certaintyPhrases?: CertaintyPhraseInput[];
  /**
   * Tiers strong enough to back a certainty phrase. A claim using
   * certainty language whose tier is NOT in this list gets flagged.
   * Default: `['verified']`.
   */
  certaintyRequiresTier?: ProvenanceTier[];
  /**
   * Tiers that must carry a non-empty `sourceRef`. Default: `['verified']`
   * — a claim asserting it was checked against a source should say what
   * that source was.
   */
  requireSourceRefForTiers?: ProvenanceTier[];
  /** Case-sensitive phrase matching. Default false. */
  caseSensitive?: boolean;
  /** How many characters before a phrase match to scan for a negation. Default 40. */
  negationWindow?: number;
}

/** Either a ready-made claim list, or raw text plus a domain-specific extractor. */
export type ClaimsInput =
  | Claim[]
  | { text: string; extractClaims: (text: string) => Claim[] };

// Negation words/contractions checked for in the window before a match.
// Contractions are listed explicitly rather than matched with a generic
// `n't` pattern: a lookbehind-free `\bn't\b` never matches, because the
// character right before "n" in "doesn't" or "don't" is a letter, not a
// word boundary. Text is folded (curly apostrophes -> straight) before this
// runs, so only the straight-apostrophe form is needed here.
const NEGATION_WORDS =
  /\b(not|never|no|none|nothing|nor|neither|without|hardly|barely|far from|isn't|is not|wasn't|was not|aren't|are not|weren't|were not|doesn't|does not|don't|do not|didn't|did not|can't|cannot|can not|couldn't|could not|won't|will not|wouldn't|would not|shouldn't|should not|hasn't|has not|haven't|have not|hadn't|had not)\b/i;

// Idioms that contain a negation word but do not negate what follows —
// "no doubt X" and "not only X" both assert X. Stripped out of the window
// before the negation check runs, so they don't wrongly suppress a real
// certainty-phrase offense (a false negative in the dangerous direction).
const NEGATION_IDIOM_EXCEPTIONS =
  /\b(no doubt|no question|no wonder|no one|not only|not just|not merely|not simply)\b/gi;

/** True if `ch` is a letter or digit under the same definition INTRAWORD_HYPHEN uses. */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function normalizePhrase(input: CertaintyPhraseInput): CertaintyPhraseRule {
  return typeof input === 'string' ? { phrase: input } : input;
}

// Characters that are invisible to a reader but break a plain substring
// search: soft hyphen, zero-width space/joiners, bidi marks, word joiner,
// and the byte-order mark.
const INVISIBLE_CHARS = /[\u00ad\u200b-\u200f\u2060\ufeff]/g;
// Typographic apostrophes, folded to ' so contractions are recognized.
const CURLY_APOSTROPHES = /[\u2018\u2019\u02bc\u2032]/g;
// A hyphen (ASCII or U+2010..U+2012) between two letters/digits reads as a
// space for matching: "fact-checked" and "fact checked" are the same phrase.
const INTRAWORD_HYPHEN = /(?<=[\p{L}\p{N}])[-\u2010-\u2012](?=[\p{L}\p{N}])/gu;
const WHITESPACE_RUN = /\s+/g;

/**
 * Fold text into the form used for matching: Unicode compatibility
 * normalization (NFKC: ligatures, full-width letters, non-breaking spaces),
 * invisible characters removed, intra-word hyphens read as spaces, runs of
 * whitespace collapsed, and (unless case-sensitive) lower-cased.
 *
 * Phrases and claim text are folded the same way, and every position used
 * afterwards (match index, negation window) is a position in the FOLDED
 * string. Mixing positions from the folded string with the original text
 * is a bug: lower-casing "\u0130" changes the string length.
 */
function foldText(text: string, caseSensitive: boolean): string {
  const folded = text
    .normalize('NFKC')
    .replace(INVISIBLE_CHARS, '')
    .replace(CURLY_APOSTROPHES, "'")
    .replace(INTRAWORD_HYPHEN, ' ')
    .replace(WHITESPACE_RUN, ' ');
  return caseSensitive ? folded : folded.toLowerCase();
}

/**
 * Start index of every non-overlapping occurrence of `needle` in `haystack`
 * that starts on a word boundary when `needle` itself starts with a letter
 * or digit — so a phrase like "verified dataset" does not match inside
 * "UNverified dataset", and "100% accurate" does not match inside
 * "2100% accurate". A phrase starting with punctuation (e.g. "(verified)")
 * is unrestricted. The END of a match is never boundary-checked on purpose:
 * plural and inflected forms ("guarantees", "proprietary datasets") are
 * meant to match.
 */
function findOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const needsLeftBoundary = isWordChar(needle[0]);
  const indices: number[] = [];
  let start = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, start);
    if (idx === -1) break;
    if (!needsLeftBoundary || !isWordChar(haystack[idx - 1])) {
      indices.push(idx);
    }
    start = idx + needle.length;
  }
  return indices;
}

/**
 * True if the text immediately preceding a phrase match contains a
 * negation word ("not", "isn't", "without", ...), e.g. "not a
 * proprietary dataset" should not be flagged even though "proprietary
 * dataset" is a certainty phrase. `text` must be the folded string the
 * match index was computed on.
 */
function isNegated(text: string, matchIndex: number, windowSize: number): boolean {
  const start = Math.max(0, matchIndex - windowSize);
  const preceding = text.slice(start, matchIndex).replace(NEGATION_IDIOM_EXCEPTIONS, ' ');
  return NEGATION_WORDS.test(preceding);
}

/**
 * Scan a list of claims (or raw text plus an extractor) for provenance
 * problems: certainty language not backed by an appropriate tier, tiers
 * that require a source but don't have one, and claims carrying an
 * unrecognized tier. Returns a structured list of offenders — not a
 * boolean — so callers can render a real report (which claim, which
 * phrase, why) in a CI failure or a lint output.
 *
 * An empty return value means the claims passed every configured check.
 */
export function validateClaims(
  input: ClaimsInput,
  options: ValidateClaimsOptions = {},
): ClaimOffense[] {
  if (input == null || typeof input !== 'object') {
    throw new TypeError(
      `validateClaims: expected a Claim[] or { text, extractClaims }, got ${JSON.stringify(input)}.`,
    );
  }
  const claims = Array.isArray(input) ? input : input.extractClaims(input.text);
  if (!Array.isArray(claims)) {
    throw new TypeError(
      'validateClaims: extractClaims(text) must return an array of Claim, got ' +
        `${typeof claims}. Check your domain-specific extractor.`,
    );
  }

  const {
    certaintyPhrases = DEFAULT_CERTAINTY_PHRASES,
    certaintyRequiresTier = ['verified'],
    requireSourceRefForTiers = ['verified'],
    caseSensitive = false,
    negationWindow = 40,
  } = options;

  const normalizedPhrases = certaintyPhrases.map(normalizePhrase);
  const offenses: ClaimOffense[] = [];

  for (const claim of claims) {
    const tierIsValid = claim.tier != null && VALID_TIERS.includes(claim.tier);
    const foldedText = foldText(claim.text, caseSensitive);

    for (const { phrase, reason } of normalizedPhrases) {
      const occurrences = findOccurrences(foldedText, foldText(phrase, caseSensitive));
      for (const idx of occurrences) {
        if (isNegated(foldedText, idx, negationWindow)) continue;

        const backed = tierIsValid && certaintyRequiresTier.includes(claim.tier);
        if (backed) continue;

        offenses.push({
          claimId: claim.id,
          claimText: claim.text,
          phrase,
          reason: 'certainty_phrase_without_backing_tier',
          message:
            reason ??
            `Claim uses certainty language ("${phrase}") but is tiered ` +
              `${tierIsValid ? `"${claim.tier}"` : '(missing/invalid tier)'}, not one of: ` +
              `${certaintyRequiresTier.join(', ')}.`,
          tier: typeof claim.tier === 'string' ? claim.tier : null,
        });
      }
    }

    if (!tierIsValid) {
      offenses.push({
        claimId: claim.id,
        claimText: claim.text,
        phrase: null,
        reason: 'unknown_tier',
        message:
          `Claim "${claim.id}" has no valid provenance tier ` +
          `(got ${JSON.stringify(claim.tier)}). Every claim must be ` +
          `'verified', 'modeled', or 'editorial'.`,
        tier: typeof claim.tier === 'string' ? claim.tier : null,
      });
      continue;
    }

    // trim(): a whitespace-only sourceRef ("   ") is truthy but cites
    // nothing — it should not satisfy "must cite what this was checked
    // against" any more than an empty string does.
    if (requireSourceRefForTiers.includes(claim.tier) && !claim.sourceRef?.trim()) {
      offenses.push({
        claimId: claim.id,
        claimText: claim.text,
        phrase: null,
        reason: 'missing_source_ref',
        message:
          `Claim "${claim.id}" is tiered "${claim.tier}" but has no sourceRef. ` +
          `Claims at this tier must cite what they were checked against.`,
        tier: claim.tier,
      });
    }
  }

  return offenses;
}
