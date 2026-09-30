// Review finding: a negation used to hide a real certainty phrase that sat in
// a different coordinated part of the same clause ("No fees and guaranteed
// returns", "not a guess but a verified dataset"). The words `and` and `but`
// now end a negation's scope, like a clause boundary does; `nothing but` and
// `without question` are idioms that assert what follows.
//
// The six false negatives the review found, and what happens to each:
//   caught now:        "No fees and guaranteed returns."
//                      "It is not a guess but a verified dataset."
//                      "Nothing but independently verified sources."
//                      "Without question independently verified."
//   documented misses: "Don't miss our independently verified rates."
//                      "You can't beat our proprietary dataset."
//                      (the negation governs a verb, not the phrase; a clause
//                      scanner cannot tell "don't miss X" from "don't claim X")

import { describe, expect, it } from 'vitest';
import { flaggedPhrases } from './helpers.js';

describe('the six reviewer examples on a modeled claim', () => {
  it.each([
    ['No fees and guaranteed returns.', ['guaranteed', 'guarantee']],
    ['It is not a guess but a verified dataset.', ['verified dataset']],
    ['Nothing but independently verified sources.', ['independently verified']],
    ['Without question independently verified.', ['independently verified']],
  ])('flags %j', (text, expected) => {
    expect(flaggedPhrases(text)).toEqual(expected);
  });

  it.each([
    "Don't miss our independently verified rates.",
    "You can't beat our proprietary dataset.",
  ])('still misses %j (documented limit: the negation governs a verb)', (text) => {
    expect(flaggedPhrases(text)).toEqual([]);
  });
});

describe('"but" ends a negation', () => {
  it.each([
    ['not cheap but independently verified', ['independently verified']],
    ['Not a guess but fact-checked.', ['fact-checked']],
    ['NOT A GUESS BUT A PROPRIETARY DATASET', ['proprietary dataset']],
    ['never late but always independently verified', ['independently verified']],
    ['This is not a guess\tbut\ta verified dataset.', ['verified dataset']],
  ])('flags the phrase after "but" in %j', (text, expected) => {
    expect(flaggedPhrases(text)).toEqual(expected);
  });

  it('a negation after "but" protects the phrase again', () => {
    expect(flaggedPhrases('It is not cheap but not a proprietary dataset.')).toEqual([]);
    expect(flaggedPhrases('Fast but never independently verified.')).toEqual([]);
  });

  it('a negation before "but" still protects a phrase that comes before "but"', () => {
    expect(flaggedPhrases('This is not a proprietary dataset but it is modeled.')).toEqual([]);
  });

  it('is a whole word: "but" inside another word is not a boundary', () => {
    expect(flaggedPhrases('It is not a butterfly proprietary dataset.')).toEqual([]);
    expect(flaggedPhrases('We are not rebutting the independently verified figure.')).toEqual([]);
    expect(flaggedPhrases('It is not abut independently verified.')).toEqual([]);
  });

  it('"not only ... but also" still asserts what follows "but"', () => {
    // Offenses follow the phrase-list order, not the order in the text.
    expect(flaggedPhrases('It is not only fact-checked but also independently verified.')).toEqual([
      'independently verified',
      'fact-checked',
    ]);
  });
});

describe('"and" ends a negation after its own object', () => {
  it.each([
    ['no fees and guaranteed returns', ['guaranteed', 'guarantee']],
    ['There are no hidden fees and a proprietary dataset behind it.', ['proprietary dataset']],
    ['It is not a guess and it is independently verified.', ['independently verified']],
    ['We never overcharge AND our numbers are fact-checked.', ['fact-checked']],
  ])('flags the phrase after "and" in %j', (text, expected) => {
    expect(flaggedPhrases(text)).toEqual(expected);
  });

  it('a negation after "and" protects the phrase again', () => {
    expect(flaggedPhrases('No fees and no guaranteed returns.')).toEqual([]);
    expect(flaggedPhrases('It is not cheap and is not a proprietary dataset.')).toEqual([]);
  });

  it('a negation before "and" still protects a phrase that comes before "and"', () => {
    expect(flaggedPhrases('This is not a proprietary dataset and never was.')).toEqual([]);
  });

  it('is a whole word: "and" inside another word is not a boundary', () => {
    expect(flaggedPhrases('It is not a band independently verified.')).toEqual([]);
    expect(flaggedPhrases('We are not a brand proprietary dataset.')).toEqual([]);
    expect(flaggedPhrases('It is not Sandy fact-checked.')).toEqual([]);
  });

  it('documented false positive: a negation over a coordinated phrase list is cut at "and"', () => {
    // Same class as the comma-separated list in the README's Honest limits: the
    // scanner cannot tell that "not" governs both coordinated items.
    expect(flaggedPhrases('We do not use guaranteed and verified datasets.')).toEqual(['verified dataset']);
  });

  it('"or" and "nor" are not scope boundaries', () => {
    expect(flaggedPhrases('Neither measured nor a proprietary dataset.')).toEqual([]);
    expect(flaggedPhrases('It is not guaranteed or independently verified.')).toEqual([]);
  });
});

describe('idioms that contain a negation word but assert what follows', () => {
  it.each([
    ['nothing but', 'We publish nothing but independently verified sources.'],
    ['without question', 'It is, without question, independently verified.'],
    ['without question (no commas)', 'It is without question independently verified.'],
    ['NOTHING BUT', 'NOTHING BUT FACT-CHECKED FIGURES.'],
  ])('%s does not suppress a phrase in the same clause', (_label, text) => {
    expect(flaggedPhrases(text)).not.toEqual([]);
  });

  it('a real negation in the same clause still suppresses after such an idiom', () => {
    expect(flaggedPhrases('Without question, it is not a proprietary dataset.')).toEqual([]);
    expect(flaggedPhrases('Nothing but not independently verified.')).toEqual([]);
  });

  it('"without" on its own still negates', () => {
    expect(flaggedPhrases('Built without a proprietary dataset.')).toEqual([]);
    expect(flaggedPhrases('Shipped without any question about the proprietary dataset.')).toEqual([]);
  });
});

describe('negationWindow interacts with the new boundaries', () => {
  it('a window of 0 still turns negation off, with or without "and"/"but"', () => {
    expect(flaggedPhrases('not a guess but a verified dataset', { negationWindow: 0 })).toEqual(['verified dataset']);
  });

  it('a wide window stops at "but" the same way a narrow one does', () => {
    const text = `not ${'really '.repeat(20)}but independently verified`;
    expect(flaggedPhrases(text, { negationWindow: Infinity })).toEqual(['independently verified']);
  });
});
