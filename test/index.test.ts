// test/index.test.ts
//
// Coverage for the four load-bearing behaviors of provenance-kit:
// 1. A properly verified + sourced claim passes clean.
// 2. A certainty phrase without a backing tier gets flagged (including
//    the "tier missing entirely" case).
// 3. A properly negated certainty phrase ("not a proprietary dataset")
//    is correctly NOT flagged.
// 4. The badge-text and methodology-outline helpers produce correct
//    output from caller-supplied tier definitions.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CERTAINTY_PHRASES,
  methodologyPageOutline,
  provenanceBadgeText,
  validateClaims,
  type Claim,
  type ProvenanceTierDefinitions,
} from '../src/index';

describe('validateClaims', () => {
  it('passes a claim correctly labeled verified with a sourceRef', () => {
    const claims: Claim[] = [
      {
        id: 'ship-tonnage',
        text: 'This ship is independently verified at 168,666 gross tons, per the operator spec sheet.',
        tier: 'verified',
        sourceRef: 'https://operator.example/specs/ship-x',
      },
    ];

    const offenses = validateClaims(claims);
    expect(offenses).toEqual([]);
  });

  it('flags a certainty phrase tiered as editorial', () => {
    const claims: Claim[] = [
      {
        id: 'bid-floor',
        text: 'This bid floor was independently verified across thousands of sailings.',
        tier: 'editorial',
      },
    ];

    const offenses = validateClaims(claims);
    expect(offenses.length).toBeGreaterThan(0);
    const phraseOffense = offenses.find((o) => o.phrase === 'independently verified');
    expect(phraseOffense).toBeDefined();
    expect(phraseOffense?.reason).toBe('certainty_phrase_without_backing_tier');
    expect(phraseOffense?.claimId).toBe('bid-floor');
  });

  it('flags a certainty phrase when the tier is missing entirely', () => {
    // Cast through unknown to simulate data arriving at runtime without
    // passing through the TS type system (e.g. from JSON/CMS content).
    const claims = [
      {
        id: 'no-tier-claim',
        text: 'Our proprietary dataset shows this route is independently verified.',
      },
    ] as unknown as Claim[];

    const offenses = validateClaims(claims);
    expect(offenses.length).toBeGreaterThan(0);
    expect(offenses.some((o) => o.reason === 'unknown_tier')).toBe(true);
    expect(offenses.some((o) => o.reason === 'certainty_phrase_without_backing_tier')).toBe(true);
  });

  it('does not flag a properly negated banned phrase', () => {
    const claims: Claim[] = [
      {
        id: 'obc-bands',
        text: 'These onboard-credit bands are not a proprietary dataset — they are modeled from public bid reports.',
        tier: 'modeled',
      },
    ];

    const offenses = validateClaims(claims);
    expect(offenses).toEqual([]);
  });

  it('flags a verified claim missing a sourceRef', () => {
    const claims: Claim[] = [
      { id: 'no-source', text: 'The ship carries 3,600 passengers at double occupancy.', tier: 'verified' },
    ];

    const offenses = validateClaims(claims);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].reason).toBe('missing_source_ref');
  });

  it('accepts raw text plus a caller-supplied claim extractor', () => {
    const text = 'Sentence one is fine. Our proprietary dataset says sentence two is not.';
    const offenses = validateClaims({
      text,
      extractClaims: (t) =>
        t.split('. ').map((sentence, i) => ({
          id: `s${i}`,
          text: sentence,
          tier: 'modeled' as const,
        })),
    });

    expect(offenses.some((o) => o.phrase === 'proprietary dataset')).toBe(true);
  });

  it('respects a fully custom certaintyPhrases override', () => {
    const claims: Claim[] = [
      { id: 'custom', text: 'This result is clinically proven.', tier: 'editorial' },
    ];

    // Default phrase list would not catch this domain-specific phrase.
    expect(validateClaims(claims)).toEqual([]);

    const offenses = validateClaims(claims, {
      certaintyPhrases: [{ phrase: 'clinically proven', reason: 'Implies a trial that did not happen.' }],
    });
    expect(offenses.some((o) => o.phrase === 'clinically proven')).toBe(true);
  });

  it('ships a non-empty, generic default certainty phrase list', () => {
    expect(DEFAULT_CERTAINTY_PHRASES.length).toBeGreaterThan(0);
    expect(DEFAULT_CERTAINTY_PHRASES.map((p) => p.phrase)).toContain('proprietary dataset');
  });
});

describe('provenanceBadgeText', () => {
  const definitions: ProvenanceTierDefinitions = {
    verified: {
      label: 'Verified',
      shortDescription: 'Checked directly against the source.',
      criteria: 'A human checked this fact against the source\'s own published material.',
    },
    modeled: {
      label: 'Modeled estimate',
      shortDescription: 'An estimate from public signal — not a guarantee.',
      criteria: 'Derived from publicly observable patterns, not measured directly.',
    },
    // `editorial` intentionally omitted to test the missing-definition path.
  };

  it('returns the label from the caller-supplied definitions', () => {
    expect(provenanceBadgeText('verified', definitions)).toBe('Verified');
    expect(provenanceBadgeText('modeled', definitions)).toBe('Modeled estimate');
  });

  it('optionally includes the short description', () => {
    expect(provenanceBadgeText('verified', definitions, { includeShortDescription: true })).toBe(
      'Verified — Checked directly against the source.',
    );
  });

  it('throws when a definition is missing for the requested tier', () => {
    expect(() => provenanceBadgeText('editorial', definitions)).toThrow(/no tier definition supplied/i);
  });
});

describe('methodologyPageOutline', () => {
  const definitions: ProvenanceTierDefinitions = {
    verified: {
      label: 'Verified',
      shortDescription: 'Checked against the source.',
      criteria: 'Structural facts checked directly against the source\'s own published material.',
    },
    modeled: {
      label: 'Modeled estimate',
      shortDescription: 'An estimate from public signal.',
      criteria: 'Estimates derived from public signal. Not guarantees, not measurements.',
    },
    editorial: {
      label: 'Editorial judgment',
      shortDescription: 'Stated opinion.',
      criteria: 'The publication\'s judgment, clearly marked as opinion.',
    },
  };

  it('renders every supplied tier label and criteria into the outline', () => {
    const outline = methodologyPageOutline(definitions, { productName: 'Test Product' });

    expect(outline).toContain('# How we know what we publish');
    expect(outline).toContain('### Verified');
    expect(outline).toContain('Structural facts checked directly against the source');
    expect(outline).toContain('### Modeled estimate');
    expect(outline).toContain('### Editorial judgment');
    expect(outline).toContain('Test Product');
  });

  it('respects a custom title and tier order', () => {
    const outline = methodologyPageOutline(definitions, {
      title: 'Our Methodology',
      tiers: ['editorial', 'verified'],
    });

    expect(outline).toContain('# Our Methodology');
    const editorialIndex = outline.indexOf('### Editorial judgment');
    const verifiedIndex = outline.indexOf('### Verified');
    expect(editorialIndex).toBeGreaterThan(-1);
    expect(verifiedIndex).toBeGreaterThan(editorialIndex);
    expect(outline).not.toContain('### Modeled estimate');
  });

  it('leaves a TODO marker for a tier with no supplied definition', () => {
    const outline = methodologyPageOutline({ verified: definitions.verified! });
    expect(outline).toContain('TODO: no ProvenanceTierDefinition was supplied for "modeled"');
  });
});
