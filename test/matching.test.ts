// Phrase matching: the scanner must see through spacing, hyphenation, case,
// and Unicode-encoding differences that do not change what a reader sees.
// A miss here is the dangerous direction: an overclaim slipping through.

import { describe, expect, it } from 'vitest';
import { validateClaims } from '../src/index.js';
import { flaggedPhrases } from './helpers.js';

describe('phrase matching ignores spacing and hyphenation', () => {
  it.each([
    ['double space', 'This is independently  verified data.'],
    ['tab', 'This is independently\tverified data.'],
    ['line break', 'This is independently\nverified data.'],
    ['Windows line break', 'This is independently\r\nverified data.'],
    ['non-breaking space', 'This is independently verified data.'],
    ['ideographic space', 'This is independently　verified data.'],
    ['hyphen instead of space', 'This is independently-verified data.'],
    ['non-breaking hyphen', 'This is independently‑verified data.'],
    ['Unicode hyphen U+2010', 'This is independently‐verified data.'],
  ])('flags "independently verified" written with %s', (_label, text) => {
    expect(flaggedPhrases(text)).toEqual(['independently verified']);
  });

  it.each([
    ['fact checked', 'Every number here is fact checked.'],
    ['fact-checked', 'Every number here is fact-checked.'],
    ['Fact‑Checked', 'Every number here is Fact‑Checked.'],
  ])('flags "fact-checked" written as %s', (_label, text) => {
    expect(flaggedPhrases(text)).toEqual(['fact-checked']);
  });

  it('flags "reverse engineered" without the hyphen', () => {
    expect(flaggedPhrases('We reverse engineered the pricing.')).toEqual(['reverse-engineered']);
  });

  it('does not treat a hyphen as equal to a different letter or an en dash', () => {
    expect(flaggedPhrases('This is independently–verified data.')).toEqual([]);
    expect(flaggedPhrases('This is independentlyXverified data.')).toEqual([]);
  });
});

describe('phrase matching is Unicode-aware', () => {
  it('sees through a ligature copied from a PDF ("veriﬁed")', () => {
    expect(flaggedPhrases('Our veriﬁed dataset shows it.')).toEqual(['verified dataset']);
  });

  it('sees through full-width letters', () => {
    expect(flaggedPhrases('Our ｖｅｒｉｆｉｅｄ ｄａｔａｓｅｔ shows it.')).toEqual(['verified dataset']);
  });

  it('ignores soft hyphens and zero-width characters inside a phrase', () => {
    expect(flaggedPhrases('Our proprie­tary dataset shows it.')).toEqual(['proprietary dataset']);
    expect(flaggedPhrases('Our propri​etary dataset shows it.')).toEqual(['proprietary dataset']);
    expect(flaggedPhrases('Our proprietary⁠ dataset shows it.')).toEqual(['proprietary dataset']);
  });

  it('matches upper, lower, and mixed case by default', () => {
    expect(flaggedPhrases('INDEPENDENTLY VERIFIED')).toEqual(['independently verified']);
    expect(flaggedPhrases('Independently Verified')).toEqual(['independently verified']);
    expect(flaggedPhrases('iNdEpEnDeNtLy vErIfIeD')).toEqual(['independently verified']);
  });

  it('honors caseSensitive: true for letter case', () => {
    const options = { certaintyPhrases: ['Fact-Checked'], caseSensitive: true };
    expect(flaggedPhrases('This is Fact-Checked.', options)).toEqual(['Fact-Checked']);
    expect(flaggedPhrases('This is fact-checked.', options)).toEqual([]);
  });

  it('still folds spacing and hyphenation when caseSensitive is true', () => {
    const options = { certaintyPhrases: ['Fact-Checked'], caseSensitive: true };
    expect(flaggedPhrases('This is Fact Checked.', options)).toEqual(['Fact-Checked']);
    expect(flaggedPhrases('This is Fact Checked.', options)).toEqual(['Fact-Checked']);
  });

  it('reports the phrase as the caller wrote it, not the folded form', () => {
    const offenses = validateClaims(
      [{ id: 'a', text: 'Our ｖｅｒｉｆｉｅｄ ｄａｔａｓｅｔ.', tier: 'modeled' }],
      { certaintyPhrases: [{ phrase: 'Verified Dataset', reason: 'r' }] },
    );
    expect(offenses).toHaveLength(1);
    expect(offenses[0]?.phrase).toBe('Verified Dataset');
    expect(offenses[0]?.claimText).toBe('Our ｖｅｒｉｆｉｅｄ ｄａｔａｓｅｔ.');
  });

  it('is not thrown off when lower-casing changes the text length', () => {
    // "İ".toLowerCase() is two UTF-16 units, so match positions computed on
    // the lower-cased copy used to point past the real position. The
    // negation "not" that comes AFTER the phrase then fell inside the window.
    const prefix = 'İ'.repeat(30);
    const text = `${prefix} Our proprietary dataset is not free.`;
    expect(flaggedPhrases(text)).toEqual(['proprietary dataset']);
    // Control: the same sentence with a length-stable prefix.
    expect(flaggedPhrases(`${'a'.repeat(30)} Our proprietary dataset is not free.`)).toEqual([
      'proprietary dataset',
    ]);
  });
});

describe('phrase matching stays linear on adversarial input', () => {
  it('handles a very long run of separators in well under a second', () => {
    const text = `independently${' '.repeat(200_000)}not-a-match ${'fact '.repeat(20_000)}`;
    const started = Date.now();
    expect(flaggedPhrases(text)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
