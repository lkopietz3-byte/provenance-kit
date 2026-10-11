// Rows from the field trial on real marketing, pricing and docs copy (paraphrased
// into fresh synthetic sentences): the shipped strength starter list, whole-word
// patterns, baselines and the compliance-claim-needs-an-evidence-link ledger.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRENGTH_RULES,
  OPTIONAL_STRENGTH_RULES,
  copyBaselineKey,
  plantedViolationsFail,
  scanCopy,
  type CopyRule,
} from '../src/index.js';

const ids = (text: string, rules: readonly CopyRule[], options = {}) =>
  scanCopy([{ id: 's', text }], rules, options).offenses.map((o) => o.ruleId);

describe('the starter strength list keeps only words that earned it', () => {
  it('has the measured set and nothing else', () => {
    expect(DEFAULT_STRENGTH_RULES.map((r) => r.id)).toEqual([
      'strength-accurate',
      'strength-audited',
      'strength-certified',
      'strength-proven',
    ]);
    expect(OPTIONAL_STRENGTH_RULES.map((r) => r.id)).toEqual(['strength-verified', 'strength-accuracy']);
  });
  it.each([
    ['an ordinary adverb', 'You see exactly what changed.'],
    ['a different word that starts with a listed word', 'Each figure carries its provenance.'],
    ['a compound', 'It future-proofed their stack for AI.'],
    ['social proof and proof of concept', 'Social proof helps. We built a proof of concept.'],
    ['a technical sense', 'Runs are deterministic. Writes are atomic. Tokens are validated on the server.'],
    ['an adverb of a listed word', 'Records must be accurately preserved.'],
    ['a verb sense', 'The approach has proven useful in practice.'],
    ['a UI status', 'Team email verified!'],
  ])('stays quiet on %s', (_name, text) => {
    expect(ids(text, [...DEFAULT_STRENGTH_RULES])).toEqual([]);
  });
  it.each([
    ['a vendor certification claim', 'Both are SOC 2 certified and ready.', 'strength-certified'],
    ['an accuracy claim', 'The tool is highly accurate.', 'strength-accurate'],
    ['a proven-method claim', 'Sentry is the proven choice.', 'strength-proven'],
    ['an audit claim', 'The stack runs on audited infrastructure.', 'strength-audited'],
  ])('still flags %s', (_name, text, id) => {
    expect(ids(text, [...DEFAULT_STRENGTH_RULES])).toEqual([id]);
  });
  it('a check reference next to the word clears it', () => {
    expect(ids('Both are SOC 2 certified (see /trust).', [...DEFAULT_STRENGTH_RULES], { checkReference: '/trust' })).toEqual([]);
  });
  it('the optional words are flagged only when asked for', () => {
    expect(ids('Prices are verified. High accuracy.', [...DEFAULT_STRENGTH_RULES])).toEqual([]);
    expect(ids('Prices are verified. High accuracy.', [...OPTIONAL_STRENGTH_RULES])).toEqual([
      'strength-verified',
      'strength-accuracy',
    ]);
  });
  it('every starter and optional rule catches its own planted sample', () => {
    expect(plantedViolationsFail([...DEFAULT_STRENGTH_RULES, ...OPTIONAL_STRENGTH_RULES]).ok).toBe(true);
  });
});

describe('proven: verb uses pass, adjective uses after have/has are claims', () => {
  const flagged = (text: string) => ids(text, [...DEFAULT_STRENGTH_RULES]);
  it.each([
    'The approach has proven useful in practice.',
    'It has also proven to be easy to adopt.',
    'Experience has proven that the plan works.',
    'The team have proven themselves.',
    'The tool had proven invaluable.',
    'It has proven helpful.',
    "We've proven that it works.",
  ])('stays quiet on a verb use: %s', (text) => {
    expect(flagged(text)).toEqual([]);
  });
  it.each([
    'We have proven results.',
    'Our platform has proven security.',
    'The vendor has proven reliability.',
    'We have a proven record.',
    'It is the proven choice.',
    'Proven results, every time.',
    'The firm has long proven expertise.',
  ])('still flags an adjective use: %s', (text) => {
    expect(flagged(text)).toEqual(['strength-proven']);
  });
});

describe('baseline keys cannot collide', () => {
  const rule = (id: string): CopyRule => ({ id, kind: 'banned', pattern: 'guarantee', reason: 'x' });
  it('keeps a source id and a rule id that contain the separator apart', () => {
    const a = scanCopy([{ id: 'a | b', text: 'We guarantee it.' }], [rule('c')]).offenses.map(copyBaselineKey);
    const b = scanCopy([{ id: 'a', text: 'We guarantee it.' }], [rule('b | c')]).offenses.map(copyBaselineKey);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).not.toBe(b[0]);
    const hidden = scanCopy([{ id: 'a', text: 'We guarantee it.' }], [rule('b | c')], { baseline: a });
    expect(hidden.offenses).toHaveLength(1);
    expect(hidden.staleBaseline).toEqual(a);
  });
  it('has a documented, stable shape: a JSON array of source id, rule id and line text', () => {
    const [o] = scanCopy([{ id: 'docs/a.md', text: 'We guarantee "it".' }], [rule('g')]).offenses;
    expect(o && copyBaselineKey(o)).toBe('["docs/a.md","g","We guarantee \\"it\\"."]');
    expect(JSON.parse(o ? copyBaselineKey(o) : '[]')).toEqual(['docs/a.md', 'g', 'We guarantee "it".']);
  });
});

describe('wholeWord', () => {
  const proven: CopyRule = { id: 'p', kind: 'banned', pattern: 'proven', reason: 'x', wholeWord: true };
  const issue: CopyRule = { id: 'n', kind: 'banned', pattern: '#1', reason: 'x', wholeWord: true };
  it('checks the end of a string pattern', () => {
    expect(ids('Each figure carries its provenance.', [proven])).toEqual([]);
    expect(ids('A proven method.', [proven])).toEqual(['p']);
    expect(ids('Proven.', [proven])).toEqual(['p']);
  });
  it('keeps issue and PR numbers out of a rank pattern', () => {
    expect(ids('Fixes issue #123 and PR #10.', [issue])).toEqual([]);
    expect(ids('We are #1 in speed.', [issue])).toEqual(['n']);
    expect(ids('Ranked #1.', [issue])).toEqual(['n']);
  });
  it('is off by default, so plurals and inflections still match', () => {
    const plain: CopyRule = { ...proven, wholeWord: undefined };
    expect(ids('Each figure carries its provenance.', [plain])).toEqual(['p']);
  });
  it('rejects a non-boolean', () => {
    expect(() => scanCopy([], [{ ...proven, wholeWord: 'yes' as never }])).toThrow(TypeError);
  });
});

describe('baseline', () => {
  const rule: CopyRule = { id: 'g', kind: 'banned', pattern: 'guarantee', reason: 'x' };
  const sources = [
    { id: 'a.md', text: 'Intro.\nWe guarantee it.\nMore.' },
    { id: 'b.md', text: 'We guarantee it.\nWe guarantee it.' },
  ];
  it('carries the line text on each offense', () => {
    const [first] = scanCopy(sources, [rule]).offenses;
    expect(first?.context).toBe('We guarantee it.');
  });
  it('suppresses known offenses and reports only new ones', () => {
    const known = scanCopy(sources, [rule]).offenses.map(copyBaselineKey);
    expect(known).toEqual([
      '["a.md","g","We guarantee it."]',
      '["b.md","g","We guarantee it."]',
      '["b.md","g","We guarantee it."]',
    ]);
    const clean = scanCopy(sources, [rule], { baseline: known });
    expect(clean.offenses).toEqual([]);
    expect(clean.suppressed).toBe(3);
    expect(clean.staleBaseline).toEqual([]);
    const grown = scanCopy([...sources, { id: 'c.md', text: 'We guarantee it.' }], [rule], { baseline: known });
    expect(grown.offenses.map((o) => o.sourceId)).toEqual(['c.md']);
  });
  it('survives a line moving, and counts each entry once', () => {
    const known = scanCopy(sources, [rule]).offenses.map(copyBaselineKey);
    const moved = [{ id: 'a.md', text: 'New line.\nIntro.\nWe guarantee it.' }, sources[1] as (typeof sources)[number]];
    expect(scanCopy(moved, [rule], { baseline: known }).offenses).toEqual([]);
    const twice = [{ id: 'a.md', text: 'We guarantee it.\nWe guarantee it.' }];
    expect(scanCopy(twice, [rule], { baseline: ['["a.md","g","We guarantee it."]'] }).offenses).toHaveLength(1);
  });
  it('lists entries that no longer match, so a fixed page can be pruned', () => {
    const r = scanCopy([{ id: 'a.md', text: 'Fine.' }], [rule], { baseline: ['["a.md","g","We guarantee it."]'] });
    expect(r.offenses).toEqual([]);
    expect(r.staleBaseline).toEqual(['["a.md","g","We guarantee it."]']);
  });
  it('reads whitespace the same way as the text', () => {
    const r = scanCopy([{ id: 'a.md', text: '  We   guarantee\tit.  ' }], [rule], { baseline: ['["a.md","g","We guarantee it."]'] });
    expect(r.offenses).toEqual([]);
  });
  it('does not suppress a different rule on the same line', () => {
    const other: CopyRule = { id: 'o', kind: 'banned', pattern: 'it', reason: 'x' };
    const r = scanCopy([{ id: 'a.md', text: 'We guarantee it.' }], [rule, other], { baseline: ['["a.md","g","We guarantee it."]'] });
    expect(r.offenses.map((o) => o.ruleId)).toEqual(['o']);
  });
  it('validates the baseline', () => {
    expect(() => scanCopy([], [], { baseline: 'x' as never })).toThrow(TypeError);
    expect(() => scanCopy([], [], { baseline: [1] as never })).toThrow(TypeError);
  });
  it('windows a very long line around the match', () => {
    const text = `${'x '.repeat(500)}We guarantee it.${' y'.repeat(500)}`;
    const [o] = scanCopy([{ id: 'a', text }], [rule]).offenses;
    expect(o?.context.length).toBeLessThanOrEqual(260);
    expect(o?.context).toContain('We guarantee it.');
  });
});

describe('rule key errors say which keys exist', () => {
  it('names the key and the known keys of a rule', () => {
    const bad = { id: 'r', kind: 'banned', pattern: 'x', reason: 'x', severity: 'high' } as never;
    expect(() => scanCopy([], [bad])).toThrow(/rules\[0\].*unknown key "severity".*known keys.*exemptNegated/s);
  });
});
