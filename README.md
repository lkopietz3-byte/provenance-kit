# provenance-kit

Make "how confident are we in this claim" a structured, enforced,
machine-checkable data field — instead of an implicit copywriting choice
that quietly drifts as a site grows.

Zero runtime dependencies. Framework-agnostic. TypeScript, strict mode.

## The incident this pattern fixes

This library generalizes a pattern built for a real content site after a
real audit found the problem it fixes.

The site had accumulated, over months of normal editorial and AI-assisted
content work:

- **~150 false `(verified)` labels** attached to numbers nobody had
  actually checked against a primary source.
- **Fabricated precise-sounding sample sizes** ("800+ Member-submitted
  reports", "1,800 confirmed bids") for data that didn't exist at that
  scale, or at all.
- **Vague high-confidence language** — "reverse-engineered", "proprietary
  dataset" — describing numbers that were, in fact, estimates modeled
  from public signal.

None of this was one person deliberately lying. It was the ordinary
failure mode of a site that grows by copywriting convention: every
individual sentence sounded fine in isolation, "verified" is a word
people reach for casually, and nothing in the codebase made a false
confidence claim any harder to ship than a true one. The confidence level
of a claim lived nowhere except in the prose itself — there was no field
to check it against, so nothing could ever be wrong in a way a build
could catch.

The fix was to stop treating provenance as a copywriting convention and
make it a **first-class, enforced data field**: every claim carries one
of exactly three tiers, a public methodology page explains what each
tier means, and a scanner checks every claim against a list of
certainty-implying phrases and fails loudly when the language and the
tier don't match. That scanner is what `validateClaims` in this package
generalizes — the specific site, its banned-phrase list, and its page
inventory were all domain-specific and are deliberately **not** included
here. What's included is the mechanism: a typed claim shape, a
phrase-vs-tier scanner with negation handling, and the two rendering
helpers (badge text, methodology-page scaffold) every product using this
pattern ends up needing.

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
