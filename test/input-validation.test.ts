// Shape validation, single-read snapshots and error-message safety for
// validateClaims. These pin the bug classes from the audit pass:
//   - sparse arrays (holes) must be rejected, not skipped by .map and then
//     visited as `undefined` by for...of;
//   - every caller-supplied value is read ONCE, so a getter or proxy cannot
//     answer differently after it was validated;
//   - error and offense messages never throw while describing a bad value.

import { describe, expect, it } from 'vitest';
import { validateClaims, type Claim, type ClaimsInput, type ValidateClaimsOptions } from '../src/index.js';

/** A value arriving at runtime past the type system (JSON, a CMS, plain JS). */
function untyped<T = never>(value: unknown): T {
  return value as T;
}
const claim = (over: Record<string, unknown> = {}): Claim => ({
  id: 'c1',
  text: 'A plain sentence.',
  tier: 'modeled',
  ...over,
});
const run = (input: unknown, options?: unknown) =>
  validateClaims(untyped<ClaimsInput>(input), untyped<ValidateClaimsOptions>(options));

describe('claims arrays must be dense (sparse-array crash at validate.ts:214)', () => {
  it('rejects a hole-only array with a message naming the index', () => {
    expect(() => run(new Array(1))).toThrow(TypeError);
    expect(() => run(new Array(1))).toThrow(/claims\[0\] is missing \(a hole in a sparse array\)/);
  });

  it('rejects a hole after valid claims and reports nothing partial', () => {
    const claims = [claim(), claim({ id: 'c2' }), , claim({ id: 'c4' })]; // eslint-disable-line no-sparse-arrays
    expect(() => run(claims)).toThrow(/claims\[2\] is missing/);
  });

  it('rejects a huge sparse array immediately instead of scanning every slot', () => {
    const started = Date.now();
    expect(() => run(new Array(2 ** 32 - 1))).toThrow(/claims\[0\] is missing/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('an inherited Array.prototype entry cannot fill a hole', () => {
    const original = Object.getOwnPropertyDescriptor(Array.prototype, 0);
    Object.defineProperty(Array.prototype, 0, { value: claim({ id: 'planted' }), configurable: true, writable: true });
    try {
      expect(() => run(new Array(1))).toThrow(/claims\[0\] is missing/);
    } finally {
      if (original) Object.defineProperty(Array.prototype, 0, original);
      else delete (Array.prototype as unknown as Record<number, unknown>)[0];
    }
    expect(Object.hasOwn(Array.prototype, 0)).toBe(false);
  });

  it('rejects a sparse array returned by extractClaims the same way', () => {
    expect(() => run({ text: 't', extractClaims: () => new Array<Claim>(2) })).toThrow(/claims\[0\] is missing/);
  });

  it('accepts an empty array and an array of valid claims', () => {
    expect(run([])).toEqual([]);
    expect(run([claim(), claim({ id: 'c2' })])).toEqual([]);
  });
});

describe('each claim must be an object with string id and text', () => {
  it.each([
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['a number', 42, '42'],
    ['a string', 'text', 'string'],
    ['an array', [], 'an array'],
  ])('rejects %s at an index', (_label, value, described) => {
    expect(() => run([claim(), value])).toThrow(TypeError);
    expect(() => run([claim(), value])).toThrow(new RegExp(`claims\\[1\\] must be an object \\(received ${described}\\)`));
  });

  it('rejects a Map or Set claim (it would read as an empty claim)', () => {
    expect(() => run([new Map([['text', 'x']])])).toThrow(/claims\[0\]\.id must be a string/);
  });

  it.each([
    ['id', { id: 42 }, /claims\[0\]\.id must be a string \(received 42\)/],
    ['missing id', { id: undefined }, /claims\[0\]\.id must be a string \(received undefined\)/],
    ['text', { text: 42 }, /claims\[0\]\.text must be a string \(received 42\)/],
    ['missing text', { text: undefined }, /claims\[0\]\.text must be a string \(received undefined\)/],
    ['sourceRef', { sourceRef: 42 }, /claims\[0\]\.sourceRef must be a string, null or undefined \(received 42\)/],
  ])('rejects a non-string %s', (_label, over, message) => {
    expect(() => run([claim(over)])).toThrow(TypeError);
    expect(() => run([claim(over)])).toThrow(message);
  });

  it('treats a null or missing sourceRef as no citation, not as bad input', () => {
    const offenses = run([claim({ tier: 'verified', sourceRef: null }), claim({ id: 'c2', tier: 'verified' })]);
    expect(offenses.map((o) => [o.claimId, o.reason])).toEqual([
      ['c1', 'missing_source_ref'],
      ['c2', 'missing_source_ref'],
    ]);
  });

  it('accepts a claim that is a class instance with the right string fields', () => {
    class Post {
      id = 'p1';
      text = 'A proprietary dataset.';
      tier = 'modeled';
    }
    expect(run([new Post()]).map((o) => o.claimId)).toEqual(['p1']);
  });

  it('an unrecognized tier is an offense, not a thrown error (existing contract)', () => {
    for (const tier of ['Verified', '', 'verifed', 42, null, undefined, new String('verified'), ['verified'], {}]) {
      const offenses = run([claim({ tier })]);
      expect(offenses.map((o) => o.reason)).toEqual(['unknown_tier']);
      expect(offenses[0]?.tier).toBe(typeof tier === 'string' ? tier : null);
    }
  });
});

describe('top-level input and extractClaims', () => {
  it.each([
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a string', 'oops', 'string'],
    ['a number', 7, '7'],
    ['a boolean', true, 'boolean'],
    ['a bigint', 10n, 'bigint'],
    ['a symbol', Symbol('s'), 'symbol'],
    ['a function', () => 1, 'function'],
  ])('describes %s without throwing while building the message', (_label, value, described) => {
    expect(() => run(value)).toThrow(TypeError);
    expect(() => run(value)).toThrow(/^validateClaims: expected a Claim\[\] or \{ text, extractClaims \}, got /);
    expect(() => run(value)).toThrow(new RegExp(`got ${described}\\.`));
  });

  it('rejects an input object that is neither an array nor { text, extractClaims }', () => {
    expect(() => run({})).toThrow(/extractClaims must be a function \(received undefined\)/);
    expect(() => run({ text: 't', extractClaims: 'nope' })).toThrow(/extractClaims must be a function \(received string\)/);
    expect(() => run({ extractClaims: () => [] })).toThrow(/text must be a string \(received undefined\)/);
    expect(() => run({ text: 42, extractClaims: () => [] })).toThrow(/text must be a string \(received 42\)/);
  });

  it('calls extractClaims once, with the text, as a method of the input object', () => {
    const seen: unknown[] = [];
    const input = {
      text: 'hello',
      label: 'kept',
      extractClaims(this: { label: string }, text: string) {
        seen.push(text, this.label);
        return [claim({ text })];
      },
    };
    expect(run(input)).toEqual([]);
    expect(seen).toEqual(['hello', 'kept']);
  });

  it.each([
    ['a string', 'not an array', /got string\./],
    ['undefined', undefined, /got undefined\./],
    ['an array-like', { length: 1, 0: claim() }, /got an object\./],
    ['a bigint', 5n, /got bigint\./],
  ])('rejects an extractClaims result that is %s', (_label, result, message) => {
    expect(() => run({ text: 't', extractClaims: () => result })).toThrow(TypeError);
    expect(() => run({ text: 't', extractClaims: () => result })).toThrow(/must return an array of Claim/);
    expect(() => run({ text: 't', extractClaims: () => result })).toThrow(message);
  });

  it('explains that an async extractor is not supported', () => {
    const asyncExtractor = () => Promise.resolve([claim()]);
    expect(() => run({ text: 't', extractClaims: asyncExtractor })).toThrow(/a promise \(async extractors are not supported\)/);
  });
});

describe('options are validated up front', () => {
  it.each([
    ['null', null],
    ['a Map', new Map()],
    ['an array', []],
    ['a class instance', new (class Opts {})()],
    ['a string', 'x'],
  ])('rejects options that are %s', (_label, options) => {
    expect(() => run([claim()], options)).toThrow(TypeError);
    expect(() => run([claim()], options)).toThrow(/^validateClaims: options must be a plain object/);
  });

  it('accepts undefined, {}, and a null-prototype options object', () => {
    expect(run([claim()], undefined)).toEqual([]);
    expect(run([claim()], {})).toEqual([]);
    expect(run([claim({ text: 'guaranteed' })], Object.assign(Object.create(null), { certaintyPhrases: ['guaranteed'] }))).toHaveLength(1);
  });

  it('ignores an inherited option (a polluted Object.prototype cannot change the rules)', () => {
    const polluted = Object.create({ certaintyPhrases: [] }) as object;
    // Not a plain object (its prototype has a prototype that is not null).
    expect(() => run([claim()], polluted)).toThrow(/options must be a plain object/);
  });

  describe('certaintyPhrases', () => {
    it.each([
      ['a string', 'guaranteed', /options\.certaintyPhrases must be an array \(received string\)/],
      ['null', null, /options\.certaintyPhrases must be an array \(received null\)/],
      ['a Set', new Set(['x']), /options\.certaintyPhrases must be an array \(received a non-plain object\)/],
    ])('rejects %s', (_label, value, message) => {
      expect(() => run([claim()], { certaintyPhrases: value })).toThrow(TypeError);
      expect(() => run([claim()], { certaintyPhrases: value })).toThrow(message);
    });

    it('rejects a sparse list (a hole would crash the scan)', () => {
      expect(() => run([claim()], { certaintyPhrases: new Array(1) })).toThrow(/options\.certaintyPhrases\[0\] is missing/);
    });

    it.each([
      ['a number', 42, /certaintyPhrases\[1\] must be a string or \{ phrase, reason \} \(received 42\)/],
      ['null', null, /certaintyPhrases\[1\] must be a string or \{ phrase, reason \} \(received null\)/],
      ['an object without a phrase', {}, /certaintyPhrases\[1\]\.phrase must be a string \(received undefined\)/],
      ['a non-string phrase', { phrase: 42 }, /certaintyPhrases\[1\]\.phrase must be a string \(received 42\)/],
      ['a non-string reason', { phrase: 'x', reason: 42 }, /certaintyPhrases\[1\]\.reason must be a string \(received 42\)/],
    ])('rejects an entry that is %s', (_label, entry, message) => {
      expect(() => run([claim()], { certaintyPhrases: ['ok', entry] })).toThrow(TypeError);
      expect(() => run([claim()], { certaintyPhrases: ['ok', entry] })).toThrow(message);
    });

    it('an empty list is valid and flags nothing', () => {
      expect(run([claim({ text: 'guaranteed and proprietary dataset' })], { certaintyPhrases: [] })).toEqual([]);
    });
  });

  describe.each(['certaintyRequiresTier', 'requireSourceRefForTiers'] as const)('%s', (key) => {
    it.each([
      ['a string (substring lookups would half work)', 'verified', new RegExp(`options\\.${key} must be an array \\(received string\\)`)],
      ['null', null, new RegExp(`options\\.${key} must be an array \\(received null\\)`)],
    ])('rejects %s', (_label, value, message) => {
      expect(() => run([claim()], { [key]: value })).toThrow(TypeError);
      expect(() => run([claim()], { [key]: value })).toThrow(message);
    });

    it('rejects a sparse list', () => {
      expect(() => run([claim()], { [key]: new Array(1) })).toThrow(new RegExp(`options\\.${key}\\[0\\] is missing`));
    });

    it('rejects a non-string entry with TypeError and an unknown tier name with RangeError', () => {
      expect(() => run([claim()], { [key]: [new String('verified')] })).toThrow(TypeError);
      expect(() => run([claim()], { [key]: ['Verified'] })).toThrow(RangeError);
      expect(() => run([claim()], { [key]: ['Verified'] })).toThrow(
        new RegExp(`options\\.${key}\\[0\\] must be one of verified, modeled, editorial \\(received "Verified"\\)`),
      );
    });

    it('accepts any subset of the three tiers, including an empty list', () => {
      expect(() => run([claim()], { [key]: [] })).not.toThrow();
      expect(() => run([claim()], { [key]: ['verified', 'modeled', 'editorial'] })).not.toThrow();
    });
  });

  it('a misspelled requireSourceRefForTiers can no longer fail open', () => {
    // Before validation, ['Verified'] matched no tier, so a verified claim with
    // no sourceRef passed clean.
    const unsourced = claim({ tier: 'verified' });
    expect(() => run([unsourced], { requireSourceRefForTiers: ['Verified'] })).toThrow(RangeError);
    expect(run([unsourced]).map((o) => o.reason)).toEqual(['missing_source_ref']);
  });

  describe('caseSensitive', () => {
    it.each([['the string "false"', 'false'], ['0', 0], ['1', 1], ['null', null], ['an object', {}]])(
      'rejects %s instead of reading it as truthy',
      (_label, value) => {
        expect(() => run([claim()], { caseSensitive: value })).toThrow(TypeError);
        expect(() => run([claim()], { caseSensitive: value })).toThrow(/options\.caseSensitive must be a boolean/);
      },
    );

    it('accepts true, false and undefined', () => {
      for (const caseSensitive of [true, false, undefined]) expect(() => run([claim()], { caseSensitive })).not.toThrow();
    });
  });

  describe('negationWindow', () => {
    it.each([
      ['a numeric string', '40', TypeError, /options\.negationWindow must be a number \(received string\)/],
      ['null', null, TypeError, /options\.negationWindow must be a number \(received null\)/],
      ['NaN (it used to mean "the whole prefix")', NaN, RangeError, /options\.negationWindow must be an integer >= 0 or Infinity \(received NaN\)/],
      ['a negative number', -1, RangeError, /received -1\)/],
      ['a fraction', 2.5, RangeError, /received 2\.5\)/],
      ['-Infinity', -Infinity, RangeError, /received -Infinity\)/],
    ])('rejects %s', (_label, value, errorType, message) => {
      expect(() => run([claim()], { negationWindow: value })).toThrow(errorType);
      expect(() => run([claim()], { negationWindow: value })).toThrow(message);
    });

    it('accepts 0, a positive integer, Infinity and undefined', () => {
      for (const negationWindow of [0, 1, 40, 10_000, Infinity, undefined]) {
        expect(() => run([claim()], { negationWindow })).not.toThrow();
      }
    });

    it('NaN no longer widens the window to the whole text', () => {
      const text = `not ${'x '.repeat(50)}proprietary dataset`;
      expect(() => run([claim({ text })], { negationWindow: NaN })).toThrow(RangeError);
    });
  });
});

describe('every caller-supplied value is read once (snapshot, then use the snapshot)', () => {
  /** An object whose named properties count their reads. */
  function counted(target: Record<string, unknown>, reads: Record<string, number>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(target)) {
      reads[key] = 0;
      Object.defineProperty(out, key, {
        enumerable: true,
        get() {
          reads[key] = (reads[key] ?? 0) + 1;
          return target[key];
        },
      });
    }
    return out;
  }

  it('reads id, text, tier and sourceRef of a claim exactly once', () => {
    const reads: Record<string, number> = {};
    const c = counted({ id: 'c1', text: 'A plain sentence.', tier: 'verified', sourceRef: '' }, reads);
    expect(run([c]).map((o) => o.reason)).toEqual(['missing_source_ref']);
    expect(reads).toEqual({ id: 1, text: 1, tier: 1, sourceRef: 1 });
  });

  it('reads every option once', () => {
    const reads: Record<string, number> = {};
    const options = counted(
      {
        certaintyPhrases: ['x'],
        certaintyRequiresTier: ['verified'],
        requireSourceRefForTiers: ['verified'],
        caseSensitive: false,
        negationWindow: 10,
      },
      reads,
    );
    run([claim(), claim({ id: 'c2' }), claim({ id: 'c3' })], options);
    expect(reads).toEqual({
      certaintyPhrases: 1,
      certaintyRequiresTier: 1,
      requireSourceRefForTiers: 1,
      caseSensitive: 1,
      negationWindow: 1,
    });
  });

  it('reads a certainty rule phrase and reason once', () => {
    const reads: Record<string, number> = {};
    const rule = counted({ phrase: 'guaranteed', reason: 'why' }, reads);
    run([claim({ text: 'guaranteed twice, guaranteed' })], { certaintyPhrases: [rule] });
    expect(reads).toEqual({ phrase: 1, reason: 1 });
  });

  it('reads { text, extractClaims } once each', () => {
    const reads: Record<string, number> = {};
    const input = counted({ text: 'hi', extractClaims: () => [claim()] }, reads);
    run(input);
    expect(reads).toEqual({ text: 1, extractClaims: 1 });
  });

  it('reads the array length and each index once', () => {
    const reads: Record<string, number> = {};
    const proxy = new Proxy([claim(), claim({ id: 'c2' })], {
      get(target, key, receiver) {
        const name = String(key);
        reads[name] = (reads[name] ?? 0) + 1;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    run(proxy);
    expect(reads.length).toBe(1);
    expect(reads['0']).toBe(1);
    expect(reads['1']).toBe(1);
  });

  it('reports what was validated even if a getter changes its answer afterwards', () => {
    let calls = 0;
    const shifty = {
      id: 'c1',
      tier: 'modeled',
      get text() {
        calls += 1;
        return calls === 1 ? 'This is independently verified.' : 'Perfectly harmless.';
      },
    };
    const offenses = run([shifty]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.phrase).toBe('independently verified');
    expect(offenses[0]?.claimText).toBe('This is independently verified.');
  });

  it('reports the tier that was validated, not a later read', () => {
    let calls = 0;
    const shifty = {
      id: 'c1',
      text: 'A proprietary dataset.',
      get tier() {
        calls += 1;
        return calls === 1 ? 'editorial' : 'verified';
      },
    };
    const offenses = run([shifty]);
    expect(offenses.map((o) => o.tier)).toEqual(['editorial']);
  });

  it('does not change or freeze what the caller passed in', () => {
    const claims = [claim({ text: 'A proprietary dataset.' })];
    const options = { certaintyPhrases: ['proprietary dataset'], negationWindow: 40 };
    const claimsBefore = JSON.stringify(claims);
    const optionsBefore = JSON.stringify(options);
    run(claims, options);
    expect(JSON.stringify(claims)).toBe(claimsBefore);
    expect(JSON.stringify(options)).toBe(optionsBefore);
    expect(Object.isFrozen(claims)).toBe(false);
  });

  it('works on deeply frozen input', () => {
    const claims = Object.freeze([Object.freeze(claim({ text: 'A proprietary dataset.' }))]);
    const options = Object.freeze({ certaintyPhrases: Object.freeze(['proprietary dataset']) });
    expect(run(claims, options)).toHaveLength(1);
  });
});
