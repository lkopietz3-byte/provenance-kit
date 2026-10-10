// src/copy-gate.ts
//
// The copy gate. Scans text you already read (pages, strings, files) against a
// ledger of banned, retracted and strength-word rules, and checks that
// required statements are present. It reuses the folding and the negation
// machinery of `validateClaims` (see validate.ts) rather than writing a second
// engine, and adds three things the claim validator has no use for: positions
// in the ORIGINAL text, a narrow quoted-use exemption, and a nearby-check rule
// for strength words.
//
// It is a text lint. It never decides that a sentence is true. A clean result
// means no rule matched; it does not mean the copy is honest.
//
// Same rules as validate.ts: caller input is read once and copied, malformed
// input throws, "can't tell" is never a pass. No file or network access here.

import { readDenseArray, rejectUnknownOptions } from './args.js';
import { describeType, displayValue, escapeForDisplay, isArray, isPlainObject, isVisiblyBlank } from './text.js';
import {
  CURLY_APOSTROPHES,
  INVISIBLE_CHARS,
  KEPT_COMMA,
  KEPT_PERIOD,
  LINE_BREAK,
  WHITESPACE_RUN,
  findOccurrences,
  foldConfusables,
  isNegated,
  markNonBoundaryPunctuation,
  matchView,
  type NegationContext,
} from './validate.js';

const FN = 'scanCopy';

/** What a rule is for. Offenses carry it so a report can group them. */
export type CopyRuleKind = 'banned' | 'retracted' | 'strength';

/** One entry of the copy ledger. */
export interface CopyRule {
  /** Stable id, unique in the ledger. Offenses refer to it. */
  id: string;
  /**
   * A phrase, or a `RegExp`. A phrase is folded like the text (NFKC, invisible
   * characters, look-alike letters, case, hyphens and line breaks read as
   * spaces) and must start on a word boundary; its end is not checked, so
   * plurals and inflections match. A `RegExp` is cloned, forced global and
   * non-sticky, and run on the folded text with case kept, so it needs its own
   * `i` flag, and with line breaks and runs of whitespace read as one space and
   * hyphens left alone (write `[-\s]` to accept both).
   */
  pattern: string | RegExp;
  /** Why the copy is not allowed. Shown in reports, returned exactly as given. */
  reason: string;
  /** Wording to use instead. Returned on the offense; `null` there when absent. */
  replacement?: string | null;
  kind: CopyRuleKind;
  /** Skip a match that is negated in its own clause ("we do not guarantee"). Default true. */
  exemptNegated?: boolean;
  /**
   * Skip a match that is mentioned, not used: the whole quotation is the
   * phrase, as in a glossary of banned words. Default true. See the README for
   * the exact rule; a quotation around more than the phrase is still an offense.
   */
  exemptQuoted?: boolean;
  /**
   * A text that must trigger this rule, used by `plantedViolationsFail`. A string
   * pattern plants itself when this is absent; a `RegExp` needs one.
   */
  sample?: string;
}

/** A text to scan, already read by the caller. */
export interface CopySource {
  /** Unique within one scan. Offenses and missing statements refer to it. */
  id: string;
  text: string;
}

/** A statement that must appear in the copy (a disclaimer, a methodology link). */
export interface RequiredStatement {
  id: string;
  /** Matched after folding, like a string `pattern`: case, hyphens, spacing and line breaks do not matter. */
  phrase: string;
  /**
   * Only these sources must carry it. Omitted means every source scanned. An id
   * that is not among the sources scanned counts as missing it.
   */
  sourceIds?: readonly string[];
}

export interface ScanCopyOptions {
  /** Statements that must appear. */
  required?: readonly RequiredStatement[];
  /**
   * What counts as a check reference for strength words: a phrase, a `RegExp`
   * (a link to a methodology page, a `[[check:id]]` token) or an array of them.
   * Absent or empty means no strength word can ever be backed, so every
   * strength match is an offense.
   */
  checkReference?: string | RegExp | readonly (string | RegExp)[];
  /** Characters of folded text, each side of a strength word, searched for a check reference. Default 120. Integer >= 0 or `Infinity`. */
  checkWindow?: number;
  /** Case-sensitive string patterns and required phrases. Default false. `RegExp` patterns always use their own flags. */
  caseSensitive?: boolean;
  /**
   * How far before a match a negation word counts, as in `validateClaims`.
   * Default 40. `0` turns the negation exemption off, so every match is an offense.
   */
  negationWindow?: number;
  /**
   * Also use the two longer negation reaches `validateClaims` has (a negated
   * comma list, and a phrase right after "as", "any", "or", "nor", "be" or
   * "been"). Default false: the gate only looks inside `negationWindow`.
   */
  extendedNegation?: boolean;
}

/** One rule match that is not exempt. */
export interface CopyOffense {
  sourceId: string;
  ruleId: string;
  kind: CopyRuleKind;
  /** 1-based line of the start of the match in the original text. Lines end at LF, CRLF or CR. */
  line: number;
  /** 1-based column in Unicode code points from the start of that line (an astral character counts as one). */
  column: number;
  /** The matched text exactly as it appears in the source, including any invisible or look-alike characters. */
  match: string;
  reason: string;
  replacement: string | null;
}

/** A required statement and the sources that lack it. */
export interface MissingStatement {
  id: string;
  phrase: string;
  sourceIds: string[];
}

export interface CopyScanResult {
  offenses: CopyOffense[];
  missing: MissingStatement[];
  /** How many sources were scanned. An empty scan has `0` and no offenses; check it if "nothing scanned" should fail. */
  sourcesScanned: number;
}

/** Thrown by `assertCopyClean`. Carries the full result. */
export class CopyGateError extends Error {
  readonly offenses: readonly CopyOffense[];
  readonly missing: readonly MissingStatement[];
  constructor(message: string, result: CopyScanResult) {
    super(message);
    this.name = 'CopyGateError';
    this.offenses = result.offenses;
    this.missing = result.missing;
  }
}

/** Result of one planted sample in `plantedViolationsFail`. */
export interface PlantedViolationResult {
  ruleId: string;
  /** The text scanned, or `null` when the rule has no sample and cannot plant itself. */
  planted: string | null;
  caught: boolean;
}

export interface PlantedViolationReport {
  /** True when every rule caught its own planted sample. */
  ok: boolean;
  results: PlantedViolationResult[];
}

const CHECK_IT = 'Link the check it refers to, or reword.';
const STRENGTH_WORDS: readonly (readonly [word: string, reason: string])[] = [
  ['verified', `Says something was checked. ${CHECK_IT}`],
  ['proof', 'Says the matter is settled. Link the evidence or the check, or reword.'],
  ['proven', 'Says the matter is settled. Link the evidence or the check, or reword.'],
  ['atomic', 'Says all-or-nothing behavior. Link the test or the check that shows it, or reword.'],
  ['accuracy', 'Says how close the numbers are. Link the check or the method, or reword.'],
  ['accurate', 'Says how close the numbers are. Link the check or the method, or reword.'],
  ['audited', 'Says an audit happened. Link the audit or its scope, or reword.'],
  ['certified', 'Says a certification exists. Link it, or reword.'],
  ['validated', 'Says a validation happened. Link the check, or reword.'],
  ['deterministic', 'Says the same input always gives the same output. Link the test, or reword.'],
  ['exact', 'Says there is no error. Link the check, or reword.'],
];

/**
 * A starter list of strength words: words that read as a claim about how well
 * something was checked. Each needs a nearby check reference (`checkReference`)
 * or the match is an offense of kind `strength`. A string pattern matches from a
 * word boundary on, so "proof" also matches "proofread" and "proofs"; use your
 * own `RegExp` rule when you need a hard end. Frozen. Extend by spreading it
 * into a new array. It is not a vocabulary of everything that overclaims.
 */
export const DEFAULT_STRENGTH_RULES: readonly CopyRule[] = Object.freeze(
  STRENGTH_WORDS.map(([word, reason]) =>
    Object.freeze<CopyRule>({ id: `strength-${word}`, kind: 'strength', pattern: word, reason }),
  ),
);

// ---------------------------------------------------------------------------
// Folding with a map back to the original text.
//
// The result has to be the string `validateClaims` would match on (the stage
// functions are the same ones, in the same order), plus, for every UTF-16 unit
// of it, the range of the original text it came from. Three stages change
// length: NFKC and invisible-character removal (done per cluster, a starter and
// the marks that follow it, so composition stays inside one cluster), and
// whitespace collapsing. The rest are one unit for one unit.

// Marks, and the conjoining Hangul jamo that compose with a starter before them.
// A private copy of the whitespace-run regex: its `lastIndex` is ours to reset.
const RUNS = new RegExp(WHITESPACE_RUN.source, 'g');
const COMBINING = /[\p{M}\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]/u;

export interface Folded {
  /** Folded text, case kept: line breaks are '\n', clause-neutral periods and commas are marked. */
  cased: string;
  /** Start of the original range each unit of `cased` came from. */
  start: Uint32Array;
  /** End (exclusive) of that range. */
  end: Uint32Array;
}

export function foldWithMap(text: string): Folded {
  const whole = text.normalize('NFKC');
  const length = text.length;
  let capacity = length + 16;
  let units = new Uint16Array(capacity);
  let starts = new Uint32Array(capacity);
  let ends = new Uint32Array(capacity);
  let count = 0;
  const grow = (extra: number): void => {
    if (count + extra <= capacity) return;
    capacity = Math.max(capacity * 2, count + extra);
    const u = new Uint16Array(capacity);
    const s = new Uint32Array(capacity);
    const e = new Uint32Array(capacity);
    u.set(units.subarray(0, count));
    s.set(starts.subarray(0, count));
    e.set(ends.subarray(0, count));
    units = u;
    starts = s;
    ends = e;
  };
  const parts: string[] = []; // NFKC of every cluster, to check against `whole`

  for (let i = 0; i < length; ) {
    if (text.charCodeAt(i) < 0x80) {
      // A run of ASCII: nothing in it normalizes, hides or combines, except that
      // the last character joins a mark that follows it.
      let k = i + 1;
      while (k < length && text.charCodeAt(k) < 0x80) k++;
      if (k < length && text.charCodeAt(k) >= 0x300) k--;
      if (k > i) {
        grow(k - i);
        for (let at = i; at < k; at++, count++) {
          units[count] = text.charCodeAt(at);
          starts[count] = at;
          ends[count] = at + 1;
        }
        parts.push(text.slice(i, k));
        i = k;
        continue;
      }
    }
    const first = text.codePointAt(i) as number;
    let j = i + (first > 0xffff ? 2 : 1);
    // Extend the cluster over marks; below U+0300 nothing combines.
    for (;;) {
      const cp = text.codePointAt(j);
      if (cp === undefined || cp < 0x300 || !COMBINING.test(String.fromCodePoint(cp))) break;
      j += cp > 0xffff ? 2 : 1;
    }
    const normalized = text.slice(i, j).normalize('NFKC');
    parts.push(normalized);
    const kept = normalized.replace(INVISIBLE_CHARS, '').replace(CURLY_APOSTROPHES, "'");
    grow(kept.length);
    for (let k = 0; k < kept.length; k++, count++) {
      units[count] = kept.charCodeAt(k);
      starts[count] = i;
      ends[count] = j;
    }
    i = j;
  }

  if (parts.join('') !== whole) {
    // Composition crossed a cluster boundary (rare scripts). Matches are still
    // found on the right text, but they all report the start of the source.
    const kept = whole.replace(INVISIBLE_CHARS, '').replace(CURLY_APOSTROPHES, "'");
    count = 0;
    grow(kept.length);
    for (let k = 0; k < kept.length; k++, count++) {
      units[count] = kept.charCodeAt(k);
      starts[count] = 0;
      ends[count] = length;
    }
  }

  const s2 = foldConfusables(unitsToString(units, count)); // one unit for one unit

  // Collapse whitespace runs: a run holding a line break becomes '\n', else ' '.
  const outStart = new Uint32Array(count);
  const outEnd = new Uint32Array(count);
  const pieces: string[] = [];
  let written = 0;
  let at = 0;
  RUNS.lastIndex = 0;
  for (;;) {
    const run = RUNS.exec(s2);
    const stop = run === null ? s2.length : run.index;
    if (stop > at) {
      pieces.push(s2.slice(at, stop));
      outStart.set(starts.subarray(at, stop), written);
      outEnd.set(ends.subarray(at, stop), written);
      written += stop - at;
    }
    if (run === null) break;
    pieces.push(LINE_BREAK.test(run[0]) ? '\n' : ' ');
    outStart[written] = starts[run.index] as number;
    outEnd[written] = ends[run.index + run[0].length - 1] as number;
    written++;
    at = run.index + run[0].length;
  }

  return {
    cased: markNonBoundaryPunctuation(pieces.join('')),
    start: outStart.slice(0, written),
    end: outEnd.slice(0, written),
  };
}

function unitsToString(units: Uint16Array, count: number): string {
  const CHUNK = 4096;
  const parts: string[] = [];
  for (let i = 0; i < count; i += CHUNK) {
    parts.push(String.fromCharCode(...units.subarray(i, Math.min(count, i + CHUNK))));
  }
  return parts.join('');
}

/**
 * Lower-case without changing the length: positions in the lower-cased text
 * stay positions in the original fold. `validateClaims` lower-cases the whole
 * string; when that keeps the length the result is identical. The one case it
 * does not keep it (U+0130, capital I with dot) is read as a plain "i" here.
 */
function lowerSameLength(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  let out = '';
  for (const ch of text) {
    const lc = ch.toLowerCase();
    if (lc.length === ch.length) {
      out += lc;
      continue;
    }
    const head = String.fromCodePoint(lc.codePointAt(0) as number);
    out += head.length === ch.length ? head : ch;
  }
  return out;
}

/** A phrase folded the way text is, ready for `findOccurrences`. Empty when it shows nothing. */
function foldPhrase(phrase: string, caseSensitive: boolean): string {
  const cased = foldWithMap(phrase).cased;
  return matchView(caseSensitive ? cased : lowerSameLength(cased)).trim();
}

// ---------------------------------------------------------------------------
// Reading input

interface CompiledRegExp {
  re: RegExp;
  unicode: boolean;
}

interface Compiled {
  id: string;
  kind: CopyRuleKind;
  reason: string;
  replacement: string | null;
  exemptNegated: boolean;
  exemptQuoted: boolean;
  /** Folded phrase, for a string pattern. */
  needle: string | undefined;
  regex: CompiledRegExp | undefined;
  /** The pattern as given, for planting a sample. */
  patternText: string | undefined;
  sample: string | undefined;
}

type Getter = (this: object) => unknown;
const protoDescriptor = (name: string): Getter | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, name);
  const getter: unknown = descriptor === undefined ? undefined : Reflect.get(descriptor, 'get');
  return typeof getter === 'function' ? (getter as Getter) : undefined;
};
const REGEXP_SOURCE = protoDescriptor('source');
const FLAG_GETTERS: readonly [string, Getter | undefined][] = [
  ['i', protoDescriptor('ignoreCase')],
  ['m', protoDescriptor('multiline')],
  ['s', protoDescriptor('dotAll')],
  ['u', protoDescriptor('unicode')],
  ['v', protoDescriptor('unicodeSets')],
];

/**
 * Clone a real `RegExp` (including one from another realm) as global and
 * non-sticky, reading its source and flags through the built-in getters, which
 * work on internal slots: a Proxy or an imitation is not a `RegExp` and gets
 * `undefined`. The caller's regex is never run, so its `lastIndex` is untouched.
 */
function cloneRegExp(value: unknown): CompiledRegExp | undefined {
  if (typeof value !== 'object' || value === null || value === RegExp.prototype || REGEXP_SOURCE === undefined) {
    return undefined;
  }
  let source: string;
  let flags = 'g';
  let unicode = false;
  try {
    source = REGEXP_SOURCE.call(value) as string;
    for (const [flag, getter] of FLAG_GETTERS) {
      if (getter !== undefined && getter.call(value) === true) {
        flags += flag;
        if (flag === 'u' || flag === 'v') unicode = true;
      }
    }
  } catch {
    return undefined;
  }
  try {
    return { re: new RegExp(source, flags), unicode };
  } catch {
    return undefined;
  }
}

const RULE_KEYS: readonly string[] = Object.freeze([
  'id', 'pattern', 'reason', 'replacement', 'kind', 'exemptNegated', 'exemptQuoted', 'sample',
]);
const RULE_KINDS: readonly string[] = Object.freeze(['banned', 'retracted', 'strength']);

function nonBlankString(value: unknown, name: string, fn: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${fn}: ${name} must be a string (received ${describeType(value)}).`);
  }
  if (isVisiblyBlank(value)) throw new RangeError(`${fn}: ${name} is blank.`);
  return value;
}

function optionalBoolean(value: unknown, name: string, fn: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new TypeError(`${fn}: ${name} must be a boolean (received ${describeType(value)}).`);
  }
  return value;
}

function readRules(value: unknown, caseSensitive: boolean, fn: string): Compiled[] {
  if (!isArray(value)) {
    throw new TypeError(`${fn}: rules must be an array (received ${describeType(value)}).`);
  }
  const seen = new Set<string>();
  return readDenseArray(value, 'rules', fn).map((entry, i) => {
    const name = `rules[${i}]`;
    if (typeof entry !== 'object' || entry === null || isArray(entry)) {
      throw new TypeError(`${fn}: ${name} must be an object (received ${describeType(entry)}).`);
    }
    const raw = entry as Record<string, unknown>;
    rejectUnknownOptions(raw, RULE_KEYS, fn);
    const id = nonBlankString(raw.id, `${name}.id`, fn);
    const pattern = raw.pattern;
    const reason = nonBlankString(raw.reason, `${name}.reason`, fn);
    const replacement = raw.replacement;
    const kind = raw.kind;
    const exemptNegated = optionalBoolean(raw.exemptNegated, `${name}.exemptNegated`, fn, true);
    const exemptQuoted = optionalBoolean(raw.exemptQuoted, `${name}.exemptQuoted`, fn, true);
    const sample = raw.sample;
    if (typeof kind !== 'string' || !RULE_KINDS.includes(kind)) {
      throw new RangeError(`${fn}: ${name}.kind must be one of ${RULE_KINDS.join(', ')} (received ${displayValue(kind)}).`);
    }
    if (replacement !== undefined && replacement !== null && typeof replacement !== 'string') {
      throw new TypeError(`${fn}: ${name}.replacement must be a string, null or undefined (received ${describeType(replacement)}).`);
    }
    if (sample !== undefined && typeof sample !== 'string') {
      throw new TypeError(`${fn}: ${name}.sample must be a string (received ${describeType(sample)}).`);
    }
    if (seen.has(id)) throw new RangeError(`${fn}: ${name}.id ${displayValue(id)} is used twice.`);
    seen.add(id);

    let needle: string | undefined;
    let regex: CompiledRegExp | undefined;
    let patternText: string | undefined;
    if (typeof pattern === 'string') {
      needle = foldPhrase(pattern, caseSensitive);
      if (needle === '') {
        throw new RangeError(`${fn}: ${name}.pattern is blank (it would match nothing, so the rule would pass everything).`);
      }
      patternText = pattern;
    } else {
      regex = cloneRegExp(pattern);
      if (regex === undefined) {
        throw new TypeError(`${fn}: ${name}.pattern must be a string or a RegExp (received ${describeType(pattern)}).`);
      }
    }
    return {
      id,
      kind: kind as CopyRuleKind,
      reason,
      replacement: typeof replacement === 'string' ? replacement : null,
      exemptNegated,
      exemptQuoted,
      needle,
      regex,
      patternText,
      sample,
    };
  });
}

type CheckRef = { needle: string } | { regex: CompiledRegExp };

interface ScanConfig {
  required: { id: string; phrase: string; needle: string; sourceIds: ReadonlySet<string> | undefined }[];
  refs: CheckRef[];
  checkWindow: number;
  caseSensitive: boolean;
  negationWindow: number;
  extendedNegation: boolean;
}

const OPTION_KEYS: readonly string[] = Object.freeze([
  'required', 'checkReference', 'checkWindow', 'caseSensitive', 'negationWindow', 'extendedNegation',
]);
const REQUIRED_KEYS: readonly string[] = Object.freeze(['id', 'phrase', 'sourceIds']);

function readCount(value: unknown, name: string, fallback: number, fn: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number') {
    throw new TypeError(`${fn}: options.${name} must be a number (received ${describeType(value)}).`);
  }
  if (!(value === Infinity || (Number.isInteger(value) && value >= 0))) {
    throw new RangeError(`${fn}: options.${name} must be an integer >= 0 or Infinity (received ${describeType(value)}).`);
  }
  return value;
}

function readConfig(options: unknown, fn: string): ScanConfig {
  if (!isPlainObject(options)) {
    throw new TypeError(`${fn}: options must be a plain object or undefined (received ${describeType(options)}).`);
  }
  rejectUnknownOptions(options, OPTION_KEYS, fn);
  const rawRequired = options.required;
  const rawRefs = options.checkReference;
  const caseSensitive = optionalBoolean(options.caseSensitive, 'options.caseSensitive', fn, false);
  const checkWindow = readCount(options.checkWindow, 'checkWindow', 120, fn);
  const negationWindow = readCount(options.negationWindow, 'negationWindow', 40, fn);
  const extendedNegation = optionalBoolean(options.extendedNegation, 'options.extendedNegation', fn, false);

  const required: ScanConfig['required'] = [];
  if (rawRequired !== undefined) {
    if (!isArray(rawRequired)) {
      throw new TypeError(`${fn}: options.required must be an array (received ${describeType(rawRequired)}).`);
    }
    const seen = new Set<string>();
    readDenseArray(rawRequired, 'options.required', fn).forEach((entry, i) => {
      const name = `options.required[${i}]`;
      if (typeof entry !== 'object' || entry === null || isArray(entry)) {
        throw new TypeError(`${fn}: ${name} must be an object (received ${describeType(entry)}).`);
      }
      const raw = entry as Record<string, unknown>;
      rejectUnknownOptions(raw, REQUIRED_KEYS, fn);
      const id = nonBlankString(raw.id, `${name}.id`, fn);
      const phrase = nonBlankString(raw.phrase, `${name}.phrase`, fn);
      const scope = raw.sourceIds;
      let sourceIds: ReadonlySet<string> | undefined;
      if (scope !== undefined) {
        if (!isArray(scope)) {
          throw new TypeError(`${fn}: ${name}.sourceIds must be an array (received ${describeType(scope)}).`);
        }
        sourceIds = new Set(
          readDenseArray(scope, `${name}.sourceIds`, fn).map((s, k) => {
            if (typeof s !== 'string') {
              throw new TypeError(`${fn}: ${name}.sourceIds[${k}] must be a string (received ${describeType(s)}).`);
            }
            return s;
          }),
        );
      }
      if (seen.has(id)) throw new RangeError(`${fn}: ${name}.id ${displayValue(id)} is used twice.`);
      seen.add(id);
      const needle = foldPhrase(phrase, caseSensitive);
      if (needle === '') throw new RangeError(`${fn}: ${name}.phrase is blank.`);
      required.push({ id, phrase, needle, sourceIds });
    });
  }

  const refs: CheckRef[] = [];
  if (rawRefs !== undefined) {
    const list: unknown[] = isArray(rawRefs) ? readDenseArray(rawRefs, 'options.checkReference', fn) : [rawRefs];
    list.forEach((ref, i) => {
      const name = `options.checkReference${isArray(rawRefs) ? `[${i}]` : ''}`;
      if (typeof ref === 'string') {
        const needle = foldPhrase(ref, caseSensitive);
        if (needle === '') throw new RangeError(`${fn}: ${name} is blank (it would back every strength word).`);
        refs.push({ needle });
        return;
      }
      const regex = cloneRegExp(ref);
      if (regex === undefined) {
        throw new TypeError(`${fn}: ${name} must be a string or a RegExp (received ${describeType(ref)}).`);
      }
      refs.push({ regex });
    });
  }
  return { required, refs, checkWindow, caseSensitive, negationWindow, extendedNegation };
}

function readSources(value: unknown, fn: string): CopySource[] {
  if (!isArray(value)) {
    throw new TypeError(`${fn}: sources must be an array (received ${describeType(value)}).`);
  }
  const seen = new Set<string>();
  return readDenseArray(value, 'sources', fn).map((entry, i) => {
    const name = `sources[${i}]`;
    if (typeof entry !== 'object' || entry === null || isArray(entry)) {
      throw new TypeError(`${fn}: ${name} must be an object (received ${describeType(entry)}).`);
    }
    const raw = entry as Record<string, unknown>;
    const id = raw.id;
    const text = raw.text;
    if (typeof id !== 'string') throw new TypeError(`${fn}: ${name}.id must be a string (received ${describeType(id)}).`);
    if (typeof text !== 'string') throw new TypeError(`${fn}: ${name}.text must be a string (received ${describeType(text)}).`);
    if (seen.has(id)) throw new RangeError(`${fn}: ${name}.id ${displayValue(id)} is used twice.`);
    seen.add(id);
    return { id, text };
  });
}

// ---------------------------------------------------------------------------
// Matching

// U+2010 to U+2012 read as the ASCII hyphen in the text a RegExp sees, so
// /risk-free/ also matches a non-breaking hyphen (NFKC turns U+2011 into U+2010).
const HYPHEN_LIKE = /[\u2010-\u2012]/g;
// An en dash directly between two letters or digits reads as a hyphen too, as it
// does for string patterns ("risk\u2013free").
const INTRAWORD_EN_DASH = /(?<=[\p{L}\p{N}])\u2013(?=[\p{L}\p{N}])/gu;

/** Every non-empty, non-overlapping match of `re` in `text`, as [start, end). Always terminates. */
function regexMatches(compiled: CompiledRegExp, text: string): [number, number][] {
  const { re, unicode } = compiled;
  const found: [number, number][] = [];
  re.lastIndex = 0;
  for (;;) {
    const m = re.exec(text);
    if (m === null) break;
    const at = m.index;
    if (m[0].length === 0) {
      // An empty match is not an offense. Step past it by one code point (two
      // units for a surrogate pair under u or v) so the loop always advances.
      const cp = text.codePointAt(at);
      re.lastIndex = at + (unicode && cp !== undefined && cp > 0xffff ? 2 : 1);
      continue;
    }
    found.push([at, at + m[0].length]);
  }
  return found;
}

// Quotation marks that pair up. Straight double quotes pair by parity within a
// line; the others by kind. Single quotes (apostrophes) and backticks are not
// quotation marks here.
const OPENERS: Readonly<Record<string, string>> = Object.freeze({
  '"': '"',
  '\u201c': '\u201d',
  '\u201e': '\u201d',
  '\u00ab': '\u00bb',
  '\u2039': '\u203a',
  '\u300c': '\u300d',
  '\u300e': '\u300f',
});
const QUOTE_CHAR = /["\u201c\u201d\u201e\u00ab\u00bb\u2039\u203a\u300c\u300d\u300e\u300f]/;
// Words that say what the quoted text is: a word being talked about.
const MENTION_WORDS: ReadonlySet<string> = new Set([
  'word', 'words', 'term', 'terms', 'phrase', 'phrases', 'wording', 'label', 'labels',
  'avoid', 'avoids', 'banned', 'retired', 'retracted', 'prohibited', 'forbidden',
]);
const MENTION_WORD_ON_LINE =
  /(?<![\p{L}\p{N}'])(?:words?|terms?|phrases?|wording|labels?|avoid|avoids|banned|retired|retracted|prohibited|forbidden)(?![\p{L}\p{N}'])/giu;
const LEAD_PUNCTUATION = new Set([':', ',', ';', '(', '[', '-', '\u2013', '\u2014', '\u2022', '*', '|', '>', '/']);
const WORD_BEFORE = /([\p{L}]+) *$/u;
const OPENING_QUOTE_AFTER = /^ ?(?:(?:and|or|nor) )?["\u201c\u201e\u00ab\u2039\u300c\u300e]/;
const ONLY_PUNCTUATION = /^[^\p{L}\p{N}]*$/u;

/** The smallest value in ascending `list` that is >= `value`. */
function firstAtOrAfter(list: readonly number[], value: number): number | undefined {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((list[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return list[lo];
}

/** The largest value in ascending `list` that is < `value`. */
function lastBeforeIn(list: readonly number[], value: number): number | undefined {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((list[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? undefined : list[lo - 1];
}

/** Quotation-mark tokens of one text, found once and searched by position. */
class QuoteIndex {
  readonly pos: number[] = [];
  readonly ch: string[] = [];
  /** For a straight quote, its 1-based number among straight quotes on its line. */
  readonly ordinal: number[] = [];
  readonly line: number[] = [];
  /** Where each line break is, and where each mention word is, in order. */
  private readonly breaks: number[] = [];
  private readonly cues: number[] = [];

  constructor(readonly text: string) {
    let line = 0;
    let straight = 0;
    for (const cue of text.matchAll(MENTION_WORD_ON_LINE)) this.cues.push(cue.index);
    for (let i = 0; i < text.length; i++) {
      const c = text[i] as string;
      if (c === '\n') {
        line++;
        straight = 0;
        this.breaks.push(i);
      } else if (QUOTE_CHAR.test(c)) {
        this.pos.push(i);
        this.ch.push(c);
        this.ordinal.push(c === '"' ? ++straight : 0);
        this.line.push(line);
      }
    }
  }

  /**
   * True if the match [a, b) is the whole content of a pair of quotation marks
   * on one line, the pair reads as a mention (it follows a colon, comma or
   * similar mark, starts the line, follows a word such as "phrase" or "banned",
   * or continues a quoted list), AND the same line holds a word that says it is
   * about words ("banned", "terms", "avoid", ...). A quotation around anything
   * else ("Join our "guaranteed returns" plan", a sentence in quotes) is not.
   */
  mentions(a: number, b: number): boolean {
    let lo = 0;
    let hi = this.pos.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.pos[mid] as number) < a) lo = mid + 1;
      else hi = mid;
    }
    const t = lo - 1;
    if (t < 0 || t + 1 >= this.pos.length) return false;
    const open = this.ch[t] as string;
    const closer = OPENERS[open];
    if (closer === undefined) return false;
    if (open === '"' && (this.ordinal[t] as number) % 2 === 0) return false;
    if (this.ch[t + 1] !== closer && !(open === '\u201e' && this.ch[t + 1] === '\u201c')) return false;
    if (this.line[t] !== this.line[t + 1]) return false;
    const q1 = this.pos[t] as number;
    const q2 = this.pos[t + 1] as number;
    if (b > q2 || a <= q1) return false;
    // The quotation starts with the phrase (only punctuation or space before
    // it) and is short after it: a word ending, or a longer entry such as
    // "guaranteed returns" when the rule is "guarantee".
    if (a - (q1 + 1) > 8 || q2 - b > 32) return false;
    if (!ONLY_PUNCTUATION.test(this.text.slice(q1 + 1, a))) return false;
    return this.lineTalksAboutWords(q1) && this.readsAsMention(q1, q2);
  }

  /** The line holding offset `at` contains a mention word (see MENTION_WORD_ON_LINE). */
  private lineTalksAboutWords(at: number): boolean {
    const after = firstAtOrAfter(this.breaks, at);
    const end = after === undefined ? this.text.length : after;
    const before = this.breaks.length === 0 ? undefined : lastBeforeIn(this.breaks, at);
    const start = before === undefined ? 0 : before + 1;
    const cue = firstAtOrAfter(this.cues, start);
    return cue !== undefined && cue < end;
  }

  private readsAsMention(q1: number, q2: number): boolean {
    const text = this.text;
    let k = q1 - 1;
    if (text[k] === ' ') k--;
    if (k < 0 || text[k] === '\n') return true; // starts the line
    const lead = text[k] as string;
    const before = text.slice(Math.max(0, k - 24), k + 1);
    if (LEAD_PUNCTUATION.has(lead)) {
      // "Banned terms: "x"" names a mention; otherwise the mark must also be
      // followed by something that is not more of the sentence.
      const word = WORD_BEFORE.exec(before.slice(0, -1));
      if (word !== null && MENTION_WORDS.has((word[1] as string).toLowerCase())) return true;
      return this.endsMention(q2);
    }
    const word = WORD_BEFORE.exec(before);
    if (word === null) return false;
    const w = (word[1] as string).toLowerCase();
    if (MENTION_WORDS.has(w)) return true;
    // The second item of a list on a line that is about words:
    // `Terms we avoid: "x" and "y"`.
    return (w === 'and' || w === 'or' || w === 'nor') && this.endsMention(q2);
  }

  /** What follows the closing mark is not the rest of a sentence about the phrase. */
  private endsMention(q2: number): boolean {
    const text = this.text;
    let k = q2 + 1;
    if (text[k] === ' ') k++;
    if (k >= text.length || text[k] === '\n') return true;
    if (!/[\p{L}\p{N}]/u.test(text[k] as string)) return true;
    return OPENING_QUOTE_AFTER.test(text.slice(q2 + 1, q2 + 12));
  }
}

/** Line starts in the original text, and code-point columns. */
class PositionIndex {
  private readonly lineStarts: number[] = [0];
  private readonly astralBefore: Uint32Array | undefined;

  constructor(readonly text: string) {
    let hasSurrogate = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 10) this.lineStarts.push(i + 1);
      else if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) i++;
        this.lineStarts.push(i + 1);
      } else if (c >= 0xd800 && c <= 0xdfff) hasSurrogate = true;
    }
    if (hasSurrogate) {
      // astralBefore[i]: how many surrogate pairs end at or before unit i.
      const counts = new Uint32Array(text.length + 1);
      let pairs = 0;
      for (let i = 0; i < text.length; i++) {
        counts[i] = pairs;
        const c = text.charCodeAt(i);
        const n = text.charCodeAt(i + 1);
        if (c >= 0xd800 && c <= 0xdbff && n >= 0xdc00 && n <= 0xdfff) {
          counts[i + 1] = pairs;
          pairs++;
          i++;
        }
      }
      counts[text.length] = pairs;
      this.astralBefore = counts;
    }
  }

  at(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.lineStarts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.lineStarts[mid] as number) <= offset) lo = mid + 1;
      else hi = mid;
    }
    const lineStart = this.lineStarts[lo - 1] as number;
    let column = offset - lineStart;
    if (this.astralBefore !== undefined) {
      column -= (this.astralBefore[offset] as number) - (this.astralBefore[lineStart] as number);
    }
    return { line: lo, column: column + 1 };
  }
}

interface Found {
  a: number;
  b: number;
  rule: number;
}

/** Check-reference intervals of one text, searchable by distance. */
class ReferenceIndex {
  private readonly starts: number[] = [];
  private readonly maxEnd: number[] = [];

  constructor(intervals: [number, number][]) {
    intervals.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let max = -1;
    for (const [s, e] of intervals) {
      max = Math.max(max, e);
      this.starts.push(s);
      this.maxEnd.push(max);
    }
  }

  /** True if some reference starts at or before `b + window` and ends at or after `a - window`. */
  near(a: number, b: number, window: number): boolean {
    let lo = 0;
    let hi = this.starts.length;
    const limit = b + window;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.starts[mid] as number) <= limit) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && (this.maxEnd[lo - 1] as number) >= a - window;
  }
}

function scan(sources: CopySource[], rules: Compiled[], config: ScanConfig): CopyScanResult {
  const offenses: CopyOffense[] = [];
  const missingBy: string[][] = config.required.map(() => []);
  const knownIds = new Set(sources.map((s) => s.id));

  for (const source of sources) {
    const fold = foldWithMap(source.text);
    const neg = config.caseSensitive ? fold.cased : lowerSameLength(fold.cased);
    const view = matchView(neg);
    const negation: NegationContext = { text: neg };
    let regexView: string | undefined;
    const rxView = (): string =>
      (regexView ??= fold.cased
        .replaceAll('\n', ' ')
        .replaceAll(KEPT_PERIOD, '.')
        .replaceAll(KEPT_COMMA, ',')
        .replace(HYPHEN_LIKE, '-')
        .replace(INTRAWORD_EN_DASH, '-'));
    let quotes: QuoteIndex | undefined;
    let references: ReferenceIndex | undefined;
    const referenceIndex = (): ReferenceIndex => {
      if (references !== undefined) return references;
      const intervals: [number, number][] = [];
      for (const ref of config.refs) {
        if ('needle' in ref) {
          for (const at of findOccurrences(view, ref.needle)) intervals.push([at, at + ref.needle.length]);
        } else {
          for (const interval of regexMatches(ref.regex, rxView())) intervals.push(interval);
        }
      }
      return (references = new ReferenceIndex(intervals));
    };

    const found: Found[] = [];
    rules.forEach((rule, index) => {
      if (rule.needle !== undefined) {
        for (const a of findOccurrences(view, rule.needle)) found.push({ a, b: a + rule.needle.length, rule: index });
      } else if (rule.regex !== undefined) {
        for (const [a, b] of regexMatches(rule.regex, rxView())) found.push({ a, b, rule: index });
      }
    });
    found.sort((x, y) => x.a - y.a || x.rule - y.rule || x.b - y.b);

    let positions: PositionIndex | undefined;
    for (const { a, b, rule: ruleIndex } of found) {
      const rule = rules[ruleIndex] as Compiled;
      if (rule.exemptNegated && isNegated(negation, a, config.negationWindow, config.extendedNegation)) continue;
      if (rule.exemptQuoted && (quotes ??= new QuoteIndex(neg)).mentions(a, b)) continue;
      if (rule.kind === 'strength' && config.refs.length > 0 && referenceIndex().near(a, b, config.checkWindow)) {
        continue;
      }
      const from = fold.start[a] as number;
      const to = fold.end[b - 1] as number;
      const { line, column } = (positions ??= new PositionIndex(source.text)).at(from);
      offenses.push({
        sourceId: source.id,
        ruleId: rule.id,
        kind: rule.kind,
        line,
        column,
        match: source.text.slice(from, to),
        reason: rule.reason,
        replacement: rule.replacement,
      });
    }

    config.required.forEach((req, i) => {
      if (req.sourceIds !== undefined && !req.sourceIds.has(source.id)) return;
      if (findOccurrences(view, req.needle).length === 0) (missingBy[i] as string[]).push(source.id);
    });
  }

  config.required.forEach((req, i) => {
    if (req.sourceIds === undefined) return;
    // A scope that names a source that was not scanned cannot be shown to hold the statement.
    for (const id of req.sourceIds) if (!knownIds.has(id)) (missingBy[i] as string[]).push(id);
  });

  const missing: MissingStatement[] = [];
  config.required.forEach((req, i) => {
    const sourceIds = missingBy[i] as string[];
    if (sourceIds.length > 0) missing.push({ id: req.id, phrase: req.phrase, sourceIds });
  });
  return { offenses, missing, sourcesScanned: sources.length };
}

/**
 * Scan `sources` against the `rules` ledger and the `options.required`
 * statements.
 *
 * Input is read once and copied; malformed `sources`, `rules` or `options`
 * throw `TypeError` or `RangeError` (a hole in an array, a blank id or pattern,
 * a duplicate id, an unknown key, a `RegExp` that is not a real `RegExp`)
 * before anything is scanned. Nothing is mutated.
 *
 * Offenses come in source order, then position, then rule order. A phrase that
 * two rules match is reported once per rule. An empty result means no rule
 * matched and every required statement was found; it does not mean the copy is
 * true, and an empty `sources` array gives an empty result (see
 * `sourcesScanned`).
 *
 * Text rules are those of `validateClaims` (NFKC, invisible characters,
 * look-alike letters, case, hyphens, line breaks, negation with English cues
 * only), with a narrower default negation reach (`extendedNegation`) and the
 * quoted-use rule described at `CopyRule.exemptQuoted`.
 *
 * A user `RegExp` runs as written on the folded text: a pattern that backtracks
 * catastrophically can hang the scan, and that is the caller's responsibility.
 * String patterns are matched in linear time.
 */
export function scanCopy(
  sources: readonly CopySource[],
  rules: readonly CopyRule[],
  options: ScanCopyOptions = {},
): CopyScanResult {
  const config = readConfig(options, FN);
  const compiled = readRules(rules, config.caseSensitive, FN);
  return scan(readSources(sources, FN), compiled, config);
}

const MAX_LISTED = 50;

/**
 * Like `scanCopy`, but throws a `CopyGateError` when there is any offense or
 * missing statement, with every one listed (the first 50 in the message; all of
 * them on the error). For a test or a CI step. Returns the (clean) result
 * otherwise. Text from the caller is escaped in the message.
 */
export function assertCopyClean(
  sources: readonly CopySource[],
  rules: readonly CopyRule[],
  options: ScanCopyOptions = {},
): CopyScanResult {
  const result = scanCopy(sources, rules, options);
  if (result.offenses.length === 0 && result.missing.length === 0) return result;
  const lines: string[] = [];
  for (const o of result.offenses) {
    lines.push(
      `${escapeForDisplay(o.sourceId)}:${o.line}:${o.column} [${escapeForDisplay(o.ruleId)}] ` +
        `"${escapeForDisplay(o.match)}": ${escapeForDisplay(o.reason)}` +
        (o.replacement === null ? '' : ` Use: ${escapeForDisplay(o.replacement)}`),
    );
  }
  for (const m of result.missing) {
    lines.push(
      `missing [${escapeForDisplay(m.id)}] "${escapeForDisplay(m.phrase)}" in: ` +
        m.sourceIds.map(escapeForDisplay).join(', '),
    );
  }
  const shown = lines.slice(0, MAX_LISTED);
  const rest = lines.length - shown.length;
  throw new CopyGateError(
    `assertCopyClean: ${result.offenses.length} offense(s), ${result.missing.length} missing statement(s)\n` +
      shown.join('\n') +
      (rest > 0 ? `\n... and ${rest} more` : ''),
    result,
  );
}

/**
 * Self-test for a ledger: plant each rule's own sample and check the rule
 * catches it. A string pattern plants itself ("Our product is <pattern>.");
 * a `RegExp` rule needs a `sample`. The sample is scanned alone against that one
 * rule with the same options, so an exemption, a window or a check reference
 * that makes the rule blind shows up as `caught: false`. A rule with no way to
 * plant is reported `caught: false` with `planted: null`: it is unproven, not
 * passing. Use it in a test: `expect(plantedViolationsFail(rules).ok).toBe(true)`.
 */
export function plantedViolationsFail(
  rules: readonly CopyRule[],
  options: ScanCopyOptions = {},
): PlantedViolationReport {
  const fn = 'plantedViolationsFail';
  const config = readConfig(options, fn);
  const compiled = readRules(rules, config.caseSensitive, fn);
  const plain: ScanConfig = { ...config, required: [] };
  const results = compiled.map((rule): PlantedViolationResult => {
    const planted = rule.sample ?? (rule.patternText !== undefined ? `Our product is ${rule.patternText}.` : null);
    if (planted === null) return { ruleId: rule.id, planted: null, caught: false };
    const result = scan([{ id: 'planted', text: planted }], [rule], plain);
    return { ruleId: rule.id, planted, caught: result.offenses.some((o) => o.ruleId === rule.id) };
  });
  return { ok: results.every((r) => r.caught), results };
}
