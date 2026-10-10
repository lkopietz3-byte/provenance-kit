// Behavior tests for the copy gate: positions, folding, quoted use, strength
// words, required statements, regex safety, hostile input, scaling, the planted
// self-test, and agreement with validateClaims on the shared negation rules.

import { describe, expect, it } from 'vitest';
import {
  CopyGateError,
  DEFAULT_CERTAINTY_PHRASES,
  DEFAULT_STRENGTH_RULES,
  assertCopyClean,
  plantedViolationsFail,
  scanCopy,
  validateClaims,
  type CopyRule,
} from '../src/index.js';
import { foldWithMap } from '../src/copy-gate.js';
import { foldText, matchView } from '../src/validate.js';

// The package has no @types/node; declare only the Node API this file uses.
declare const process: {
  cpuUsage(previous?: { user: number; system: number }): { user: number; system: number };
};
const NODE_VM = 'node:vm';

const BANNED: CopyRule = { id: 'g', kind: 'banned', pattern: 'guaranteed returns', reason: 'no guarantee' };
const scanOne = (text: string, rules: readonly CopyRule[] = [BANNED], options = {}) =>
  scanCopy([{ id: 's', text }], rules, options);

describe('positions', () => {
  const at = (text: string) => scanOne(text).offenses.map((o) => [o.line, o.column, o.match]);

  it('is 1-based on both axes', () => {
    expect(at('guaranteed returns')).toEqual([[1, 1, 'guaranteed returns']]);
  });
  it('counts lines at LF, CRLF and CR', () => {
    expect(at('a\nb guaranteed returns')).toEqual([[2, 3, 'guaranteed returns']]);
    expect(at('a\r\nb guaranteed returns')).toEqual([[2, 3, 'guaranteed returns']]);
    expect(at('a\rb guaranteed returns')).toEqual([[2, 3, 'guaranteed returns']]);
    expect(at('\r\n\r\nguaranteed returns')).toEqual([[3, 1, 'guaranteed returns']]);
  });
  it('counts columns in code points: an astral character is one', () => {
    expect(at('\u{1F600}\u{1F600} guaranteed returns')).toEqual([[1, 4, 'guaranteed returns']]);
    expect(at('x\n\u{1F600} guaranteed returns')).toEqual([[2, 3, 'guaranteed returns']]);
  });
  it('counts a lone surrogate as one', () => {
    expect(at('\ud800 guaranteed returns')).toEqual([[1, 3, 'guaranteed returns']]);
    expect(at('\udc00\ud800 guaranteed returns')).toEqual([[1, 4, 'guaranteed returns']]);
  });
  it('counts a combining mark and a BOM as code points', () => {
    expect(at('e\u0301 guaranteed returns')).toEqual([[1, 4, 'guaranteed returns']]);
    expect(at('\ufeffguaranteed returns')).toEqual([[1, 2, 'guaranteed returns']]);
  });
  it('positions a match found through folding in the ORIGINAL text', () => {
    expect(at('\ufb01 x\u00a0guaranteed\u00a0returns')).toEqual([[1, 5, 'guaranteed\u00a0returns']]);
    expect(at('\u200b\u200bguar\u200banteed returns')).toEqual([[1, 3, 'guar\u200banteed returns']]);
    expect(at('\uff47\uff55\uff41\uff52\uff41\uff4e\uff54\uff45\uff45\uff44 returns')).toEqual([
      [1, 1, '\uff47\uff55\uff41\uff52\uff41\uff4e\uff54\uff45\uff45\uff44 returns'],
    ]);
  });
  it('keeps the line of the START when a phrase is split across lines', () => {
    expect(at('hi\nguaranteed\n\n  returns')).toEqual([[2, 1, 'guaranteed\n\n  returns']]);
  });
  it('reports several matches in order, with a rule order tie-break', () => {
    const rules: CopyRule[] = [
      { id: 'b', kind: 'banned', pattern: 'returns', reason: 'r' },
      BANNED,
    ];
    const ids = scanOne('guaranteed returns, guaranteed returns', rules).offenses.map((o) => [o.ruleId, o.column]);
    expect(ids).toEqual([['g', 1], ['b', 12], ['g', 21], ['b', 32]]);
  });
  it('handles an empty text and a text of one character', () => {
    expect(scanOne('').offenses).toEqual([]);
    expect(scanOne('x').offenses).toEqual([]);
  });
});

describe('fold map agrees with validateClaims folding', () => {
  const samples = [
    'Plain text.',
    'Fact-checked, fact\u2013checked, FACT\u2011CHECKED',
    '\ufb01 \u00a0 \u200b\u2066x\u2069 gu\u0430ranteed',
    'e\u0301\u0301 a\u0308 \u1112\u1161\u11ab',
    'a\r\nb\u2028c\u0085d\te',
    '99.9% U.S. Dr. Smith, 1,000 e.g. etc. Inc. Next',
    "It\u2019s \u2018quoted\u2019 \u02bc \u2032",
    '\ud800 lone \udc00 \u{1F600}',
    '',
  ];
  it.each(samples)('same folded text as foldText: %j', (text) => {
    const mine = foldWithMap(text);
    expect(mine.cased.toLowerCase()).toBe(foldText(text, false));
    expect(matchView(mine.cased)).toBe(matchView(foldText(text, true)));
    expect(mine.start.length).toBe(mine.cased.length);
    expect(mine.end.length).toBe(mine.cased.length);
    for (let i = 0; i < mine.start.length; i++) {
      expect(mine.start[i]).toBeLessThanOrEqual(mine.end[i] as number);
      expect(mine.end[i]).toBeLessThanOrEqual(text.length);
      if (i > 0) expect(mine.start[i]).toBeGreaterThanOrEqual(mine.start[i - 1] as number);
    }
  });

  it('agrees on seeded random text built from tricky pieces', () => {
    const pieces = [
      'a', 'B', ' ', '  ', '\n', '\r\n', '-', '\u2011', '\u2013', ',', '.', '9', '\u00a0', '\u200b', '\u0301',
      '\ufb01', '\uff47', '\u0430', '\u03bf', '\u{1f600}', '\ud800', '\u1100', '\u1161', '\u11a8', '\uff76', '\uff9e', '\uff8a', '\uff9f', '\u0b47', '\u0b3e', '\u03a3', '\u0130', "'", '\u2019',
      'U.S.', 'e.g.', 'not ', 'guaranteed', 'verified ',
    ];
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let n = 0; n < 400; n++) {
      let text = '';
      for (let k = 0; k < 1 + (next() % 24); k++) text += pieces[next() % pieces.length];
      const mine = foldWithMap(text);
      expect(mine.cased.toLowerCase()).toBe(foldText(text, false));
      expect(mine.start.length).toBe(mine.cased.length);
    }
  });
});

describe('agrees with validateClaims on phrases and negation', () => {
  // Same phrases, same window, long reaches on, quoted exemption off: the gate
  // and the claim validator must flag the same phrases.
  const rules: CopyRule[] = DEFAULT_CERTAINTY_PHRASES.map((r) => ({
    id: r.phrase,
    kind: 'banned' as const,
    pattern: r.phrase,
    reason: r.reason ?? 'x',
    exemptQuoted: false,
  }));
  const cues = ['', 'not ', 'We do not use ', 'never ', 'No one can ', 'Zero ', 'without ', 'Our ', 'It is not a guess but ', 'no fees and '];
  const fillers = ['', 'the ', 'any ', 'a ', 'our '];
  const phrases = ['independently verified', 'guaranteed', 'guarantee', 'proprietary dataset', 'fact-checked', '(verified)', '100% accurate'];
  const tails = ['.', ' data.', ', ok.', ' and more.'];
  const texts: string[] = [];
  for (const cue of cues) for (const f of fillers) for (const p of phrases) for (const t of tails) texts.push(`${cue}${f}${p}${t}`);
  texts.push(
    'We make no representations, warranties or guarantees of any kind.',
    'We do not warrant that the service will be uninterrupted, error-free, or guaranteed.',
    "Don't miss our independently verified rates.",
    'These projections have not been reviewed by any outside firm or independently verified.',
    'Results are Gu\u0430ranteed. Not guaranteed. Non-guaranteed.',
  );

  it('flags the same phrases on every generated text', () => {
    for (const text of texts) {
      const expected = validateClaims([{ id: 'c', text, tier: 'modeled' }]).map((o) => o.phrase).sort();
      const mine = scanOne(text, rules, { extendedNegation: true }).offenses.map((o) => o.ruleId).sort();
      expect(mine, text).toEqual(expected);
    }
  });

  it('is never more lenient than validateClaims with the default (short) reach', () => {
    for (const text of texts) {
      const claim = validateClaims([{ id: 'c', text, tier: 'modeled' }]).length;
      expect(scanOne(text, rules).offenses.length, text).toBeGreaterThanOrEqual(claim);
    }
  });
});

describe('negation', () => {
  it('uses the kit negation rules (English cues, same clause)', () => {
    expect(scanOne('We do not offer guaranteed returns.').offenses).toEqual([]);
    expect(scanOne('We do not hedge, guaranteed returns await.').offenses).toHaveLength(1);
    expect(scanOne('Non-guaranteed returns vary.', [{ ...BANNED, pattern: 'guaranteed' }]).offenses).toEqual([]);
  });
  it('negationWindow 0 turns the exemption off, and checks every case in the table the same way', () => {
    expect(scanOne('We do not offer guaranteed returns.', [BANNED], { negationWindow: 0 }).offenses).toHaveLength(1);
    expect(scanOne('Non-guaranteed returns vary.', [{ ...BANNED, pattern: 'guaranteed' }], { negationWindow: 0 }).offenses).toHaveLength(1);
  });
  it('keeps the longer reaches off unless asked', () => {
    const text = 'We do not warrant that the service will be uninterrupted, error-free, or guaranteed returns.';
    expect(scanOne(text).offenses).toHaveLength(1);
    expect(scanOne(text, [BANNED], { extendedNegation: true }).offenses).toEqual([]);
  });
  it('does not call Spanish negation a negation', () => {
    const rule: CopyRule = { id: 'es', kind: 'banned', pattern: 'rendimientos garantizados', reason: 'x' };
    expect(scanOne('Nunca ofrecemos rendimientos garantizados.', [rule]).offenses).toHaveLength(1);
  });
});

describe('quoted use', () => {
  const run = (text: string) => scanOne(text).offenses.length;
  it('exempts the phrase alone in a pair of quotation marks that reads as a mention', () => {
    expect(run('Banned: "guaranteed returns".')).toBe(0);
    expect(run('"guaranteed returns" is banned.')).toBe(0);
    expect(run('Words we avoid: "a", "guaranteed returns", "b".')).toBe(0);
    expect(run('| "guaranteed returns" | retired |')).toBe(0);
    expect(run('Banned terms: \u201cx\u201d and \u201cguaranteed returns\u201d.')).toBe(0);
    expect(run('The phrase \u00abguaranteed returns\u00bb is retired.')).toBe(0);
    expect(run('The phrase \u201eguaranteed returns\u201c is retired.')).toBe(0);
    expect(run('The word "guaranteed returns" is retired.')).toBe(0);
    expect(run('The phrase "Guaranteed Returns" is retired.')).toBe(0);
  });
  it('exempts a shorter rule inside a longer quoted entry, and a list with parentheses', () => {
    const rules: CopyRule[] = [BANNED, { id: 'gu', kind: 'banned', pattern: 'guarantee', reason: 'x' }];
    const text = 'Our glossary of avoided words: "guarantee", "risk-free", and "guaranteed returns".';
    expect(scanOne(text, rules).offenses).toEqual([]);
    expect(scanOne('Terms we retired: "guarantee" (too strong) and "guaranteed returns".', rules).offenses).toEqual([]);
    expect(scanOne('Said: "guarantee returns are great".', rules).offenses).toHaveLength(1);
  });
  it('still reports a phrase that is used, with quotation marks around it or near it', () => {
    expect(run('Join our "guaranteed returns" plan.')).toBe(1);
    expect(run('We offer "guaranteed returns" today.')).toBe(1);
    expect(run('Our "guaranteed returns".')).toBe(1);
    expect(run('Said: "we got guaranteed returns".')).toBe(1);
    expect(run('Said: "guaranteed returns are great".')).toBe(1);
    expect(run('Said: "guaranteed returns today" ok.')).toBe(1);
    expect(run('"x guaranteed returns".')).toBe(1);
    expect(run('Said: "unbalanced guaranteed returns.')).toBe(1);
    expect(run('Said: guaranteed returns".')).toBe(1);
    expect(run("Said: 'guaranteed returns'.")).toBe(1);
    expect(run('Said: `guaranteed returns`.')).toBe(1);
    expect(run('Said: \u201cguaranteed returns\u201d plan.')).toBe(1);
  });
  it('needs a word on the same line that says the line is about words', () => {
    expect(run('Plan: "guaranteed returns".')).toBe(1);
    expect(run('"guaranteed returns"')).toBe(1);
    expect(run('Banned words\n"guaranteed returns"')).toBe(1);
    expect(run('Banned words\nBanned: "guaranteed returns"')).toBe(0);
    expect(run('"guaranteed returns" | the label we dropped')).toBe(0);
  });
  it('does not pair across lines', () => {
    expect(run('Banned: "x\nguaranteed returns"\n')).toBe(1);
    expect(run('a "\nBanned: "guaranteed returns".')).toBe(0);
  });
  it('pairs straight quotes by parity inside one line', () => {
    expect(run('Banned: "a" "guaranteed returns".')).toBe(1); // balanced, but no comma or conjunction joins the items
    expect(run('Banned: "a" "guaranteed returns.')).toBe(1); // odd count: the last quote opens, nothing closes it
    expect(run('Banned: "a", "guaranteed returns", "b".')).toBe(0);
    expect(run('he said "ok" and "guaranteed returns".')).toBe(1);
    expect(run('Banned: "a" and "guaranteed returns"')).toBe(0);
  });
  it('can be switched off per rule', () => {
    expect(scanOne('Banned: "guaranteed returns".', [{ ...BANNED, exemptQuoted: false }]).offenses).toHaveLength(1);
  });
  it('applies to regex matches as well', () => {
    const rule: CopyRule = { id: 'r', kind: 'banned', pattern: /guaranteed\s+returns/i, reason: 'x' };
    expect(scanOne('Banned: "guaranteed returns".', [rule]).offenses).toEqual([]);
    expect(scanOne('Our "guaranteed returns" plan.', [rule]).offenses).toHaveLength(1);
  });
});

describe('strength words', () => {
  const opts = { checkReference: ['/methodology', /\[\[check:[a-z0-9-]+\]\]/i] };
  const strength = (text: string, options = opts) => scanOne(text, DEFAULT_STRENGTH_RULES, options).offenses.map((o) => o.ruleId);

  it('is an offense of kind strength with nothing nearby', () => {
    const [offense] = scanOne('It is verified.', DEFAULT_STRENGTH_RULES, opts).offenses;
    expect(offense?.kind).toBe('strength');
    expect(offense?.ruleId).toBe('strength-verified');
    expect(offense?.replacement).toBeNull();
  });
  it('is an offense whenever no checkReference is configured', () => {
    expect(scanOne('It is verified [[check:x]].', DEFAULT_STRENGTH_RULES).offenses).toHaveLength(1);
    expect(strength('It is verified /methodology', { checkReference: [] })).toEqual(['strength-verified']);
  });
  it('passes with a reference on either side, inside the window', () => {
    expect(strength('It is verified /methodology')).toEqual([]);
    expect(strength('See /methodology: it is verified')).toEqual([]);
    expect(strength('Atomic [[check:txn-1]]')).toEqual([]);
    expect(strength('It is verified ([how](/methodology))')).toEqual([]);
  });
  it('honors checkWindow exactly', () => {
    const text = `verified ${'x'.repeat(10)} /methodology`;
    // gap between the end of "verified" and the start of the reference: 12 characters
    expect(strength(text, { ...opts, checkWindow: 12 } as never)).toEqual([]);
    expect(strength(text, { ...opts, checkWindow: 11 } as never)).toEqual(['strength-verified']);
    expect(strength(text, { ...opts, checkWindow: 0 } as never)).toEqual(['strength-verified']);
    expect(strength(text, { ...opts, checkWindow: Infinity } as never)).toEqual([]);
  });
  it('checks each match on its own', () => {
    expect(strength(`A is verified. ${'.'.repeat(300)} B is verified /methodology`)).toEqual(['strength-verified']);
  });
  it('accepts a single string or a single regex as checkReference', () => {
    expect(scanOne('It is verified /m', DEFAULT_STRENGTH_RULES, { checkReference: '/m' }).offenses).toEqual([]);
    expect(scanOne('It is verified #7', DEFAULT_STRENGTH_RULES, { checkReference: /#\d+/ }).offenses).toEqual([]);
  });
  it('does not match inside other words, and skips a negated use', () => {
    expect(strength('An unverified rumor. Not verified. Approve it.')).toEqual([]);
    expect(strength('Improve it.')).toEqual([]);
  });
  it('flags every default strength word', () => {
    for (const rule of DEFAULT_STRENGTH_RULES) {
      expect(strength(`Our work is ${rule.pattern as string}.`), rule.id).toEqual([rule.id]);
    }
  });
  it('extends by spreading the default list', () => {
    const custom: CopyRule = { id: 'strength-tested', kind: 'strength', pattern: 'tested', reason: 'x' };
    expect(scanOne('Fully tested.', [...DEFAULT_STRENGTH_RULES, custom], opts).offenses.map((o) => o.ruleId)).toEqual(['strength-tested']);
  });
  it('freezes the default list and each entry', () => {
    expect(Object.isFrozen(DEFAULT_STRENGTH_RULES)).toBe(true);
    expect(DEFAULT_STRENGTH_RULES.every((r) => Object.isFrozen(r))).toBe(true);
    expect(() => (DEFAULT_STRENGTH_RULES as CopyRule[]).push(BANNED)).toThrow();
  });
});

describe('required statements', () => {
  const required = [{ id: 'd', phrase: 'Estimates are not guarantees' }];
  it('reports each source that lacks the statement, in source order', () => {
    const r = scanCopy([{ id: 'a', text: 'x' }, { id: 'b', text: 'ESTIMATES   ARE\nNOT guarantees.' }, { id: 'c', text: '' }], [], { required });
    expect(r.missing).toEqual([{ id: 'd', phrase: 'Estimates are not guarantees', sourceIds: ['a', 'c'] }]);
  });
  it('can be scoped to named sources; an unknown scoped id is missing', () => {
    const r = scanCopy(
      [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }],
      [],
      { required: [{ id: 'd', phrase: 'Estimates', sourceIds: ['b', 'ghost'] }] },
    );
    expect(r.missing).toEqual([{ id: 'd', phrase: 'Estimates', sourceIds: ['b', 'ghost'] }]);
  });
  it('matches on a word boundary at the start, case-insensitively unless asked', () => {
    expect(scanCopy([{ id: 'a', text: 'unestimates are not guarantees' }], [], { required }).missing).toHaveLength(1);
    expect(scanCopy([{ id: 'a', text: 'estimates are not guarantees' }], [], { required, caseSensitive: true }).missing).toHaveLength(1);
    expect(scanCopy([{ id: 'a', text: 'Estimates are not guarantees' }], [], { required, caseSensitive: true }).missing).toEqual([]);
  });
  it('sees a statement through look-alikes, zero-width characters and NFD', () => {
    const text = 'Estimates ar\u0435 n\u200bot guarant\u0435es';
    expect(scanCopy([{ id: 'a', text }], [], { required }).missing).toEqual([]);
    const accents = [{ id: 'a', phrase: 'Se\u00f1al' }];
    expect(scanCopy([{ id: 'a', text: 'sen\u0303al' }], [], { required: accents }).missing).toEqual([]);
  });
  it('reports sourcesScanned, so an empty scan is visible', () => {
    expect(scanCopy([], [BANNED], { required }).sourcesScanned).toBe(0);
    expect(scanCopy([], [BANNED], { required }).missing).toEqual([]);
    expect(scanCopy([{ id: 'a', text: '' }], [BANNED]).sourcesScanned).toBe(1);
  });
});

describe('regex patterns', () => {
  const rule = (pattern: RegExp): CopyRule => ({ id: 'r', kind: 'banned', pattern, reason: 'x' });
  const hits = (pattern: RegExp, text: string) => scanOne(text, [rule(pattern)]).offenses.map((o) => [o.column, o.match]);

  it('runs on folded text: look-alikes, line breaks, NFKC, hyphen variants', () => {
    expect(hits(/guaranteed returns/, 'gu\u0430ranteed\nreturns')).toEqual([[1, 'gu\u0430ranteed\nreturns']]);
    expect(hits(/risk-free/, 'risk\u2011free')).toEqual([[1, 'risk\u2011free']]);
    expect(hits(/zero risk/, '\uff5a\uff45\uff52\uff4f risk')).toEqual([[1, '\uff5a\uff45\uff52\uff4f risk']]);
  });
  it('reads an en dash between letters and a non-breaking hyphen as a hyphen', () => {
    expect(hits(/risk-free/, 'risk\u2013free')).toEqual([[1, 'risk\u2013free']]);
    expect(hits(/risk-free/, 'risk \u2013 free')).toEqual([]);
  });
  it('copes with a very large number of reference matches (no argument spreading)', () => {
    const text = 'ab '.repeat(300_000) + 'verified';
    const r = scanOne(text, DEFAULT_STRENGTH_RULES, { checkReference: /ab/ });
    expect(r.offenses).toEqual([]);
  });
  it('keeps case unless the regex says otherwise', () => {
    expect(hits(/Guaranteed/, 'guaranteed')).toEqual([]);
    expect(hits(/Guaranteed/i, 'guaranteed')).toEqual([[1, 'guaranteed']]);
  });
  it('leaves the caller regex untouched, whatever its flags and lastIndex', () => {
    const re = /guaranteed/gy;
    re.lastIndex = 5;
    expect(hits(re, 'guaranteed guaranteed')).toEqual([[1, 'guaranteed'], [12, 'guaranteed']]);
    expect(re.lastIndex).toBe(5);
    expect(hits(/guaranteed/, 'guaranteed')).toEqual([[1, 'guaranteed']]);
  });
  it('skips empty matches and always advances', () => {
    expect(hits(/x*/, 'abc')).toEqual([]);
    expect(hits(/(?:)/, '')).toEqual([]);
    expect(hits(/x*/g, 'axxb')).toEqual([[2, 'xx']]);
    expect(hits(/x*/u, '\u{1F600}x\u{1F600}')).toEqual([[2, 'x']]);
    expect(hits(/\b/u, 'ab \u{1F600}')).toEqual([]);
    expect(hits(new RegExp('(?=a)', 'v'), 'aaa')).toEqual([]);
    expect(hits(/$/m, 'a\nb')).toEqual([]);
  });
  it('gives anchors the whole folded text, since line breaks read as spaces', () => {
    expect(hits(/^banned/, 'x\nbanned')).toEqual([]);
    expect(hits(/^banned/, 'banned x')).toEqual([[1, 'banned']]);
  });
  it('accepts a regex from another realm and rejects imitations', async () => {
    const vm = (await import(NODE_VM)) as { runInNewContext(code: string): unknown };
    const foreign = vm.runInNewContext('/guaranteed/i') as RegExp;
    expect(hits(foreign, 'GUARANTEED')).toEqual([[1, 'GUARANTEED']]);
    const proxy = new Proxy(/x/, {});
    expect(() => scanOne('x', [{ ...BANNED, pattern: proxy }])).toThrow(TypeError);
    expect(() => scanOne('x', [{ ...BANNED, pattern: { source: 'x', flags: 'g', exec: () => null } as never }])).toThrow(TypeError);
    expect(() => scanOne('x', [{ ...BANNED, pattern: RegExp.prototype }])).toThrow(TypeError);
  });
  it('does not call any member of the caller regex or its prototype chain', () => {
    class Sneaky extends RegExp {
      override exec(): never {
        throw new Error('exec called');
      }
      override get source(): string {
        throw new Error('source called');
      }
      override get flags(): string {
        throw new Error('flags called');
      }
    }
    expect(hits(new Sneaky('guaranteed'), 'guaranteed')).toEqual([[1, 'guaranteed']]);
  });
  it('handles the v flag', () => {
    expect(hits(new RegExp('[\\p{L}--[a-c]]+', 'v'), 'abc xyz')).toEqual([[5, 'xyz']]);
  });
  it('terminates on a pattern that matches empty at every position', () => {
    const start = Date.now();
    expect(hits(/a?/g, 'b'.repeat(50_000))).toEqual([]);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('string patterns', () => {
  it('match by prefix at a word boundary, like certainty phrases', () => {
    const rule: CopyRule = { id: 'g', kind: 'banned', pattern: 'guarantee', reason: 'x' };
    expect(scanOne('guarantees; guaranteed; unguaranteed', [rule]).offenses.map((o) => o.column)).toEqual([1, 13]);
  });
  it('read hyphens and en dashes between letters as spaces', () => {
    const rule: CopyRule = { id: 'f', kind: 'banned', pattern: 'fact-checked', reason: 'x' };
    expect(scanOne('fact checked, fact\u2013checked, fact\u2010checked', [rule]).offenses).toHaveLength(3);
  });
  it('do not match when the phrase is at the start of a longer word on the left', () => {
    const rule: CopyRule = { id: 'p', kind: 'banned', pattern: 'proof', reason: 'x' };
    expect(scanOne('bulletproof, a proof', [rule]).offenses.map((o) => o.column)).toEqual([16]);
  });
  it('trim the phrase after folding, so a trailing newline from a file still matches at the end', () => {
    const rule: CopyRule = { id: 'g', kind: 'banned', pattern: 'guaranteed returns\n', reason: 'x' };
    expect(scanOne('x guaranteed returns', [rule]).offenses).toHaveLength(1);
  });
  it('are case-sensitive only on request', () => {
    expect(scanOne('GUARANTEED RETURNS', [BANNED], { caseSensitive: true }).offenses).toEqual([]);
    expect(scanOne('guaranteed returns', [BANNED], { caseSensitive: true }).offenses).toHaveLength(1);
  });
  it('fold U+0130 without changing positions', () => {
    expect(scanOne('\u0130 guaranteed returns').offenses.map((o) => o.column)).toEqual([3]);
    expect(scanOne('\u0130ndependently verified', [{ id: 'i', kind: 'banned', pattern: 'independently verified', reason: 'x' }]).offenses).toHaveLength(1);
  });
});

/** `[first, <hole>, second]`. */
function sparse<T>([first, second]: [T, T]): T[] {
  const list = new Array<T>(3);
  list[0] = first;
  list[2] = second;
  return list;
}

describe('rule and option validation', () => {
  const bad = (rules: unknown, options: unknown = {}, sources: unknown = [{ id: 's', text: 'x' }]) =>
    () => scanCopy(sources as never, rules as never, options as never);

  it('throws on malformed rules', () => {
    expect(bad('x')).toThrow(TypeError);
    expect(bad([null])).toThrow(TypeError);
    expect(bad([[]])).toThrow(TypeError);
    expect(bad([{ ...BANNED, id: '' }])).toThrow(RangeError);
    expect(bad([{ ...BANNED, id: 5 }])).toThrow(TypeError);
    expect(bad([{ ...BANNED, pattern: '' }])).toThrow(RangeError);
    expect(bad([{ ...BANNED, pattern: ' \u200b ' }])).toThrow(RangeError);
    expect(bad([{ ...BANNED, pattern: 5 }])).toThrow(TypeError);
    expect(bad([{ ...BANNED, pattern: undefined }])).toThrow(TypeError);
    expect(bad([{ ...BANNED, reason: '' }])).toThrow(RangeError);
    expect(bad([{ ...BANNED, reason: undefined }])).toThrow(TypeError);
    expect(bad([{ ...BANNED, kind: 'loud' }])).toThrow(RangeError);
    expect(bad([{ ...BANNED, kind: undefined }])).toThrow(RangeError);
    expect(bad([{ ...BANNED, replacement: 5 }])).toThrow(TypeError);
    expect(bad([{ ...BANNED, exemptNegated: 'yes' }])).toThrow(TypeError);
    expect(bad([{ ...BANNED, exemptQuoted: 1 }])).toThrow(TypeError);
    expect(bad([{ ...BANNED, sample: 1 }])).toThrow(TypeError);
    expect(bad([{ ...BANNED, exemptNegate: false }])).toThrow(TypeError); // a typo is not ignored
    expect(bad([BANNED, BANNED])).toThrow(RangeError);
    expect(bad(sparse([BANNED, BANNED]))).toThrow(TypeError);
  });
  it('throws on malformed options', () => {
    expect(bad([], null)).toThrow(TypeError);
    expect(bad([], [])).toThrow(TypeError);
    expect(bad([], { negationwindow: 3 })).toThrow(TypeError);
    expect(bad([], { negationWindow: NaN })).toThrow(RangeError);
    expect(bad([], { negationWindow: -1 })).toThrow(RangeError);
    expect(bad([], { negationWindow: 1.5 })).toThrow(RangeError);
    expect(bad([], { negationWindow: '40' })).toThrow(TypeError);
    expect(bad([], { checkWindow: -0.5 })).toThrow(RangeError);
    expect(bad([], { caseSensitive: 'no' })).toThrow(TypeError);
    expect(bad([], { extendedNegation: 0 })).toThrow(TypeError);
    expect(bad([], { required: {} })).toThrow(TypeError);
    expect(bad([], { required: [{ id: 'a', phrase: ' ' }] })).toThrow(RangeError);
    expect(bad([], { required: [{ id: 'a', phrase: 'x', extra: 1 }] })).toThrow(TypeError);
    expect(bad([], { required: [{ id: 'a', phrase: 'x' }, { id: 'a', phrase: 'y' }] })).toThrow(RangeError);
    expect(bad([], { required: [{ id: 'a', phrase: 'x', sourceIds: 'a' }] })).toThrow(TypeError);
    expect(bad([], { required: [{ id: 'a', phrase: 'x', sourceIds: [1] }] })).toThrow(TypeError);
    expect(bad([], { checkReference: '' })).toThrow(RangeError);
    expect(bad([], { checkReference: [5] })).toThrow(TypeError);
    expect(bad([], { checkReference: 5 })).toThrow(TypeError);
  });
  it('throws on malformed sources', () => {
    expect(bad([], {}, 'x')).toThrow(TypeError);
    expect(bad([], {}, [null])).toThrow(TypeError);
    expect(bad([], {}, [{ id: 1, text: 'x' }])).toThrow(TypeError);
    expect(bad([], {}, [{ id: 'a', text: 5 }])).toThrow(TypeError);
    expect(bad([], {}, [{ id: 'a' }])).toThrow(TypeError);
    expect(bad([], {}, [{ id: 'a', text: '' }, { id: 'a', text: '' }])).toThrow(RangeError);
    expect(bad([], {}, sparse([{ id: 'a', text: '' }, { id: 'b', text: '' }]))).toThrow(TypeError);
  });
  it('validates before it scans, so a late bad rule throws instead of a partial result', () => {
    expect(bad([BANNED, { ...BANNED, id: 'z', pattern: '' }])).toThrow(RangeError);
  });
  it('accepts undefined options and a null-prototype options object', () => {
    expect(() => scanCopy([], [], undefined)).not.toThrow();
    expect(() => scanCopy([], [], Object.assign(Object.create(null), { negationWindow: 10 }) as never)).not.toThrow();
  });
});

describe('hostile values', () => {
  it('lists the keys of a Proxy rule once', () => {
    let calls = 0;
    const proxy = new Proxy({ ...BANNED }, {
      ownKeys(target) {
        calls++;
        return Reflect.ownKeys(target);
      },
    });
    expect(scanCopy([{ id: 's', text: 'guaranteed returns' }], [proxy]).offenses).toHaveLength(1);
    expect(calls).toBe(1);
  });
  it('reads each caller property once', () => {
    const reads = { id: 0, text: 0, pattern: 0, reason: 0, kind: 0, phrase: 0 };
    const source = {
      get id() { reads.id++; return 's'; },
      get text() { reads.text++; return 'guaranteed returns'; },
    };
    const rule = {
      id: 'g',
      get pattern() { reads.pattern++; return 'guaranteed returns'; },
      get reason() { reads.reason++; return 'x'; },
      get kind() { reads.kind++; return 'banned'; },
    };
    const required = [{ id: 'q', get phrase() { reads.phrase++; return 'zzz'; } }];
    const r = scanCopy([source], [rule as never], { required });
    expect(r.offenses).toHaveLength(1);
    expect(reads).toEqual({ id: 1, text: 1, pattern: 1, reason: 1, kind: 1, phrase: 1 });
  });
  it('lets a throwing getter or proxy trap propagate and returns no partial result', () => {
    const boom = { get id(): string { throw new Error('boom'); }, text: '' };
    expect(() => scanCopy([boom], [])).toThrow('boom');
    const proxy = new Proxy([], { get: () => { throw new Error('trap'); } });
    expect(() => scanCopy(proxy, [])).toThrow();
  });
  it('does not mutate its input and does not share result objects with the rules', () => {
    const rules = Object.freeze([Object.freeze({ ...BANNED })]);
    const sources = Object.freeze([Object.freeze({ id: 's', text: 'guaranteed returns' })]);
    const a = scanCopy(sources, rules);
    const b = scanCopy(sources, rules);
    expect(a).toEqual(b);
    expect(a.offenses[0]).not.toBe(b.offenses[0]);
  });
  it('is not confused by __proto__, constructor or toString as ids', () => {
    const rule = { ...BANNED, id: '__proto__' };
    const r = scanCopy([{ id: 'constructor', text: 'guaranteed returns' }, { id: 'toString', text: 'x' }], [rule], {
      required: [{ id: 'hasOwnProperty', phrase: 'zzz', sourceIds: ['toString', '__proto__'] }],
    });
    expect(r.offenses.map((o) => [o.sourceId, o.ruleId])).toEqual([['constructor', '__proto__']]);
    expect(r.missing).toEqual([{ id: 'hasOwnProperty', phrase: 'zzz', sourceIds: ['toString', '__proto__'] }]);
  });
  it('handles huge arrays without spreading them', () => {
    const sources = Array.from({ length: 100_000 }, (_, i) => ({ id: String(i), text: '' }));
    expect(scanCopy(sources, []).sourcesScanned).toBe(100_000);
    const rules = Array.from({ length: 10_000 }, (_, i) => ({ ...BANNED, id: `r${i}`, pattern: `zq${i}z` }));
    expect(scanCopy([{ id: 'a', text: 'zq9999z here' }], rules).offenses.map((o) => o.ruleId)).toEqual(['r9999']);
  });
  it('treats NaN, Infinity and -0 options as documented', () => {
    expect(() => scanOne('x', [BANNED], { negationWindow: Infinity })).not.toThrow();
    expect(() => scanOne('x', [BANNED], { checkWindow: Infinity })).not.toThrow();
    expect(scanOne('We do not offer guaranteed returns.', [BANNED], { negationWindow: -0 }).offenses).toHaveLength(1);
  });
  it('handles lone surrogates and invisible-only text in every field', () => {
    expect(scanOne('\u{10000}\ud800 guaranteed returns \udc00').offenses.map((o) => o.column)).toEqual([4]);
    expect(scanOne('\u200b\u2066\u2069').offenses).toEqual([]);
    expect(() => scanCopy([{ id: '\ud800', text: '\ud800' }], [{ ...BANNED, id: '\udc00', pattern: '\ud800 guaranteed' }])).not.toThrow();
  });
  it('finds a phrase hidden by every kind of zero-width character', () => {
    for (const ch of ['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad', '\u2066', '\u202e', '\ufe0f', '\u180e', '\u061c']) {
      expect(scanOne(`guar${ch}anteed ret${ch}urns`).offenses, JSON.stringify(ch)).toHaveLength(1);
    }
  });
  it('does not call a value\'s then', () => {
    const thenable = { id: 's', text: 'x', then() { throw new Error('then called'); } };
    expect(() => scanCopy([thenable], [])).not.toThrow();
  });
});

describe('scaling', () => {
  // CPU time, best of a few runs; 4x the text must stay far below 16x the time.
  const cpu = (fn: () => void): number => {
    let best = Infinity;
    for (let i = 0; i < 4; i++) {
      const before = process.cpuUsage();
      fn();
      const after = process.cpuUsage(before);
      best = Math.min(best, after.user + after.system);
    }
    return best;
  };
  const rules: CopyRule[] = [
    BANNED,
    { id: 'rx', kind: 'banned', pattern: /risk[- ]free|zero\s+risk/i, reason: 'x' },
    ...DEFAULT_STRENGTH_RULES,
  ];
  const options = { checkReference: ['/methodology', /\[\[check:[a-z-]+\]\]/], required: [{ id: 'd', phrase: 'estimates are not guarantees' }] };
  const shapes: Record<string, (n: number) => string> = {
    'one long clause full of matches': (n) => 'guaranteed returns '.repeat(Math.ceil(n / 19)).slice(0, n),
    'negations everywhere, no clause boundary': (n) => 'not never no verified '.repeat(Math.ceil(n / 22)).slice(0, n),
    'quote marks everywhere': (n) => '"guaranteed returns" "'.repeat(Math.ceil(n / 23)).slice(0, n),
    'many lines': (n) => 'a guaranteed returns b\n'.repeat(Math.ceil(n / 23)).slice(0, n),
    'strength words with references': (n) => 'verified [[check:a]] proof atomic '.repeat(Math.ceil(n / 34)).slice(0, n),
    'long hyphen and space runs': (n) => ('- '.repeat(10) + 'x ').repeat(Math.ceil(n / 23)).slice(0, n),
    'combining marks': (n) => 'e\u0301\u0301\u0301 guaranteed '.repeat(Math.ceil(n / 20)).slice(0, n),
    'astral text': (n) => '\u{1F600} guaranteed returns '.repeat(Math.ceil(n / 22)).slice(0, n),
    'no match at all, long': (n) => 'lorem ipsum dolor '.repeat(Math.ceil(n / 18)).slice(0, n),
  };
  for (const [name, make] of Object.entries(shapes)) {
    it(`stays near linear: ${name}`, () => {
      const small = make(20_000);
      const large = make(80_000);
      const run = (text: string) => () => scanCopy([{ id: 's', text }], rules, options);
      run(small)(); // warm up
      const ratio = cpu(run(large)) / Math.max(cpu(run(small)), 1000);
      expect(ratio).toBeLessThan(9);
    });
  }
  it('stays near linear with the widest negation settings on a long clause full of cues', () => {
    const wide = { ...options, negationWindow: Infinity, extendedNegation: true };
    const make = (n: number) => 'zero not unable to guaranteed returns, no '.repeat(Math.ceil(n / 43)).slice(0, n);
    const run = (text: string) => () => scanCopy([{ id: 's', text }], rules, wide);
    run(make(20_000))();
    expect(cpu(run(make(80_000))) / Math.max(cpu(run(make(20_000))), 1000)).toBeLessThan(9);
    const noBoundary = (n: number) => 'zero x not y guaranteed returns '.repeat(Math.ceil(n / 32)).slice(0, n);
    run(noBoundary(20_000))();
    expect(cpu(run(noBoundary(80_000))) / Math.max(cpu(run(noBoundary(20_000))), 1000)).toBeLessThan(9);
  });
  it('stays near linear with many sources', () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, text: 'a guaranteed returns b' }));
    const run = (n: number) => () => scanCopy(make(n), rules, options);
    run(250)();
    expect(cpu(run(1_000)) / Math.max(cpu(run(250)), 1000)).toBeLessThan(9);
  }, 30_000);
});

describe('assertCopyClean', () => {
  it('returns the result when clean', () => {
    expect(assertCopyClean([{ id: 'a', text: 'fine' }], [BANNED])).toEqual({ offenses: [], missing: [], sourcesScanned: 1 });
  });
  it('throws a CopyGateError that lists every offense and missing statement', () => {
    let error: unknown;
    try {
      assertCopyClean(
        [{ id: 'home.html', text: 'Enjoy guaranteed returns.' }],
        [{ ...BANNED, replacement: 'estimated returns' }],
        { required: [{ id: 'disclaimer', phrase: 'Estimates are not guarantees' }] },
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CopyGateError);
    expect(error).toBeInstanceOf(Error);
    const e = error as CopyGateError;
    expect(e.offenses).toHaveLength(1);
    expect(e.missing).toHaveLength(1);
    expect(e.message).toContain('home.html:1:7 [g] "guaranteed returns": no guarantee Use: estimated returns');
    expect(e.message).toContain('missing [disclaimer] "Estimates are not guarantees" in: home.html');
  });
  it('escapes control and bidi characters from caller text in the message', () => {
    expect(() => assertCopyClean([{ id: 'a\u001b[31m', text: 'guaranteed\nreturns \u202e' }], [BANNED])).toThrow(
      /a\\u001b\[31m:1:1 \[g\] "guaranteed\\u000areturns"/,
    );
  });
  it('lists at most 50 in the message but keeps all on the error', () => {
    let error: CopyGateError | undefined;
    try {
      assertCopyClean([{ id: 'a', text: 'guaranteed returns. '.repeat(80) }], [BANNED]);
    } catch (e) {
      error = e as CopyGateError;
    }
    expect(error?.offenses).toHaveLength(80);
    expect(error?.message).toContain('... and 30 more');
    expect(error?.message.split('\n')).toHaveLength(52);
  });
  it('propagates validation errors untouched', () => {
    expect(() => assertCopyClean([], [{ ...BANNED, pattern: '' }])).toThrow(RangeError);
  });
});

describe('plantedViolationsFail', () => {
  it('proves every default strength rule catches a planted sample', () => {
    const report = plantedViolationsFail(DEFAULT_STRENGTH_RULES);
    expect(report.ok).toBe(true);
    expect(report.results).toHaveLength(DEFAULT_STRENGTH_RULES.length);
    expect(report.results.every((r) => r.caught && r.planted !== null)).toBe(true);
  });
  it('still catches them when a check reference is configured (the plant carries none)', () => {
    expect(plantedViolationsFail(DEFAULT_STRENGTH_RULES, { checkReference: [/\bOur\b/] }).ok).toBe(false);
    expect(plantedViolationsFail(DEFAULT_STRENGTH_RULES, { checkReference: ['/methodology'] }).ok).toBe(true);
  });
  it('proves a ledger of banned and retracted rules', () => {
    expect(plantedViolationsFail([BANNED, { id: 'u', kind: 'retracted', pattern: '99.99% uptime', reason: 'x' }]).ok).toBe(true);
  });
  it('reports a regex rule with no sample as unproven, and uses its sample when given', () => {
    const rx = /risk[- ]free/i;
    const missing = plantedViolationsFail([{ id: 'r', kind: 'banned', pattern: rx, reason: 'x' }]);
    expect(missing).toEqual({ ok: false, results: [{ ruleId: 'r', planted: null, caught: false }] });
    expect(plantedViolationsFail([{ id: 'r', kind: 'banned', pattern: rx, reason: 'x', sample: 'It is risk-free.' }]).ok).toBe(true);
  });
  it('reports a rule whose sample it cannot catch (a wrong sample, a blind pattern)', () => {
    const wrong = plantedViolationsFail([{ id: 'r', kind: 'banned', pattern: /risk[- ]free/i, reason: 'x', sample: 'It is safe.' }]);
    expect(wrong.ok).toBe(false);
    const blind = plantedViolationsFail([{ id: 'r', kind: 'banned', pattern: /Risk-Free/, reason: 'x', sample: 'It is risk-free.' }]);
    expect(blind.results[0]?.caught).toBe(false);
    const exempt = plantedViolationsFail([{ id: 'r', kind: 'banned', pattern: 'risk-free', reason: 'x', sample: 'We are not risk-free.' }]);
    expect(exempt.ok).toBe(false);
  });
  it('validates the ledger like scanCopy', () => {
    expect(() => plantedViolationsFail([{ ...BANNED, pattern: '' }])).toThrow(RangeError);
    expect(() => plantedViolationsFail([], { negationWindow: -1 })).toThrow(RangeError);
  });
  it('is the documented CI recipe', () => {
    const ledger: CopyRule[] = [BANNED, ...DEFAULT_STRENGTH_RULES];
    expect(plantedViolationsFail(ledger).ok).toBe(true);
    expect(() => assertCopyClean([{ id: 'page', text: 'Our plan has guaranteed returns.' }], ledger)).toThrow(CopyGateError);
  });
});

describe('defaults are conservative', () => {
  it('does not run user code or touch the clock', () => {
    const rule: CopyRule = { id: 'r', kind: 'banned', pattern: 'a', reason: 'x', replacement: null };
    expect(scanOne('a', [rule]).offenses[0]?.replacement).toBeNull();
  });
  it('returns the reason and replacement exactly as given', () => {
    const rule: CopyRule = { id: 'r', kind: 'retracted', pattern: 'a', reason: ' r\n\u202e ', replacement: ' b\n ' };
    const [o] = scanOne('a', [rule]).offenses;
    expect(o?.reason).toBe(' r\n\u202e ');
    expect(o?.replacement).toBe(' b\n ');
  });
});
