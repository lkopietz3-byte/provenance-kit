# provenance-kit

**[Try it in your browser →](https://lkopietz3-byte.github.io/honesty-kits/#provenance-kit)** · Part of [honesty kits](https://github.com/lkopietz3-byte/honesty-kits), a family of small checks for the claims an AI product makes.

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
negation word (`not`, `isn't`, `without`, `never`, `no one`, `unable`, …). A
clause boundary (`, ; . : ! ?`, an em or en dash, or a line break) or the word
`and` or `but` between the negation and the phrase ends the negation, so
`"These are not guesses, they are independently verified."` and `"It is not a
guess but a verified dataset."` are flagged. A period or comma inside a number
or a known abbreviation (`99.9%`, `1,000`, `U.S.`, `Dr.`) is not a boundary,
and a negated list such as `"We make no representations, warranties or
guarantees"` stays negated. The negation check can still hide a real
overclaim; see Honest limits.

#### Strict mode for CI

Negation handling is a heuristic. It trades a few missed overclaims for far
fewer false alarms on honest disclaimers. On a 137-sentence stress set of real
marketing, help-center and legal copy (70 overclaims, 67 honest sentences) it
scores precision 0.815 and recall 0.757, versus 0.620 and 0.629 for 0.2.1.
A team that would rather review every certainty word can turn all of it off:

```ts
validateClaims(claims, { negationWindow: 0 });
```

`negationWindow: 0` disables every negation rule (the negation words, the
asserting idioms, negated lists and the longer reaches), so every occurrence of
every phrase is reported. A test checks this on every case in the verdict
table, honest and overclaiming alike.

Bad input throws instead of being skipped: a sparse claims array, a claim
that is not an object, an `id` or `text` that is not a string, an option of
the wrong type, or an unknown option key (a typo such as `certaintyPhrase`)
all raise `TypeError` or `RangeError` before any claim is scanned. A claim with a wrong `tier` is not an error; it is reported as an
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

## Copy gate

`validateClaims` checks claims you have already extracted and tiered. The copy
gate is the other half of a build-failing copy check: it scans the text you ship
(page files, strings, whatever your test reads) against a ledger of wording you
have banned or retracted, and checks that required statements are present. It
is a text lint. It never says a sentence is true, and a clean result only means
no rule matched.

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  DEFAULT_STRENGTH_RULES,
  assertCopyClean,
  plantedViolationsFail,
  type CopyRule,
} from 'provenance-kit';

const ledger: CopyRule[] = [
  {
    id: 'no-guaranteed-returns',
    kind: 'banned',
    pattern: 'guaranteed returns',
    reason: 'No return is guaranteed.',
    replacement: 'estimated returns',
  },
  {
    id: 'uptime-retracted',
    kind: 'retracted',
    pattern: /99\.99\s*% uptime/i,
    reason: 'Retracted: measured uptime was lower.',
    replacement: '99.9% uptime target',
    sample: 'We deliver 99.99% uptime.', // a RegExp rule needs a planted sample
  },
  ...DEFAULT_STRENGTH_RULES, // "verified", "proof", "atomic", "accuracy", ...
];

test('every rule catches its own planted sample', () => {
  expect(plantedViolationsFail(ledger).ok).toBe(true);
});

test('shipped copy has no banned or retracted wording', () => {
  const sources = ['index.html', 'pricing.html'].map((id) => ({
    id,
    text: readFileSync(`dist/${id}`, 'utf8'),
  }));
  // Throws a CopyGateError listing every offense (file:line:column, rule, reason,
  // replacement) and every missing statement, so the build fails.
  assertCopyClean(sources, ledger, {
    required: [{ id: 'disclaimer', phrase: 'Estimates are not guarantees' }],
    checkReference: [/\[\[check:[a-z0-9-]+\]\]/i, '/methodology'],
  });
});
```

`scanCopy(sources, rules, options?)` returns the same information without
throwing:

```ts
const { offenses, missing, sourcesScanned } = scanCopy(sources, ledger, options);
// offenses: [{ sourceId, ruleId, kind, line, column, match, reason, replacement }]
// missing:  [{ id, phrase, sourceIds }]   (sourceIds = the sources that lack it)
```

### Exact rules

- **Sources.** `[{ id, text }]`, read by you. The package never touches a file
  or the network. Ids must be unique. Each text is scanned on its own.
- **Folding.** Text and string patterns go through the same folding as
  `validateClaims`: NFKC, invisible and zero-width characters removed, curly
  apostrophes straightened, the fixed list of Cyrillic and Greek look-alike
  letters read as Latin inside Latin words, whitespace runs (and line breaks)
  read as one space, a hyphen or en dash between two letters or digits read as
  a space, and case folded unless `caseSensitive`. So `ｇｕａｒａｎｔｅｅｄ`, `gu\u0430ranteed`,
  `guaran\u200bteed`, NFD text and `guaranteed\nreturns` all match `guaranteed returns`.
- **String patterns** match from a word boundary on the left; the end is not
  checked, so `guarantee` also matches `guarantees` and `guaranteed`. They are
  matched in linear time. A blank pattern throws; it would match nothing.
- **RegExp patterns** are cloned (your regex is never run and its `lastIndex`
  is never touched), made global and non-sticky, and run on the folded text with
  case kept, so write the `i` flag yourself. In that text every whitespace run,
  line breaks included, is one space, `\u2010` to `\u2012` and an en dash between
  letters read as `-`, and `^` and `$` mean the start and end of the whole
  source. Empty matches are skipped and the scan steps past them by one code
  point under `u` and `v`, so it always ends. A pattern that backtracks
  catastrophically will hang the scan; that is your responsibility, as it is
  with any regex.
- **Positions.** `line` and `column` are 1-based and describe the START of the
  match in your original text. Lines end at LF, CRLF or CR. `column` counts
  Unicode code points, so an emoji is one column and a combining mark is its own.
  `match` is the original text, including any hidden or look-alike characters.
  Offenses come in source order, then position, then rule order. Two rules that
  match the same words each report.
- **Negated use** (`exemptNegated`, default `true`) is decided by the same
  clause-bounded negation logic as `validateClaims`: a cue such as `not`,
  `never`, `no`, `cannot` or `without` earlier in the same clause, within
  `negationWindow` characters (default 40), and not across `and`, `but` or a
  clause boundary. Strict scanning is the default: the two longer reaches
  `validateClaims` has (a negated comma list, and a phrase right after "as",
  "any", "or", "nor", "be" or "been") are off unless you pass
  `extendedNegation: true`, and `negationWindow: 0` turns the exemption off, so
  every match is an offense.
- **Quoted use** (`exemptQuoted`, default `true`) is a mention, not a use. A
  match is exempt only when ALL of these hold: it sits inside one pair of
  quotation marks on one line (straight `"` paired by parity, or the curly,
  German, guillemet and corner-bracket pairs; single quotes and backticks are
  not quotation marks here); the quotation starts with the phrase (only
  punctuation before it, and at most 32 characters after it); the quotation
  reads as a list entry or a named word (it starts the line, follows a colon,
  comma or similar mark, follows a word such as "phrase" or "banned", or is the
  second item after "and" or "or"); and the same line contains a word that says
  the line is about words (`word`, `term`, `phrase`, `label`, `wording`,
  `avoid`, `banned`, `retired`, `retracted`, `prohibited`, `forbidden`). A
  quotation that does not fit, including `Join our "guaranteed returns" plan`
  and `He said "we got guaranteed returns"`, stays an offense.
- **Strength words** (`kind: 'strength'`) are wording about how well something
  was checked. Each match is an offense unless a check reference
  (`options.checkReference`: a phrase, a `RegExp` such as a methodology link or a
  `[[check:id]]` token, or an array of them) appears within `checkWindow`
  characters (default 120) before or after it. With no `checkReference`
  configured, every strength match is an offense. `DEFAULT_STRENGTH_RULES` holds
  `verified`, `proof`, `proven`, `atomic`, `accuracy`, `accurate`, `audited`,
  `certified`, `validated`, `deterministic` and `exact`; it is a starter list.
  Extend it by spreading: `[...DEFAULT_STRENGTH_RULES, myRule]`. A string
  pattern matches by prefix, so `proof` also matches `proofread`; use a
  `RegExp` such as `/\bproof\b/i` for a hard end.
- **Required statements** (`options.required`, `[{ id, phrase, sourceIds? }]`)
  must appear in every source, or in the listed `sourceIds` only. The phrase is
  folded like a string pattern. Presence is all that is checked: the statement
  may be negated or quoted and still counts. A scoped id that is not among the
  sources scanned is reported as missing.
- **Errors.** Bad `sources`, `rules` or `options` throw `TypeError` or
  `RangeError` before anything is scanned: a hole in an array, an unknown key (a
  typo such as `exemptNegate`), a duplicate id, a blank id, reason, pattern or
  required phrase, a wrong `kind`, a value that is not a real `RegExp`. Caller
  values are read once and copied.
- **Self-test.** `plantedViolationsFail(rules, options?)` plants each rule's
  `sample` (a string pattern plants itself) in its own text and reports which
  rules did not catch it. A rule with no way to plant is reported as unproven,
  not as passing. It uses the same options, so a negation window or a check
  reference that blinds a rule shows up.

### Copy gate limits

- **Text only.** It reads the text you pass. It does not read markup (an
  entity such as `&nbsp;` or a tag inside a phrase hides it; strip and decode
  first), images, PDFs or rendered pages, and it never decides that a sentence
  is true or false. A clean result is not an honest page.
- **English negation only.** The negation cues are the English ones
  `validateClaims` has. A Spanish `nunca` or `sin` is not a cue, so honest
  Spanish disclaimers are reported (a false offense, which is the safe
  direction). Look-alike folding covers a fixed list of Cyrillic and Greek
  letters only.
- **Negation can still hide a real claim**, as in `validateClaims`: `Don't miss
  our guaranteed returns` and `We are not afraid to offer guaranteed returns`
  pass, because the negation word sits in the same clause. Review rules that
  matter with `negationWindow: 0`, or set `exemptNegated: false` on them.
- **The quoted exemption can be fooled** by a line that talks about words and
  also uses the phrase in quotation marks as a slogan (`Our terms: "guarantee"`).
  Set `exemptQuoted: false` on a rule where that matters.
- **Known misses.** A word hyphenated at a line break (`risk-\nfree`) is not
  rejoined; a zero-width space between two words glues them (`guaranteed\u200breturns`
  reads as `guaranteedreturns`, because the same removal finds `guaran\u200bteed`);
  letters spaced out (`g u a r a n t e e d`) and phrases reworded
  (`returns we promise`) are not seen.
- **Known false offenses.** An unquoted glossary of banned words, a quotation
  after a verb the gate does not know (`we removed "99.99% uptime"`), single
  quotes, backticks, and a negation in another language are reported.
- **No output limits.** There is no cap on offenses per source, and an empty
  `sources` array returns an empty result (`sourcesScanned` is `0`, so you can
  fail on that yourself).

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
| `validateClaims(input, options?)` | Function: scans claims, returns `ClaimOffense[]`. Throws `TypeError` for malformed `input`, claims or options (including a hole in a sparse array, a non-string `id` or `text`, and an unknown option key), and `RangeError` for an out-of-range option. |
| `CopyRule`, `CopyRuleKind` | Types: one ledger entry `{ id, pattern, reason, replacement?, kind, exemptNegated?, exemptQuoted?, sample? }` and its kind, `'banned' \| 'retracted' \| 'strength'` |
| `CopySource`, `RequiredStatement`, `ScanCopyOptions` | Types: `{ id, text }`; `{ id, phrase, sourceIds? }`; `{ required?, checkReference?, checkWindow?, caseSensitive?, negationWindow?, extendedNegation? }` |
| `CopyOffense`, `MissingStatement`, `CopyScanResult` | Types: `{ sourceId, ruleId, kind, line, column, match, reason, replacement }`; `{ id, phrase, sourceIds }`; `{ offenses, missing, sourcesScanned }` |
| `DEFAULT_STRENGTH_RULES` | Value: 11 starter strength-word rules. Frozen (including each entry). |
| `scanCopy(sources, rules, options?)` | Function: the copy gate, returns `CopyScanResult`. Throws `TypeError` or `RangeError` for malformed input. |
| `assertCopyClean(sources, rules, options?)` | Function: like `scanCopy`, but throws `CopyGateError` when there is any offense or missing statement. |
| `CopyGateError` | Value: `Error` subclass thrown by `assertCopyClean`, with `offenses` and `missing`. |
| `PlantedViolationReport`, `PlantedViolationResult` | Types: `{ ok, results }` and `{ ruleId, planted, caught }` |
| `plantedViolationsFail(rules, options?)` | Function: plants each rule's sample and reports which rules miss it. |
| `ProvenanceBadgeTextOptions` | Type: `{ includeShortDescription? }` |
| `provenanceBadgeText(tier, definitions, options?)` | Function: pure badge-label lookup. Throws `Error` if the tier has no own definition, `TypeError` for a non-string tier, a malformed definition or an unknown option key, `RangeError` for a visibly blank label. |
| `MethodologyPageOutlineOptions` | Type: `{ title?, intro?, tiers?, productName? }` |
| `methodologyPageOutline(definitions, options?)` | Function: Markdown methodology-page scaffold. A missing tier definition becomes a `TODO` line, not a throw. `definitions` and `options` must be plain objects with known keys, `tiers` a dense array of strings (`TypeError` otherwise), and a visibly blank label, `title`, `intro` or `productName` is a `RangeError`. |

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
  accurate," "clinically proven," "audited," "third-party tested," "100
  percent accurate": none of these are in the default list). Extend it for
  your product; a stale or narrow list is a false sense of coverage, not a
  lint. Plain `"verified"`, `"audited"`, `"proven"` and `"100 percent
  accurate"` were left out of the default on purpose: a bare `"verified"` would
  report a second offense next to every `"independently verified"` and
  `"verified dataset"` and flag account-status copy such as "Email verified";
  `"proven"` would match the start of "provenance" (the end of a match is not
  boundary-checked, see below); `"audited"` and `"100 percent accurate"` are
  reasonable additions for most products, so add them with your own list.
- **Negation is a character window that stops at a clause boundary, not a
  parser, and it can hide a real overclaim.** The scanner looks at up to
  `negationWindow` characters (default 40) immediately before a match, cut off
  at the nearest `, ; . : ! ?`, em dash, en dash, line break, `and` or `but`,
  for a negation word. A period or comma inside a number or a known
  abbreviation (`99.9%`, `1,000`, `U.S.`, `Dr.`, `etc.` mid-sentence) is not a
  boundary, with three exceptions: `e.g.` and `i.e.` always are; an
  abbreviation followed (past any closing quote or bracket) by a space and
  then a capital letter, a digit or any opening quote or bracket is; and a negation never reaches past a number written with a
  separator that sits right before the phrase (`"No fees on your first $5,000
  guaranteed."` is flagged). Two narrow cases reach further back, up to 500
  characters but never past a boundary, `and`, `but` or one of `because`,
  `since`, `when`, `whenever`, `while`, `whereas`, `if`, `unless`, `until`,
  `so`, `thanks to`, `with`, `which`, `who`, `whom`, `whose`, `where`, `after`,
  `before`, `as soon as` or `that`:
  - a phrase right after `as`, `any`, `or`, `nor`, `be` or `been` (`"These
    projections have not been reviewed by any outside firm or independently
    verified."`); `a` and `an` do not get this reach, because marketing copy
    puts the phrase there after an unrelated negation (`"Never worry about a
    missed payment again thanks to autopay backed by a guarantee."`);
  - a negated comma list with at most one word, then `or` or `nor`, then
    optionally `a`, `an` or `any` before the phrase (`"We do not warrant that
    the service will be uninterrupted, error-free, or guaranteed"`). An
    imperative opener (`Never`, `Don't`, `Do not`, also after an opening quote
    or bracket or after `please`, `just`, `so`, `now` or `hey`) never heads such
    a list, so
    `"Don't wait, apply today or the guaranteed rate expires."` is flagged, and
    the same subordinating words end a negation's hold on the list (`"No setup
    required because each plan includes support, updates, or guaranteed
    returns."` is flagged). The one exception is `that` right after a
    disclaimer verb such as `warrant`, `represent` or `claim`, which carries
    the negation into the list; a relative `that` clause does not (`"No signup
    needed for plans that include support, updates, or guaranteed returns."` is
    flagged).

  That fixes the classic false negative (`"These are not guesses, they are
  independently verified."` is flagged), but the cut is punctuation, a few
  conjunctions and a few word lists, not grammar. It fails in both directions.

  The word lists are small, explicit and English-only. A multiword cue or idiom
  also matches with hyphens for its spaces (`"far-from-guaranteed"`,
  `"not-just"`):
  - strong negations (`not`, `never`, `no`, `none`, `nothing`, `nor`,
    `neither`, `without`, `hardly`, `barely`, `far from`, `cannot` and the
    contractions `isn't`, `wasn't`, `aren't`, `weren't`, `doesn't`, `don't`,
    `didn't`, `can't`, `couldn't`, `won't`, `wouldn't`, `shouldn't`, `hasn't`,
    `haven't`, `hadn't`, `mustn't`, `needn't`, `shan't`, `mightn't` and
    `oughtn't`) reach any phrase in the window. `ain't` is not on the list:
    `"If it ain't guaranteed we don't sell it."` asserts the guarantee;
  - `zero`, `lack`, `lacks` and `lacking` negate only a phrase that follows
    directly after a space (`"Zero guarantees apply."`, `"This tool lacks
    independently verified data."`). `"Zero downtime guaranteed."`, `"Other
    apps lack a proprietary dataset like ours."` and `"Our error rate is zero
    (guaranteed)."` are flagged. No cue other than a strong negation reaches
    across punctuation, parentheses or quotes;
  - `unable` reaches only across `to`, `be`, `been`, `being`, `fully`,
    `currently`, `yet`, `ever`, `always` or `legally` (`"unable to
    guarantee"`), so `"Big banks are unable to match our guaranteed savings
    rate."` is flagged;
  - `instead of` and `rather than` reach only across `a`, `an`, `any`, `be` or
    `being` (`"rather than a guarantee"`), so `"Get answers rather than guesses
    with our guarantee."` is flagged;
  - `no one` and `nobody` negate a phrase only across auxiliary words (`"No one
    can guarantee"`, `"Nobody has independently verified"`), not across a main
    verb (`"No one disputes this independently verified figure"` is flagged);
  - `non-`, `un-`, `no-` or `zero-` negates only when attached to the phrase
    itself (`"non-guaranteed"`, `"no-guarantee"`; `"Non-stop guaranteed
    support"` and `"No-risk guaranteed trial"` are flagged).

  False negatives (a real overclaim is NOT reported; this is the direction that
  matters for a lint). A negation word in the same clause still suppresses a
  phrase it does not govern. On a `modeled` claim each of these is missed:
  - `"Don't miss our independently verified rates."`, `"You can't beat our
    proprietary dataset."`, `"Other tools cannot match our guaranteed
    rates."`, `"Never miss a guaranteed fare drop."`, `"You can't go wrong with
    a guaranteed rate."` and `"Don't settle for less than a guaranteed rate."`
    (the negation belongs to a verb, not to the phrase);
  - `"Never overpay with our guaranteed lowest price."`, `"No signup needed for
    our proprietary dataset"`, `"No more guesswork with guaranteed fares."`,
    `"No hidden fees guaranteed"`, `"There is no better proprietary database"`
    and `"Rivals lack independently verified data."` (a negation word with the
    phrase further on in the same clause);
  - `"Skip the guesswork, not the guarantee."` and rhetorical questions such as
    `"Who wouldn't want a guaranteed return on their savings?"`;
  - `"Not estimated (verified)"`.

  These used to be missed and are now reported: `"No fees and guaranteed
  returns."` and `"It is not a guess but a verified dataset."` (`and` and `but`
  end a negation), and a set of idioms that contain a negation word but assert
  what follows: `"no doubt"`, `"no question"`, `"no wonder"`, `"nothing but"`,
  `"without question"`, `"without (a) doubt"`, `"not only"`, `"not just"`,
  `"not merely"`, `"not simply"`, `"nothing (else) beats / compares / comes
  close / tops / matches / rivals"`, `"no other"` followed by another word,
  `"(there is) no denying"`, `"not to mention"`, `"why not"`, `"not once has"`
  and hyphenated `"no-"` or `"zero-"` compounds on another word (`"No-risk
  guaranteed trial"`). The idiom list is short and is not an exhaustive list of
  English.

  False positives (noise: something negated is reported):
  - a negation over a list is cut at a comma that is not followed by the list
    shape above, so `"This is not a fact-checked, independently-verified
    dataset."` and `"Do not use guaranteed, verified, or proprietary
    datasets."` (an imperative) are flagged;
  - the same happens at `and`: `"We do not use guaranteed and verified
    datasets."` is flagged for "verified dataset". `or` and `nor` are not
    boundaries, so `"not guaranteed or independently verified"` is clean;
  - a phrase more than 40 characters after its negation that is not right after
    one of the reach words is flagged: `"We are not saying that any of these
    numbers come with a guarantee."` and `"Not a single one of the figures in
    this whole table is in any way guaranteed."`;
  - the narrow cues above flag honest copy that falls outside their gap lists:
    `"This estimate lacks a guarantee."`, `"There is zero chance of a guaranteed
    payout."`, `"Results ain't guaranteed."`, `"No representation is made that
    the estimates shown are guaranteed."`, `"No one at our company has
    independently verified the reviews."`, and `"We dont guarantee approval."`
    (no apostrophe);
  - a number written with a separator right before the phrase blocks the
    negation: `"We do not have 1,000 fact-checked records."` is flagged;
  - `e.g.`, `i.e.`, an abbreviation the scanner does not know, and one that is
    followed by a capital letter or a digit all count as a boundary;
  - a claim hard-wrapped across lines (`"not\nverified"`) is cut at the line
    break; keep each claim on one line or unwrap it first.

  Narrowing `negationWindow` shrinks how far back a negation reaches inside a
  clause; `0` turns negation handling off (including both longer reaches),
  which reports every match and removes the false negatives above at the cost
  of flagging real negations. Review the negated phrases the scanner stays
  silent on if the wording matters to you.
- **Look-alike letters are folded from a fixed list only.** 33 Cyrillic and 22
  Greek letters that look like Latin letters (for example Cyrillic a, e, o, p
  and c, and Greek omicron) are read as Latin, but only inside a word that also
  contains an ASCII Latin letter, so `"gu\u0430ranteed"` is caught
  and ordinary Cyrillic or Greek words are untouched. The full list is in
  `src/validate.ts` (`CONFUSABLE_TO_LATIN`). Look-alikes from other scripts, and
  a word written entirely in look-alike letters, are not folded.
- **Markup is not stripped.** The scanner reads plain text. A tag or entity
  inside a phrase (`"<b>guarant</b>eed"`, `"independently&nbsp;verified"`) hides
  it; strip markup and decode entities before scanning.
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
- **Empty phrases match nothing.** Each `certaintyPhrases` entry is trimmed
  after folding, so a trailing space, CR or LF from a file does not stop it
  matching. An entry that is empty after that (an empty string, or only
  whitespace or invisible characters) is ignored rather than treated as an
  error, so a blank row in a phrase list you load from a file quietly adds no
  rule.
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
