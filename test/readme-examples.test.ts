// Runs the README's worked examples (the blocks that follow an
// `<!-- example:NAME -->` marker), so the documentation cannot drift from the code.

import { describe, expect, it } from 'vitest';
import { plantedViolationsFail, scanCopy, type CopyRule, type ScanCopyOptions } from '../src/index.js';

// The package has no @types/node; load the two Node modules this file needs by name.
const NODE_FS = 'node:fs';
const NODE_VM = 'node:vm';
const fs = (await import(NODE_FS)) as { readFileSync(path: string, encoding: string): string };
const vm = (await import(NODE_VM)) as { runInNewContext(code: string, context: object): unknown };
declare const process: {
  cpuUsage(previous?: { user: number; system: number }): { user: number; system: number };
};
const README = fs.readFileSync('README.md', 'utf8'); // vitest runs from the package root

/** Run the JavaScript block after `<!-- example:name -->` and return the named values it defines. */
function example<T>(name: string, returns: string): T {
  const marker = `<!-- example:${name} -->`;
  const at = README.indexOf(marker);
  if (at === -1) throw new Error(`README has no ${marker}`);
  const open = README.indexOf('```js\n', at);
  const close = README.indexOf('\n```', open + 6);
  const code = README.slice(open + 6, close);
  return vm.runInNewContext(`(() => {\n${code}\nreturn ${returns};\n})()`, {}) as T;
}

type Extract = (raw: string, options?: object) => { text: string; locate: (line: number, column: number) => { line: number; column: number } };
const { markdownToText } = example<{ markdownToText: Extract }>('extract', '{ markdownToText }');

describe('README: compliance claims need an evidence link', () => {
  const { complianceRules, complianceOptions } = example<{
    complianceRules: CopyRule[];
    complianceOptions: ScanCopyOptions;
  }>('compliance', '{ complianceRules, complianceOptions }');
  const run = (raw: string, options: ScanCopyOptions = complianceOptions, extract: object = { keepLinkTargets: true }) =>
    scanCopy([{ id: 'p.md', text: markdownToText(raw, extract).text }], complianceRules, options).offenses.map((o) => [
      o.ruleId,
      o.line,
      o.column,
    ]);

  it('catches its own planted samples', () => {
    expect(plantedViolationsFail(complianceRules, complianceOptions).ok).toBe(true);
  });
  it('flags a claim with no link and clears one with a trust link', () => {
    expect(run('We are SOC 2 compliant.')).toEqual([['compliance-framework-claim', 1, 8]]);
    expect(run('We are SOC 2 compliant ([report](/trust)).')).toEqual([]);
    expect(run('Our servers are compliant with HIPAA.')).toEqual([['compliance-claim-framework', 1, 17]]);
  });
  it('keeps an HTML or JSX link target when asked, and only then', () => {
    expect(run('<a href="/trust">We are SOC 2 certified</a>.')).toEqual([]);
    expect(run("We are SOC 2 certified (<a class='x' href='/security'>details</a>).")).toEqual([]);
    expect(run('We are SOC 2 certified (<a href={"/compliance"}>details</a>).')).toEqual([]);
    expect(run('<a href="/trust">We are SOC 2 certified</a>.', complianceOptions, {})).toHaveLength(1);
    expect(run('<a href="/pricing">We are SOC 2 certified</a>.')).toHaveLength(1);
  });
  it('keeps only a real href attribute, not look-alikes or text inside another value', () => {
    const claim = 'We are SOC 2 certified';
    expect(run(`${claim} (<span data-href="/trust">details</span>).`)).toHaveLength(1);
    expect(run(`${claim} (<span aria-href='/trust'>details</span>).`)).toHaveLength(1);
    expect(run(`${claim} (<span title='href="/trust"'>details</span>).`)).toHaveLength(1);
    expect(run(`${claim} (<span title="see href='/trust'">details</span>).`)).toHaveLength(1);
    expect(run(`${claim} (<a onClick={() => go("href='/trust'")} href="/team">details</a>).`)).toHaveLength(1);
    expect(run(`${claim} (<a HREF="/trust">details</a>).`)).toEqual([]);
    expect(run(`${claim} (<a title="a > b" href="/trust">details</a>).`)).toEqual([]);
    expect(run(`${claim} (<a title="x"\n   href="/trust">details</a>).`)).toEqual([]);
    expect(run(`${claim} (<a href=/trust>details</a>).`)).toEqual([]);
    expect(run(`${claim} (<a href='/security' />).`)).toEqual([]);
  });
  it('keeps an href written as a JSX template literal', () => {
    const claim = 'We are SOC 2 certified';
    expect(run(`${claim} (<a href={\`/trust\`}>details</a>).`)).toEqual([]);
    expect(run(`${claim} (<a href={"/compliance"}>details</a>).`)).toEqual([]);
    expect(run(`${claim} (<a href={\`/pricing\`}>details</a>).`)).toHaveLength(1);
  });
  it('does not treat an href shown in inline code as a link', () => {
    expect(run('Write `<a href="/trust">` to link. We are SOC 2 certified.')).toHaveLength(1);
  });
  it('flags table rows that say Compliant with nothing beside them', () => {
    expect(run('| Framework | Status |\n| --- | --- |\n| ESIGN / UETA | Compliant |\n| SOC 2 | Compliant |').map((o) => o[1])).toEqual([3, 4]);
  });
  it('treats an honest negated list of frameworks as clean', () => {
    expect(run('We are not SOC 2, ISO 27001, or HIPAA certified.')).toEqual([]);
    expect(run('We are not SOC 2 compliant, but we are HIPAA compliant.')).toEqual([['compliance-framework-claim', 1, 40]]);
  });
  it('a rule on the last word alone would report the same sentence', () => {
    const lastWord: CopyRule = { id: 'c', kind: 'strength', pattern: 'certified', reason: 'x', wholeWord: true };
    expect(scanCopy([{ id: 'a', text: 'We are not SOC 2, ISO 27001, or HIPAA certified.' }], [lastWord]).offenses).toHaveLength(1);
  });
  it('does not fire on hedged wording', () => {
    expect(run('Our cloud is HIPAA-ready and GDPR-ready.')).toEqual([]);
  });
});

describe('README: markdownToText', () => {
  const sample = [
    'import Chart from "./chart";',
    '# Pricing',
    '',
    'We **guarantee** a [fast start](/start) with `code` and ![logo](a.png).',
    '<Callout type="info">',
    '  Estimates&nbsp;only.',
    '</Callout>',
    '```js',
    'const guarantee = true;',
    '```',
    '<!-- guarantee -->',
    '| Plan | Note |',
  ].join('\n');
  const GUARANTEE: CopyRule[] = [
    { id: 'g', kind: 'banned', pattern: 'guarantee', reason: 'x' },
    { id: 'gr', kind: 'banned', pattern: 'guaranteed returns', reason: 'x' },
  ];
  const hits = (raw: string, rules: CopyRule[] = GUARANTEE, options: object = {}) => {
    const { text, locate } = markdownToText(raw, options);
    return scanCopy([{ id: 'p.mdx', text }], rules).offenses.map((o) => [o.ruleId, o.line, o.column, locate(o.line, o.column)]);
  };

  it('keeps every line break, and the length when nothing is decoded', () => {
    const { text } = markdownToText(sample);
    expect(text.length).toBe(sample.length - '&nbsp;'.length + 1);
    expect(text.split('\n').length).toBe(sample.split('\n').length);
    const plain = sample.replace('&nbsp;', ' ');
    const out = markdownToText(plain).text;
    expect(out.length).toBe(plain.length);
    expect([...out].map((c) => c === '\n')).toEqual([...plain].map((c) => c === '\n'));
  });
  it('keeps prose where it was and blanks syntax and code', () => {
    const { text } = markdownToText(sample);
    expect(text.split('\n')[3]).toMatch(/^We {3}guarantee {3}a {2}fast start\s+with/);
    expect(text).not.toContain('Chart');
    expect(text).not.toContain('const guarantee');
    expect(text).not.toContain('<!--');
    expect(text).toContain('Estimates only.');
  });
  it('gives offenses the line and column of the original file', () => {
    expect(hits(sample)).toEqual([['g', 4, 6, { line: 4, column: 6 }]]);
    expect(sample.split('\n')[3]?.slice(5, 14)).toBe('guarantee');
  });
  it('keeps a Markdown link label where it was (no column shift)', () => {
    expect(hits('[guarantee](/x)')).toEqual([['g', 1, 2, { line: 1, column: 2 }]]);
    expect(hits('See [guarantee](/x) and [guarantee](/y).').map((h) => h[3])).toEqual([
      { line: 1, column: 6 },
      { line: 1, column: 26 },
    ]);
    expect(hits('x\n  [a](/b) [guarantee](/x)').map((h) => h[3])).toEqual([{ line: 2, column: 12 }]);
  });
  it('decodes numeric and named entities so they cannot hide a phrase', () => {
    for (const raw of [
      'guaranteed &#114;eturns',
      'guaranteed &#x72;eturns',
      'guaranteed &#X72;eturns',
      'guaranteed&nbsp;returns',
      'guar&#97;nteed returns',
      'guaranteed r&#101;turns',
    ]) {
      expect(hits(raw).map((h) => h[0]), raw).toContain('gr');
    }
  });
  it('maps positions back across a decoded entity', () => {
    const raw = 'a &#114; b\nxx &#x72;&#x72; guarantee';
    const found = hits(raw);
    expect(found.map((h) => [h[1], h[2]])).toEqual([[2, 7]]);
    expect(found.map((h) => h[3])).toEqual([{ line: 2, column: 17 }]);
    expect(raw.split('\n')[1]?.slice(16, 25)).toBe('guarantee');
    expect(hits('\u{1F600} &amp; &#128512; guarantee').map((h) => h[3])).toEqual([{ line: 1, column: 19 }]);
  });
  it('treats an unknown or out-of-range entity as a space, not as text', () => {
    expect(markdownToText('a&bogus;b &#0; &#xD800; &#1114112; &#10; z').text).toBe(`a b${' '.repeat(9)}z`);
  });
  it('keeps CRLF and lone CR line breaks', () => {
    expect(hits('x\r\n[a] guarantee').map((h) => h[3])).toEqual([{ line: 2, column: 5 }]);
    expect(hits('x\r[a] guarantee').map((h) => h[3])).toEqual([{ line: 2, column: 5 }]);
  });
  it('can keep link targets and blank known proper nouns', () => {
    expect(markdownToText('[docs](/trust)', { keepLinkTargets: true }).text).toBe(' docs  /trust ');
    expect(markdownToText('<a href="/trust" title="x">t</a>', { keepLinkTargets: true }).text).toContain('/trust');
    expect(markdownToText('<a href="/trust" title="x">t</a>', { keepLinkTargets: true }).text).not.toContain('title');
    const noun = 'American Institute of Certified Public Accountants';
    const out = markdownToText(`Run by the ${noun}.`, { allow: [noun] }).text;
    expect(scanCopy([{ id: 'a', text: out }], [{ id: 'c', kind: 'banned', pattern: 'certified', reason: 'x' }]).offenses).toEqual([]);
  });
});

describe('README: markdownToText costs linear time on hostile documents', () => {
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
  const shapes: Record<string, (n: number) => string> = {
    'unterminated <a href=" openings': (n) => '<a href="'.repeat(Math.ceil(n / 9)),
    'unterminated openings with text between': (n) => '<a href="/x" title=\'y and some words '.repeat(Math.ceil(n / 38)),
    'unterminated single-quote and brace openings': (n) => "<a title='x {y ".repeat(Math.ceil(n / 15)),
    'bare < and </ everywhere': (n) => '< a </ b <1 <a '.repeat(Math.ceil(n / 15)),
    'unterminated comments': (n) => '<!-- x '.repeat(Math.ceil(n / 7)),
    'unterminated code fences': (n) => '```js x\n'.repeat(Math.ceil(n / 8)).slice(0, n) + '~~~',
    'many [ with no ](': (n) => '[a '.repeat(Math.ceil(n / 3)),
    'many ![ with no ](': (n) => '![a '.repeat(Math.ceil(n / 4)),
    'many & with no ;': (n) => '&#123456 &abc '.repeat(Math.ceil(n / 14)),
    'many backticks': (n) => '`a `b '.repeat(Math.ceil(n / 6)),
  };
  for (const [name, make] of Object.entries(shapes)) {
    it(`stays near linear: ${name}`, () => {
      const run = (n: number) => () => markdownToText(make(n), { keepLinkTargets: true });
      run(20_000)();
      expect(cpu(run(80_000)) / Math.max(cpu(run(20_000)), 1000)).toBeLessThan(9);
    }, 60_000);
  }
  it('treats a tag that never closes as text, and ignores a tag over the length cap', () => {
    expect(markdownToText('a <b title="x and more text').text).toBe('a <b title="x and more text');
    expect(markdownToText('<a href="/trust"', { keepLinkTargets: true }).text).toBe('<a href="/trust"');
    expect(markdownToText('x < y and 1 <2 and </ z <').text).toBe('x < y and 1 <2 and </ z <');
    const long = `<a ${'x '.repeat(3000)}href="/trust">go</a>`;
    const tooLong = markdownToText(long, { keepLinkTargets: true }).text;
    expect(tooLong.startsWith('<a x x x')).toBe(true); // the opening tag stays text
    expect(tooLong.endsWith('href="/trust">go    ')).toBe(true); // the closing tag is its own tag
    const fits = `<a ${'x '.repeat(1500)}href="/trust">go</a>`;
    expect(markdownToText(fits, { keepLinkTargets: true }).text).toContain('/trust');
  });
  it('lets a later tag close after an earlier one failed', () => {
    const out = markdownToText('<a href="x <a href="/trust">t</a>', { keepLinkTargets: true }).text;
    expect(out).toContain('/trust');
  });
  it('blanks fenced code and comments, and leaves an unclosed opener as text', () => {
    expect(markdownToText('a ```x``` b').text).toBe('a         b');
    expect(markdownToText('a ~~~x b').text).toBe('a ~~~x b');
    expect(markdownToText('a <!-- x --> b <!-- y').text).toBe('a            b <!-- y');
    expect(markdownToText('~~~\nx\n~~~ ```y```\n~~~z').text).toBe('   \n \n~~~          \n~~~z'.replace('~~~          ', '           '));
  });
});
