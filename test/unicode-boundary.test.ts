// PVK-F-002: the left word boundary is judged on whole code points, not UTF-16
// code units. `haystack[idx - 1]` used to be half of a surrogate pair, so a
// letter or digit outside the Basic Multilingual Plane never counted as a word
// character and "\u{10400}verified dataset" matched as if it started a word.
//
// Also: invisible formatting characters are removed before matching, and a
// rejected boundary candidate must not hide a valid overlapping one.

import { describe, expect, it } from 'vitest';
import { flaggedPhrases } from './helpers.js';

const DESERET_LETTER = '\u{10400}'; // U+10400, Lu, encoded as a surrogate pair
const OSMANYA_DIGIT = '\u{104A0}'; // U+104A0, Nd, encoded as a surrogate pair
const CJK_EXT_B = '\u{20000}'; // U+20000, Lo, encoded as a surrogate pair

describe('the left boundary reads the whole code point before the match', () => {
  it('does not match "verified dataset" right after a supplementary-plane letter (PVK-F-002)', () => {
    expect(flaggedPhrases(`${DESERET_LETTER}verified dataset`)).toEqual([]);
  });

  it.each([
    ['supplementary uppercase letter', DESERET_LETTER],
    ['supplementary ideograph', CJK_EXT_B],
    ['two supplementary letters', `${DESERET_LETTER}${DESERET_LETTER}`],
  ])('does not match after %s', (_label, before) => {
    expect(flaggedPhrases(`${before}verified dataset`)).toEqual([]);
  });

  it('does not match a number-led phrase after a supplementary-plane digit', () => {
    expect(flaggedPhrases(`${OSMANYA_DIGIT}100% accurate`)).toEqual([]);
    expect(flaggedPhrases(`${OSMANYA_DIGIT} 100% accurate`)).toEqual(['100% accurate']);
  });

  it('still matches after a space, punctuation, an emoji, or the start of the text', () => {
    expect(flaggedPhrases(`${DESERET_LETTER} verified dataset`)).toEqual(['verified dataset']);
    expect(flaggedPhrases(`${DESERET_LETTER}. verified dataset`)).toEqual(['verified dataset']);
    expect(flaggedPhrases(`${DESERET_LETTER}.verified dataset`)).toEqual(['verified dataset']);
    expect(flaggedPhrases('\u{1F600}verified dataset')).toEqual(['verified dataset']);
    expect(flaggedPhrases('verified dataset')).toEqual(['verified dataset']);
  });

  it('keeps the BMP and ASCII behavior (controls)', () => {
    expect(flaggedPhrases('éverified dataset')).toEqual([]); // é
    expect(flaggedPhrases('éverified dataset')).toEqual([]); // e + combining acute, composed by NFKC
    expect(flaggedPhrases('unverified dataset')).toEqual([]);
    expect(flaggedPhrases('7verified dataset')).toEqual([]);
    expect(flaggedPhrases(' verified dataset')).toEqual(['verified dataset']);
  });

  it('treats a lone (unpaired) surrogate as a non-word character', () => {
    expect(flaggedPhrases('\ud800verified dataset')).toEqual(['verified dataset']);
    expect(flaggedPhrases('\udc00verified dataset')).toEqual(['verified dataset']);
    expect(flaggedPhrases('x\udc00verified dataset')).toEqual(['verified dataset']);
  });
});

describe('a phrase that starts with a supplementary-plane character', () => {
  const options = { certaintyPhrases: [`${DESERET_LETTER}abc`] };

  it('needs a word boundary when its first code point is a letter', () => {
    expect(flaggedPhrases(`x${DESERET_LETTER}abc`, options)).toEqual([]);
    expect(flaggedPhrases(`${DESERET_LETTER}${DESERET_LETTER}abc`, options)).toEqual([]);
    expect(flaggedPhrases(`see ${DESERET_LETTER}abc`, options)).toEqual([`${DESERET_LETTER}abc`]);
    expect(flaggedPhrases(`${DESERET_LETTER}abc`, options)).toEqual([`${DESERET_LETTER}abc`]);
  });

  it('matches case-insensitively across the plane (U+10400 lower-cases to U+10428)', () => {
    expect(flaggedPhrases('see \u{10428}ABC', options)).toEqual([`${DESERET_LETTER}abc`]);
  });

  it('is unrestricted when its first code point is not a letter or digit', () => {
    const emoji = { certaintyPhrases: ['\u{1F600} verified'] };
    expect(flaggedPhrases('x\u{1F600} verified', emoji)).toEqual(['\u{1F600} verified']);
  });
});

describe('invisible formatting characters do not hide a phrase', () => {
  it.each([
    ['left-to-right isolate U+2066', '⁦'],
    ['right-to-left isolate U+2067', '⁧'],
    ['first-strong isolate U+2068', '⁨'],
    ['pop directional isolate U+2069', '⁩'],
    ['Arabic letter mark U+061C', '؜'],
    ['left-to-right embedding U+202A', '‪'],
    ['right-to-left override U+202E', '‮'],
    ['variation selector U+FE0F', '️'],
    ['combining grapheme joiner U+034F', '͏'],
    ['Mongolian free variation selector U+180B', '᠋'],
    ['invisible times U+2062', '⁢'],
    ['tag character U+E0041', '\u{E0041}'],
    ['zero width space U+200B (already handled)', '​'],
  ])('finds "independently verified" with %s inside a word and next to the space', (_label, invisible) => {
    expect(flaggedPhrases(`Our data is indepen${invisible}dently${invisible} verified.`)).toEqual([
      'independently verified',
    ]);
  });

  it('finds a hyphenated phrase with an invisible character next to the hyphen', () => {
    expect(flaggedPhrases('Every number is fact⁦-checked.')).toEqual(['fact-checked']);
  });

  it('finds a phrase configured with an invisible character in it', () => {
    expect(flaggedPhrases('This is clinically proven.', { certaintyPhrases: ['clinically⁦ proven'] })).toEqual([
      'clinically⁦ proven',
    ]);
  });

  it('an invisible character is not a word character, so it does not create or remove a left boundary', () => {
    // "un" + isolate + "verified dataset": the invisible character is removed,
    // so the text reads "unverified dataset" and is not a match.
    expect(flaggedPhrases('un⁦verified dataset')).toEqual([]);
  });
});

describe('a rejected boundary candidate does not hide a later valid match', () => {
  // "ab.ab" sits inside "xab.ab.ab" at index 1 (preceded by the letter x, so
  // rejected) and again at index 4 (preceded by ".", so valid). The scan must
  // resume one character after a rejected candidate, not after its whole length.
  const options = { certaintyPhrases: ['ab.ab'] };

  it('finds the overlapping match that starts after punctuation', () => {
    expect(flaggedPhrases('xab.ab.ab', options)).toEqual(['ab.ab']);
  });

  it('still reports accepted matches as non-overlapping', () => {
    expect(flaggedPhrases('ab.ab.ab', options)).toEqual(['ab.ab']);
    expect(flaggedPhrases('ab.ab ab.ab', options)).toEqual(['ab.ab', 'ab.ab']);
  });
});

describe('an empty phrase matches nothing and never loops', () => {
  // findOccurrences() returns early for an empty needle. Without that guard
  // `indexOf('', start)` returns `start` forever and the scan never ends.
  it.each([
    ['an empty string', ['']],
    ['an empty rule', [{ phrase: '' }]],
    ['a phrase made only of invisible characters', ['​⁦﻿']],
  ])('terminates with no offense for %s', (_label, certaintyPhrases) => {
    expect(flaggedPhrases('Anything at all, even ​ nothing.', { certaintyPhrases })).toEqual([]);
  });

  it('an empty phrase does not stop other phrases from matching', () => {
    expect(
      flaggedPhrases('A proprietary dataset.', { certaintyPhrases: ['', 'proprietary dataset'] }),
    ).toEqual(['proprietary dataset']);
  });
});
