// Runs the README's worked examples (the blocks that follow an
// `<!-- example:NAME -->` marker), so the documentation cannot drift from the code.

import { describe, expect, it } from 'vitest';
import { plantedViolationsFail, scanCopy, type CopyRule, type ScanCopyOptions } from '../src/index.js';

// The package has no @types/node; load the two Node modules this file needs by name.
const NODE_FS = 'node:fs';
const NODE_VM = 'node:vm';
const fs = (await import(NODE_FS)) as { readFileSync(path: string, encoding: string): string };
const vm = (await import(NODE_VM)) as { runInNewContext(code: string, context: object): unknown };
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

describe('README: compliance claims need an evidence link', () => {
  const { complianceRules, complianceOptions } = example<{
    complianceRules: CopyRule[];
    complianceOptions: ScanCopyOptions;
  }>('compliance', '{ complianceRules, complianceOptions }');
  const { markdownToText } = example<{ markdownToText: (raw: string, o?: object) => string }>(
    'extract',
    '{ markdownToText }',
  );
  const run = (raw: string, options: ScanCopyOptions = complianceOptions) =>
    scanCopy([{ id: 'p.md', text: markdownToText(raw, { keepLinkTargets: true }) }], complianceRules, options).offenses.map(
      (o) => [o.ruleId, o.line, o.column],
    );

  it('catches its own planted samples', () => {
    expect(plantedViolationsFail(complianceRules, complianceOptions).ok).toBe(true);
  });
  it('flags a claim with no link and clears one with a trust link', () => {
    expect(run('We are SOC 2 compliant.')).toEqual([['compliance-framework-claim', 1, 8]]);
    expect(run('We are SOC 2 compliant ([report](/trust)).')).toEqual([]);
    expect(run('Our servers are compliant with HIPAA.')).toEqual([['compliance-claim-framework', 1, 17]]);
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
  const { markdownToText } = example<{ markdownToText: (raw: string, o?: object) => string }>(
    'extract',
    '{ markdownToText }',
  );
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

  it('keeps every line break and the text length', () => {
    const out = markdownToText(sample);
    expect(out.length).toBe(sample.length);
    expect([...out].map((c) => c === '\n')).toEqual([...sample].map((c) => c === '\n'));
  });
  it('keeps prose where it was and blanks syntax and code', () => {
    const out = markdownToText(sample);
    expect(out.split('\n')[3]).toMatch(/^We {3}guarantee {3}a fast start/);
    expect(out).not.toContain('Chart');
    expect(out).not.toContain('const guarantee');
    expect(out).not.toContain('<!--');
    expect(out).toMatch(/Estimates {6}only\./);
  });
  it('gives offenses the line and column of the original file', () => {
    const raw = sample;
    const offense = scanCopy([{ id: 'p.mdx', text: markdownToText(raw) }], [
      { id: 'g', kind: 'banned', pattern: 'guarantee', reason: 'x' },
    ]).offenses;
    expect(offense.map((o) => [o.line, o.column])).toEqual([[4, 6]]);
    expect(raw.split('\n')[3]?.slice(5, 14)).toBe('guarantee');
  });
  it('can keep link targets and blank known proper nouns', () => {
    expect(markdownToText('[docs](/trust)', { keepLinkTargets: true })).toBe('docs (/trust) ');
    const noun = 'American Institute of Certified Public Accountants';
    const out = markdownToText(`Run by the ${noun}.`, { allow: [noun] });
    expect(scanCopy([{ id: 'a', text: out }], [{ id: 'c', kind: 'banned', pattern: 'certified', reason: 'x' }]).offenses).toEqual([]);
  });
});
