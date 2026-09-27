// Imports provenance-kit BY NAME from an installed tarball (see
// verify-package.mjs) and exercises the real public API the way a
// consumer would, asserting real outputs — not just "it exports
// something."

import assert from 'node:assert/strict';
import {
  DEFAULT_CERTAINTY_PHRASES,
  PROVENANCE_TIERS,
  methodologyPageOutline,
  provenanceBadgeText,
  validateClaims,
} from 'provenance-kit';

// --- PROVENANCE_TIERS -------------------------------------------------
assert.deepEqual(PROVENANCE_TIERS, ['verified', 'modeled', 'editorial']);
assert.equal(Object.isFrozen(PROVENANCE_TIERS), true, 'PROVENANCE_TIERS should be frozen');

// --- DEFAULT_CERTAINTY_PHRASES -----------------------------------------
assert.ok(DEFAULT_CERTAINTY_PHRASES.length > 0);
assert.ok(DEFAULT_CERTAINTY_PHRASES.some((r) => r.phrase === 'proprietary dataset'));
assert.equal(Object.isFrozen(DEFAULT_CERTAINTY_PHRASES), true);

// --- validateClaims: a claim that should pass clean ---------------------
const clean = validateClaims([
  {
    id: 'ship-tonnage',
    text: 'This ship is 168,666 gross tons.',
    tier: 'verified',
    sourceRef: 'https://operator.example/specs/ship-x',
  },
]);
assert.deepEqual(clean, []);

// --- validateClaims: an overclaim that should be flagged, with the right shape ---
const flagged = validateClaims([
  { id: 'bid-floor', text: 'This bid floor was independently verified across thousands of sailings.', tier: 'editorial' },
]);
assert.equal(flagged.length, 1);
assert.equal(flagged[0].claimId, 'bid-floor');
assert.equal(flagged[0].phrase, 'independently verified');
assert.equal(flagged[0].reason, 'certainty_phrase_without_backing_tier');
assert.equal(typeof flagged[0].message, 'string');
assert.ok(flagged[0].message.length > 0);

// --- validateClaims: negation, spacing/hyphenation folding, and the left-boundary fix ---
assert.deepEqual(
  validateClaims([{ id: 'x', text: 'These figures are not a proprietary dataset.', tier: 'modeled' }]),
  [],
  'a properly negated phrase must not be flagged',
);
assert.equal(
  validateClaims([{ id: 'x', text: 'This is independently-verified data.', tier: 'modeled' }]).length,
  1,
  'a hyphenated variant of a certainty phrase must still be caught',
);
assert.deepEqual(
  validateClaims([{ id: 'x', text: 'This is an unverified dataset of bids.', tier: 'modeled' }]),
  [],
  '"unverified dataset" must not match the phrase "verified dataset"',
);

// --- validateClaims: bad input throws a clear, on-brand error -----------
assert.throws(() => validateClaims(null), /expected a Claim\[\]/);

// --- provenanceBadgeText --------------------------------------------------
const definitions = {
  verified: { label: 'Verified', shortDescription: 'Checked against the source.', criteria: 'c' },
};
assert.equal(provenanceBadgeText('verified', definitions), 'Verified');
assert.equal(
  provenanceBadgeText('verified', definitions, { includeShortDescription: true }),
  'Verified — Checked against the source.',
);
assert.throws(() => provenanceBadgeText('editorial', definitions), /no tier definition supplied/i);
// A prototype-inherited key must not resolve as a definition.
assert.throws(() => provenanceBadgeText('constructor', definitions), /no tier definition supplied/i);

// --- methodologyPageOutline -----------------------------------------------
const outline = methodologyPageOutline(definitions, { productName: 'Consumer Probe Co' });
assert.ok(outline.includes('# How we know what we publish'));
assert.ok(outline.includes('### Verified'));
assert.ok(outline.includes('Consumer Probe Co'));
assert.ok(outline.includes('TODO: no ProvenanceTierDefinition was supplied for "modeled"'));

console.log('consumer-probe.mjs: all assertions passed');
