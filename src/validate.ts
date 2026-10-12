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
import { readDenseArray, rejectUnknownOptions } from './args.js';
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
 * bad value throws instead of being read as "off". An unknown key (a typo such
 * as `certaintyPhrase` or `negationwindow`) throws `TypeError`.
 */
export interface ValidateClaimsOptions {
  /**
   * Phrases that assert certainty. Defaults to a small generic starter
   * list (`DEFAULT_CERTAINTY_PHRASES`) — override freely; different
   * products need different banned-phrase lists. Must be a dense array of
   * strings or `{ phrase, reason? }` objects (a hole or a non-string phrase
   * throws `TypeError`). Each phrase is folded like claim text and then
   * trimmed, so a trailing space, CR or LF from a loaded file does not stop it
   * matching at the end of a text. A phrase that is empty after that (an empty
   * string, or only whitespace or invisible characters) matches nothing.
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
   * boundary (`, ; . : ! ?`, an em or en dash, or a line break; not a period or
   * comma inside a number or a known abbreviation such as "U.S.") and at the
   * words `and` and `but`, so a negation in an earlier clause or conjunct
   * never suppresses a later phrase. Two narrow cases reach up to 500
   * characters back, past this window but not past a boundary or a
   * subordinating word such as "because": a phrase right after "as", "any",
   * "or", "nor", "be" or "been" ("has not been reviewed by any outside firm or
   * independently verified"), and a negated list ("no representations,
   * warranties or guarantees"). A negation still hides a
   * phrase it does not govern in the same clause (`"Don't miss our
   * independently verified rates."`), so `0` (negation off, including both
   * longer reaches) is the strictest setting. Default 40. Must be an integer
   * >= 0 or `Infinity` (whole clause for every phrase).
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

// ---------------------------------------------------------------------------
// Negation vocabulary. Every list below is small, explicit and English-only on
// purpose: this is a wording lint with a documented error rate, not a parser.
// Each cue is matched as a whole word (letters, digits and apostrophes cannot
// touch either end), case-insensitively, in the folded text.
//
// Every cue that makes the scanner MORE lenient can hide a real overclaim, so
// the weaker cues only reach a phrase a few words away (see `NEGATION_CUE`).

// One alternation, five groups, so the classes cannot overlap:
//   1. subject cues   "no one", "no-one", "nobody": they negate a phrase only
//      when nothing but auxiliary words sits between ("No one can guarantee",
//      "Nobody has independently verified"). "No one disputes this independently
//      verified figure" asserts the figure, so other words in between stop it.
//   2. direct cues    "zero", "lack", "lacks", "lacking": they negate only a
//      phrase that follows directly ("zero guarantees", "lacks independently
//      verified data"). "Zero downtime guaranteed" and "Other apps lack a
//      proprietary dataset like ours" assert what follows, so are reported.
//   3. "unable": only across UNABLE_GAP_WORDS ("unable to guarantee"), never
//      across a second verb ("unable to match our guaranteed rate").
//   4. contrast cues  "instead of", "rather than": only across
//      CONTRAST_GAP_WORDS ("rather than a guarantee"), never across a verb or a
//      possessive ("Get answers rather than guesses with our guarantee").
//   5. strong cues    "not", "never", "no", "none", "nothing", "nor",
//      "neither", "without", "hardly", "barely", "far from", "cannot" and the
//      listed "n't" contractions: they negate anything after them in the same
//      scope and window. "ain't" is left out on purpose: "If it ain't
//      guaranteed we don't sell it" is a slogan that asserts the guarantee.
// Text is folded (curly apostrophes -> straight) before this runs.
// A space inside a multiword cue or idiom also matches a hyphen, because the
// negation check sees hyphens as written ("far-from-guaranteed", "not-just").
const WORD_GAP = '[ \\-\\u2010-\\u2012]';
/** Let every space in a regex source fragment also match a hyphen. */
const hyphenable = (source: string): string => source.replaceAll(' ', WORD_GAP);

const NEGATION_CUE = new RegExp(
  "(?<![\\p{L}\\p{N}'])(?:" +
    '(no[ \\-\\u2010-\\u2012]one|nobody)' +
    '|(zero|lacks|lacking|lack)' +
    '|(unable)' +
    hyphenable('|(instead of|rather than)') +
    hyphenable('|(not|never|no|none|nothing|nor|neither|without|hardly|barely|far from|cannot|') +
    "(?:is|was|are|were|does|do|did|ca|could|wo|would|should|has|have|had|must|need|sha|might|ought)n't)" +
    ")(?![\\p{L}\\p{N}'])",
  'giu',
);

const NO_GAP_WORDS: ReadonlySet<string> = new Set();
const UNABLE_GAP_WORDS: ReadonlySet<string> = new Set([
  'to', 'be', 'been', 'being', 'fully', 'currently', 'yet', 'ever', 'always', 'legally',
]);
const CONTRAST_GAP_WORDS: ReadonlySet<string> = new Set(['a', 'an', 'any', 'be', 'being']);

// Words that may sit between a subject cue ("no one", "nobody") and the phrase
// it negates: auxiliaries, modals and a few adverbs. Anything else (a main
// verb such as "disputes", or "else") means the phrase is not what is negated.
const SUBJECT_CUE_GAP_WORDS: ReadonlySet<string> = new Set([
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'do', 'does', 'did', 'has', 'have', 'had', 'is', 'was', 'are', 'were',
  'be', 'been', 'being', 'ever', 'really', 'truly', 'fully', 'actually', 'yet',
]);
/** The most gap words any cue other than a strong cue may reach across. */
const MAX_GAP_WORDS = 4;

// Idioms that contain a negation word but assert what follows. They are blanked
// out of the window before cues are looked for, so they cannot hide a phrase
// (the dangerous direction). The list is short on purpose and is not a claim
// to cover English:
//   no doubt, no question, no wonder, nothing but, without question,
//   without (a) doubt, not only, not just, not merely, not simply,
//   nothing (else) beats / compares / comes close / tops / matches / rivals,
//   no other + another word ("No other tool gives you ..."; "No other
//     guarantee applies" keeps its negation because the phrase follows directly),
//   (there is / there's) no denying, not to mention, why not,
//   not once has / have / had / did / was / were,
//   a hyphenated "no-" or "zero-" compound on another word ("no-risk",
//     "zero-fee"; but "no-guarantee" still negates, because the phrase follows
//     the hyphen).
// `nothing but` is also cut by the `but` scope rule; it is listed so the idiom
// stays correct if that rule changes. Each also matches with hyphens for
// spaces ("not-just", "without-question").
const ASSERTING_IDIOM = new RegExp(
  '(?<![\\p{L}\\p{N}\'])(?:' +
    [
      'no doubt',
      'no question',
      'no wonder',
      'nothing but',
      'without question',
      'without (?:a )?doubt',
      'not only',
      'not just',
      'not merely',
      'not simply',
      'nothing (?:else )?(?:beats|compares|comes close|tops|matches|rivals)',
      'no other(?= [\\p{L}\\p{N}])',
      "(?:there is |there's )?no denying",
      'not to mention',
      'why not',
      'not once (?:has|have|had|did|was|were)',
      '(?:no|zero)[\\-\\u2010-\\u2012](?!one(?![\\p{L}\\p{N}]))[\\p{L}\\p{N}]+',
    ]
      .map(hyphenable)
      .join('|') +
    ")(?![\\p{L}\\p{N}'])",
  'giu',
);

// A negating prefix attached to the phrase itself: "non-guaranteed", "non
// guaranteed", "non-proprietary dataset", "un-guaranteed", "no-guarantee". It
// only counts when it touches the match: "Non-stop guaranteed support" and
// "No-risk guaranteed trial" are still reported.
const ATTACHED_NEGATING_PREFIX = /(?<![\p{L}\p{N}'])(?:non[- \u2010-\u2013]|un[-\u2010-\u2013]|(?:no|zero)[-\u2010-\u2012])$/iu;

// `and` and `but` end a negation's scope, like a clause boundary does. "No fees
// and guaranteed returns" and "not a guess but a verified dataset" each negate
// only the part before the conjunction, so a phrase after it is reported. The
// price is noise on a negated coordinated list ("we do not use guaranteed and
// verified datasets" reports the second item); `or` and `nor` are left alone
// because "not A or B" negates both. Whole words only, judged on letters and
// digits of any script, so "band" and "butterfly" are not conjunctions.
const SCOPE_ENDING_WORD = /(?<![\p{L}\p{N}_])(?:and|but)(?![\p{L}\p{N}_])/gu;
const HAS_SCOPE_ENDING_WORD = new RegExp(SCOPE_ENDING_WORD.source, 'u');

// A negated list that runs past commas: "no representations, warranties or
// guarantees", "do not use guaranteed, verified, or proprietary datasets". The
// commas do not end the negation when ALL of these hold:
//   - the text from the last comma to the phrase is at most one word, then
//     `or` or `nor`, then at most two of "a an any" (LIST_TAIL);
//   - each comma-separated part before that is one to three words (LIST_ITEM);
//   - the first part that is not a plain item carries a negation that governs
//     what follows it (see `headsNegatedList`).
// "Don't wait, act now or lose your guaranteed rate" and "Don't wait, apply
// today or the guaranteed rate expires" are still reported: an imperative
// never heads a list, and "the" after "or" does not continue one.
// Word characters here include the kept period and comma (see KEPT_PERIOD), so
// "etc." and "1,000" count as one word.
const LIST_TAIL = /^ ?(?:[\p{L}\p{N}'\-\u2010-\u2012\u2024\ufe50]+ )?(?:or|nor) (?:(?:a|an|any) ){0,2}$/iu;
const LIST_ITEM = /^ ?[\p{L}\p{N}'\-\u2010-\u2012\u2024\ufe50]+(?: [\p{L}\p{N}'\-\u2010-\u2012\u2024\ufe50]+){0,2} ?$/u;
const MAX_LIST_ITEMS = 8;
// How far back, in characters, a negated list and a phrase in complement
// position (see COMPLEMENT_LEAD_WORDS) can carry a negation when that is
// farther than `negationWindow`. A cap, so a huge text with no clause
// boundaries cannot make each match rescan everything before it.
const EXTENDED_REACH = 500;
// A clause part that opens with an imperative negation ("Never pay ...",
// "Don't miss ...", "Do not use ..."). It never heads a negated list.
// Opening quotes or brackets and a polite or filler word in front do not hide
// it: "\u201cDon't miss ...", "Please don't miss ...".
const IMPERATIVE_OPENER =
  /^[ "'\p{Ps}\p{Pi}]*(?:(?:please|just|so|now|hey)[ ,]+)*(?:never|don't|do not)(?![\p{L}\p{N}'])/iu;

// Words that put the phrase after them in complement position, where a
// disclaimer's negation usually lands however long the clause is ("not ... as
// guaranteed", "not ... or independently verified", "not ... been
// fact-checked"). See `NegationIndex`. "a", "an", "is" and "are" are left out on
// purpose: "Never worry about a missed payment again thanks to autopay backed by
// a guarantee" and "every quote is guaranteed" are overclaims.
const COMPLEMENT_LEAD_WORDS: ReadonlySet<string> = new Set(['as', 'any', 'or', 'nor', 'be', 'been']);
// Words that start a new clause inside a sentence. The longer reach (see
// `NegationIndex`) stops at them, as it does at a boundary or `and` / `but`: "You
// don't have to take our word for it because every number has been
// independently verified" is reported.
const FAR_REACH_STOP_WORD =
  /(?<![\p{L}\p{N}'])(?:because|since|when|whenever|while|whereas|if|unless|until|so|thanks to|with|which|who|whom|whose|where|after|before|as soon as|that)(?![\p{L}\p{N}'])/giu;
// The same stops end a negation's hold on a list it heads (see
// `headsNegatedList`), with one exception: "that" right after a disclaimer verb
// (DISCLAIMER_VERB_BEFORE) carries the negation into the list, as in "We do not
// warrant that the service will be uninterrupted, error-free, or guaranteed".
// Anywhere else "that" opens a relative clause that asserts: "No signup needed
// for plans that include support, updates, or guaranteed returns" is reported.
const DISCLAIMER_VERB_BEFORE =
  /(?<![\p{L}\p{N}'])(?:warrant|represent|promise|claim|guarantee|state|say|certify|assert|imply|suggest)s? $/iu;
// The last word right before a match, followed by exactly one space.
const PRECEDING_WORD = /(?<![\p{L}\p{N}'])([\p{L}]+) $/u;

// A word for counting gaps: letters and digits, joined by an apostrophe, a
// hyphen or a kept period or comma ("can't", "no-risk", "u.s.", "1,000").
const GAP_WORD = /[\p{L}\p{N}]+(?:['\-\u2010-\u2012\u2024\ufe50][\p{L}\p{N}]+)*/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const LEADING_WORD_AT = /[\p{L}\p{N}]+/uy;

/** True if the code point `cp` is a letter or digit, the definition INTRAWORD_HYPHEN uses. */
export function isWordCodePoint(cp: number | undefined): boolean {
  return cp !== undefined && WORD_CHAR.test(String.fromCodePoint(cp));
}

/**
 * The whole code point that ends just before UTF-16 index `index`, or
 * undefined at the start of the string. Reading `text[index - 1]` returns half
 * of a surrogate pair for a character outside the Basic Multilingual Plane, so
 * a supplementary-plane letter would never look like a letter. A lone
 * (unpaired) surrogate is returned as itself and is not a word character.
 */
export function codePointBefore(text: string, index: number): number | undefined {
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
export const INVISIBLE_CHARS = /\p{Default_Ignorable_Code_Point}/gu;
// Typographic apostrophes, folded to ' so contractions are recognized.
export const CURLY_APOSTROPHES = /[\u2018\u2019\u02bc\u2032]/g;

// Cyrillic and Greek letters that look like Latin letters. NFKC does not fold
// them, so "gu\u0430ranteed" (Cyrillic a) evaded the scan. Each is read as its
// Latin twin, but only inside a word that also contains an ASCII Latin letter,
// so ordinary Cyrillic and Greek words are left alone. The map below is the
// complete list: 33 Cyrillic and 22 Greek letters, each one UTF-16 unit, so
// positions do not move. Cyrillic: lower a e i j o p c s y x h d q w l, upper
// A B E H I J K M O P C S T X Y Q W and palochka as I. Greek: lower alpha iota
// kappa nu omicron rho upsilon chi as a i k v o p u x, upper A B E Z H I K M N
// O P T Y X.
const CONFUSABLE_TO_LATIN: Readonly<Record<string, string>> = Object.freeze({
  '\u0430': 'a', '\u0435': 'e', '\u0456': 'i', '\u0458': 'j', '\u043e': 'o', '\u0440': 'p',
  '\u0441': 'c', '\u0455': 's', '\u0443': 'y', '\u0445': 'x', '\u04bb': 'h', '\u0501': 'd',
  '\u051b': 'q', '\u051d': 'w', '\u04cf': 'l',
  '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041d': 'H', '\u0406': 'I', '\u0408': 'J',
  '\u041a': 'K', '\u041c': 'M', '\u041e': 'O', '\u0420': 'P', '\u0421': 'C', '\u0405': 'S',
  '\u0422': 'T', '\u0425': 'X', '\u0423': 'Y', '\u051a': 'Q', '\u051c': 'W', '\u04c0': 'I',
  '\u03b1': 'a', '\u03b9': 'i', '\u03ba': 'k', '\u03bd': 'v', '\u03bf': 'o', '\u03c1': 'p',
  '\u03c5': 'u', '\u03c7': 'x',
  '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0396': 'Z', '\u0397': 'H', '\u0399': 'I',
  '\u039a': 'K', '\u039c': 'M', '\u039d': 'N', '\u039f': 'O', '\u03a1': 'P', '\u03a4': 'T',
  '\u03a5': 'Y', '\u03a7': 'X',
});
const CONFUSABLE_CHAR = new RegExp(`[${Object.keys(CONFUSABLE_TO_LATIN).join('')}]`, 'gu');
const LETTER_RUN = /[\p{L}\p{M}]+/gu;
const ASCII_LETTER = /[A-Za-z]/;
// Every key of CONFUSABLE_TO_LATIN is in these blocks; a quick pre-check.
const GREEK_OR_CYRILLIC = /[\u0370-\u052f]/;

/** Read Cyrillic and Greek look-alikes as Latin inside words that also contain ASCII Latin letters. */
export function foldConfusables(text: string): string {
  if (!GREEK_OR_CYRILLIC.test(text)) return text;
  return text.replace(LETTER_RUN, (word) =>
    ASCII_LETTER.test(word) ? word.replace(CONFUSABLE_CHAR, (ch) => CONFUSABLE_TO_LATIN[ch] ?? ch) : word,
  );
}

// Periods and commas that do not end a clause. They are swapped for a
// placeholder of the same length in the folded text, so the negation check
// does not see a boundary there; `matchView` swaps them back so matching is
// unchanged. NFKC maps both placeholders to "." and ",", so neither can be
// left in the text by the time this runs.
export const KEPT_PERIOD = '\u2024'; // ONE DOT LEADER
export const KEPT_COMMA = '\ufe50'; // SMALL COMMA
// A decimal point and a thousands separator: "99.9%", "1,000". A negation
// still does not reach past such a number right before the phrase (see
// `pastNumber`).
const DECIMAL_POINT = /(?<=\d)\.(?=\d)/g;
const THOUSANDS_COMMA = /(?<=\d),(?=\d{3}(?!\d))/g;
// Dotted initialisms ("U.S.", "a.m."): every inner period is kept. The final
// one is kept too unless a new sentence plausibly starts there (end of text, a
// line break, or a space and then an opening quote or bracket, an upper-case
// letter or a digit), looking past closing quotes or brackets right after the
// period ("in the U.S.\u201d Guaranteed ..."). "e.g." and "i.e." are not kept at all: they
// often introduce a new claim ("No hidden fees i.e. guaranteed transparent
// pricing").
const INITIALISM = /(?<![\p{L}\p{N}.])(?:\p{L}\.){2,}/gu;
// Abbreviations that are followed by a name or a number, never a sentence end:
// Dr. Mr. Mrs. Ms. Mx. Prof. St. Sr. Jr. vs.
const TITLE_ABBREVIATION = /(?<![\p{L}\p{N}])(?:dr|mr|mrs|ms|mx|prof|st|sr|jr|vs)\.(?= )/giu;
// Abbreviations that can also end a sentence: etc. Inc. Ltd. Co. Corp. approx.
// Kept unless a new sentence plausibly starts after them (as above).
const SENTENCE_FINAL_ABBREVIATION = /(?<![\p{L}\p{N}])(?:etc|inc|ltd|co|corp|approx)\./giu;
// No `i` flag: under `iu`, `\p{Lu}` also matches lower-case letters.
const NEW_SENTENCE_AFTER = /^["'\p{Pe}\p{Pf}]{0,4}(?:$|\n| ["'\p{Ps}\p{Pi}\p{Lu}\p{N}])/u;

/** A few UTF-16 units at `index`: all NEW_SENTENCE_AFTER needs, without copying the rest of the text. */
function peek(text: string, index: number): string {
  return text.slice(index, index + 8);
}

/**
 * Mark the periods and commas that do not end a clause (see KEPT_PERIOD). Runs
 * before lower-casing, because "U.S. Our data" and "U.S. government" differ
 * only in case. Every replacement is one UTF-16 unit for one.
 */
export function markNonBoundaryPunctuation(text: string): string {
  if (!text.includes('.') && !text.includes(',')) return text;
  return text
    .replace(DECIMAL_POINT, KEPT_PERIOD)
    .replace(THOUSANDS_COMMA, KEPT_COMMA)
    .replace(INITIALISM, (dots: string, offset: number) => {
      const lower = dots.toLowerCase();
      if (lower === 'e.g.' || lower === 'i.e.') return dots;
      const inner = dots.slice(0, -1).replaceAll('.', KEPT_PERIOD);
      const keepLast = !NEW_SENTENCE_AFTER.test(peek(text, offset + dots.length));
      return inner + (keepLast ? KEPT_PERIOD : '.');
    })
    .replace(TITLE_ABBREVIATION, (abbr) => abbr.slice(0, -1) + KEPT_PERIOD)
    .replace(SENTENCE_FINAL_ABBREVIATION, (abbr: string, offset: number) =>
      NEW_SENTENCE_AFTER.test(peek(text, offset + abbr.length)) ? abbr : abbr.slice(0, -1) + KEPT_PERIOD,
    );
}

// A hyphen (ASCII or U+2010..U+2012) between two letters/digits reads as a
// space for MATCHING: "fact-checked" and "fact checked" are the same phrase. It
// is not folded in the text the negation check sees, so "no-risk" (a modifier)
// can be told apart from "no risk"; `matchView` applies it.
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
export const WHITESPACE_RUN = /[\s\u0085]+/g;
export const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/;
// A negation only reaches a phrase when none of these sits between them: the
// clause-ending punctuation `, ; . : ! ?`, an em or en dash, or a line break
// (already folded to '\n'). Periods and commas inside numbers and known
// abbreviations were already swapped out (see `markNonBoundaryPunctuation`).
const CLAUSE_BOUNDARY = /[,;.:!?\u2014\u2013\n]/;

/**
 * Fold text into the form the negation check uses: Unicode compatibility
 * normalization (NFKC: ligatures, full-width letters, non-breaking spaces),
 * invisible characters removed, curly apostrophes straightened, Cyrillic and
 * Greek look-alikes inside Latin words read as Latin, runs of whitespace
 * collapsed, periods and commas that do not end a clause marked, and (unless
 * case-sensitive) lower-cased. `matchView` derives the matching form from it.
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
export function foldText(text: string, caseSensitive: boolean): string {
  const folded = markNonBoundaryPunctuation(
    foldConfusables(
      text
        .normalize('NFKC')
        .replace(INVISIBLE_CHARS, '')
        .replace(CURLY_APOSTROPHES, "'"),
    ).replace(WHITESPACE_RUN, (run) => (LINE_BREAK.test(run) ? '\n' : ' ')),
  );
  return caseSensitive ? folded : folded.toLowerCase();
}

/**
 * The folded text as matching sees it, same length: line breaks read as
 * spaces, kept periods and commas are restored, and a hyphen or en dash between
 * two letters or digits reads as a space.
 */
export function matchView(folded: string): string {
  return folded
    .replaceAll('\n', ' ')
    .replaceAll(KEPT_PERIOD, '.')
    .replaceAll(KEPT_COMMA, ',')
    .replace(INTRAWORD_HYPHEN, ' ')
    .replace(INTRAWORD_EN_DASH, ' ');
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
export function findOccurrences(haystack: string, needle: string): number[] {
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
 * True if every word in `text` from `from` to the end is in `allowed`, there
 * are at most MAX_GAP_WORDS of them, and only spaces sit around them: a
 * parenthesis, quote or other punctuation stops the reach ("Our error rate is
 * zero (guaranteed)" is reported). Stops at the first word that fails, so a
 * long clause costs no more than a short one.
 */
function gapFits(text: string, from: number, allowed: ReadonlySet<string>): boolean {
  GAP_WORD.lastIndex = from;
  let last = from;
  for (let count = 0; ; count++) {
    const word = GAP_WORD.exec(text);
    if (word === null) return ONLY_SPACES.test(text.slice(last));
    if (count >= MAX_GAP_WORDS || !ONLY_SPACES.test(text.slice(last, word.index))) return false;
    if (!allowed.has(word[0].toLowerCase())) return false;
    last = word.index + word[0].length;
  }
}
const ONLY_SPACES = /^ *$/;

/** The gap words a non-strong cue may reach across (see NEGATION_CUE), or null for a strong cue. */
function gapWordsFor(cue: RegExpMatchArray, allowSubject: boolean): ReadonlySet<string> | null | undefined {
  if (cue[5] !== undefined) return null;
  if (cue[1] !== undefined) return allowSubject ? SUBJECT_CUE_GAP_WORDS : undefined;
  if (cue[2] !== undefined) return NO_GAP_WORDS;
  if (cue[3] !== undefined) return UNABLE_GAP_WORDS;
  return CONTRAST_GAP_WORDS;
}

/**
 * True if `segment` contains a negation cue that governs its END (where the
 * phrase, or the next list comma, starts): a strong cue anywhere, or another
 * cue whose gap words all fit its class (see NEGATION_CUE). Subject cues count
 * only when `allowSubject`. `segment` has its idioms blanked already.
 */
function hasGoverningCue(segment: string, allowSubject: boolean): boolean {
  for (const cue of segment.matchAll(NEGATION_CUE)) {
    const allowed = gapWordsFor(cue, allowSubject);
    if (allowed === null) return true;
    if (allowed !== undefined && gapFits(segment, cue.index + cue[0].length, allowed)) return true;
  }
  return false;
}

/**
 * True if `part` (the comma-separated part that opens a negated list) carries a
 * negation that governs the items after it ("We make no representations",
 * "Nothing in this article constitutes a recommendation"). An imperative
 * opener ("Never", "Don't", "Do not") never does: it governs its own verb, so
 * "Never pay more for flights, hotels, or guaranteed rental cars" and "Don't
 * wait, apply today or the guaranteed rate expires" are still reported.
 */
function headsNegatedList(raw: string, blanked: string): boolean {
  if (IMPERATIVE_OPENER.test(raw)) return false;
  // A subordinate clause between the negation and the list ends its hold: "No
  // setup required because each plan includes support, updates, or guaranteed
  // returns" is reported.
  // A stop word with nothing after it ("not affiliated with, endorsed by, or
  // guaranteed by") is a dangling preposition, not a new clause.
  let start = 0;
  for (const word of raw.matchAll(FAR_REACH_STOP_WORD)) {
    const end = word.index + word[0].length;
    if (!/[\p{L}\p{N}]/u.test(raw.slice(end))) continue;
    if (word[0].toLowerCase() === 'that' && DISCLAIMER_VERB_BEFORE.test(raw.slice(0, word.index))) continue;
    start = end;
  }
  return hasGoverningCue(blanked.slice(start), false);
}

/** Where the text after the last `and` / `but` starts (0 if there is none). */
function lastScopeEnd(text: string): number {
  let scopeStart = 0;
  for (const word of text.matchAll(SCOPE_ENDING_WORD)) scopeStart = word.index + word[0].length;
  return scopeStart;
}

// A number with a kept period or comma ("5,000", "99.9%") right before the
// phrase. A negation does not reach past it: "No fees on your first $5,000
// guaranteed" is reported.
const NUMBER_BEFORE_PHRASE = /\d[\u2024\ufe50]\d+%? ?$/u;

/** Raise `floor` past a number with a kept separator that sits right before the match. */
function pastNumber(text: string, matchIndex: number, floor: number): number {
  const sliceStart = Math.max(floor, matchIndex - 32);
  const number = NUMBER_BEFORE_PHRASE.exec(text.slice(sliceStart, matchIndex));
  return number === null ? floor : Math.max(floor, sliceStart + number.index + 2);
}

/**
 * Everything `isNegated` looks up, built once per claim the first time a match
 * needs it, so many matches in one long clause stay cheap (each lookup is a
 * binary search): the idiom-blanked folded text, the start of every strong
 * negation cue in it, every clause boundary, the positions that end a cue's
 * reach in the window (a boundary, `and` / `but`), and the positions that also
 * end the longer reach (those plus each FAR_REACH_STOP_WORD).
 */
export class NegationIndex {
  readonly text: string;
  readonly blanked: string;
  readonly strongCues: number[] = [];
  readonly boundaries: number[] = [];
  readonly nearStops: number[];
  readonly farStops: number[];

  constructor(text: string) {
    this.blanked = blankIdioms(text);
    for (const cue of this.blanked.matchAll(NEGATION_CUE)) {
      if (cue[5] !== undefined) this.strongCues.push(cue.index);
    }
    for (let i = 0; i < this.blanked.length; i++) {
      if (CLAUSE_BOUNDARY.test(this.blanked[i] as string)) this.boundaries.push(i);
    }
    // Scope and stop words come from the text as written, not the blanked
    // copy: the "but" in "nothing but" still ends the scope of an earlier
    // negation ("No fees with nothing but guaranteed returns" is reported).
    this.text = text;
    const scopeWords = Array.from(text.matchAll(SCOPE_ENDING_WORD), (m) => m.index);
    const stopWords = Array.from(text.matchAll(FAR_REACH_STOP_WORD), (m) => m.index);
    this.nearStops = [...this.boundaries, ...scopeWords].sort((x, y) => x - y);
    this.farStops = [...this.nearStops, ...stopWords].sort((x, y) => x - y);
  }

  /** Index of the last clause boundary in `[floor, end)`, or `floor - 1` if there is none. */
  boundaryBefore(end: number, floor: number): number {
    const at = lastBefore(this.boundaries, end);
    return at === undefined || at < floor ? floor - 1 : at;
  }

  /** True if a strong cue starts in `[floor, end)` with no stop from `stops` after it. */
  strongCueReaches(end: number, floor: number, stops: readonly number[]): boolean {
    const cue = lastBefore(this.strongCues, end);
    if (cue === undefined || cue < floor) return false;
    const stop = lastBefore(stops, end);
    return stop === undefined || stop < cue;
  }
}

/** The largest value in ascending `list` that is below `limit`. */
function lastBefore(list: readonly number[], limit: number): number | undefined {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((list[mid] as number) < limit) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? undefined : list[lo - 1];
}

/** Per-claim state for `isNegated`: the folded text and its lazily built index. */
export interface NegationContext {
  text: string;
  index?: NegationIndex;
}

// "No other" right before the phrase negates it ("No other guarantee
// applies"); followed by another word it is an asserting idiom (blanked).
const NO_OTHER_BEFORE_PHRASE = /(?<![\p{L}\p{N}'])no[ \-\u2010-\u2012]other[ \-\u2010-\u2012]$/iu;
// How far back, in characters, the tail scan for non-strong cues looks. They
// reach at most MAX_GAP_WORDS words, which fits in this.
const TAIL_SCAN = 160;

/**
 * True if a phrase match is negated in its own clause (see the vocabulary
 * notes above): "not a proprietary dataset", "no one can guarantee",
 * "non-guaranteed", "no representations, warranties or guarantees". The cue
 * must start within `windowSize` characters before the match, and a clause
 * boundary (see CLAUSE_BOUNDARY) or `and` / `but` between the cue and the
 * phrase ends it, so "not guesses, independently verified" is still an
 * offense. `ctx.text` must be the folded string (line breaks as '\n') the
 * match index was computed on. `extendedReach` (default true, what
 * `validateClaims` uses) enables the two longer reaches described at the
 * option `negationWindow`; the copy gate turns it off by default.
 */
export function isNegated(
  ctx: NegationContext,
  matchIndex: number,
  windowSize: number,
  extendedReach = true,
): boolean {
  const text = ctx.text;
  const floor = pastNumber(text, matchIndex, windowStart(text, matchIndex, windowSize));
  const before = text.slice(Math.max(floor, matchIndex - 10), matchIndex);
  if (ATTACHED_NEGATING_PREFIX.test(before) || NO_OTHER_BEFORE_PHRASE.test(before)) return true;

  const index = (ctx.index ??= new NegationIndex(text));
  // Strong cues: anywhere in the window after the last boundary or and/but.
  if (index.strongCueReaches(matchIndex, floor, index.nearStops)) return true;
  // Other cues reach only a few words: scan the tail of the window.
  const stop = lastBefore(index.nearStops, matchIndex);
  const tailStart = windowStart(text, matchIndex, Math.min(matchIndex - Math.max(floor, (stop ?? -1) + 1), TAIL_SCAN));
  if (hasGoverningCue(index.blanked.slice(tailStart, matchIndex), true)) return true;

  if (windowSize === 0 || !extendedReach) return false;
  const reachFloor = pastNumber(text, matchIndex, windowStart(text, matchIndex, Math.max(windowSize, EXTENDED_REACH)));
  if (isNegatedList(index, matchIndex, reachFloor)) return true;

  const lead = PRECEDING_WORD.exec(text.slice(Math.max(reachFloor, matchIndex - 8), matchIndex));
  if (lead === null || !COMPLEMENT_LEAD_WORDS.has((lead[1] as string).toLowerCase())) return false;
  return index.strongCueReaches(matchIndex, reachFloor, index.farStops);
}

/**
 * A negated list that runs past commas (see LIST_TAIL), ending at the match.
 * The walk is not limited by `negationWindow`: a list carries its negation, the
 * way "We do not warrant that the service will be uninterrupted, error-free,
 * or guaranteed" does. It is limited by the shape checks, MAX_LIST_ITEMS and
 * EXTENDED_REACH (`floor`).
 */
function isNegatedList(index: NegationIndex, matchIndex: number, floor: number): boolean {
  const text = index.blanked;
  let boundary = index.boundaryBefore(matchIndex, floor);
  if (boundary < floor || text[boundary] !== ',' || !LIST_TAIL.test(text.slice(boundary + 1, matchIndex))) return false;
  for (let items = 0; items < MAX_LIST_ITEMS; items++) {
    const end = boundary;
    boundary = index.boundaryBefore(end, floor);
    const part = text.slice(boundary + 1, end);
    const raw = index.text.slice(boundary + 1, end);
    const scope = lastScopeEnd(raw);
    if (headsNegatedList(raw.slice(scope), part.slice(scope))) return true;
    if (HAS_SCOPE_ENDING_WORD.test(raw)) return false;
    // Keep walking back only over short items joined by commas.
    if (!LIST_ITEM.test(part) || boundary < floor || text[boundary] !== ',') return false;
  }
  return false;
}

/**
 * Where a look-back of `size` characters from `matchIndex` starts. A window that
 * starts inside a word would leave only the tail of it, and the tail of
 * "casino" or "knot" reads as the negation "no" or "not". That partial word is
 * skipped: it did not fit in the window, like any other word.
 */
function windowStart(text: string, matchIndex: number, size: number): number {
  const floor = Math.max(0, matchIndex - size);
  if (!isWordCodePoint(codePointBefore(text, floor))) return floor;
  LEADING_WORD_AT.lastIndex = floor;
  return LEADING_WORD_AT.test(text) ? Math.min(LEADING_WORD_AT.lastIndex, matchIndex) : floor;
}

/** Blank asserting idioms with spaces, so the remaining text keeps its shape. */
function blankIdioms(text: string): string {
  return text.replace(ASSERTING_IDIOM, (idiom) => ' '.repeat(idiom.length));
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
      // Trimmed after folding, so a phrase loaded with a trailing space, CR or
      // LF still matches at the end of a text, and a phrase that is only
      // whitespace is empty and matches nothing.
      folded: matchView(foldText(phrase as string, caseSensitive)).trim(),
    };
  });
}

const KNOWN_OPTIONS: readonly string[] = Object.freeze([
  'certaintyPhrases',
  'certaintyRequiresTier',
  'requireSourceRefForTiers',
  'caseSensitive',
  'negationWindow',
]);

/** Read every option once and validate it. Nothing here touches a claim. */
function readOptions(options: unknown): ScanOptions {
  if (!isPlainObject(options)) {
    throw new TypeError(`${PREFIX}options must be a plain object or undefined (received ${describeType(options)}).`);
  }
  const raw = options;
  rejectUnknownOptions(raw, KNOWN_OPTIONS, FN);
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
 *   between two letters or digits), spacing (a line break reads as a space),
 *   a fixed list of Cyrillic and Greek look-alike letters inside words that
 *   also contain ASCII Latin letters, and, unless `caseSensitive`, case.
 * - A phrase that starts with a letter or digit must start on a word boundary,
 *   judged on whole code points. The end of a match is never boundary-checked.
 * - A negation word suppresses a phrase only inside the same clause, after the
 *   last `and` or `but`, and within `negationWindow` (see that option for the
 *   two longer reaches). The negation vocabulary is English. It is a window
 *   with small, explicit word lists, not a parser: it can still suppress an
 *   overclaim the negation does not govern.
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
    const negation: NegationContext = { text: foldedText };

    for (const { phrase, reason, folded } of config.phrases) {
      for (const idx of findOccurrences(searchText, folded)) {
        if (isNegated(negation, idx, negationWindow)) continue;
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
