// Messages built from caller values must never throw and must never let a
// caller string forge structure (a line break, a terminal escape, bidi
// reordering). Structured fields (claimId, claimText, phrase) stay raw.
// Also: "visibly empty" sourceRef values must count as missing.

import { describe, expect, it } from 'vitest';
import { validateClaims, type Claim } from '../src/index.js';

const UNSAFE = /[\p{Cc}\u{061c}\u{200e}\u{200f}\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}]/u;

function claim(over: Record<string, unknown>): Claim {
  return { id: 'c1', text: 'A plain sentence.', tier: 'modeled', ...over } as unknown as Claim;
}

describe('describing a bad tier can never throw (bug class 3)', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  it.each([
    ['a bigint', 1n, 'got 1n'],
    ['a cyclic object', cyclic, 'got an object'],
    ['an object with a throwing toJSON', { toJSON: () => { throw new Error('boom'); } }, 'got an object'],
    ['an object with a throwing toString', { toString: () => { throw new Error('boom'); } }, 'got an object'],
    ['a symbol', Symbol('s'), 'got a symbol'],
    ['a function', () => 1, 'got a function'],
    ['undefined', undefined, 'got undefined'],
    ['null', null, 'got null'],
    ['a number', 42, 'got 42'],
    ['NaN', NaN, 'got NaN'],
    ['a string', 'Verified', 'got "Verified"'],
    ['an empty string', '', 'got ""'],
    ['an array', ['verified'], 'got an object'],
  ])('reports %s as an unknown_tier offense', (_label, tier, fragment) => {
    const offenses = validateClaims([claim({ tier })]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.reason).toBe('unknown_tier');
    expect(offenses[0]?.message).toContain(fragment);
  });

  it('a string tier is escaped inside the message but echoed raw in the tier field', () => {
    const tier = 'ver\nified\u{1b}[31m\u{202e}';
    const [offense] = validateClaims([claim({ tier })]);
    expect(offense?.tier).toBe(tier);
    expect(offense?.message).toContain('got "ver\\u000aified\\u001b[31m\\u202e"');
    expect(offense?.message).not.toMatch(UNSAFE);
  });
});

describe('caller strings are escaped in human-readable text (bug class 8)', () => {
  const nasty = 'a\nb\r\u{1b}[31mred\u{7}\u{202e}\u{2066}\u{2028}z';
  const escaped = 'a\\u000ab\\u000d\\u001b[31mred\\u0007\\u202e\\u2066\\u2028z';

  it('escapes the claim id in an unknown_tier message and leaves claimId raw', () => {
    const [offense] = validateClaims([claim({ id: nasty, tier: 'nope' })]);
    expect(offense?.claimId).toBe(nasty);
    expect(offense?.message).toContain(`Claim "${escaped}" has no valid provenance tier`);
    expect(offense?.message).not.toMatch(UNSAFE);
  });

  it('escapes the claim id in a missing_source_ref message', () => {
    const [offense] = validateClaims([claim({ id: nasty, tier: 'verified' })]);
    expect(offense?.reason).toBe('missing_source_ref');
    expect(offense?.claimId).toBe(nasty);
    expect(offense?.message).toBe(
      `Claim "${escaped}" is tiered "verified" but has no sourceRef. Claims at this tier must cite what they were checked against.`,
    );
    expect(offense?.message).not.toMatch(UNSAFE);
  });

  it('escapes the phrase in a certainty message and leaves the phrase field raw', () => {
    // A line break inside the phrase still matches "independently verified"
    // because matching reads it as a space.
    const phrase = 'independently\nverified\u{1b}[0m';
    const [offense] = validateClaims([claim({ text: 'It was independently verified\u{1b}[0m.' })], {
      certaintyPhrases: [phrase],
    });
    expect(offense?.phrase).toBe(phrase);
    expect(offense?.message).toBe(
      'Claim uses certainty language ("independently\\u000averified\\u001b[0m") but is tiered "modeled", not one of: verified.',
    );
    expect(offense?.message).not.toMatch(UNSAFE);
  });

  it('escapes a custom reason and keeps its readable text', () => {
    const [offense] = validateClaims([claim({ text: 'clinically proven' })], {
      certaintyPhrases: [{ phrase: 'clinically proven', reason: 'Implies a trial.\nIgnore this line.\u{1b}[2J' }],
    });
    expect(offense?.message).toBe('Implies a trial.\\u000aIgnore this line.\\u001b[2J');
  });

  it('leaves claimText untouched, including control characters', () => {
    const text = 'x\ny is a proprietary dataset\u{202e}';
    const [offense] = validateClaims([claim({ text })]);
    expect(offense?.claimText).toBe(text);
  });

  it('does not escape ordinary text: quotes, backslashes, emoji, accents, CJK', () => {
    const id = 'q"uote\\back \u{1f600} caf\u{e9} \u{4e2d}\u{6587}';
    const [offense] = validateClaims([claim({ id, tier: 'nope' })]);
    expect(offense?.message).toContain(`Claim "${id}" has no valid`);
  });

  it('a default reason and a blank custom reason both fall back to readable default text', () => {
    for (const reason of ['', '   ', '\u{200b}\u{2066}', '\u{0}']) {
      const [offense] = validateClaims([claim({ text: 'clinically proven' })], {
        certaintyPhrases: [{ phrase: 'clinically proven', reason }],
      });
      expect(offense?.message).toBe(
        'Claim uses certainty language ("clinically proven") but is tiered "modeled", not one of: verified.',
      );
    }
  });
});

describe('a visibly empty sourceRef counts as missing (bug class 7)', () => {
  const verified = (sourceRef: string): Claim =>
    claim({ tier: 'verified', sourceRef });

  it.each([
    ['empty', ''],
    ['spaces', '   '],
    ['tab and newline', '\t\n'],
    ['zero-width space', '\u{200b}'],
    ['soft hyphen', '\u{ad}'],
    ['word joiner and BOM', '\u{2060}\u{feff}'],
    ['left-to-right isolate pair', '\u{2066}\u{2069}'],
    ['right-to-left isolate pair', '\u{2067}\u{2069}'],
    ['first-strong isolate pair', '\u{2068}\u{2069}'],
    ['Arabic letter mark', '\u{61c}'],
    ['bidi marks and overrides', '\u{200e}\u{200f}\u{202a}\u{202b}\u{202c}\u{202d}\u{202e}'],
    ['variation selector', '\u{fe0f}'],
    ['Hangul filler', '\u{3164}'],
    ['Mongolian vowel separator', '\u{180e}'],
    ['tag characters', '\u{e0001}\u{e0020}'],
    ['NUL and other controls', '\u{0}\u{1}\u{7f}'],
    ['non-breaking and ideographic spaces', '\u{a0}\u{3000}'],
    ['a mix of all of them', ' \u{200b}\u{2066}\u{61c}\n\u{feff} '],
  ])('flags %s as missing_source_ref', (_label, sourceRef) => {
    const offenses = validateClaims([verified(sourceRef)]);
    expect(offenses.map((o) => o.reason)).toEqual(['missing_source_ref']);
  });

  it.each([
    ['a URL', 'https://operator.example/specs'],
    ['a URL wrapped in bidi isolates', '\u{2066}https://operator.example/specs\u{2069}'],
    ['a single letter', 'a'],
    ['a single digit', '7'],
    ['punctuation only', '.'],
    ['an emoji', '\u{1f600}'],
    ['a CJK reference', '\u{6587}\u{4e66}'],
    ['visible text among invisible characters', '\u{200b}RFC 9110\u{2069}'],
  ])('accepts %s', (_label, sourceRef) => {
    expect(validateClaims([verified(sourceRef)])).toEqual([]);
  });

  it('does not require a sourceRef for tiers outside requireSourceRefForTiers', () => {
    expect(validateClaims([claim({ tier: 'modeled', sourceRef: '\u{200b}' })])).toEqual([]);
    expect(
      validateClaims([verified('\u{200b}')], { requireSourceRefForTiers: ['modeled'] }),
    ).toEqual([]);
  });

  it('applies the same rule to a configured tier list', () => {
    const offenses = validateClaims([claim({ tier: 'modeled', sourceRef: '\u{2066}\u{2069}' })], {
      requireSourceRefForTiers: ['modeled'],
    });
    expect(offenses.map((o) => [o.reason, o.tier])).toEqual([['missing_source_ref', 'modeled']]);
  });
});
