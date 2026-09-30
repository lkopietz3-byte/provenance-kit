// Wording that is part of the package's observable behavior: the default
// phrase list (a CI run prints its reasons), the methodology scaffold, and the
// exact text of the errors a caller sees. A change here should be a deliberate
// diff, not a side effect.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CERTAINTY_PHRASES,
  methodologyPageOutline,
  validateClaims,
  type Claim,
  type ClaimsInput,
  type ValidateClaimsOptions,
} from '../src/index.js';
import { FULL_DEFINITIONS } from './helpers.js';

describe('DEFAULT_CERTAINTY_PHRASES', () => {
  it('is exactly this list, in this order (offenses follow it)', () => {
    expect(DEFAULT_CERTAINTY_PHRASES).toEqual([
      {
        phrase: '(verified)',
        reason:
          'A parenthetical "(verified)" tag reads as a blanket verification ' +
          'stamp. Only attach it to claims actually checked against a primary source.',
      },
      {
        phrase: 'independently verified',
        reason:
          '"Independently verified" claims a check by a party other than the ' +
          'publisher. Do not use this language for in-house estimates.',
      },
      {
        phrase: 'verified dataset',
        reason: 'Calling a dataset "verified" implies every record was checked, not modeled.',
      },
      {
        phrase: 'proprietary dataset',
        reason:
          '"Proprietary dataset" implies a measured, owned corpus of data. ' +
          'Estimates derived from public signal are not a proprietary dataset.',
      },
      {
        phrase: 'proprietary database',
        reason: 'Same issue as "proprietary dataset" \u{2014} implies ownership of measured records.',
      },
      {
        phrase: 'reverse-engineered',
        reason:
          'Implies a measured derivation process that did not happen; use "modeled" or "estimated" instead.',
      },
      {
        phrase: 'guaranteed',
        reason: '"Guaranteed" is a promise about outcome, not appropriate for an estimate.',
      },
      {
        phrase: 'guarantee',
        reason: 'Same as "guaranteed" \u{2014} a promise a modeled or editorial claim cannot back.',
      },
      {
        phrase: 'fact-checked',
        reason: '"Fact-checked" implies a specific verification process took place.',
      },
      {
        phrase: 'confirmed by',
        reason: '"Confirmed by X" attributes verification to a named source; only true if that happened.',
      },
      {
        phrase: '100% accurate',
        reason:
          'Absolute-accuracy claims are rarely defensible and should not appear outside verified, sourced claims.',
      },
    ]);
  });

  it('every default phrase is reported by its own reason text when used as a claim', () => {
    for (const { phrase, reason } of DEFAULT_CERTAINTY_PHRASES) {
      const offenses = validateClaims([{ id: 'c', text: `We say ${phrase}.`, tier: 'editorial' }]);
      expect(offenses.some((o) => o.phrase === phrase && o.message === reason)).toBe(true);
    }
  });
});

describe('methodologyPageOutline default scaffold', () => {
  it('renders exactly this Markdown for three definitions', () => {
    expect(methodologyPageOutline(FULL_DEFINITIONS, { productName: 'Acme' })).toBe(
      [
        '# How we know what we publish',
        '',
        '_A publication or product earns trust by telling readers what it knows, what it estimates, ' +
          'and what it merely judges \u{2014} and never confusing the three._',
        '',
        '## The tiers',
        '',
        '### Verified',
        '',
        'A person checked this against the source.',
        '',
        '### Modeled estimate',
        '',
        'Derived from public signal, not measured.',
        '',
        '### Editorial judgment',
        '',
        'Judgment, clearly marked as opinion.',
        '',
        '## What we do not do',
        '',
        'TODO: list the specific overclaiming Acme has committed to avoiding ' +
          '(e.g. "we do not call an estimate a measurement", "we do not attach unsourced ' +
          'claims to named individuals"). This section is what makes the tiers above ' +
          'credible \u{2014} a generic list is a weaker signal than a specific one.',
        '',
        '## Corrections we have made to ourselves',
        '',
        'TODO: a dated log of provenance corrections (mislabeled claims found and fixed). ' +
          'A publication that records its own corrections is demonstrating the standard, ' +
          'not just asserting it.',
        '',
        '## Common questions',
        '',
        'TODO: FAQ entries addressing what each tier does and does not mean in practice, ' +
          'and what a reader should do with a modeled or editorial claim before acting on it.',
        '',
      ].join('\n'),
    );
  });

  it('uses the default product name and a custom title and intro', () => {
    const text = methodologyPageOutline({}, { title: 'T', intro: 'I', tiers: [] });
    expect(text.startsWith('# T\n\n_I_\n\n## The tiers\n\n## What we do not do\n')).toBe(true);
    expect(text).toContain('overclaiming This product has committed to avoiding');
  });

  it('allows blank criteria (only the label must be visible)', () => {
    const defs = { verified: { label: 'Verified', shortDescription: 's', criteria: '' } };
    expect(methodologyPageOutline(defs, { tiers: ['verified'] })).toContain('### Verified\n\n\n\n## What we do not do');
  });
});

describe('validateClaims message text', () => {
  const claim = (over: Record<string, unknown>): Claim => ({ id: 'c1', text: 'Plain.', tier: 'modeled', ...over });

  it('certainty phrase without a backing tier, valid tier', () => {
    const [offense] = validateClaims([claim({ text: 'A proprietary database.', tier: 'editorial' })], {
      certaintyPhrases: ['proprietary database'],
    });
    expect(offense?.message).toBe(
      'Claim uses certainty language ("proprietary database") but is tiered "editorial", not one of: verified.',
    );
  });

  it('certainty phrase without a backing tier, invalid tier, several backing tiers', () => {
    const [offense] = validateClaims([claim({ text: 'A proprietary database.', tier: 'nope' })], {
      certaintyPhrases: ['proprietary database'],
      certaintyRequiresTier: ['verified', 'modeled'],
    });
    expect(offense?.message).toBe(
      'Claim uses certainty language ("proprietary database") but is tiered (missing/invalid tier), not one of: verified, modeled.',
    );
    expect(offense?.tier).toBe('nope');
  });

  it('unknown tier', () => {
    const [offense] = validateClaims([claim({ tier: 'nope' })]);
    expect(offense).toEqual({
      claimId: 'c1',
      claimText: 'Plain.',
      phrase: null,
      reason: 'unknown_tier',
      message:
        'Claim "c1" has no valid provenance tier (got "nope"). Every claim must be \'verified\', \'modeled\', or \'editorial\'.',
      tier: 'nope',
    });
  });

  it('missing sourceRef', () => {
    const [offense] = validateClaims([claim({ tier: 'verified' })]);
    expect(offense).toEqual({
      claimId: 'c1',
      claimText: 'Plain.',
      phrase: null,
      reason: 'missing_source_ref',
      message:
        'Claim "c1" is tiered "verified" but has no sourceRef. Claims at this tier must cite what they were checked against.',
      tier: 'verified',
    });
  });

  it('extractClaims that does not return an array', () => {
    expect(() => validateClaims({ text: 't', extractClaims: () => 'x' } as unknown as ClaimsInput)).toThrow(
      'validateClaims: extractClaims(text) must return an array of Claim, got string. Check your domain-specific extractor.',
    );
  });

  it('a non-string tier list entry', () => {
    expect(() =>
      validateClaims([claim({})], { certaintyRequiresTier: [42] } as unknown as ValidateClaimsOptions),
    ).toThrow('validateClaims: options.certaintyRequiresTier[0] must be a string tier name (received 42).');
  });

  it('a null reason means "no custom reason"; an undefined reason too', () => {
    for (const reason of [null, undefined]) {
      const [offense] = validateClaims([claim({ text: 'clinically proven' })], {
        certaintyPhrases: [{ phrase: 'clinically proven', reason } as unknown as { phrase: string }],
      });
      expect(offense?.message).toBe(
        'Claim uses certainty language ("clinically proven") but is tiered "modeled", not one of: verified.',
      );
    }
  });
});
