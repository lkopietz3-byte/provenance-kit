// Shared helpers for the test files. Not part of the package (test/ is not
// in the tarball).

import { validateClaims, type Claim, type ClaimOffense, type ProvenanceTier, type ValidateClaimsOptions } from '../src/index.js';

/** Validate a single claim and return only the certainty-phrase offenses. */
export function phraseOffenses(
  text: string,
  options: ValidateClaimsOptions = {},
  tier: ProvenanceTier = 'modeled',
): ClaimOffense[] {
  const claim: Claim = { id: 'c', text, tier };
  return validateClaims([claim], options).filter(
    (o) => o.reason === 'certainty_phrase_without_backing_tier',
  );
}

/** The matched phrases for a single modeled claim (what a caller would see flagged). */
export function flaggedPhrases(text: string, options: ValidateClaimsOptions = {}): string[] {
  return phraseOffenses(text, options).map((o) => o.phrase ?? '');
}

/** Complete tier definitions used by the rendering tests. */
export const FULL_DEFINITIONS = {
  verified: {
    label: 'Verified',
    shortDescription: 'Checked against the source.',
    criteria: 'A person checked this against the source.',
  },
  modeled: {
    label: 'Modeled estimate',
    shortDescription: 'An estimate from public signal.',
    criteria: 'Derived from public signal, not measured.',
  },
  editorial: {
    label: 'Editorial judgment',
    shortDescription: 'Stated opinion.',
    criteria: 'Judgment, clearly marked as opinion.',
  },
} as const;
