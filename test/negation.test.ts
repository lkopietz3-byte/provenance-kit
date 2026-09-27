// Negation and word boundaries. Two directions matter:
//   - a negation that does NOT apply to the phrase must not suppress the flag
//     (false negative: an overclaim slips through);
//   - a real negation ("isn't", "no guarantee") should not raise a flag
//     (false positive: noise that teaches people to ignore the lint).
//
// The scanner is a fixed-width "characters before the match" window, not a
// clause parser (see README "Honest limits") — it deliberately does not try
// to tell "not X, but Y" from "not X and Y". These tests pin down the
// window's actual boundary and the negation vocabulary, not clause parsing.

import { describe, expect, it } from 'vitest';
import { flaggedPhrases } from './helpers.js';

describe('negation applies within the same clause', () => {
  it.each([
    ['not', 'These figures are not a proprietary dataset.'],
    ['isn\'t', "This isn't a proprietary dataset."],
    ['isn’t (curly apostrophe)', 'This isn’t a proprietary dataset.'],
    ["doesn't", "This doesn't claim to be a proprietary dataset."],
    ['doesn’t (curly apostrophe)', 'This doesn’t claim to be a proprietary dataset.'],
    ["don't", "We don't use a proprietary dataset."],
    ["can't", "You can't call this a proprietary dataset."],
    ["won't", "We won't pretend this is a proprietary dataset."],
    ['cannot', 'This cannot be described as a proprietary dataset.'],
    ['without', 'Built without a proprietary dataset.'],
    ['never', 'It was never a proprietary dataset.'],
    ['nor', 'Neither measured nor a proprietary dataset.'],
    ['neither', 'It is neither estimated nor a proprietary dataset.'],
    ['none', 'None of this is a proprietary dataset.'],
    ['nothing', 'Nothing here is a proprietary dataset.'],
    ['far from', 'Far from a proprietary dataset.'],
    ['UPPER-CASE NOT', 'This is NOT a proprietary dataset.'],
    ['Capitalized Not', 'Not a proprietary dataset.'],
    ['no', 'We used no proprietary dataset.'],
  ])('does not flag a phrase negated by %s', (_label, text) => {
    expect(flaggedPhrases(text)).toEqual([]);
  });

  it('treats "no guarantee" as a disclaimer, not a promise', () => {
    expect(flaggedPhrases('There is no guarantee these numbers hold.')).toEqual([]);
    expect(flaggedPhrases('These numbers are guaranteed.')).toEqual(['guaranteed', 'guarantee']);
  });

  it('recognizes capitalized negation even when caseSensitive is true', () => {
    expect(flaggedPhrases('Not a proprietary dataset.', { caseSensitive: true })).toEqual([]);
  });
});

describe('the negation window is a fixed character count, not a clause parser (documented trade-off)', () => {
  // README "Honest limits": this is a "characters before the match" window,
  // not grammar. A negation earlier in the same window still suppresses a
  // later, unrelated phrase — false positives here are the accepted cost of
  // catching every real negation with a small, auditable rule.
  it('a negation followed by punctuation still suppresses a phrase later in the window', () => {
    expect(flaggedPhrases('Ships are not cheap. Our proprietary dataset covers them.')).toEqual([]);
    expect(flaggedPhrases('These are not guesses, they are independently verified.')).toEqual([]);
  });

  it('a negation outside the window does not suppress the phrase', () => {
    const farNegation = `not ${'x'.repeat(60)} independently verified`;
    expect(flaggedPhrases(farNegation)).toEqual(['independently verified']);
  });
});

describe('negation words that do not negate', () => {
  it.each([
    ['no doubt', 'There is no doubt this is independently verified.'],
    ['no question', 'There is no question this is independently verified.'],
    ['no wonder', 'It is no wonder this is independently verified.'],
    ['no one', 'No one disputes this independently verified figure.'],
    ['not only', 'Not only is it fact-checked, it is audited.'],
    ['not just', 'This is not just fact-checked but audited.'],
    ['not merely', 'It is not merely fact-checked.'],
    ['not simply', 'It is not simply fact-checked.'],
  ])('still flags a phrase after "%s" (an idiom, not a real negation)', (_label, text) => {
    expect(flaggedPhrases(text)).not.toEqual([]);
  });

  it('does not treat words that merely contain a negation as negations', () => {
    expect(flaggedPhrases('Note that this is independently verified.')).toEqual(['independently verified']);
    expect(flaggedPhrases('We know our proprietary dataset well.')).toEqual(['proprietary dataset']);
  });
});

describe('negationWindow boundaries', () => {
  // Folded text before the phrase is "not xxxxxxxxxx " (15 characters), so the
  // whole word "not" fits only when the window is at least 15.
  const text = 'not xxxxxxxxxx proprietary dataset';

  it('negates when the window is exactly wide enough', () => {
    expect(flaggedPhrases(text, { negationWindow: 15 })).toEqual([]);
  });

  it('negates when the window is wider', () => {
    expect(flaggedPhrases(text, { negationWindow: 16 })).toEqual([]);
    expect(flaggedPhrases(text, { negationWindow: 500 })).toEqual([]);
  });

  it('does not negate when the window is one character too narrow', () => {
    expect(flaggedPhrases(text, { negationWindow: 14 })).toEqual(['proprietary dataset']);
  });

  it('a window of 0 disables negation entirely', () => {
    expect(flaggedPhrases('This is not a proprietary dataset.', { negationWindow: 0 })).toEqual([
      'proprietary dataset',
    ]);
  });

  it('defaults to 40 characters', () => {
    const far = `not ${'x'.repeat(38)} proprietary dataset`; // "not" is 43 chars before the phrase
    const near = `not ${'x'.repeat(30)} proprietary dataset`; // 35 chars before
    expect(flaggedPhrases(far)).toEqual(['proprietary dataset']);
    expect(flaggedPhrases(near)).toEqual([]);
  });

  it('a phrase at the very start of the text has nothing before it to negate it', () => {
    expect(flaggedPhrases('Proprietary dataset, not estimated.')).toEqual(['proprietary dataset']);
  });
});

describe('phrase start is a word boundary; the end is not', () => {
  it('does not match inside a longer word ("unverified dataset")', () => {
    expect(flaggedPhrases('This is an unverified dataset of bids.')).toEqual([]);
    expect(flaggedPhrases('We use no preverified dataset here.')).toEqual([]);
  });

  it('does not match a number that merely ends in the phrase digits', () => {
    expect(flaggedPhrases('Accuracy of 2100% accurate is nonsense.')).toEqual([]);
    expect(flaggedPhrases('It is 100% accurate.')).toEqual(['100% accurate']);
  });

  it('matches inflected and plural forms (the end is open)', () => {
    // "guaranteed" contains "guarantee" as a prefix, and both are default
    // certainty phrases, so a sentence using "guaranteed" flags both.
    expect(flaggedPhrases('These prices are guaranteed.')).toEqual(['guaranteed', 'guarantee']);
    expect(flaggedPhrases('Price guarantees apply.')).toEqual(['guarantee']);
    expect(flaggedPhrases('We keep proprietary datasets.')).toEqual(['proprietary dataset']);
  });

  it('applies no start boundary to a phrase that begins with punctuation', () => {
    expect(flaggedPhrases('Ship spec(verified) 168,666 GT.')).toEqual(['(verified)']);
    expect(flaggedPhrases('Ship spec (verified) 168,666 GT.')).toEqual(['(verified)']);
    expect(flaggedPhrases('Ship spec (unverified) 168,666 GT.')).toEqual([]);
  });

  it('matches after hyphens and punctuation (not word characters)', () => {
    expect(flaggedPhrases('A self-verified dataset.')).toEqual(['verified dataset']);
    expect(flaggedPhrases('"verified dataset"')).toEqual(['verified dataset']);
  });

  it('a custom bare word is usable because of the boundary ("verified" vs "unverified")', () => {
    const options = { certaintyPhrases: ['verified'] };
    expect(flaggedPhrases('This is verified.', options)).toEqual(['verified']);
    expect(flaggedPhrases('This is unverified.', options)).toEqual([]);
    expect(flaggedPhrases('This is not verified.', options)).toEqual([]);
  });

  it('keeps scanning after a failed boundary check', () => {
    // First hit is inside "unverified"; the second is a real match.
    expect(flaggedPhrases('unverified dataset and a verified dataset')).toEqual(['verified dataset']);
  });
});
