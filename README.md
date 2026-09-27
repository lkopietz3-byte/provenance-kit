# provenance-kit

Provenance Kit lets a product label claims as verified, modeled, or editorial, then check that public wording matches the claim's evidence tier. The TypeScript library has no runtime dependencies and works across frameworks.

## A synthetic failure pattern this library addresses

The following hypothetical is synthetic; it does not describe a particular
product, audit, or dataset. On a growing content site, routine editorial and
AI-assisted work could lead to:

- Numbers receiving `(verified)` labels before anyone checks them against a
  primary source.
- Precise-sounding sample sizes appearing without supporting records.
- Phrases such as "reverse-engineered" or "proprietary dataset" describing
  estimates modeled from public signals.

These errors can emerge without intent to mislead. When confidence lives only
in prose, a build has no field to check against and cannot flag a mismatch.

The pattern is to make provenance a **first-class, enforced data field**:
every claim carries one of exactly three tiers, a methodology page explains
what each tier means, and a scanner checks claims against certainty-implying
phrases and flags mismatches. This package generalizes that mechanism:
a typed claim shape, a phrase-vs-tier scanner with negation handling, and
badge-text and methodology-page helpers. Phrase lists and page inventories
depend on the product and are not included here.

## The three tiers

```ts
type ProvenanceTier = 'verified' | 'modeled' | 'editorial';
```

- **`verified`** — a structural fact checked directly against the
  source's own published material. Checkable, and someone checked it.
- **`modeled`** — an estimate derived from public signal. Explicitly
  **not** a measurement, **not** a guarantee, and **not** a "proprietary
  dataset."
- **`editorial`** — stated judgment or opinion, clearly marked as such.

This is a deliberately minimal set. Resist adding a fourth tier unless
there's a genuinely generic reason — most "we need a special case" urges
are better solved with a more specific `sourceRef` or a domain wrapper
around these three, not a fourth epistemic state every consumer of the
library then has to learn to handle.

The exact meaning of "verified" is domain-specific (a cruise-ship spec
page vs. a nutrition label vs. a legal filing), so this library never
hardcodes tier wording. You supply it via `ProvenanceTierDefinition`.

## Install

```bash
npm install provenance-kit
```

(Not published to a registry yet — point at the local path or a git URL
until it is.)

## Usage

### 1. Define your claims

```ts
import type { Claim } from 'provenance-kit';

const claims: Claim[] = [
  {
    id: 'ship-tonnage',
    text: 'This ship is 168,666 gross tons.',
    tier: 'verified',
    sourceRef: 'https://operator.example/specs/ship-x',
  },
  {
    id: 'bid-floor-estimate',
    text: 'Typical upgrade bid floors run $150–$300 per night on this class.',
    tier: 'modeled',
  },
  {
    id: 'cabin-read',
    text: 'This is the quiet pick on the deck.',
    tier: 'editorial',
  },
];
```

### 2. Validate them (in a test, a lint step, or CI)

```ts
import { validateClaims } from 'provenance-kit';

const offenses = validateClaims(claims);

if (offenses.length > 0) {
  for (const o of offenses) {
    console.error(`[${o.claimId}] ${o.reason}: ${o.message}`);
  }
  process.exit(1); // fail the build
}
```

`validateClaims` also accepts raw text plus a claim-extraction function,
since pulling claims out of prose is inherently domain-specific:

```ts
validateClaims({
  text: pageMarkdown,
  extractClaims: (text) => myDomainSpecificExtractor(text),
});
```

By default it checks against `DEFAULT_CERTAINTY_PHRASES` — a small,
generic starter list (`"(verified)"`, `"independently verified"`,
`"proprietary dataset"`, `"reverse-engineered"`, `"guaranteed"`, …).
**Override it.** Every product accumulates its own vocabulary of
overclaiming:

```ts
validateClaims(claims, {
  certaintyPhrases: [
    ...DEFAULT_CERTAINTY_PHRASES,
    { phrase: 'clinically proven', reason: 'Implies a trial that did not happen.' },
    { phrase: 'walked by the editor', reason: 'Implies physical inspection that did not happen.' },
  ],
  certaintyRequiresTier: ['verified'], // which tiers can carry certainty language
  requireSourceRefForTiers: ['verified'], // which tiers must cite a sourceRef
});
```

Properly negated phrases are not flagged — `"these figures are not a
proprietary dataset"` passes clean, because the scanner checks a window
of text immediately before each match for a negation word (`not`,
`isn't`, `without`, `never`, …).

Each offense is structured, not a boolean:

```ts
interface ClaimOffense {
  claimId: string;
  claimText: string;
  phrase: string | null;
  reason: 'certainty_phrase_without_backing_tier' | 'missing_source_ref' | 'unknown_tier';
  message: string;
  tier: ProvenanceTier | string | null | undefined;
}
```

### 3. Render a badge, in any framework

```ts
import { provenanceBadgeText } from 'provenance-kit';

const definitions = {
  verified: {
    label: 'Verified',
    shortDescription: "Checked against the operator's published material.",
    criteria: 'A human checked this fact against a primary source.',
  },
  modeled: {
    label: 'Modeled estimate',
    shortDescription: 'An estimate from public signal — not a guarantee.',
    criteria: 'Derived from publicly observable patterns, not measured directly.',
  },
  editorial: {
    label: 'Editorial judgment',
    shortDescription: "The publication's opinion, not a measured fact.",
    criteria: 'Stated judgment, clearly marked as opinion, not fact.',
  },
};

provenanceBadgeText('modeled', definitions);
// => "Modeled estimate"

provenanceBadgeText('modeled', definitions, { includeShortDescription: true });
// => "Modeled estimate — An estimate from public signal — not a guarantee."
```

Use the returned string in a React `<span>`, a Vue template, a plain
`<div>` — the library has no rendering opinion at all.

### 4. Scaffold a methodology page

```ts
import { methodologyPageOutline } from 'provenance-kit';

const markdown = methodologyPageOutline(definitions, {
  productName: 'Acme Almanac',
});
```

Produces a Markdown skeleton with a `## The tiers` section filled in from
your definitions, plus `TODO`-marked sections for the parts that are
genuinely domain-specific (what your product doesn't do, your correction
log, your FAQ) — this library can't honestly know those for you.

## API surface

| Export | What it does |
|---|---|
| `ProvenanceTier` | `'verified' \| 'modeled' \| 'editorial'` |
| `PROVENANCE_TIERS` | The three tiers, in display order |
| `ProvenanceTierDefinition` | Caller-supplied `{ label, shortDescription, criteria }` |
| `ProvenanceTierDefinitions` | `Partial<Record<ProvenanceTier, ProvenanceTierDefinition>>` |
| `Claim` | `{ id, text, tier, sourceRef? }` |
| `DEFAULT_CERTAINTY_PHRASES` | Generic starter list of overclaiming phrases |
| `validateClaims(input, options?)` | Scans claims, returns `ClaimOffense[]` |
| `provenanceBadgeText(tier, definitions, options?)` | Pure badge-label lookup |
| `methodologyPageOutline(definitions, options?)` | Markdown methodology-page scaffold |

## Design notes

- **No UI dependency.** `provenanceBadgeText` and `methodologyPageOutline`
  return plain strings. Nothing here imports React, Vue, or any DOM API.
- **No hardcoded vocabulary.** Tier wording and the certainty-phrase list
  are both caller-supplied. What counts as "verified" or as overclaiming
  is a domain decision this library refuses to make for you.
- **Structured offenses, not booleans.** A CI check that only says "fail"
  is a worse CI check than one that says which claim, which phrase, and
  why. `validateClaims` always returns the full list.
- **Negation-aware.** "Not a proprietary dataset" is not the same claim
  as "proprietary dataset," and the scanner treats them differently.

## License

MIT
