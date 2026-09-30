// Text and value helpers shared by the scanner and the rendering helpers.
// Internal: not exported from index.ts.

// Blank means "shows nothing": only whitespace, Default_Ignorable_Code_Point
// characters, and control characters. Default_Ignorable_Code_Point is the
// Unicode property for characters a renderer is told to draw as nothing:
// zero-width spaces and joiners, the soft hyphen, the word joiner, every bidi
// control (U+200E/F, U+202A-E, U+2066-9, U+061C), variation selectors, Hangul
// fillers and the tag characters. `String.prototype.trim` misses all of them.
// Visible text in any script, emoji, and visible text wrapped in bidi controls
// all still count as present.
const BLANK = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]*$/u;

/**
 * Whether `text` shows nothing to a reader: empty, or made only of
 * whitespace, invisible formatting characters and control characters.
 */
export function isVisiblyBlank(text: string): boolean {
  return BLANK.test(text);
}

// Everything that could end a line, move the cursor, send a terminal escape,
// or reorder the text around it when a caller-supplied string is printed:
//   \p{Cc}            C0 controls (ESC, CR, LF, NUL, ...), DEL, and C1 controls
//   U+2028, U+2029    line and paragraph separators
//   U+061C            Arabic letter mark
//   U+200E, U+200F    left-to-right and right-to-left marks
//   U+202A-U+202E     embeddings and overrides
//   U+2066-U+2069     isolates
const UNSAFE_FOR_DISPLAY = /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Make a caller-supplied string safe to print inside a line of report text.
 * Every control character (including CR, LF and ESC), line or paragraph
 * separator and bidi formatting character becomes a visible `\uXXXX` escape
 * (four lowercase hex digits). Visible text in every script, emoji and
 * backslashes are left alone. The escape is for display only and is not
 * reversible.
 */
export function escapeForDisplay(text: string): string {
  return text.replace(
    UNSAFE_FOR_DISPLAY,
    (ch) => `\\u${(ch.codePointAt(0) as number).toString(16).padStart(4, '0')}`,
  );
}

/**
 * Name a received value's TYPE for an error message: "received string",
 * "received an array", "received null". It never calls into the value (no
 * `toString`, `toJSON` or getters), so a hostile value cannot break or change
 * the error that reports it, and a long caller string is not echoed back.
 * Numbers print as themselves so `NaN` and `-1` are visible.
 */
export function describeType(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  try {
    if (Array.isArray(value)) return 'an array';
  } catch {
    return 'an object'; // a revoked proxy makes Array.isArray throw
  }
  return isPlainObject(value) ? 'an object' : 'a non-plain object';
}

/**
 * Show a caller value inside a human-readable message. A string prints in
 * double quotes with control and bidi characters escaped; a bigint prints as
 * `10n`; `null` and `undefined` by name; a symbol, function or object by kind.
 * It never calls the value's own `toString`, `toJSON` or getters, so a BigInt,
 * a cyclic object or a throwing `toJSON` cannot break the message.
 */
export function displayValue(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return `"${escapeForDisplay(value)}"`;
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return 'a symbol';
    case 'function':
      return 'a function';
    case 'object':
      return value === null ? 'null' : 'an object';
    default:
      return String(value);
  }
}

/** A plain object or a null-prototype object: not an array, Map, Set, Date, RegExp or class instance. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null) return false;
    const proto: unknown = Object.getPrototypeOf(value);
    // `Object.getPrototypeOf(proto) === null` also accepts Object.prototype
    // from another realm, whose identity differs from ours.
    return proto === null || Object.getPrototypeOf(proto) === null;
  } catch {
    return false; // a revoked proxy throws here
  }
}
