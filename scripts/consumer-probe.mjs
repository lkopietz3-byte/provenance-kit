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

// --- validateClaims: negation, spacing/hyphenation folding, and the left boundary ---
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

// --- validateClaims: negation stops at a clause boundary (0.2.0) ---------
assert.deepEqual(
  validateClaims([{ id: 'x', text: 'These are not guesses, they are independently verified.', tier: 'modeled' }]).map(
    (o) => o.phrase,
  ),
  ['independently verified'],
  'a negation in an earlier clause must not hide an overclaim',
);
assert.deepEqual(
  validateClaims([{ id: 'x', text: 'This is not verified.', tier: 'modeled' }], { certaintyPhrases: ['verified'] }),
  [],
  'a negation in the same clause still suppresses',
);

// --- validateClaims: the left boundary reads whole code points (0.2.0) ---
assert.deepEqual(
  validateClaims([{ id: 'x', text: '\u{10400}verified dataset', tier: 'modeled' }]),
  [],
  'a supplementary-plane letter before the phrase is not a word boundary',
);
assert.equal(
  validateClaims([{ id: 'x', text: '\u{10400} verified dataset', tier: 'modeled' }]).length,
  1,
  'a space after that letter is a boundary',
);

// --- validateClaims: a visibly empty sourceRef is missing (0.2.0) --------
assert.deepEqual(
  validateClaims([{ id: 'x', text: 'A fact.', tier: 'verified', sourceRef: '\u{200b}\u{2066}\u{2069}' }]).map(
    (o) => o.reason,
  ),
  ['missing_source_ref'],
);

// --- validateClaims: bad input throws a clear, on-brand error -----------
assert.throws(() => validateClaims(null), /expected a Claim\[\]/);
// A hole in a sparse array is rejected, never skipped or crashed on.
assert.throws(() => validateClaims(new Array(1)), /claims\[0\] is missing/);
// A bad option throws instead of being read as "off".
assert.throws(() => validateClaims([], { negationWindow: Number.NaN }), RangeError);
// Message text from caller strings is escaped; the structured id stays raw.
const [escaped] = validateClaims([{ id: 'a\nb', text: 'x', tier: 'nope' }]);
assert.equal(escaped.claimId, 'a\nb');
assert.ok(escaped.message.includes('"a\\u000ab"'));

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
// A tier that is not a string is rejected, not coerced into a key.
assert.throws(() => provenanceBadgeText(['verified'], definitions), TypeError);
// A visibly blank label would render an unlabeled badge.
assert.throws(() => provenanceBadgeText('verified', { verified: { label: '\u{200b}' } }), RangeError);

// --- methodologyPageOutline -----------------------------------------------
const outline = methodologyPageOutline(definitions, { productName: 'Consumer Probe Co' });
assert.ok(outline.includes('# How we know what we publish'));
assert.ok(outline.includes('### Verified'));
assert.ok(outline.includes('Consumer Probe Co'));
assert.ok(outline.includes('TODO: no ProvenanceTierDefinition was supplied for "modeled"'));

console.log('consumer-probe.mjs: all assertions passed');
