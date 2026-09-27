// PROVENANCE_TIERS and DEFAULT_CERTAINTY_PHRASES are module-level
// singletons shared by every caller in the process. Before these were
// frozen, one caller mutating them in place (forgetting to spread before
// pushing, or a stray `.sort()`) silently corrupted the default for every
// other `validateClaims`/`methodologyPageOutline` call — a classic shared
// mutable state bug.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CERTAINTY_PHRASES,
  PROVENANCE_TIERS,
  validateClaims,
  type CertaintyPhraseRule,
  type ProvenanceTier,
} from '../src/index.js';

/** Views a frozen readonly array as its mutable array type, to exercise a runtime mutation attempt. */
function asMutable<T>(value: readonly T[]): T[] {
  return value as unknown as T[];
}

describe('PROVENANCE_TIERS', () => {
  it('is exactly the three tiers, in display order', () => {
    expect(PROVENANCE_TIERS).toEqual(['verified', 'modeled', 'editorial']);
  });

  it('is frozen and resists mutation', () => {
    expect(Object.isFrozen(PROVENANCE_TIERS)).toBe(true);
    const mutable: ProvenanceTier[] = asMutable(PROVENANCE_TIERS);
    expect(() => mutable.push('modeled')).toThrow(TypeError);
    expect(PROVENANCE_TIERS).toHaveLength(3);
  });
});

describe('DEFAULT_CERTAINTY_PHRASES immutability', () => {
  it('is frozen and resists mutation', () => {
    expect(Object.isFrozen(DEFAULT_CERTAINTY_PHRASES)).toBe(true);
    const mutable: CertaintyPhraseRule[] = asMutable(DEFAULT_CERTAINTY_PHRASES);
    expect(() => mutable.push({ phrase: 'oops' })).toThrow(TypeError);
  });

  it('each entry is also frozen, so a field cannot be edited in place', () => {
    const first = DEFAULT_CERTAINTY_PHRASES[0];
    expect(first).toBeDefined();
    expect(Object.isFrozen(first)).toBe(true);
    const original = first?.phrase;
    expect(() => {
      if (first) first.phrase = 'oops';
    }).toThrow(TypeError);
    expect(DEFAULT_CERTAINTY_PHRASES[0]?.phrase).toBe(original);
  });

  it('mutating a spread copy never touches the shared default (the documented safe pattern)', () => {
    const before = DEFAULT_CERTAINTY_PHRASES.length;
    const copy = [...DEFAULT_CERTAINTY_PHRASES, { phrase: 'clinically proven' }];
    copy.push({ phrase: 'off-market exclusive' });
    expect(DEFAULT_CERTAINTY_PHRASES).toHaveLength(before);
    expect(validateClaims([{ id: 'a', text: 'clinically proven', tier: 'modeled' }]).length).toBe(0);
  });
});
