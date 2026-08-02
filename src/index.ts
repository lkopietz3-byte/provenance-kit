// src/index.ts
//
// provenance-kit — public entry point. See README.md for the incident
// this pattern fixes and a usage walkthrough.

export type {
  ProvenanceTier,
  ProvenanceTierDefinition,
  ProvenanceTierDefinitions,
  Claim,
} from './types.js';
export { PROVENANCE_TIERS } from './types.js';

export type { CertaintyPhraseRule, CertaintyPhraseInput } from './certainty-phrases.js';
export { DEFAULT_CERTAINTY_PHRASES } from './certainty-phrases.js';

export type {
  ClaimOffense,
  ClaimOffenseReason,
  ClaimsInput,
  ValidateClaimsOptions,
} from './validate.js';
export { validateClaims } from './validate.js';

export type { ProvenanceBadgeTextOptions } from './badge.js';
export { provenanceBadgeText } from './badge.js';

export type { MethodologyPageOutlineOptions } from './methodology.js';
export { methodologyPageOutline } from './methodology.js';
