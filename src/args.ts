// Argument checks shared by the scanner and the two rendering helpers
// (validate.ts, badge.ts, methodology.ts). Internal: not exported from index.ts.
//
// Two rules: read caller input ONCE, and never let a malformed argument
// silently change what is scanned or rendered. A definition whose label is
// missing or visibly blank would render an unlabeled badge, which is the
// failure this library exists to prevent.

import type { ProvenanceTierDefinitions } from './types.js';
import { describeType, displayValue, escapeForDisplay, isArray, isPlainObject, isVisiblyBlank } from './text.js';

/** The definition fields the calling helper reads, after they have been checked. */
export type ReadDefinition = { label: string; shortDescription?: string; criteria?: string };

/**
 * Copy an array once through an indexed traversal that rejects holes. A
 * `.map` or `.forEach` skips a hole while `for...of` visits it as `undefined`,
 * so a sparse array validated one way and processed the other way crashes or
 * renders "undefined". `Object.hasOwn` (not `in`) keeps an inherited
 * `Array.prototype` entry from filling a hole. `name` and `fn` only shape the
 * error message, e.g. `validateClaims: claims[2] is missing (...)`.
 */
export function readDenseArray(list: readonly unknown[], name: string, fn: string): unknown[] {
  const length = list.length;
  const copy: unknown[] = [];
  for (let i = 0; i < length; i++) {
    if (!Object.hasOwn(list, i)) {
      throw new TypeError(`${fn}: ${name}[${i}] is missing (a hole in a sparse array).`);
    }
    copy.push(list[i]);
  }
  return copy;
}

/** `definitions` must be a plain object (or null-prototype object). */
export function assertDefinitions(
  value: unknown,
  fn: string,
): asserts value is ProvenanceTierDefinitions {
  if (!isPlainObject(value)) {
    throw new TypeError(`${fn}: definitions must be a plain object (received ${describeType(value)}).`);
  }
}

/**
 * `options` must be a plain object. The public functions default an omitted
 * (or explicitly `undefined`) argument to `{}` before this runs, so `null`,
 * a Map, an array and a class instance all fail here.
 */
export function readOptionsObject(value: unknown, fn: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new TypeError(`${fn}: options must be a plain object or undefined (received ${describeType(value)}).`);
  }
  return value;
}

/**
 * Reject an own, enumerable string key that is not a known option, so a typo
 * ("certaintyPhrase", "negationwindow") throws instead of being silently
 * ignored. `Object.keys` reads key names only, never a value or a getter, so
 * this does not break the read-once rule. Symbol keys, non-enumerable keys and
 * inherited keys are not options and are ignored.
 */
export function rejectUnknownOptions(options: Record<string, unknown>, known: readonly string[], fn: string): void {
  for (const key of Object.keys(options)) {
    if (!known.includes(key)) {
      throw new TypeError(`${fn}: unknown option ${displayValue(key)} (known options: ${known.join(', ')}).`);
    }
  }
}

/** An optional string option: `undefined` means "use the default"; anything else must be a string. */
export function optionalString(value: unknown, name: string, fn: string): string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`${fn}: options.${name} must be a string (received ${describeType(value)}).`);
  }
  return value;
}

/**
 * Like `optionalString`, but a visibly blank string (only whitespace, zero-width
 * or bidi control characters) throws `RangeError`: it would render an empty
 * heading, an empty emphasis or a sentence with a hole in it.
 */
export function optionalNonBlankString(value: unknown, name: string, fn: string): string | undefined {
  const text = optionalString(value, name, fn);
  if (text !== undefined && isVisiblyBlank(text)) {
    throw new RangeError(`${fn}: options.${name} is blank.`);
  }
  return text;
}

/**
 * Read the definition for `tier` once. Returns `undefined` when the caller did
 * not supply one: no OWN property (so an inherited key like "constructor" or
 * "toString" is treated as missing), or an own property that is `undefined` or
 * `null`. Otherwise the definition must be an object whose `label` is a
 * non-blank string, and every field named in `needs` must be a string
 * (`shortDescription` must also be non-blank). A wrong type throws
 * `TypeError`; a visibly blank label or description throws `RangeError`.
 */
export function readDefinition(
  definitions: ProvenanceTierDefinitions,
  tier: string,
  needs: readonly ('shortDescription' | 'criteria')[],
  fn: string,
): ReadDefinition | undefined {
  if (!Object.hasOwn(definitions, tier)) return undefined;
  const def: unknown = (definitions as Record<string, unknown>)[tier];
  if (def === undefined || def === null) return undefined;
  const name = `definitions["${escapeForDisplay(tier)}"]`;
  if (typeof def !== 'object' || isArray(def)) {
    throw new TypeError(`${fn}: ${name} must be an object (received ${describeType(def)}).`);
  }
  const record = def as Record<string, unknown>;
  const label = record.label;
  if (typeof label !== 'string') {
    throw new TypeError(`${fn}: ${name}.label must be a string (received ${describeType(label)}).`);
  }
  if (isVisiblyBlank(label)) {
    throw new RangeError(`${fn}: ${name}.label is blank, so it would render an unlabeled tier.`);
  }
  const out: ReadDefinition = { label };
  for (const field of needs) {
    const value = record[field];
    if (typeof value !== 'string') {
      throw new TypeError(`${fn}: ${name}.${field} must be a string (received ${describeType(value)}).`);
    }
    if (field === 'shortDescription' && isVisiblyBlank(value)) {
      throw new RangeError(`${fn}: ${name}.shortDescription is blank.`);
    }
    out[field] = value;
  }
  return out;
}
