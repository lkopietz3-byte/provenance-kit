// Unit tests for the internal text helpers (src/text.ts). They are not part of
// the public API, but every message and blank check depends on them.

import { describe, expect, it } from 'vitest';
import {
  describeType,
  displayValue,
  escapeForDisplay,
  isArray,
  isPlainObject,
  isVisiblyBlank,
} from '../src/text.js';

function revokedProxy(target: object = {}): object {
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  return proxy;
}

describe('isVisiblyBlank', () => {
  it.each(['', ' ', '\t\r\n', '\u{a0}\u{2003}\u{3000}', '\u{200b}\u{feff}\u{ad}\u{2060}', '\u{2066}\u{2069}\u{61c}\u{202e}', '\u{0}\u{7f}\u{85}', '\u{fe0f}\u{e0020}\u{3164}'])(
    'is true for %j',
    (text) => {
      expect(isVisiblyBlank(text)).toBe(true);
    },
  );

  it.each(['a', '0', '.', '\u{1f600}', '\u{4e2d}', ' a ', '\u{200b}x\u{200b}', '\u{2066}text\u{2069}', '\u{2800}'])(
    'is false for %j',
    (text) => {
      expect(isVisiblyBlank(text)).toBe(false);
    },
  );
});

describe('escapeForDisplay', () => {
  it('escapes controls, line separators and bidi characters as four lowercase hex digits', () => {
    expect(escapeForDisplay('\u{0}\n\r\t\u{1b}\u{7f}\u{85}')).toBe('\\u0000\\u000a\\u000d\\u0009\\u001b\\u007f\\u0085');
    expect(escapeForDisplay('\u{2028}\u{2029}\u{61c}\u{200e}\u{200f}')).toBe('\\u2028\\u2029\\u061c\\u200e\\u200f');
    expect(escapeForDisplay('\u{202a}\u{202b}\u{202c}\u{202d}\u{202e}\u{2066}\u{2067}\u{2068}\u{2069}')).toBe(
      '\\u202a\\u202b\\u202c\\u202d\\u202e\\u2066\\u2067\\u2068\\u2069',
    );
  });

  it('leaves visible text, backslashes, quotes, emoji and other invisible characters alone', () => {
    const text = 'caf\u{e9} \u{4e2d}\u{6587} \u{1f600} "quote" back\\slash \u{200b}';
    expect(escapeForDisplay(text)).toBe(text);
    expect(escapeForDisplay('')).toBe('');
  });

  it('does not treat the boundary characters just outside each escaped range as unsafe', () => {
    for (const ch of ['\u{a0}', '\u{2027}', '\u{202f}', '\u{2065}', '\u{206a}', '\u{200d}', '\u{200c}']) {
      expect(escapeForDisplay(ch)).toBe(ch);
    }
  });
});

describe('isArray', () => {
  it('is true for arrays and false for everything else, including a revoked array proxy', () => {
    expect(isArray([])).toBe(true);
    expect(isArray(new Array(3))).toBe(true);
    expect(isArray({ length: 0 })).toBe(false);
    expect(isArray('abc')).toBe(false);
    expect(isArray(null)).toBe(false);
    expect(isArray(revokedProxy([]))).toBe(false);
  });
});

describe('isPlainObject', () => {
  it('accepts plain and null-prototype objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('accepts an object whose prototype is another realm\'s Object.prototype (a prototype whose own prototype is null)', () => {
    const foreignObjectPrototype = Object.create(null) as object;
    expect(isPlainObject(Object.create(foreignObjectPrototype) as object)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'x'],
    ['a number', 1],
    ['an array', []],
    ['a Map', new Map()],
    ['a Set', new Set()],
    ['a Date', new Date(0)],
    ['a RegExp', /x/],
    ['a class instance', new (class Foo {})()],
    ['a function', () => 1],
    ['an object with a custom prototype', Object.create({ inherited: true }) as object],
    ['a revoked proxy', revokedProxy()],
  ])('rejects %s', (_label, value) => {
    expect(isPlainObject(value)).toBe(false);
  });
});

describe('describeType (never calls into the value)', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const hostile = {
    toString: () => {
      throw new Error('toString called');
    },
    toJSON: () => {
      throw new Error('toJSON called');
    },
    get boom(): never {
      throw new Error('getter called');
    },
  };

  it.each([
    ['a string', 'a long caller string', 'string'],
    ['a number', 42, '42'],
    ['NaN', NaN, 'NaN'],
    ['a negative zero', -0, '0'],
    ['Infinity', Infinity, 'Infinity'],
    ['a boolean', false, 'boolean'],
    ['a bigint', 10n, 'bigint'],
    ['a symbol', Symbol('s'), 'symbol'],
    ['a function', () => 1, 'function'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['an array', [1], 'an array'],
    ['a plain object', {}, 'an object'],
    ['a null-prototype object', Object.create(null) as object, 'an object'],
    ['a cyclic object', cyclic, 'an object'],
    ['a hostile object', hostile, 'an object'],
    ['a Map', new Map(), 'a non-plain object'],
    ['a Date', new Date(0), 'a non-plain object'],
    ['a class instance', new (class Foo {})(), 'a non-plain object'],
    ['a revoked proxy', revokedProxy(), 'a non-plain object'],
    ['a revoked array proxy', revokedProxy([]), 'a non-plain object'],
  ])('names %s', (_label, value, expected) => {
    expect(describeType(value)).toBe(expected);
  });
});

describe('displayValue (never calls into the value)', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  it.each([
    ['a string', 'Verified', '"Verified"'],
    ['an empty string', '', '""'],
    ['a string with controls', 'a\nb\u{202e}', '"a\\u000ab\\u202e"'],
    ['a number', 42, '42'],
    ['NaN', NaN, 'NaN'],
    ['a boolean', true, 'true'],
    ['a bigint', 10n, '10n'],
    ['a negative bigint', -3n, '-3n'],
    ['a symbol', Symbol('s'), 'a symbol'],
    ['a function', () => 1, 'a function'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['a cyclic object', cyclic, 'an object'],
    ['an array', [1], 'an object'],
    ['an object with a throwing toJSON', { toJSON: () => { throw new Error('boom'); } }, 'an object'],
  ])('shows %s', (_label, value, expected) => {
    expect(displayValue(value)).toBe(expected);
  });
});
