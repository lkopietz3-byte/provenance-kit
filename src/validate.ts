// src/validate.ts
//
// The scanner. Turns "does this claim sound more certain than its tier
// allows" from an implicit copywriting judgment into a machine-checkable
// rule, so it can run in CI and fail a build the same way a type error
// does. It checks wording against a declared tier; it cannot check that a
// claim is true.
//
// Two rules run through this file:
//   1. Caller input is read ONCE. A getter, a Proxy or a sparse array can
//      answer differently the second time, so `readOptions` and `readClaims`
//      copy everything a single time and the scan only uses those copies.
//   2. A malformed argument throws a clear error; it never silently changes
//      what is scanned (an option read as "off", a hole skipped).

import type { Claim, ProvenanceTier } from './types.js';
import { PROVENANCE_TIERS } from './types.js';
import { readDenseArray } from './args.js';
import { DEFAULT_CERTAINTY_PHRASES, type CertaintyPhraseInput } from './certainty-phrases.js';
import {
  describeType,
  displayValue,
  escapeForDisplay,
  isArray,
  isPlainObject,
  isVisiblyBlank,
} from './text.js';

const FN = 'validateClaims';
const PREFIX = `${FN}: `;

/** Why a given offense was raised. */
export type ClaimOffenseReason =
  | 'certainty_phrase_without_backing_tier'
  | 'missing_source_ref'
  | 'unknown_tier';

/** A single flagged problem with a claim. One claim can produce several. */
export interface ClaimOffense {
  /** id of the offending claim, exactly as given (not escaped). */
  claimId: string;
  /** text of the offending claim, for context in a report, exactly as given (not escaped). */
  claimText: string;
  /**
   * The specific certainty phrase matched, as the caller wrote it (not the
   * folded form and not escaped), or null for non-phrase offenses.
   */
  phrase: string | null;
  /** Machine-checkable reason code. */
  reason: ClaimOffenseReason;
  /**
   * Human-readable explanation, suitable for a CI failure message. Safe to
   * print: control characters, line breaks and bidi formatting characters that
   * came from caller strings are shown as `\uXXXX` escapes.
   */
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

/**
 * Options for `validateClaims`. The whole object must be a plain object (or
 * `undefined`); every field is validated before any claim is scanned, and a
 * bad value throws instead of being read as "off".
 */
export interface ValidateClaimsOptions {
  /**
   * Phrases that assert certainty. Defaults to a small generic starter
   * list (`DEFAULT_CERTAINTY_PHRASES`) — override freely; different
   * products need different banned-phrase lists. Must be a dense array of
   * strings or `{ phrase, reason? }` objects (a hole or a non-string phrase
   * throws `TypeError`). A phrase that is empty after folding (for example an
   * empty string, or only invisible characters) matches nothing.
   */
  certaintyPhrases?: readonly CertaintyPhraseInput[];
  /**
   * Tiers strong enough to back a certainty phrase. A claim using
   * certainty language whose tier is NOT in this list gets flagged.
   * Default: `['verified']`. Must be a dense array of the three tier names
   * (`TypeError` for a wrong type, `RangeError` for an unknown name).
   */
  certaintyRequiresTier?: ProvenanceTier[];
  /**
   * Tiers that must carry a non-empty `sourceRef`. Default: `['verified']`
   * — a claim asserting it was checked against a source should say what
   * that source was. Validated like `certaintyRequiresTier`, so a misspelled
   * tier throws instead of silently requiring nothing.
   */
  requireSourceRefForTiers?: ProvenanceTier[];
  /** Case-sensitive phrase matching. Default false. Must be a real boolean. */
  caseSensitive?: boolean;
  /**
   * How many characters before a phrase match to scan for a negation word,
   * counted in the folded text. The scan also stops at the nearest clause
   * boundary (`, ; . : ! ?`, an em or en dash, or a line break) and at the
   * words `and` and `but`, so a negation in an earlier clause or conjunct
   * never suppresses a later phrase. A negation still hides a phrase it does
   * not govern in the same clause (`"Don't miss our independently verified
   * rates."`), so `0` (negation off) is the strictest setting. Default 40.
   * Must be an integer >= 0 or `Infinity` (whole clause); `0` turns negation
   * handling off.
   */
  negationWindow?: number;
}

/**
 * Either a ready-made claim list, or raw text plus a domain-specific
 * extractor. The list (or the extractor's return value) must be a dense
 * array; `extractClaims` runs once and must return synchronously.
 */
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
// "no doubt X", "not only X", "without question X" and "nothing but X" all
// assert X. (`but` also ends a negation's scope, see SCOPE_ENDING_WORD, so
// "nothing but" is reported either way; it is listed so the idiom stays
// correct if that rule changes.) Stripped out of the window
// before the negation check runs, so they don't wrongly suppress a real
// certainty-phrase offense (a false negative in the dangerous direction).
const NEGATION_IDIOM_EXCEPTIONS =
  /\b(no doubt|no question|no wonder|no one|nothing but|without question|not only|not just|not merely|not simply)\b/gi;

// `and` and `but` end a negation's scope, like a clause boundary does. "No fees
// and guaranteed returns" and "not a guess but a verified dataset" each negate
// only the part before the conjunction, so a phrase after it is reported. The
// price is noise on a negated coordinated list ("we do not use guaranteed and
// verified datasets" reports the second item); `or` and `nor` are left alone
// because "not A or B" negates both. Whole words only, judged on letters and
// digits of any script, so "band" and "butterfly" are not conjunctions.
const SCOPE_ENDING_WORD = /(?<![\p{L}\p{N}_])(?:and|but)(?![\p{L}\p{N}_])/gu;

const WORD_CHAR = /[\p{L}\p{N}]/u;
const LEADING_WORD = /^[\p{L}\p{N}]+/u;

/** True if the code point `cp` is a letter or digit, the definition INTRAWORD_HYPHEN uses. */
function isWordCodePoint(cp: number | undefined): boolean {
  return cp !== undefined && WORD_CHAR.test(String.fromCodePoint(cp));
}

/**
 * The whole code point that ends just before UTF-16 index `index`, or
 * undefined at the start of the string. Reading `text[index - 1]` returns half
 * of a surrogate pair for a character outside the Basic Multilingual Plane, so
 * a supplementary-plane letter would never look like a letter. A lone
 * (unpaired) surrogate is returned as itself and is not a word character.
 */
function codePointBefore(text: string, index: number): number | undefined {
  if (index <= 0) return undefined;
  const unit = text.charCodeAt(index - 1);
  if (unit >= 0xdc00 && unit <= 0xdfff && index >= 2) {
    const lead = text.charCodeAt(index - 2);
    if (lead >= 0xd800 && lead <= 0xdbff) return text.codePointAt(index - 2);
  }
  return unit;
}

// Characters a renderer draws as nothing but that break a plain substring
// search: the Unicode Default_Ignorable_Code_Point property. It covers the
// soft hyphen, zero-width space and joiners, every bidi control (marks,
// embeddings, overrides and the isolates U+2066-2069, U+061C), the word
// joiner, invisible math operators, variation selectors, Hangul fillers, the
// byte-order mark and tag characters. A hand-written range list missed the
// isolates and U+061C, so "independently\u2066 verified" evaded the scan.
const INVISIBLE_CHARS = /\p{Default_Ignorable_Code_Point}/gu;
// Typographic apostrophes, folded to ' so contractions are recognized.
const CURLY_APOSTROPHES = /[\u2018\u2019\u02bc\u2032]/g;
// A hyphen (ASCII or U+2010..U+2012) between two letters/digits reads as a
// space for matching: "fact-checked" and "fact checked" are the same phrase.
const INTRAWORD_HYPHEN = /(?<=[\p{L}\p{N}])[-\u2010-\u2012](?=[\p{L}\p{N}])/gu;
// An en dash directly between two letters/digits also reads as a space for
// MATCHING ("fact\u2013checked" is "fact-checked" to a reader). It is not folded
// in the text the negation check sees, because an unspaced en dash is also a
// clause boundary there ("not guesses\u2013proprietary dataset"); `matchView`
// applies it.
const INTRAWORD_EN_DASH = /(?<=[\p{L}\p{N}])\u2013(?=[\p{L}\p{N}])/gu;
// Any run of whitespace (JS `\s` plus U+0085, which `\s` omits) collapses to
// one character. A run that contains a line break becomes '\n' instead of ' ',
// so the negation check can still see where a line ended (see `foldText`).
const WHITESPACE_RUN = /[\s\u0085]+/g;
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/;
// A negation only reaches a phrase when none of these sits between them: the
// clause-ending punctuation `, ; . : ! ?`, an em or en dash, or a line break
// (already folded to '\n').
const CLAUSE_BOUNDARY = /[,;.:!?\u2014\u2013\n]/;

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
 *
 * A whitespace run that contains a line break folds to '\n' rather than ' '
 * so the negation check can treat a line break as a clause boundary. Matching
 * must not see that difference: `matchView` turns every '\n' back into a
 * space, one character for one character, so positions are identical in both
 * views.
 */
function foldText(text: string, caseSensitive: boolean): string {
  const folded = text
    .normalize('NFKC')
    .replace(INVISIBLE_CHARS, '')
    .replace(CURLY_APOSTROPHES, "'")
    .replace(INTRAWORD_HYPHEN, ' ')
    .replace(WHITESPACE_RUN, (run) => (LINE_BREAK.test(run) ? '\n' : ' '));
  return caseSensitive ? folded : folded.toLowerCase();
}

/**
 * The folded text as matching sees it: line breaks and an en dash between two
 * letters or digits read as spaces, same length.
 */
function matchView(folded: string): string {
  return folded.replaceAll('\n', ' ').replace(INTRAWORD_EN_DASH, ' ');
}

/**
 * Start index of every non-overlapping accepted occurrence of `needle` in
 * `haystack`. A needle that starts with a letter or digit (judged on its first
 * whole code point) is accepted only on a word boundary: the code point before
 * it must not be a letter or digit, so a phrase like "verified dataset" does
 * not match inside "UNverified dataset", or after a supplementary-plane letter,
 * and "100% accurate" does not match inside "2100% accurate". A phrase starting
 * with punctuation (e.g. "(verified)") is unrestricted. The END of a match is
 * never boundary-checked on purpose: plural and inflected forms ("guarantees",
 * "proprietary datasets") are meant to match.
 *
 * An empty needle matches nothing. The early return is load-bearing:
 * `indexOf('', start)` returns `start`, so without it the scan below would
 * never advance.
 */
function findOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const needsLeftBoundary = isWordCodePoint(needle.codePointAt(0));
  const indices: number[] = [];
  let start = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, start);
    if (idx === -1) break;
    if (!needsLeftBoundary || !isWordCodePoint(codePointBefore(haystack, idx))) {
      indices.push(idx);
      // Accepted matches do not overlap.
      start = idx + needle.length;
    } else {
      // A rejected candidate must not hide a valid one that starts inside it.
      start = idx + 1;
    }
  }
  return indices;
}

/**
 * True if the same clause, up to `windowSize` characters before a phrase
 * match, contains a negation word ("not", "isn't", "without", ...), e.g.
 * "not a proprietary dataset" should not be flagged even though
 * "proprietary dataset" is a certainty phrase. A clause boundary (see
 * CLAUSE_BOUNDARY) between the negation and the phrase ends the negation:
 * "not guesses, independently verified" is still an offense. `text` must be
 * the folded string (line breaks as '\n') the match index was computed on.
 */
function isNegated(text: string, matchIndex: number, windowSize: number): boolean {
  const start = Math.max(0, matchIndex - windowSize);
  let preceding = text.slice(start, matchIndex);
  // A window that starts inside a word would leave only the tail of it, and
  // the tail of "casino" or "knot" reads as the negation "no" or "not". Drop
  // that partial word: it did not fit in the window, like any other word.
  if (isWordCodePoint(codePointBefore(text, start))) {
    preceding = preceding.replace(LEADING_WORD, '');
  }
  for (let i = preceding.length - 1; i >= 0; i--) {
    if (CLAUSE_BOUNDARY.test(preceding[i] as string)) {
      preceding = preceding.slice(i + 1);
      break;
    }
  }
  // The last `and` / `but` ends the scope: only what follows it can negate.
  let scopeStart = 0;
  for (const word of preceding.matchAll(SCOPE_ENDING_WORD)) scopeStart = word.index + word[0].length;
  preceding = preceding.slice(scopeStart);
  return NEGATION_WORDS.test(preceding.replace(NEGATION_IDIOM_EXCEPTIONS, ' '));
}

interface ScanOptions {
  phrases: { phrase: string; reason: string | undefined; folded: string }[];
  certaintyRequiresTier: readonly ProvenanceTier[];
  requireSourceRefForTiers: readonly ProvenanceTier[];
  caseSensitive: boolean;
  negationWindow: number;
}

/** One claim, copied once from caller input and checked for shape. */
interface ClaimSnapshot {
  id: string;
  text: string;
  /** Not validated here: an unrecognized tier is reported as an offense. */
  tier: unknown;
  sourceRef: string | undefined;
}

function isTier(value: unknown): value is ProvenanceTier {
  return typeof value === 'string' && (PROVENANCE_TIERS as readonly string[]).includes(value);
}

function readTierList(value: unknown, name: string, fallback: readonly ProvenanceTier[]): readonly ProvenanceTier[] {
  if (value === undefined) return fallback;
  if (!isArray(value)) {
    throw new TypeError(`${PREFIX}options.${name} must be an array (received ${describeType(value)}).`);
  }
  const tiers = readDenseArray(value, `options.${name}`, FN);
  tiers.forEach((tier, i) => {
    if (typeof tier !== 'string') {
      throw new TypeError(
        `${PREFIX}options.${name}[${i}] must be a string tier name (received ${describeType(tier)}).`,
      );
    }
    if (!isTier(tier)) {
      throw new RangeError(
        `${PREFIX}options.${name}[${i}] must be one of ${PROVENANCE_TIERS.join(', ')} ` +
          `(received ${displayValue(tier)}).`,
      );
    }
  });
  return tiers as ProvenanceTier[];
}

function readPhrases(value: unknown, caseSensitive: boolean): ScanOptions['phrases'] {
  const input = value === undefined ? DEFAULT_CERTAINTY_PHRASES : value;
  if (!isArray(input)) {
    throw new TypeError(`${PREFIX}options.certaintyPhrases must be an array (received ${describeType(input)}).`);
  }
  return readDenseArray(input, 'options.certaintyPhrases', FN).map((entry, i) => {
    const name = `options.certaintyPhrases[${i}]`;
    let phrase: unknown = entry;
    let reason: unknown;
    if (typeof entry !== 'string') {
      if (typeof entry !== 'object' || entry === null || isArray(entry)) {
        throw new TypeError(`${PREFIX}${name} must be a string or { phrase, reason } (received ${describeType(entry)}).`);
      }
      const rule = entry as { phrase?: unknown; reason?: unknown };
      phrase = rule.phrase;
      reason = rule.reason;
      if (typeof phrase !== 'string') {
        throw new TypeError(`${PREFIX}${name}.phrase must be a string (received ${describeType(phrase)}).`);
      }
      if (reason !== undefined && reason !== null && typeof reason !== 'string') {
        throw new TypeError(`${PREFIX}${name}.reason must be a string (received ${describeType(reason)}).`);
      }
    }
    return {
      phrase: phrase as string,
      reason: typeof reason === 'string' && !isVisiblyBlank(reason) ? reason : undefined,
      folded: matchView(foldText(phrase as string, caseSensitive)),
    };
  });
}

/** Read every option once and validate it. Nothing here touches a claim. */
function readOptions(options: unknown): ScanOptions {
  if (!isPlainObject(options)) {
    throw new TypeError(`${PREFIX}options must be a plain object or undefined (received ${describeType(options)}).`);
  }
  const raw = options;
  const certaintyPhrases = raw.certaintyPhrases;
  const certaintyRequiresTier = raw.certaintyRequiresTier;
  const requireSourceRefForTiers = raw.requireSourceRefForTiers;
  const rawCaseSensitive = raw.caseSensitive;
  const rawNegationWindow = raw.negationWindow;
  const caseSensitive = rawCaseSensitive === undefined ? false : rawCaseSensitive;
  const negationWindow = rawNegationWindow === undefined ? 40 : rawNegationWindow;

  if (typeof caseSensitive !== 'boolean') {
    throw new TypeError(`${PREFIX}options.caseSensitive must be a boolean (received ${describeType(caseSensitive)}).`);
  }
  if (typeof negationWindow !== 'number') {
    throw new TypeError(`${PREFIX}options.negationWindow must be a number (received ${describeType(negationWindow)}).`);
  }
  if (!(negationWindow === Infinity || (Number.isInteger(negationWindow) && negationWindow >= 0))) {
    throw new RangeError(
      `${PREFIX}options.negationWindow must be an integer >= 0 or Infinity (received ${describeType(negationWindow)}).`,
    );
  }
  return {
    phrases: readPhrases(certaintyPhrases, caseSensitive),
    certaintyRequiresTier: readTierList(certaintyRequiresTier, 'certaintyRequiresTier', ['verified']),
    requireSourceRefForTiers: readTierList(requireSourceRefForTiers, 'requireSourceRefForTiers', ['verified']),
    caseSensitive,
    negationWindow,
  };
}

/** Copy one claim once and check the shape of the fields the scan uses. */
function readClaim(entry: unknown, index: number): ClaimSnapshot {
  const name = `${PREFIX}claims[${index}]`;
  if (typeof entry !== 'object' || entry === null || isArray(entry)) {
    throw new TypeError(`${name} must be an object (received ${describeType(entry)}).`);
  }
  const record = entry as Record<string, unknown>;
  const id = record.id;
  const text = record.text;
  const tier = record.tier;
  const sourceRef = record.sourceRef;
  if (typeof id !== 'string') {
    throw new TypeError(`${name}.id must be a string (received ${describeType(id)}).`);
  }
  if (typeof text !== 'string') {
    throw new TypeError(`${name}.text must be a string (received ${describeType(text)}).`);
  }
  if (sourceRef !== undefined && sourceRef !== null && typeof sourceRef !== 'string') {
    throw new TypeError(`${name}.sourceRef must be a string, null or undefined (received ${describeType(sourceRef)}).`);
  }
  return { id, text, tier, sourceRef: sourceRef ?? undefined };
}

/** Resolve `input` to a dense list of claim snapshots, reading everything once. */
function readClaims(input: unknown): ClaimSnapshot[] {
  if (input === null || typeof input !== 'object') {
    throw new TypeError(
      `${PREFIX}expected a Claim[] or { text, extractClaims }, got ${describeType(input)}.`,
    );
  }
  let claims: unknown;
  if (isArray(input)) {
    claims = input;
  } else {
    const source = input as { text?: unknown; extractClaims?: unknown };
    const extractClaims = source.extractClaims;
    const text = source.text;
    if (typeof extractClaims !== 'function') {
      throw new TypeError(`${PREFIX}extractClaims must be a function (received ${describeType(extractClaims)}).`);
    }
    if (typeof text !== 'string') {
      throw new TypeError(`${PREFIX}text must be a string (received ${describeType(text)}).`);
    }
    claims = (extractClaims as (text: string) => unknown).call(input, text);
    if (!isArray(claims)) {
      throw new TypeError(
        `${PREFIX}extractClaims(text) must return an array of Claim, got ` +
          `${claims instanceof Promise ? 'a promise (async extractors are not supported)' : describeType(claims)}. ` +
          'Check your domain-specific extractor.',
      );
    }
  }
  return readDenseArray(claims as unknown[], 'claims', FN).map(readClaim);
}

/**
 * Scan a list of claims (or raw text plus an extractor) for provenance
 * problems: certainty language not backed by an appropriate tier, tiers
 * that require a source but don't have one, and claims carrying an
 * unrecognized tier. Returns a structured list of offenders — not a
 * boolean — so callers can render a real report (which claim, which
 * phrase, why) in a CI failure or a lint output.
 *
 * An empty return value means the claims passed every configured check
 * under those rules. It does not mean the claims are true.
 *
 * Input rules:
 * - `input` is a `Claim[]` or `{ text, extractClaims }`. `extractClaims` is
 *   called once, as a method of `input`, and must return an array
 *   synchronously.
 * - The claims list must be dense: a hole in a sparse array throws
 *   `TypeError`, as does a claim that is not an object, an `id` or `text` that
 *   is not a string, or a `sourceRef` that is not a string, `null` or
 *   `undefined`. A wrong or unknown `tier` is NOT an error: it is reported as
 *   an `unknown_tier` offense.
 * - Everything the caller passes in (claims, options, getters, proxies) is
 *   read once and copied before any check runs; nothing is mutated.
 *   Bad `options` throw `TypeError` or `RangeError` before any claim is scanned.
 *
 * Text rules:
 * - Matching folds Unicode compatibility forms, invisible formatting
 *   characters, hyphenation (an ASCII hyphen, U+2010 to U+2012 or an en dash
 *   between two letters or digits), spacing (a line break reads as a space)
 *   and, unless `caseSensitive`, case.
 * - A phrase that starts with a letter or digit must start on a word boundary,
 *   judged on whole code points. The end of a match is never boundary-checked.
 * - A negation word suppresses a phrase only inside the same clause, after the
 *   last `and` or `but`, and within `negationWindow`. It is a window, not a
 *   parser: it can still suppress an overclaim the negation does not govern.
 * - `message` text is safe to print: control characters, line breaks and bidi
 *   formatting characters that came from caller strings are shown as `\uXXXX`
 *   escapes. `claimId`, `claimText` and `phrase` are structured data and are
 *   returned exactly as given.
 *
 * @throws {TypeError} malformed `input`, claims or options (see above).
 * @throws {RangeError} an out-of-range option value.
 */
export function validateClaims(
  input: ClaimsInput,
  options: ValidateClaimsOptions = {},
): ClaimOffense[] {
  const config = readOptions(options);
  const claims = readClaims(input);
  const { certaintyRequiresTier, requireSourceRefForTiers, caseSensitive, negationWindow } = config;
  const offenses: ClaimOffense[] = [];

  for (const claim of claims) {
    const tier = claim.tier;
    const validTier = isTier(tier) ? tier : undefined;
    const tierField = typeof tier === 'string' ? tier : null;
    const foldedText = foldText(claim.text, caseSensitive);
    const searchText = matchView(foldedText);

    for (const { phrase, reason, folded } of config.phrases) {
      for (const idx of findOccurrences(searchText, folded)) {
        if (isNegated(foldedText, idx, negationWindow)) continue;
        // `certaintyRequiresTier` holds only valid tier strings, so a claim tier
        // that is not a string in that list (a String object, an array, ...) is never "backed".
        if ((certaintyRequiresTier as readonly unknown[]).includes(tier)) continue;

        offenses.push({
          claimId: claim.id,
          claimText: claim.text,
          phrase,
          reason: 'certainty_phrase_without_backing_tier',
          message:
            reason !== undefined
              ? escapeForDisplay(reason)
              : `Claim uses certainty language ("${escapeForDisplay(phrase)}") but is tiered ` +
                `${validTier !== undefined ? `"${validTier}"` : '(missing/invalid tier)'}, not one of: ` +
                `${certaintyRequiresTier.join(', ')}.`,
          tier: tierField,
        });
      }
    }

    if (validTier === undefined) {
      offenses.push({
        claimId: claim.id,
        claimText: claim.text,
        phrase: null,
        reason: 'unknown_tier',
        message:
          `Claim "${escapeForDisplay(claim.id)}" has no valid provenance tier ` +
          `(got ${displayValue(tier)}). Every claim must be ` +
          `'verified', 'modeled', or 'editorial'.`,
        tier: tierField,
      });
      continue;
    }

    // A sourceRef of only whitespace, zero-width or bidi control characters
    // is "visibly empty": it cites nothing, exactly like an empty string.
    if (
      requireSourceRefForTiers.includes(validTier) &&
      (claim.sourceRef === undefined || isVisiblyBlank(claim.sourceRef))
    ) {
      offenses.push({
        claimId: claim.id,
        claimText: claim.text,
        phrase: null,
        reason: 'missing_source_ref',
        message:
          `Claim "${escapeForDisplay(claim.id)}" is tiered "${validTier}" but has no sourceRef. ` +
          `Claims at this tier must cite what they were checked against.`,
        tier: validTier,
      });
    }
  }

  return offenses;
}
