// src/index.ts
//
// provenance-kit — public entry point. See README.md for a usage walkthrough.

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

export type {
  CopyRule,
  CopyRuleKind,
  CopySource,
  RequiredStatement,
  ScanCopyOptions,
  CopyOffense,
  MissingStatement,
  CopyScanResult,
  PlantedViolationResult,
  PlantedViolationReport,
} from './copy-gate.js';
export {
  CopyGateError,
  DEFAULT_STRENGTH_RULES,
  assertCopyClean,
  plantedViolationsFail,
  scanCopy,
} from './copy-gate.js';
