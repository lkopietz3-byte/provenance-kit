// Strict, NodeNext-mode type probe: uses the package's public types the
// way a TypeScript consumer with strict settings would, importing by
// package name (not a relative path into the repo). Compiled with
// `tsc --strict --module NodeNext` against the installed .d.ts files by
// verify-package.mjs; it is never run, only type-checked.

import {
  validateClaims,
  provenanceBadgeText,
  methodologyPageOutline,
  DEFAULT_CERTAINTY_PHRASES,
  PROVENANCE_TIERS,
  type Claim,
  type ClaimOffense,
  type ClaimOffenseReason,
  type ClaimsInput,
  type ProvenanceTier,
  type ProvenanceTierDefinitions,
  type ValidateClaimsOptions,
  type ProvenanceBadgeTextOptions,
  type MethodologyPageOutlineOptions,
  type CertaintyPhraseRule,
  type CertaintyPhraseInput,
} from 'provenance-kit';

const tier: ProvenanceTier = 'verified';
const tiers: readonly ProvenanceTier[] = PROVENANCE_TIERS;
void tiers;

const claim: Claim = {
  id: 'a',
  text: 'The ship is 168,666 gross tons.',
  tier,
  sourceRef: 'https://operator.example/specs',
};

const claims: ClaimsInput = [claim];

const options: ValidateClaimsOptions = {
  certaintyPhrases: DEFAULT_CERTAINTY_PHRASES,
  certaintyRequiresTier: ['verified'],
  requireSourceRefForTiers: ['verified'],
  caseSensitive: false,
  negationWindow: 40,
};

const offenses: ClaimOffense[] = validateClaims(claims, options);
const firstReason: ClaimOffenseReason | undefined = offenses[0]?.reason;
void firstReason;
// An unrecognized tier string is echoed; a non-string tier is null.
const offenseTier: string | null | undefined = offenses[0]?.tier;
void offenseTier;

const phraseInput: CertaintyPhraseInput = { phrase: 'guaranteed', reason: 'r' };
const phraseRule: CertaintyPhraseRule = phraseInput as CertaintyPhraseRule;
void phraseRule;

const definitions: ProvenanceTierDefinitions = {
  verified: { label: 'Verified', shortDescription: 's', criteria: 'c' },
};

const badgeOptions: ProvenanceBadgeTextOptions = { includeShortDescription: true };
const badgeText: string = provenanceBadgeText('verified', definitions, badgeOptions);
void badgeText;

const methodologyOptions: MethodologyPageOutlineOptions = {
  title: 'How we know',
  intro: 'intro',
  tiers: ['verified', 'modeled'],
  productName: 'Consumer Probe Co',
};
const outline: string = methodologyPageOutline(definitions, methodologyOptions);
void outline;

// The extractClaims form of ClaimsInput must also type-check.
const fromText: ClaimsInput = {
  text: 'raw text',
  extractClaims: (text: string): Claim[] => [{ id: 's0', text, tier: 'modeled' }],
};
void validateClaims(fromText);
