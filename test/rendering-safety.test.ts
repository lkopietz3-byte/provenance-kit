// provenanceBadgeText and methodologyPageOutline are pure string builders
// with "no UI dependency" (see README Design notes) — they do not know
// whether the caller will hand the result to React (auto-escaping text
// child), assign it to innerHTML (no escaping), or feed it to a Markdown
// renderer that passes through raw HTML. These tests pin down the actual,
// documented behavior (verbatim passthrough, no escaping) with the classic
// XSS-probe inputs, so a future change to that behavior is a deliberate,
// visible diff here — not a silent regression either way.

import { describe, expect, it } from 'vitest';
import { methodologyPageOutline, provenanceBadgeText } from '../src/index.js';

const DANGEROUS_INPUTS = [
  ['script tag', '<script>alert(1)</script>'],
  ['attribute-breaking quote', '"><img src=x onerror=alert(1)>'],
  ['javascript: URL', '[click me](javascript:alert(1))'],
  ['bare ampersand', 'Ships & Sails'],
  ['single quote', "Rider's choice"],
] as const;

describe('provenanceBadgeText passes definition text through verbatim (no escaping)', () => {
  it.each(DANGEROUS_INPUTS)('does not alter a %s in the label', (_label, dangerous) => {
    const definitions = { verified: { label: dangerous, shortDescription: 's', criteria: 'c' } };
    expect(provenanceBadgeText('verified', definitions)).toBe(dangerous);
  });

  it.each(DANGEROUS_INPUTS)('does not alter a %s in the shortDescription', (_label, dangerous) => {
    const definitions = { verified: { label: 'Verified', shortDescription: dangerous, criteria: 'c' } };
    expect(provenanceBadgeText('verified', definitions, { includeShortDescription: true })).toBe(
      `Verified — ${dangerous}`,
    );
  });
});

describe('methodologyPageOutline passes definition text through verbatim (no escaping)', () => {
  it.each(DANGEROUS_INPUTS)('does not alter a %s in criteria', (_label, dangerous) => {
    const definitions = { verified: { label: 'Verified', shortDescription: 's', criteria: dangerous } };
    const outline = methodologyPageOutline(definitions, { tiers: ['verified'] });
    expect(outline).toContain(dangerous);
  });

  it.each(DANGEROUS_INPUTS)('does not alter a %s in a tier label heading', (_label, dangerous) => {
    const definitions = { verified: { label: dangerous, shortDescription: 's', criteria: 'c' } };
    const outline = methodologyPageOutline(definitions, { tiers: ['verified'] });
    expect(outline).toContain(`### ${dangerous}`);
  });

  it.each(DANGEROUS_INPUTS)('does not alter a %s in a custom title', (_label, dangerous) => {
    const outline = methodologyPageOutline({}, { title: dangerous });
    expect(outline).toContain(`# ${dangerous}`);
  });
});
