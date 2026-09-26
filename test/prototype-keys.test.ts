// A tier value at runtime can come from JSON/CMS content (see the existing
// "as unknown as Claim[]" cast in index.test.ts), not just TypeScript's
// closed ProvenanceTier union. If that value happens to match a key every
// plain object inherits from Object.prototype — "constructor", "toString",
// "__proto__", "hasOwnProperty" — a lookup with `definitions[tier]` resolves
// to the inherited value instead of "missing", which is a real bug: the
// documented contract is "throws when a definition is missing", and
// silently rendering "undefined" text is worse than the blank badge the
// throw exists to prevent.

import { describe, expect, it } from 'vitest';
import { methodologyPageOutline, provenanceBadgeText, type ProvenanceTier } from '../src/index.js';
import { FULL_DEFINITIONS } from './helpers.js';

const POLLUTING_TIER_KEYS = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'];

/** A tier value arriving at runtime from JSON/CMS content, past the ProvenanceTier type. */
function asRuntimeTier(key: string): ProvenanceTier {
  return key as unknown as ProvenanceTier;
}

describe('provenanceBadgeText treats prototype-inherited keys as missing', () => {
  it.each(POLLUTING_TIER_KEYS)('throws for tier %s even though Object.prototype has it', (key) => {
    expect(() => provenanceBadgeText(asRuntimeTier(key), FULL_DEFINITIONS)).toThrow(
      /no tier definition supplied/i,
    );
  });

  it('still returns real definitions for the three actual tiers', () => {
    expect(provenanceBadgeText('verified', FULL_DEFINITIONS)).toBe('Verified');
  });
});

describe('methodologyPageOutline treats prototype-inherited keys as missing', () => {
  it.each(POLLUTING_TIER_KEYS)('emits a TODO for tier %s instead of "### undefined"', (key) => {
    const outline = methodologyPageOutline(FULL_DEFINITIONS, {
      tiers: [asRuntimeTier(key)],
    });
    expect(outline).not.toContain('undefined');
    expect(outline).toContain(`TODO: no ProvenanceTierDefinition was supplied for "${key}"`);
  });
});
