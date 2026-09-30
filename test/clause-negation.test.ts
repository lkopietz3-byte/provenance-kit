// PVK-F-003: negation is clause-bounded.
//
// A negation word only suppresses a certainty phrase when no clause boundary
// (`, ; . : ! ? — –` or a line break) sits between the negation and the
// phrase, still inside `negationWindow`. Two directions matter:
//   - a negation that belongs to a DIFFERENT clause must not hide an overclaim
//     (false negative, the dangerous direction);
//   - a real negation in the same clause must still suppress the flag
//     (false positive, noise).

import { describe, expect, it } from 'vitest';
import { flaggedPhrases } from './helpers.js';

const CLAUSE_BOUNDARIES = [
  ['comma', ','],
  ['semicolon', ';'],
  ['period', '.'],
  ['colon', ':'],
  ['exclamation mark', '!'],
  ['question mark', '?'],
  ['em dash', '—'],
  ['en dash', '–'],
  ['line feed', '\n'],
  ['carriage return + line feed', '\r\n'],
  ['carriage return', '\r'],
  ['line separator U+2028', ' '],
  ['paragraph separator U+2029', ' '],
  ['next line U+0085', '\u0085'],
  ['vertical tab', '\v'],
  ['form feed', '\f'],
] as const;

describe('a negation in another clause does not hide an overclaim', () => {
  it('reports the audit reproduction (PVK-F-003)', () => {
    expect(flaggedPhrases('These are not guesses, they are independently verified.')).toEqual([
      'independently verified',
    ]);
  });

  it.each(CLAUSE_BOUNDARIES)('a %s between the negation and the phrase ends the negation', (_label, boundary) => {
    expect(flaggedPhrases(`These are not guesses${boundary} our proprietary dataset covers them.`)).toEqual([
      'proprietary dataset',
    ]);
  });

  it.each(CLAUSE_BOUNDARIES)('a %s with no spaces around it still ends the negation', (_label, boundary) => {
    expect(flaggedPhrases(`not guesses${boundary}proprietary dataset`)).toEqual(['proprietary dataset']);
  });

  it('a boundary right after the negation word ends it ("No, this is ...")', () => {
    expect(flaggedPhrases('No, this is a proprietary dataset.')).toEqual(['proprietary dataset']);
    expect(flaggedPhrases('Not. Proprietary dataset.')).toEqual(['proprietary dataset']);
  });

  it('a boundary INSIDE the window still cuts a negation that is well within the window', () => {
    expect(flaggedPhrases('not, proprietary dataset', { negationWindow: 500 })).toEqual(['proprietary dataset']);
    expect(flaggedPhrases('no. independently verified.', { negationWindow: Infinity })).toEqual([
      'independently verified',
    ]);
  });

  it('only the nearest clause counts, however many negations came earlier', () => {
    expect(
      flaggedPhrases('It is not cheap, not quick, never simple; it is a proprietary dataset.'),
    ).toEqual(['proprietary dataset']);
  });

  it('a line break ends the negation even though matching treats it as a space', () => {
    // Matching still reads "independently\nverified" as the phrase (see
    // matching.test.ts); only the negation check sees the line break.
    expect(flaggedPhrases('This is not\nindependently verified.')).toEqual(['independently verified']);
    expect(flaggedPhrases('This is not\n\n   \tindependently\nverified.')).toEqual(['independently verified']);
  });

  it('an unrelated negation before a boundary does not protect a phrase after it (custom bare word)', () => {
    const options = { certaintyPhrases: ['verified'] };
    expect(flaggedPhrases('Nothing was skipped, and everything is verified.', options)).toEqual(['verified']);
  });

  it('a phrase that begins with punctuation is judged by the text before it', () => {
    expect(flaggedPhrases('This is not (verified).')).toEqual([]);
    expect(flaggedPhrases('This is fine, (verified).')).toEqual(['(verified)']);
  });
});

describe('a negation in the same clause still suppresses the phrase', () => {
  it('suppresses "This is not verified."', () => {
    expect(flaggedPhrases('This is not verified.', { certaintyPhrases: ['verified'] })).toEqual([]);
  });

  it('suppresses "We don\'t claim it is verified" (straight and curly apostrophes)', () => {
    const options = { certaintyPhrases: ['verified'] };
    expect(flaggedPhrases("We don't claim it is verified", options)).toEqual([]);
    expect(flaggedPhrases('We don’t claim it is verified', options)).toEqual([]);
  });

  it.each([
    'These figures are not a proprietary dataset.',
    'This is NOT a proprietary dataset.',
    'We never said this was a proprietary dataset.',
    'Built without a proprietary dataset.',
    'Neither measured nor a proprietary dataset.',
    'There is no guarantee of a proprietary dataset.',
  ])('suppresses %s', (text) => {
    expect(flaggedPhrases(text)).toEqual([]);
  });

  it('a boundary BEFORE the negation is irrelevant', () => {
    expect(flaggedPhrases('Yes, this is not a proprietary dataset.')).toEqual([]);
    expect(flaggedPhrases('Note: this is not a proprietary dataset.')).toEqual([]);
    expect(flaggedPhrases('First point. Second point — it is not a proprietary dataset.')).toEqual([]);
  });

  it('a boundary AFTER the phrase is irrelevant', () => {
    expect(flaggedPhrases('Not a proprietary dataset, and never was.')).toEqual([]);
    expect(flaggedPhrases('This is not a proprietary dataset—it is modeled.')).toEqual([]);
  });

  it('hyphens and apostrophes are not clause boundaries', () => {
    expect(flaggedPhrases('This is not a well-known proprietary dataset.')).toEqual([]);
    expect(flaggedPhrases("It isn't anyone's proprietary dataset.")).toEqual([]);
  });

  it('a second negation in the later clause protects the phrase there', () => {
    expect(flaggedPhrases('It is not cheap, and it is not a proprietary dataset.')).toEqual([]);
  });

  it('negationWindow: Infinity reaches back to the clause start and no further', () => {
    const filler = 'really '.repeat(100);
    expect(flaggedPhrases(`It is not ${filler}a proprietary dataset.`, { negationWindow: Infinity })).toEqual([]);
    expect(flaggedPhrases(`It is not ${filler}a proprietary dataset.`)).toEqual(['proprietary dataset']);
  });
});

describe('mixed claims: each match is judged by its own clause', () => {
  it('flags only the phrase that is not negated in its own clause', () => {
    expect(
      flaggedPhrases('This is not a proprietary dataset, but it is independently verified.'),
    ).toEqual(['independently verified']);
    expect(
      flaggedPhrases('It is independently verified, not a proprietary dataset.'),
    ).toEqual(['independently verified']);
  });

  it('flags every overclaim after a boundary (offenses follow the phrase-list order)', () => {
    expect(
      flaggedPhrases('Not a proprietary database. A proprietary dataset; fact-checked; guaranteed!'),
    ).toEqual(['proprietary dataset', 'guaranteed', 'guarantee', 'fact-checked']);
  });
});

describe('idioms still do not negate, inside the clause', () => {
  it('"no doubt" and "not only" do not suppress a phrase in the same clause', () => {
    expect(flaggedPhrases('There is no doubt it is independently verified.')).toEqual(['independently verified']);
    expect(flaggedPhrases('It is not only fact-checked but audited.')).toEqual(['fact-checked']);
  });

  it('a real negation after an idiom in the same clause still suppresses', () => {
    expect(flaggedPhrases('No doubt, but not independently verified.')).toEqual([]);
    expect(flaggedPhrases('Not only is it not a proprietary dataset.')).toEqual([]);
  });
});
