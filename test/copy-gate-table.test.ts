// Verdict table for the copy gate (scanCopy).
//
// Written before the implementation. Honest copy must pass (no offenses, no
// missing statements); bad copy must be flagged. Adversarial rows sit next to
// the honest rows they could be confused with. Every exemption (negated,
// quoted) has a guard row where the cue is present and the copy is still bad.
//
// PASS means scanCopy returned no offenses and no missing statements. FLAG
// means at least one offense (or missing statement) came back, and the row can
// say exactly which rule ids must be among them.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRENGTH_RULES,
  scanCopy,
  type CopyRule,
  type ScanCopyOptions,
} from '../src/index.js';

const RULES: readonly CopyRule[] = [
  {
    id: 'no-guaranteed-returns',
    kind: 'banned',
    pattern: 'guaranteed returns',
    reason: 'No return is guaranteed.',
    replacement: 'estimated returns',
  },
  {
    id: 'no-risk-free',
    kind: 'banned',
    pattern: 'risk-free',
    reason: 'Nothing here is risk-free.',
  },
  {
    id: 'retracted-uptime',
    kind: 'retracted',
    pattern: '99.99% uptime',
    reason: 'Retracted on 2026-09-30: measured uptime was lower.',
    replacement: '99.9% uptime target',
  },
  {
    id: 'no-garantia',
    kind: 'banned',
    pattern: 'garant\u00eda total',
    reason: 'No total guarantee is offered.',
  },
  ...DEFAULT_STRENGTH_RULES,
];

const OPTIONS: ScanCopyOptions = {
  required: [{ id: 'disclaimer', phrase: 'Estimates are not guarantees' }],
  checkReference: [/\[\[check:[a-z0-9-]+\]\]/i, '/methodology'],
};

const DISCLAIMER = ' Estimates are not guarantees.';

type Verdict = 'PASS' | 'FLAG';
interface Row {
  name: string;
  text: string;
  expected: Verdict;
  /** Rule ids that must be among the offenses of a FLAG row. */
  ids?: readonly string[];
  /** The text carries (or deliberately lacks) its own disclaimer: do not append the standard one. */
  own?: boolean;
  rules?: readonly CopyRule[];
  options?: ScanCopyOptions;
}

function check(row: Row): void {
  it(row.name, () => {
    const options: ScanCopyOptions = { ...OPTIONS, ...row.options };
    const text = row.own === true ? row.text : row.text + DISCLAIMER;
    const result = scanCopy([{ id: 'page', text }], row.rules ?? RULES, options);
    if (row.expected === 'PASS') {
      expect(result.offenses).toEqual([]);
      expect(result.missing).toEqual([]);
    } else {
      expect(result.offenses.length + result.missing.length).toBeGreaterThan(0);
      for (const id of row.ids ?? []) {
        expect(result.offenses.map((o) => o.ruleId)).toContain(id);
      }
    }
  });
}

describe('honest copy passes', () => {
  const rows: Row[] = [
    { name: 'clean sentence with the disclaimer', text: 'Our model estimates monthly cost.', expected: 'PASS' },
    {
      name: 'negated: "do not offer"',
      text: 'We do not offer guaranteed returns.',
      expected: 'PASS',
    },
    { name: 'negated: "never advertise"', text: 'We never advertise guaranteed returns.', expected: 'PASS' },
    { name: 'negated: "cannot promise"', text: 'No plan can offer guaranteed returns.', expected: 'PASS' },
    {
      name: 'quoted glossary of banned words',
      text: 'Words we avoid: "guaranteed returns", "risk-free".',
      expected: 'PASS',
    },
    {
      name: 'quoted glossary with curly quotes',
      text: 'Banned terms: \u201cguaranteed returns\u201d and \u201crisk-free\u201d.',
      expected: 'PASS',
    },
    {
      name: 'quoted after the word "phrase"',
      text: 'The phrase "guaranteed returns" is retired.',
      expected: 'PASS',
    },
    {
      name: 'strength word next to a methodology link',
      text: 'Every price is verified against the filing ([how](/methodology)).',
      expected: 'PASS',
    },
    {
      name: 'strength word next to a check token',
      text: 'Transfers are atomic [[check:txn-atomicity]].',
      expected: 'PASS',
    },
    {
      name: 'strength word, check token before it',
      text: '[[check:ledger-sum]] Totals match: the ledger is accurate.',
      expected: 'PASS',
    },
    { name: 'strength word, negated', text: 'This figure is not verified by an outside firm.', expected: 'PASS' },
    { name: 'strength word, left boundary ("unverified")', text: 'An unverified rumor.', expected: 'PASS' },
    {
      name: 'disclaimer split by a line break still counts',
      text: 'Our model estimates cost.\nEstimates are\nnot guarantees.',
      expected: 'PASS',
      own: true,
    },
    {
      name: 'disclaimer written in full-width letters still counts',
      text: '\uff25stimates are not guarantees.',
      expected: 'PASS',
      own: true,
    },
    {
      name: 'a retracted claim named in a quoted correction entry',
      text: 'Retracted: "99.99% uptime".',
      expected: 'PASS',
    },
  ];
  rows.forEach(check);
});

describe('bad copy is flagged', () => {
  const rows: Row[] = [
    { name: 'banned phrase', text: 'Enjoy guaranteed returns today.', expected: 'FLAG', ids: ['no-guaranteed-returns'] },
    { name: 'banned phrase, upper case', text: 'Enjoy GUARANTEED RETURNS today.', expected: 'FLAG', ids: ['no-guaranteed-returns'] },
    {
      name: 'retracted claim',
      text: 'We deliver 99.99% uptime.',
      expected: 'FLAG',
      ids: ['retracted-uptime'],
    },
    {
      name: 'full-width spelling',
      text: 'Enjoy \uff47\uff55\uff41\uff52\uff41\uff4e\uff54\uff45\uff45\uff44 \uff52\uff45\uff54\uff55\uff52\uff4e\uff53 today.',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'Cyrillic look-alike spelling',
      text: 'Enjoy gu\u0430ranteed returns today.',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'Greek look-alike spelling',
      text: 'Enjoy guarantee\u03b4 returns today.'.replace('\u03b4', 'd').replace('guaranteed', 'gu\u03b1ranteed'),
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'phrase split across a line break',
      text: 'Enjoy guaranteed\nreturns today.',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'phrase split across a CRLF break',
      text: 'Enjoy guaranteed\r\nreturns today.',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'zero-width space inside the phrase',
      text: 'Enjoy guaran\u200bteed returns today.',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'non-breaking hyphen spelling',
      text: 'It is risk\u2011free.',
      expected: 'FLAG',
      ids: ['no-risk-free'],
    },
    {
      name: 'NFD text against an NFC rule',
      text: 'Ofrecemos garanti\u0301a total.',
      expected: 'FLAG',
      ids: ['no-garantia'],
    },
    {
      name: 'strength word with no check reference',
      text: 'Every price is verified.',
      expected: 'FLAG',
      ids: ['strength-verified'],
    },
    {
      name: 'strength word, reference too far away',
      text: `Every price is verified. ${'Filler words go here. '.repeat(20)}See /methodology.`,
      expected: 'FLAG',
      ids: ['strength-verified'],
    },
    {
      name: 'strength words: proof, atomic, accuracy',
      text: 'Here is proof. It is atomic. Accuracy matters.',
      expected: 'FLAG',
      ids: ['strength-proof', 'strength-atomic', 'strength-accuracy'],
    },
    {
      name: 'missing required disclaimer',
      text: 'Our model estimates cost.',
      own: true,
      options: { required: [{ id: 'disclaimer', phrase: 'Estimates are not guarantees' }] },
      expected: 'FLAG',
    },
    // Guards: the cue is present and the copy is still bad.
    {
      name: 'guard: negation in an earlier clause',
      text: 'We do not hedge, guaranteed returns await.',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'guard: negation before "and"',
      text: 'We offer no fees and guaranteed returns.',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'guard: quoted scare-quote inside a sentence',
      text: 'Join our "guaranteed returns" plan.',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'guard: whole sentence in quotes (a testimonial still makes the claim)',
      text: 'One customer said "we got guaranteed returns".',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'guard: quoted after a verb the gate does not know is still flagged (conservative)',
      text: 'Correction: we removed "99.99% uptime" from this page.',
      expected: 'FLAG',
      ids: ['retracted-uptime'],
    },
    {
      name: 'guard: a slogan after a label is not a glossary entry',
      text: 'Plan: "guaranteed returns".',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'guard: a quoted pair after a quoted item and "and", with no word-about-words on the line',
      text: 'He said "ok" and "guaranteed returns".',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'guard: unbalanced quote',
      text: 'Words we avoid: "guaranteed returns, risk-free.',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'guard: single quotes are not used (apostrophes)',
      text: "Words we avoid: 'guaranteed returns'.",
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'guard: negation does not reach a long way back',
      text: `We do not ${'x'.repeat(60)} guaranteed returns today.`,
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'guard: exemptQuoted: false keeps a quoted phrase flagged',
      text: 'Words we avoid: "guaranteed returns".',
      rules: [
        { id: 'r', kind: 'banned', pattern: 'guaranteed returns', reason: 'x', exemptQuoted: false },
      ],
      options: { required: [] },
      expected: 'FLAG',
      ids: ['r'],
    },
    {
      name: 'guard: exemptNegated: false keeps a negated phrase flagged',
      text: 'We do not offer guaranteed returns.',
      rules: [
        { id: 'r', kind: 'banned', pattern: 'guaranteed returns', reason: 'x', exemptNegated: false },
      ],
      options: { required: [] },
      expected: 'FLAG',
      ids: ['r'],
    },
    {
      name: 'strict negation: negationWindow 0 flags the negated phrase',
      text: 'We do not offer guaranteed returns.',
      options: { negationWindow: 0 },
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
    {
      name: 'long-reach negation is off by default (list)',
      text: 'We do not warrant that the service will be uninterrupted, error-free, or guaranteed returns.',
      expected: 'FLAG',
      ids: ['no-guaranteed-returns'],
    },
  ];
  rows.forEach(check);
});

describe('documented limits (pinned so a change is deliberate)', () => {
  // These pass although they should not. Each is listed in the README limits.
  const rows: Row[] = [
    { name: 'a negation that does not govern the phrase', text: "Don't miss our guaranteed returns.", expected: 'PASS' },
    { name: 'a word hyphenated at a line break is not rejoined', text: 'It is risk-\nfree.', expected: 'PASS' },
    { name: 'a zero-width space between words glues them', text: 'Enjoy guaranteed\u200breturns.', expected: 'PASS' },
    { name: 'letters spaced out', text: 'Enjoy g u a r a n t e e d returns.', expected: 'PASS' },
    { name: 'an HTML entity is not decoded', text: 'Enjoy guaranteed&nbsp;returns.', expected: 'PASS' },
    { name: 'English negation only: Spanish "nunca" is not a cue (this one is a false offense)', text: 'Nunca ofrecemos garant\u00eda total.', expected: 'FLAG' },
  ];
  rows.forEach(check);
});

describe('Unicode rows from review (composition across clusters, final sigma)', () => {
  const rule: CopyRule = { id: 'g', kind: 'banned', pattern: 'guaranteed returns', reason: 'x' };
  const where = (text: string, rules: readonly CopyRule[] = [rule]) =>
    scanCopy([{ id: 's', text }], rules).offenses.map((o) => [o.line, o.column, o.match]);

  it('keeps line and column when NFKC composes a half-width kana with its voiced mark', () => {
    expect(where('Header \uff76\uff9e\nEnjoy guaranteed returns.')).toEqual([[2, 7, 'guaranteed returns']]);
    expect(where('\uff76\uff9e guaranteed returns')).toEqual([[1, 4, 'guaranteed returns']]);
    expect(where('\uff8a\uff9f \uff76\uff9e guaranteed returns')).toEqual([[1, 7, 'guaranteed returns']]);
  });
  it('maps a match inside a composed span to that span, not to the source', () => {
    const kana: CopyRule = { id: 'k', kind: 'banned', pattern: '\u30ac', reason: 'x' };
    expect(where('x \uff76\uff9e y', [kana])).toEqual([[1, 3, '\uff76\uff9e']]);
  });
  it('finds a lower-case final sigma pattern in upper-case text, with or without a dotted capital I', () => {
    const sigma: CopyRule = { id: 's', kind: 'banned', pattern: '\u03bf\u03c2', reason: 'x' };
    expect(where('\u039f\u03a3', [sigma])).toEqual([[1, 1, '\u039f\u03a3']]);
    expect(where('\u039f\u03a3 \u0130', [sigma])).toEqual([[1, 1, '\u039f\u03a3']]);
    expect(where('\u0130 \u039f\u03a3 x', [sigma])).toEqual([[1, 3, '\u039f\u03a3']]);
    const plain: CopyRule = { id: 'p', kind: 'banned', pattern: '\u03bf\u03c3', reason: 'x' };
    expect(where('\u039f\u03c2 \u0130', [plain])).toEqual([[1, 1, '\u039f\u03c2']]);
  });
});


describe('Unicode rows from review (conjoining Hangul jamo)', () => {
  const ga: CopyRule = { id: 'ga', kind: 'banned', pattern: '\uac00', reason: 'x' };
  // A RegExp: a string pattern needs a word boundary on its left, and Hangul syllables are letters.
  const na: CopyRule = { id: 'na', kind: 'banned', pattern: /\ub098/, reason: 'x' };
  const gak: CopyRule = { id: 'gak', kind: 'banned', pattern: '\uac01', reason: 'x' };
  const where = (text: string, rule: CopyRule) =>
    scanCopy([{ id: 's', text }], [rule]).offenses.map((o) => [o.line, o.column, o.match]);

  it('starts an NFD syllable at its own line and column after a line break', () => {
    expect(where('Header\n\u1100\u1161', ga)).toEqual([[2, 1, '\u1100\u1161']]);
    expect(where('Header \u1100\u1161', ga)).toEqual([[1, 8, '\u1100\u1161']]);
  });
  it('gives consecutive NFD syllables their own spans', () => {
    expect(where('x \u1100\u1161\u1102\u1161', na)).toEqual([[1, 5, '\u1102\u1161']]);
    expect(where('x \u1100\u1161\u1102\u1161', ga)).toEqual([[1, 3, '\u1100\u1161']]);
  });
  it('composes a trailing jamo with the syllable before it, and only then', () => {
    expect(where('\uac00\u11a8', gak)).toEqual([[1, 1, '\uac00\u11a8']]);
    expect(where('\u1100\u1161\u11a8 x', gak)).toEqual([[1, 1, '\u1100\u1161\u11a8']]);
    expect(where('\uac00\u1102\u1161', na)).toEqual([[1, 2, '\u1102\u1161']]);
    expect(where('\uac00\u1102\u1161', ga)).toEqual([[1, 1, '\uac00']]);
  });
});

describe('results carry what a report needs', () => {
  it('reports position, original match text, reason and replacement', () => {
    const result = scanCopy(
      [{ id: 'home', text: 'Line one.\nWe deliver 99.99% uptime.' + DISCLAIMER }],
      RULES,
      OPTIONS,
    );
    expect(result.offenses).toEqual([
      {
        sourceId: 'home',
        ruleId: 'retracted-uptime',
        kind: 'retracted',
        line: 2,
        column: 12,
        match: '99.99% uptime',
        reason: 'Retracted on 2026-09-30: measured uptime was lower.',
        replacement: '99.9% uptime target',
      },
    ]);
    expect(result.missing).toEqual([]);
  });

  it('reports the sources that miss a required statement', () => {
    const result = scanCopy(
      [
        { id: 'a', text: 'Fine. Estimates are not guarantees.' },
        { id: 'b', text: 'Fine.' },
        { id: 'c', text: '' },
      ],
      [],
      { required: [{ id: 'disclaimer', phrase: 'Estimates are not guarantees' }] },
    );
    expect(result.offenses).toEqual([]);
    expect(result.missing).toEqual([
      { id: 'disclaimer', phrase: 'Estimates are not guarantees', sourceIds: ['b', 'c'] },
    ]);
  });
});
