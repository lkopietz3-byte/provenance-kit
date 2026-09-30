// provenanceBadgeText and methodologyPageOutline: argument checks, single
// reads, and error text that cannot forge structure. Verbatim passthrough of
// definition text stays the documented contract (rendering-safety.test.ts).

import { describe, expect, it } from 'vitest';
import {
  methodologyPageOutline,
  provenanceBadgeText,
  type MethodologyPageOutlineOptions,
  type ProvenanceBadgeTextOptions,
  type ProvenanceTier,
  type ProvenanceTierDefinitions,
} from '../src/index.js';
import { FULL_DEFINITIONS } from './helpers.js';

const UNSAFE = /[\p{Cc}\u{061c}\u{200e}\u{200f}\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}]/u;

// Rest parameters, not default parameters: an explicit `undefined` definitions
// argument must reach the function instead of being replaced by a default.
const badge = (tier: unknown, ...rest: unknown[]) =>
  provenanceBadgeText(
    tier as ProvenanceTier,
    (rest.length > 0 ? rest[0] : FULL_DEFINITIONS) as ProvenanceTierDefinitions,
    rest[1] as ProvenanceBadgeTextOptions,
  );
const outline = (...rest: unknown[]) =>
  methodologyPageOutline(
    (rest.length > 0 ? rest[0] : FULL_DEFINITIONS) as ProvenanceTierDefinitions,
    rest[1] as MethodologyPageOutlineOptions,
  );
const withLabel = (label: unknown) => ({ verified: { label, shortDescription: 's', criteria: 'c' } });

const BLANKS = [
  ['empty', ''],
  ['spaces', '   '],
  ['zero-width space', '\u{200b}'],
  ['bidi isolates', '\u{2066}\u{2069}'],
  ['Arabic letter mark', '\u{61c}'],
  ['BOM and word joiner', '\u{feff}\u{2060}'],
  ['NUL', '\u{0}'],
] as const;

describe('provenanceBadgeText arguments (bug classes 6, 7, 10)', () => {
  it.each([
    ['an array holding a tier name', ['verified'], /received an array/],
    ['a String object', new String('verified'), /received a non-plain object/],
    ['a number', 42, /received 42/],
    ['null', null, /received null/],
    ['undefined', undefined, /received undefined/],
    ['an object with toString', { toString: () => 'verified' }, /received an object/],
    ['a symbol', Symbol('verified'), /received symbol/],
  ])('rejects %s as the tier instead of coercing it to a key', (_label, tier, message) => {
    expect(() => badge(tier)).toThrow(TypeError);
    expect(() => badge(tier)).toThrow(/^provenanceBadgeText: tier must be a string/);
    expect(() => badge(tier)).toThrow(message);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a Map', new Map([['verified', FULL_DEFINITIONS.verified]])],
    ['an array', [FULL_DEFINITIONS.verified]],
    ['a class instance', new (class Defs { verified = FULL_DEFINITIONS.verified; })()],
    ['a string', 'verified'],
  ])('rejects definitions that are %s', (_label, definitions) => {
    expect(() => badge('verified', definitions)).toThrow(TypeError);
    expect(() => badge('verified', definitions)).toThrow(/^provenanceBadgeText: definitions must be a plain object/);
  });

  it('accepts null-prototype definitions', () => {
    const defs = Object.assign(Object.create(null) as object, FULL_DEFINITIONS);
    expect(badge('verified', defs)).toBe('Verified');
  });

  it.each([
    ['null', null],
    ['a Map', new Map()],
    ['an array', []],
  ])('rejects options that are %s', (_label, options) => {
    expect(() => badge('verified', FULL_DEFINITIONS, options)).toThrow(/options must be a plain object or undefined/);
  });

  it.each([['the string "yes"', 'yes'], ['1', 1], ['null', null]])(
    'rejects includeShortDescription: %s',
    (_label, value) => {
      expect(() => badge('verified', FULL_DEFINITIONS, { includeShortDescription: value })).toThrow(TypeError);
      expect(() => badge('verified', FULL_DEFINITIONS, { includeShortDescription: value })).toThrow(
        /options\.includeShortDescription must be a boolean/,
      );
    },
  );

  it('still treats a missing, null or undefined definition as "no tier definition supplied"', () => {
    for (const definitions of [{}, { verified: undefined }, { verified: null }, { modeled: FULL_DEFINITIONS.modeled }]) {
      expect(() => badge('verified', definitions)).toThrow(Error);
      expect(() => badge('verified', definitions)).toThrow(/^provenanceBadgeText: no tier definition supplied for "verified"\. Every tier rendered in the UI needs a ProvenanceTierDefinition\.$/);
    }
  });

  it.each([
    ['a string', 'Verified', /definitions\["verified"\] must be an object \(received string\)/],
    ['a number', 7, /must be an object \(received 7\)/],
    ['false', false, /must be an object \(received boolean\)/],
    ['an array', ['Verified'], /must be an object \(received an array\)/],
  ])('rejects a definition that is %s', (_label, def, message) => {
    expect(() => badge('verified', { verified: def })).toThrow(TypeError);
    expect(() => badge('verified', { verified: def })).toThrow(message);
  });

  it.each([
    ['missing', undefined, /label must be a string \(received undefined\)/],
    ['a number', 42, /label must be a string \(received 42\)/],
    ['null', null, /label must be a string \(received null\)/],
    ['an object', {}, /label must be a string \(received an object\)/],
  ])('rejects a label that is %s (it used to render "undefined" or a number)', (_label, label, message) => {
    expect(() => badge('verified', withLabel(label))).toThrow(TypeError);
    expect(() => badge('verified', withLabel(label))).toThrow(message);
  });

  it.each(BLANKS)('rejects a visibly blank label (%s) instead of rendering an unlabeled badge', (_label, blank) => {
    expect(() => badge('verified', withLabel(blank))).toThrow(RangeError);
    expect(() => badge('verified', withLabel(blank))).toThrow(
      /^provenanceBadgeText: definitions\["verified"\]\.label is blank, so it would render an unlabeled tier\.$/,
    );
  });

  it('checks shortDescription only when it is requested', () => {
    const noDescription = { verified: { label: 'Verified' } };
    expect(badge('verified', noDescription)).toBe('Verified');
    expect(() => badge('verified', noDescription, { includeShortDescription: true })).toThrow(
      /shortDescription must be a string \(received undefined\)/,
    );
    expect(() => badge('verified', noDescription, { includeShortDescription: false })).not.toThrow();
  });

  it.each(BLANKS)('rejects a blank shortDescription (%s) when it is requested', (_label, blank) => {
    const defs = { verified: { label: 'Verified', shortDescription: blank, criteria: 'c' } };
    expect(() => badge('verified', defs, { includeShortDescription: true })).toThrow(RangeError);
    expect(() => badge('verified', defs, { includeShortDescription: true })).toThrow(/shortDescription is blank/);
    expect(badge('verified', defs)).toBe('Verified');
  });

  it('accepts a label that is visible text next to invisible characters, and keeps it verbatim', () => {
    expect(badge('verified', withLabel('\u{200b}Verified\u{2069}'))).toBe('\u{200b}Verified\u{2069}');
  });

  it('escapes the requested tier in the missing-definition message', () => {
    const tier = 'x\ny\u{1b}[31m\u{202e}';
    expect(() => badge(tier)).toThrow('no tier definition supplied for "x\\u000ay\\u001b[31m\\u202e".');
    try {
      badge(tier);
    } catch (error) {
      expect((error as Error).message).not.toMatch(UNSAFE);
    }
  });

  it('reads the definition entry, label and shortDescription once each', () => {
    const reads = { entry: 0, label: 0, shortDescription: 0 };
    const def = {
      get label() {
        reads.label += 1;
        return 'Verified';
      },
      get shortDescription() {
        reads.shortDescription += 1;
        return 'Checked.';
      },
    };
    const definitions = {
      get verified() {
        reads.entry += 1;
        return def;
      },
    };
    expect(badge('verified', definitions, { includeShortDescription: true })).toBe('Verified \u{2014} Checked.');
    expect(reads).toEqual({ entry: 1, label: 1, shortDescription: 1 });
  });
});

describe('methodologyPageOutline arguments (bug classes 2, 6, 8, 10)', () => {
  it.each([
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a Map', new Map([['verified', FULL_DEFINITIONS.verified]]), 'a non-plain object'],
    ['an array', [], 'an array'],
    ['a string', 'verified', 'string'],
  ])('rejects definitions that are %s (a Map used to read as "no definitions")', (_label, definitions, described) => {
    expect(() => outline(definitions)).toThrow(TypeError);
    expect(() => outline(definitions)).toThrow(
      new RegExp(`^methodologyPageOutline: definitions must be a plain object \\(received ${described}\\)\\.$`),
    );
  });

  it.each([['null', null], ['a Map', new Map()], ['an array', []]])('rejects options that are %s', (_label, options) => {
    expect(() => outline(FULL_DEFINITIONS, options)).toThrow(/options must be a plain object or undefined/);
  });

  it.each([
    ['title', 42, /options\.title must be a string \(received 42\)/],
    ['intro', null, /options\.intro must be a string \(received null\)/],
    ['productName', {}, /options\.productName must be a string \(received an object\)/],
    ['tiers', 'verified', /options\.tiers must be an array \(received string\)/],
    ['tiers', null, /options\.tiers must be an array \(received null\)/],
  ])('rejects a non-string or non-array %s option', (key, value, message) => {
    expect(() => outline(FULL_DEFINITIONS, { [key]: value })).toThrow(TypeError);
    expect(() => outline(FULL_DEFINITIONS, { [key]: value })).toThrow(message);
  });

  it('rejects a sparse tiers list and a non-string tier entry', () => {
    expect(() => outline(FULL_DEFINITIONS, { tiers: new Array(2) })).toThrow(/options\.tiers\[0\] is missing \(a hole in a sparse array\)/);
    expect(() => outline(FULL_DEFINITIONS, { tiers: ['verified', , 'modeled'] })).toThrow(/options\.tiers\[1\] is missing/); // eslint-disable-line no-sparse-arrays
    expect(() => outline(FULL_DEFINITIONS, { tiers: ['verified', ['modeled']] })).toThrow(
      /options\.tiers\[1\] must be a string \(received an array\)/,
    );
    expect(() => outline(FULL_DEFINITIONS, { tiers: [new String('verified')] })).toThrow(TypeError);
  });

  it('only undefined means "use the default", and an empty tiers list renders no tier sections', () => {
    const defaults = outline(FULL_DEFINITIONS);
    expect(outline(FULL_DEFINITIONS, { title: undefined, intro: undefined, productName: undefined, tiers: undefined })).toBe(defaults);
    const none = outline(FULL_DEFINITIONS, { tiers: [] });
    expect(none).toContain('## The tiers');
    expect(none).not.toContain('### ');
  });

  it('rejects a present but malformed definition, and a blank label', () => {
    expect(() => outline({ verified: 'Verified' })).toThrow(/definitions\["verified"\] must be an object \(received string\)/);
    expect(() => outline(withLabel(42))).toThrow(/label must be a string \(received 42\)/);
    expect(() => outline({ verified: { label: 'V', shortDescription: 's', criteria: 42 } })).toThrow(
      /definitions\["verified"\]\.criteria must be a string \(received 42\)/,
    );
    for (const [, blank] of BLANKS) {
      expect(() => outline(withLabel(blank), { tiers: ['verified'] })).toThrow(RangeError);
    }
  });

  it('does not require shortDescription, and keeps a multi-line criteria verbatim', () => {
    const defs = { verified: { label: 'Verified', criteria: 'Line one.\n\nLine two.' } };
    expect(outline(defs, { tiers: ['verified'] })).toContain('### Verified\n\nLine one.\n\nLine two.\n');
  });

  it('a missing definition is still a TODO, not an error, for undefined, null and absent entries', () => {
    for (const definitions of [{}, { modeled: undefined }, { modeled: null }]) {
      const text = outline(definitions, { tiers: ['modeled'] });
      expect(text).toContain(
        '### modeled\n\nTODO: no ProvenanceTierDefinition was supplied for "modeled". ' +
          'Add one so this section can be filled in automatically.\n\n## What we do not do',
      );
    }
  });

  it('escapes a tier name in the fallback heading and TODO so it cannot forge a heading', () => {
    const text = outline({}, { tiers: ['x\n# Forged heading\u{1b}[31m\u{202e}'] });
    expect(text).toContain('### x\\u000a# Forged heading\\u001b[31m\\u202e\n');
    expect(text).toContain('supplied for "x\\u000a# Forged heading\\u001b[31m\\u202e".');
    expect(text.split('\n').some((line) => line.startsWith('# Forged'))).toBe(false);
  });

  it('reads each definition entry, label and criteria once', () => {
    const reads = { entry: 0, label: 0, criteria: 0 };
    const def = {
      get label() {
        reads.label += 1;
        return 'Verified';
      },
      get criteria() {
        reads.criteria += 1;
        return 'Checked.';
      },
    };
    const definitions = {
      get verified() {
        reads.entry += 1;
        return def;
      },
    };
    expect(outline(definitions, { tiers: ['verified'] })).toContain('### Verified\n\nChecked.\n');
    expect(reads).toEqual({ entry: 1, label: 1, criteria: 1 });
  });

  it('reads the tiers array length and each entry once', () => {
    const reads: Record<string, number> = {};
    const tiers = new Proxy(['verified', 'modeled'], {
      get(target, key, receiver) {
        const name = String(key);
        reads[name] = (reads[name] ?? 0) + 1;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    outline(FULL_DEFINITIONS, { tiers });
    expect([reads.length, reads['0'], reads['1']]).toEqual([1, 1, 1]);
  });
});
