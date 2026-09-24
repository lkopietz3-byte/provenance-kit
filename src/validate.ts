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

const NEGATION_WORDS =
  /\b(not|never|no|isn't|is not|wasn't|was not|aren't|are not|weren't|were not|n't|without|nor|hardly|barely|far from)\b/i;

function normalizePhrase(input: CertaintyPhraseInput): CertaintyPhraseRule {
  return typeof input === 'string' ? { phrase: input } : input;
}

function findOccurrences(haystack: string, needle: string, caseSensitive: boolean): number[] {
  if (!needle) return [];
  const h = caseSensitive ? haystack : haystack.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  const indices: number[] = [];
  let start = 0;
  for (;;) {
    const idx = h.indexOf(n, start);
    if (idx === -1) break;
    indices.push(idx);
    start = idx + n.length;
  }
  return indices;
}

/**
 * True if the text immediately preceding a phrase match contains a
 * negation word ("not", "isn't", "without", ...), e.g. "not a
 * proprietary dataset" should not be flagged even though "proprietary
 * dataset" is a certainty phrase.
 */
function isNegated(text: string, matchIndex: number, windowSize: number): boolean {
  const start = Math.max(0, matchIndex - windowSize);
  const preceding = text.slice(start, matchIndex);
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
  const claims = Array.isArray(input) ? input : input.extractClaims(input.text);

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

    for (const { phrase, reason } of normalizedPhrases) {
      const occurrences = findOccurrences(claim.text, phrase, caseSensitive);
      for (const idx of occurrences) {
        if (isNegated(claim.text, idx, negationWindow)) continue;

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

    if (requireSourceRefForTiers.includes(claim.tier) && !claim.sourceRef) {
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
