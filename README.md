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

Or build from source: clone the repository and run `npm install && npm run build`.

No runtime dependencies. Ships TypeScript declarations. MIT licensed.

It is an ESM package (`"type": "module"`). `import` is the supported way to
load it. `require()` also works where Node can `require(esm)`:

| How you load it | Node 20.19+ | Node 22.12+ | Node 24 and 26 | Older Node 20 or 22 |
| --- | --- | --- | --- | --- |
| `import { validateClaims } from 'provenance-kit'` | works | works | works | works |
| `require('provenance-kit')` | works | works | works | fails (no `require(esm)`); use `import()` |

Recommended runtimes are Node 22 and 24 (LTS) and Node 26 (current). Node 20 is
end-of-life. CI still runs the tests and the installed-package probes on Node
20.19.0 and 22.12.0 (the `require(esm)` floors) to catch regressions, but that
is compatibility testing, not a recommendation. `engines` in `package.json` is
`>=20`.

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
proprietary dataset"` passes clean, because the scanner checks the text
immediately before each match, back to the start of its clause, for a
negation word (`not`, `isn't`, `without`, `never`, …). A clause boundary
(`, ; . : ! ?`, an em or en dash, or a line break) or the word `and` or `but`
between the negation and the phrase ends the negation, so `"These are not
guesses, they are independently verified."` and `"It is not a guess but a
verified dataset."` are flagged. The negation check can still hide a real
overclaim; see Honest limits.

Bad input throws instead of being skipped: a sparse claims array, a claim
that is not an object, an `id` or `text` that is not a string, or an option
of the wrong type all raise `TypeError` or `RangeError` before any claim is
scanned. A claim with a wrong `tier` is not an error; it is reported as an
`unknown_tier` offense.

Each offense is structured, not a boolean. `message` is safe to print: control
characters, line breaks and bidi formatting characters that came from caller
strings are shown as `\uXXXX` escapes. `claimId`, `claimText` and `phrase` are
returned exactly as given:

```ts
interface ClaimOffense {
  claimId: string;
  claimText: string;
  phrase: string | null;
  reason: 'certainty_phrase_without_backing_tier' | 'missing_source_ref' | 'unknown_tier';
  message: string;
  tier: ProvenanceTier | (string & {}) | null; // an unrecognized string is echoed; a non-string tier is null
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

Every export from `provenance-kit`, values and types:

| Export | What it does |
|---|---|
| `ProvenanceTier` | Type: `'verified' \| 'modeled' \| 'editorial'` |
| `PROVENANCE_TIERS` | Value: the three tiers, in display order. Frozen. |
| `ProvenanceTierDefinition` | Type: caller-supplied `{ label, shortDescription, criteria }` |
| `ProvenanceTierDefinitions` | Type: `Partial<Record<ProvenanceTier, ProvenanceTierDefinition>>` |
| `Claim` | Type: `{ id, text, tier, sourceRef? }` |
| `CertaintyPhraseRule` | Type: `{ phrase, reason? }` — one entry in a certainty-phrase list |
| `CertaintyPhraseInput` | Type: `string \| CertaintyPhraseRule` — what you may pass in `certaintyPhrases` |
| `DEFAULT_CERTAINTY_PHRASES` | Value: 11-entry generic starter list of overclaiming phrases. Frozen (including each entry). |
| `ClaimOffenseReason` | Type: `'certainty_phrase_without_backing_tier' \| 'missing_source_ref' \| 'unknown_tier'` |
| `ClaimOffense` | Type: one flagged problem — `{ claimId, claimText, phrase, reason, message, tier }` |
| `ClaimsInput` | Type: `Claim[] \| { text, extractClaims }` — what `validateClaims` accepts |
| `ValidateClaimsOptions` | Type: `{ certaintyPhrases?, certaintyRequiresTier?, requireSourceRefForTiers?, caseSensitive?, negationWindow? }` |
| `validateClaims(input, options?)` | Function: scans claims, returns `ClaimOffense[]`. Throws `TypeError` for malformed `input`, claims or options (including a hole in a sparse array and a non-string `id` or `text`), and `RangeError` for an out-of-range option. |
| `ProvenanceBadgeTextOptions` | Type: `{ includeShortDescription? }` |
| `provenanceBadgeText(tier, definitions, options?)` | Function: pure badge-label lookup. Throws `Error` if the tier has no own definition, `TypeError` for a non-string tier or a malformed definition, `RangeError` for a visibly blank label. |
| `MethodologyPageOutlineOptions` | Type: `{ title?, intro?, tiers?, productName? }` |
| `methodologyPageOutline(definitions, options?)` | Function: Markdown methodology-page scaffold. A missing tier definition becomes a `TODO` line, not a throw. `definitions` and `options` must be plain objects, `tiers` a dense array of strings (`TypeError` otherwise), and a visibly blank label is a `RangeError`. |

## When not to use this

- **You need to know if a claim is true.** `validateClaims` is a wording
  lint, not a fact-checker. It checks whether the LANGUAGE a claim uses
  matches its declared tier — it has no way to know whether a `verified`
  claim's `sourceRef` actually supports the claim, or whether the claim
  itself is correct. A human (or a separate process) still has to do the
  checking; this library only makes it loud when the wording and the tier
  disagree.
- **You need to track evidence over time.** This library has no concept of
  "last checked on" or evidence staleness — `sourceRef` is a single
  point-in-time string, not a record. If what you need is "does this claim
  have a link to evidence, and how long since it was reviewed," that's a
  different, complementary tool (see "Relationship to sibling kits" below).
- **You need semantic understanding.** The scanner matches phrases, not
  meaning. It cannot tell that "these numbers held up under scrutiny"
  makes the same claim as "verified" in different words, and it cannot
  tell that "not entirely unverified" is a hedge, not a clean negation.

## Honest limits

- **The certainty-phrase list is a starting point, not a taxonomy.**
  `DEFAULT_CERTAINTY_PHRASES` has 11 generic entries.
  It will not catch a phrase it doesn't know about (any of "confirmed
  accurate," "clinically proven," "audited," "third-party tested" — none
  of these are in the default list). Extend it for your product; a stale
  or narrow list is a false sense of coverage, not a lint.
- **Negation is a character window that stops at a clause boundary, not a
  parser, and it can hide a real overclaim.** The scanner looks at up to
  `negationWindow` characters (default 40) immediately before a match, cut off
  at the nearest `, ; . : ! ?`, em dash, en dash, line break, `and` or `but`,
  for a negation word. That fixes the classic false negative (`"These are not
  guesses, they are independently verified."` is flagged), but the cut is
  punctuation and two conjunctions, not grammar. It fails in both directions.

  False negatives (a real overclaim is NOT reported; this is the direction that
  matters for a lint). A negation word in the same clause still suppresses a
  phrase it does not govern. On a `modeled` claim each of these is missed:
  - `"Don't miss our independently verified rates."` and `"You can't beat our
    proprietary dataset."` (the negation belongs to a verb such as "miss" or
    "beat", not to the phrase);
  - `"Never overpay with our guaranteed lowest price."`, `"No signup needed for
    our proprietary dataset"`, `"No hidden fees guaranteed"` and `"There is no
    better proprietary database"` (a negation word with the phrase further on
    in the same clause);
  - `"Not estimated (verified)"`.

  These four used to be missed too and are now reported: `"No fees and
  guaranteed returns."` and `"It is not a guess but a verified dataset."` (`and`
  and `but` end a negation), `"Nothing but independently verified sources."` and
  `"Without question independently verified."` (idioms that assert what follows).
  `"No doubt"`, `"no question"`, `"no wonder"`, `"no one"`, `"not only"`, `"not
  just"`, `"not merely"` and `"not simply"` are special-cased the same way. The
  idiom list is short and is not an exhaustive list of English.

  False positives (noise: something negated is reported):
  - a comma or period inside a number counts as a boundary, so `"We do not
    have 1,000 fact-checked records"` is flagged;
  - a negation that governs a list is cut at the first comma, so `"We do not
    use guaranteed, verified, or proprietary datasets"` is flagged for the
    later items;
  - the same happens at `and`: `"We do not use guaranteed and verified
    datasets."` is flagged for "verified dataset". `or` and `nor` are not
    boundaries, so `"not guaranteed or independently verified"` is clean;
  - a claim hard-wrapped across lines (`"not\nverified"`) is cut at the line
    break; keep each claim on one line or unwrap it first.

  Narrowing `negationWindow` shrinks how far back a negation reaches inside a
  clause; `0` turns negation handling off, which reports every match and removes
  the false negatives above at the cost of flagging real negations. Review the
  negated phrases the scanner stays silent on if the wording matters to you.
- **The phrase-boundary rule is asymmetric on purpose.** A match must start
  on a word boundary (so "unverified dataset" does not match the phrase
  "verified dataset"), but the END of a match is never boundary-checked,
  so plural and inflected forms match ("guaranteed," "proprietary
  datasets"). This also means a phrase can match as a prefix of an
  unrelated longer word if that word happens to start right after a
  boundary — this is a deliberate trade-off toward fewer missed overclaims,
  not a guarantee of natural-language-aware matching.
- **Two default phrases overlap.** `"guarantee"` and `"guaranteed"` are
  both in `DEFAULT_CERTAINTY_PHRASES`; a sentence using "guaranteed" is
  reported twice (once per phrase), not once.
- **Rendering helpers do not escape their output.** `provenanceBadgeText`
  and `methodologyPageOutline` copy your tier definitions into their
  return value **verbatim** — no HTML escaping, no Markdown escaping. That
  is safe when you pass the result to a template that escapes on its own
  (a React/Vue text child, `textContent`), and it is safe when your tier
  definitions are hardcoded in your own source, as in every example above.
  It is NOT safe to concatenate the result directly into an HTML string,
  assign it to `innerHTML`, or render `methodologyPageOutline`'s Markdown
  with a renderer that passes through raw HTML, if a tier definition's
  text can come from anywhere a non-developer can edit it (a CMS field,
  for example). Escape or sanitize first in that case.
- **A clean result is not a verified claim, and an empty input is not a clean
  result.** `validateClaims([])`, or an extractor that finds nothing, returns
  `[]`, the same as claims that passed every check. If "no claims" should be an
  error in your pipeline, check the input length yourself. A claim labeled
  `verified` with any visible `sourceRef` string passes: the scanner does not
  open, fetch or judge the reference.
- **Empty phrases match nothing.** A `certaintyPhrases` entry that is empty
  after folding (an empty string, or only invisible characters) is ignored
  rather than treated as an error, so a blank row in a phrase list you load
  from a file quietly adds no rule.
- **Shape checks are shallow.** `validateClaims` checks that each claim is an
  object with a string `id` and `text` and a string, `null` or `undefined`
  `sourceRef`; it does not check that ids are unique or that `text` is a
  single sentence. Callback results are checked for type only (an
  `extractClaims` must return an array synchronously).

## Relationship to sibling kits

`claims-registry-kit` is a complementary, not overlapping, tool: it tracks
whether a public claim has a linked evidence reference and how long since
that reference was last reviewed (`{ text, evidenceRef, verifiedAt }`); it
never opens or checks the reference itself.
`provenance-kit` never stores a review date and has no concept of staleness
— it only checks, at a point in time, whether a claim's wording is stronger
than its declared tier allows. A product with both concerns (does this
claim have current evidence, AND does its wording overclaim relative to its
tier) would reasonably use both libraries side by side; neither replaces
the other.

[grounding-kit](https://github.com/lkopietz3-byte/grounding-kit) checks a
different question: whether each sentence of generated text carries a citation
marker that points at an entry in the evidence map you gave the model,
classifying it as `grounded`, `placeholder`, `ungrounded`, or `invalid`. It is a
mechanical, sentence-level check; it never decides whether the evidence is true
or whether the sentence follows from it. `provenance-kit` never looks at
evidence at all — it only checks whether a claim's certainty-implying wording
matches its declared tier. A pipeline producing AI-generated, tiered claims could
run `grounding-kit` first (does each sentence cite evidence you supplied) and
`provenance-kit` second (does its wording overclaim relative to its tier).

[corroboration-kit](https://github.com/lkopietz3-byte/corroboration-kit)
applies fixed rules to signals you collected and labeled, and returns a verdict
(`confirmed`, `likely`, `mixed`, `not-found`, `inconclusive`) bounded by the
coverage you declare. It trusts your labels, and a verdict grades those signals;
it is not independent verification. It does not know about provenance tiers,
and `provenance-kit` does not know about corroboration verdicts or signals; the
two are not integrated in code. A product could use a `corroboration-kit`
verdict as one input to the human decision of which `ProvenanceTier` a claim is
entitled to, not as a substitute for that decision.

## Design notes

- **No UI dependency.** `provenanceBadgeText` and `methodologyPageOutline`
  return plain strings. Nothing here imports React, Vue, or any DOM API.
- **No hardcoded vocabulary.** Tier wording and the certainty-phrase list
  are both caller-supplied. What counts as "verified" or as overclaiming
  is a domain decision this library refuses to make for you.
- **Structured offenses, not booleans.** A CI check that only says "fail"
  is a worse CI check than one that says which claim, which phrase, and
  why. `validateClaims` always returns the full list.
- **Negation-aware, within a clause.** "Not a proprietary dataset" is not the
  same claim as "proprietary dataset," and the scanner treats them differently;
  a negation in an earlier clause, or before an `and` or `but`, does not carry
  over.
- **Shared defaults are frozen.** `PROVENANCE_TIERS` and
  `DEFAULT_CERTAINTY_PHRASES` are module-level singletons, `Object.freeze`d
  (including each phrase entry) so one caller mutating them in place can't
  corrupt the default for every other call in the same process. Spread
  them into your own array to extend — `[...DEFAULT_CERTAINTY_PHRASES,
  ...yours]` — rather than pushing onto them directly.

## License

MIT
