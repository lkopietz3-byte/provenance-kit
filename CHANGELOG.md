# Changelog

All notable changes to this project are documented in this file. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Fixes from a verdict hunt on real marketing, help-center, legal and pricing
copy. The `validateClaims` exports and the shape of `ClaimOffense` are unchanged. Some inputs
that used to be accepted now throw, and some verdicts change in both
directions; see Changed.

### Added

- **Copy gate.** `scanCopy(sources, rules, options?)` scans text you already
  read (pages, strings, files) against a ledger of `banned`, `retracted` and
  `strength` rules and checks that required statements are present. Offenses
  carry the source id, rule id, kind, 1-based line and column (in code points)
  in the original text, the matched text, the reason and the replacement.
  `missing` lists, per required statement, the sources that lack it. Text is
  folded like `validateClaims` text (NFKC, invisible characters, look-alike
  letters, case, hyphens, line breaks). A match that is negated in its own
  clause or is the whole content of a quoted mention is exempt unless the rule
  turns that off. Strength words need a check reference nearby or they are
  offenses. The default is strict: only the short negation reach is used (the
  two longer reaches are opt-in with `extendedNegation`), and `negationWindow:
  0` turns the negation exemption off.
- Positions stay accurate where NFKC composes across characters (a half-width kana and its voiced mark): the composed span maps to its own start and end. Case folding in the gate does not depend on neighbors: a Greek final sigma reads as sigma in patterns and text. `validateClaims` keeps the native lower-casing, so it still treats final sigma by context.
- Conjoining Hangul jamo start their own cluster and merge with the one before only where NFKC composes them, so NFD syllables after a line break or after each other keep their own line, column and span. `assertCopyClean` formats only the entries it lists.
- `DEFAULT_STRENGTH_RULES` (frozen starter list: accurate, audited, certified, proven, each a whole word), `OPTIONAL_STRENGTH_RULES` (verified, accuracy), `assertCopyClean(...)` (throws `CopyGateError` listing every offense, for tests and CI) and `plantedViolationsFail(rules)` (plants each rule's own sample and reports the rules that miss it). The starter list was re-derived from a field trial on 863 public marketing, pricing and docs pages: the eleven words first drafted (verified, proof, proven, atomic, accuracy, accurate, audited, certified, validated, deterministic, exact) gave 472 distinct hits of which roughly one in three were real claims; `exact` was 0 of 139, `deterministic` 0 of 6, `validated` 0 of 6, `atomic` 0 of 1 and `proof` 6 of 21, so they are gone, and `verified` (3 of 21) and `accuracy` moved to the opt-in list. The four kept words gave 73 distinct hits, 56 real (single reviewer).
- The `proven` starter rule now exempts only verb uses after a form of "have" ("has proven useful", "have proven to be", "has proven that"); "have proven results" and "has proven security" are reported. `copyBaselineKey` returns a JSON array of source id, rule id and line text, so ids that contain a separator cannot collide; the format is stable. The README text extractor now blanks Markdown link delimiters in place (labels keep their column), decodes numeric and named entities with a `locate(line, column)` map back to the file, and keeps HTML or JSX `href` values when `keepLinkTargets` is on (a real `href` attribute only, not `data-href` or text inside another attribute's value, and including `href={`/trust`}`). The recipe walks tags, code fences and comments with small scanners (a tag that does not close within 4,096 characters is text) and bounds its link patterns, so its cost is linear on hostile documents; a scaling test runs it on 20k and 80k characters of unterminated openings.
- `wholeWord: true` on a rule requires a word boundary after a string pattern (`proven` skips `provenance`, `#1` skips `#123`). Off by default.
- Adoption helpers: `options.baseline` with `copyBaselineKey(offense)` hides accepted offenses by source, rule and line text and reports `suppressed` and `staleBaseline`; each offense carries `context` (its line of text); an unknown rule key now says which keys exist.
- README: the copy gate guide comes first; the opening states the positioning (a ledger-driven regression gate for wording you already know you do not want); added a worked compliance-claims-need-an-evidence-link ledger, a length-preserving Markdown/MDX/HTML text extractor, a baseline recipe, and the measured precision of the starter words. Both worked examples run in `test/readme-examples.test.ts`.
- New exports: `scanCopy`, `assertCopyClean`, `plantedViolationsFail`,
  `CopyGateError`, `DEFAULT_STRENGTH_RULES`, `OPTIONAL_STRENGTH_RULES`,
  `copyBaselineKey`, and the types `CopyRule`,
  `CopyRuleKind`, `CopySource`, `RequiredStatement`, `ScanCopyOptions`,
  `CopyOffense`, `MissingStatement`, `CopyScanResult`,
  `PlantedViolationResult` and `PlantedViolationReport`.
- `validateClaims` is unchanged. Internally, `src/validate.ts` now exports its
  folding and negation helpers to the gate (not part of the public API), and
  `isNegated` takes an optional `extendedReach` argument that defaults to the
  old behavior.

### Fixed

- **"No one" and "nobody" negate again.** `"No one can guarantee future
  results."` and `"Nobody has independently verified these figures."` are no
  longer reported. They negate only across auxiliary words, so `"No one
  disputes this independently verified figure."` is still reported.
- **More negation cues, each with a narrow reach.** `zero`, `lack`, `lacks` and
  `lacking` negate a phrase that follows directly; `unable` reaches only across
  `to`, `be` and a few adverbs; `instead of` and `rather than` only across `a`,
  `an`, `any`, `be` or `being`. `mustn't`, `needn't`, `shan't`, `mightn't` and
  `oughtn't` join the listed contractions, and a `non-`, `un-`, `no-` or
  `zero-` prefix attached to the phrase (`"non-guaranteed"`) negates.
  `"Zero downtime guaranteed."`, `"Big banks are unable to match our
  guaranteed savings rate."`, `"Non-stop guaranteed support"` and `"If it
  ain't guaranteed we don't sell it."` are still reported (`ain't` is not a
  cue).
- **Imperatives, quotes and parentheses.** An imperative list head is still
  recognized after an opening quote or bracket or after `please`, `just`,
  `so`, `now` or `hey`; any opening quote or bracket after an abbreviation's
  period and a space starts a new sentence; and cues other than strong
  negations never reach across punctuation, so `"Please don't miss our deals on
  flights, hotels, or guaranteed rentals."`, `"Not available in the U.S.
  \u201cguaranteed returns\u201d is our slogan."` and `"Our error rate is zero
  (guaranteed)."` are reported.
- **Scope words inside idioms and relative clauses.** The `but` in `nothing
  but` still ends an earlier negation's scope, and a relative `that` clause
  after an unrelated negation does not inherit it: `"No fees with nothing but
  guaranteed returns."` and `"No signup needed for plans that include support,
  updates, or guaranteed returns."` are reported. `"We do not warrant that the
  service will be uninterrupted, error-free, or guaranteed."` stays negated.
- **Hyphenated multiword cues and idioms.** `"far-from-guaranteed"` negates,
  and `"Not-just guaranteed returns."` and `"Without-question guaranteed
  returns."` are reported, as their spaced forms are.
- **Idioms that assert what follows are reported.** `"Nothing beats ..."`,
  `"Nothing compares ..."`, `"No other tool gives ..."`, `"Without (a) doubt
  ..."`, `"There is no denying ..."`, `"Not to mention ..."`, `"Why not ..."`,
  `"Not once has ..."` and hyphenated `"no-"` / `"zero-"` compounds (`"No-risk
  guaranteed trial"`) no longer hide a phrase. `"No other guarantee applies"`
  and `"no-guarantee estimates"` stay negated.
- **Clause boundaries skip numbers and abbreviations.** A period or comma inside
  a number (`99.9%`, `1,000`) or a known abbreviation (`U.S.`, `Dr.`, `etc.`
  mid-sentence) no longer ends a negation. `e.g.` and `i.e.` still do; so does
  an abbreviation followed, past any closing quote or bracket, by a capital
  letter, a digit or an opening quote or bracket (`"We are not in the U.S. Our data is independently verified."` is
  reported). A negation never reaches past a separated number right before the
  phrase (`"No fees on your first $5,000 guaranteed."` is reported).
- **Negated lists.** `"We make no representations, warranties or guarantees of
  any kind."` and `"We do not use guaranteed, verified, or proprietary
  datasets."` no longer report the later items when the negation is not an
  imperative. Only a tail of at most one word, `or` / `nor` and optionally `a`,
  `an` or `any` counts, and an imperative (`Never`, `Don't`, `Do not`) never
  heads a list, nor does a negation separated from the list by a subordinating
  word: `"No fees, no contracts and guaranteed returns."`, `"Don't wait, apply
  today or the guaranteed rate expires."` and `"No setup required because each
  plan includes support, updates, or guaranteed returns."` are still reported.
- **Long disclaimers in one clause.** A phrase right after `as`, `any`, `or`,
  `nor`, `be` or `been` is reached by a strong negation anywhere earlier in its
  clause, up to 500 characters back, unless a subordinating word (`because`,
  `since`, `when`, `thanks to`, `with`, `that`, ...) sits between (`"These
  projections have not been reviewed by any outside firm or independently
  verified."`). Other positions keep the 40-character default, so `"No credit
  card required to start your free trial of our independently verified rate
  tracker."` is still reported.
- **Look-alike letters.** 33 Cyrillic and 22 Greek letters that look like Latin
  letters are read as Latin inside words that also contain ASCII Latin letters,
  so `"gu\u0430ranteed"` (Cyrillic a) is reported.
- **Phrases are trimmed.** A `certaintyPhrases` entry with a trailing space, CR
  or LF now matches at the end of a text, and an entry of only whitespace
  matches nothing instead of flagging every claim with a space in it.

### Changed

- **Unknown option keys throw `TypeError`.** `validateClaims`,
  `provenanceBadgeText` and `methodologyPageOutline` reject an own, enumerable
  option key they do not know (`certaintyPhrase`, `negationwindow`), instead of
  ignoring it. Callers who pass a larger config object straight through as
  options will see a throw.
- **Blank methodology strings throw `RangeError`.** A visibly blank `title`,
  `intro` or `productName` in `methodologyPageOutline` used to render an empty
  heading or a sentence with a hole in it.
- **Verdicts change in both directions.** Copy with the negations above is
  reported less often; copy with the asserting idioms, look-alike letters or
  `no-` / `zero-` compounds is reported more often. Rerun your claim suite and
  review the difference before upgrading.

### Documented

- A "Strict mode for CI" note in the README: the measured trade-off (precision
  0.815 and recall 0.757 on a 137-sentence stress set, versus 0.620 and 0.629
  for 0.2.1) and `negationWindow: 0`, which turns every negation rule off. A
  test checks that strict mode reports every phrase occurrence in every
  verdict-table case.
- The README's Honest limits list the new word lists, the two longer reaches
  and their 500-character cap, the overclaims still missed (including `"No more
  guesswork with guaranteed fares."` and `"Rivals lack independently verified
  data."`), the noise still reported (a comma list without `or`, `"in any way
  guaranteed"` far from its negation), that negation words are English only,
  that markup is not stripped, and the exact look-alike letter list.
- Plain `"verified"`, `"audited"`, `"proven"` and `"100 percent accurate"` stay
  out of `DEFAULT_CERTAINTY_PHRASES`, with the reason for each.
- `test/verdict-table.test.ts` pins one case per hunt finding plus guard cases on
  both sides, every overclaim from a second review that 0.2.1 reported (all
  still reported), the misses and noise that are wrong in both builds, and two
  CPU-time bounds for long single-clause input.
- Negation lookups use one index per claim, so a long clause with many matches
  costs about what 0.2.1 did.

## [0.2.1] - 2026-10-07

No change to the library's behavior or API.

### Changed

- The README links to the [in-browser playground](https://lkopietz3-byte.github.io/honesty-kits/#provenance-kit) and the honesty kits family, and the npm homepage now points to the playground.
- Added the `honesty-kits` npm keyword so the family shows up together in search.

### Security

- Development lockfile: `source-map-js` 1.2.2 (GHSA-68fv-2mgg-jv7q). Development tooling only; the published package has no runtime dependencies.

## [0.2.0] - 2026-09-29

Minor release: some inputs that used to be accepted now throw or give a
different result, and some text that used to slip through is now reported. The
exports and the shape of `ClaimOffense` are unchanged.

### Fixed (breaking)

- **Negation is clause-bounded (PVK-F-003).** A negation word used to suppress a
  certainty phrase anywhere in the 40-character window, so `"These are not
  guesses, they are independently verified."` reported nothing. A negation now
  reaches a phrase only when no clause boundary (`, ; . : ! ?`, an em or en
  dash, or a line break) sits between them, still inside `negationWindow`.
  `"This is not verified."` and `"We don't claim it is verified"` are still
  suppressed. The rule is not a parser and fails both ways; see the README's
  Honest limits for the noisy cases (commas inside numbers, a negated list,
  hard-wrapped claims) and for the overclaims it still misses (a negation that
  belongs to another word in the same clause, such as `"Don't miss our
  independently verified rates."`). A line break still reads as a space for
  matching, so a phrase wrapped across lines is still found.
- **`and` and `but` also end a negation; `nothing but` and `without question`
  do not negate.** A negation used to hide a real phrase in another coordinated
  part of the same clause. `"No fees and guaranteed returns."`, `"It is not a
  guess but a verified dataset."`, `"Nothing but independently verified
  sources."` and `"Without question independently verified."` are now
  reported on a `modeled` claim. Cost: a negation over a coordinated list is cut
  at `and` (`"We do not use guaranteed and verified datasets."` reports
  "verified dataset"); `or` and `nor` are not boundaries. The README's Honest
  limits names the overclaims that are still missed.
- **An en dash between two letters reads like a hyphen.** `"fact\u2013checked"`
  and `"independently\u2013verified"` now match `fact-checked` and
  `independently verified`; before, only ASCII hyphens and U+2010 to U+2012 did.
  An en dash with a space or punctuation next to it is unchanged, and an
  unspaced en dash still ends a negation.
- **Word boundaries use whole code points (PVK-F-002).** The left boundary
  looked at one UTF-16 code unit, so a letter or digit outside the Basic
  Multilingual Plane never counted, and `"\u{10400}verified dataset"` matched.
  The code point before the match, and the first code point of the phrase, now
  decide it.
- **Invisible characters no longer hide a phrase.** The characters removed
  before matching are now every `Default_Ignorable_Code_Point`, including the
  bidi isolates U+2066 to U+2069 and U+061C that the old hand-written list
  missed (`"independently\u2066 verified"` used to evade the scan).
- **A negation window that starts inside a word no longer reads the tail of it
  as a negation.** Cutting the window at a fixed offset could leave `no` (from
  "casino") or `not` (from "knot") at its start, which matched as a negation and
  hid an overclaim. A word that is only partly inside the window is now dropped,
  like any other word that does not fit.
- **A rejected boundary candidate no longer hides a valid one.** The scan
  resumed after the full length of a rejected match, which could skip a valid
  overlapping match that starts after punctuation.
- **A sparse claims array is rejected, not crashed on.** `validateClaims`
  validated with `.map`-style skipping and then processed with `for...of`, so a
  hole reached the scan as `undefined` and raised a raw `TypeError`
  (validate.ts:214). Every list (claims, `certaintyPhrases`, the tier lists,
  `tiers`) is now copied once through an indexed traversal that throws
  `TypeError` naming the index, and an inherited `Array.prototype` entry cannot
  fill a hole.
- **Input is read once.** Claims, options, `extractClaims`, definitions and
  `tiers` are read once per call and the copies are used, so a getter or Proxy
  cannot report something different from what was validated.
- **Options are validated up front.** `options` must be a plain object; only
  `undefined` means "use the default" (`null` is an error); `caseSensitive` must
  be a boolean; `negationWindow` must be an integer >= 0 or `Infinity` (`NaN` used
  to mean "the whole text before the match"); `certaintyRequiresTier` and
  `requireSourceRefForTiers` must be dense arrays of real tier names (a
  misspelled `requireSourceRefForTiers` used to require nothing, so a `verified`
  claim without a source passed); `certaintyPhrases` must be a dense array of
  strings or `{ phrase, reason? }`.
- **Claim shape is checked.** Each claim must be an object with a string `id` and
  `text`; `sourceRef` must be a string, `null` or `undefined`. A wrong `tier` is
  still reported as an `unknown_tier` offense, not thrown.
- **A visibly empty `sourceRef` counts as missing.** `String.prototype.trim` kept
  a `sourceRef` made only of zero-width characters or bidi controls; now
  whitespace, `Default_Ignorable_Code_Point` and control characters count as empty.
- **Messages can no longer throw or forge structure.** A BigInt, cyclic-object or
  throwing-`toJSON` tier used to throw while the `unknown_tier` message was built
  (`JSON.stringify`); it is now described safely. Control characters, line
  breaks and bidi characters from caller strings (claim id, phrase, custom
  reason, tier) are escaped as `\uXXXX` in `message` text. `claimId`,
  `claimText` and `phrase` are returned unchanged.
- **`provenanceBadgeText` no longer coerces its tier.** `['verified']` or
  `new String('verified')` used to work as a key. `tier` must be a string, and
  `definitions` and `options` must be plain objects. A definition whose label is
  missing, not a string, or visibly blank now throws instead of rendering
  `undefined` or an empty badge; `includeShortDescription` must be a boolean.
- **`methodologyPageOutline` checks its arguments.** A `Map`, array or `null` for
  `definitions` used to read as "no definitions" or crash; a bare-string `tiers`
  was iterated one character at a time; a hole in `tiers` printed `undefined`.
  Tier names shown in `TODO` lines and fallback headings escape control and bidi
  characters.

### Changed

- The `unknown_tier` message shows an object tier as `an object` and a bigint as
  `10n`; a string tier is still quoted.
- A custom `reason` that is empty or visibly blank falls back to the default
  message text.
- Removed the unsupported claims about a real incident and a specific count from
  the README, ENGINEERING.md and source comments (PVK-F-004). The README's
  synthetic-example framing is unchanged.
- README: an ESM/CommonJS compatibility table, the `ClaimOffense` type now
  matches the exported type, sibling-kit descriptions match those kits' own
  limits, and Honest limits covers clause-bounded negation, empty input, empty
  phrases and shallow shape checks. `PROJECT_CONTEXT.md` and the package
  description no longer say the tier is "enforced" or "checked".
- CI: compatibility jobs also run on Node 20.19.0 and 22.12.0 (the `require(esm)`
  floors). The release workflow runs `audit:dependencies`, `verify` and `attw`,
  requires a matching `v*` tag on both triggers, and treats only a confirmed
  `E404` as "not published".

### Added

- Tests for the empty-phrase guard (`indexOf('')` would otherwise never advance),
  the text helpers, every message, and the default phrase list. Mutation score
  (Stryker) went from 66.8% to 97.4%; v8 coverage is 100% of statements and
  branches.

## [0.1.1] - 2026-09-27

### Added

- CommonJS `require()` support: a `"default"` condition next to `"import"`
  in the `exports` entry, pointing at the same built file. Proven against
  the packed tarball with `require()` on Node 26.3.0, and guarded in CI on
  Node 20, 22, and 24 by an extended `scripts/verify-package.mjs`.
- README: a "Relationship to sibling kits" section now also covers
  [grounding-kit](https://github.com/lkopietz3-byte/grounding-kit) (checks
  whether generated text is grounded in supplied evidence, a different
  question from this package's tier-vs-wording check) and
  [corroboration-kit](https://github.com/lkopietz3-byte/corroboration-kit)
  (turns collected signals into a bounded verdict that could inform, but is
  not integrated with, a claim's provenance tier).

### Fixed

- The shipped `.js.map` file now inlines the original TypeScript source
  (`inlineSources` in `tsconfig.build.json`), so it resolves without the
  unshipped `src/` directory. `.d.ts.map` generation is now disabled instead
  of shipping a source map with an unresolvable `../src/*.ts` path; the
  `.d.ts` declaration file itself is unaffected.

### Changed

- README: added an ESM/CommonJS install note (`require()` works on Node
  versions that support `require(esm)`); the README previously did not
  state a module format at all.

## [0.1.0] - 2026-09-27

First release.

### Added

- `ProvenanceTier` (`'verified' | 'modeled' | 'editorial'`) and
  `PROVENANCE_TIERS`, the fixed three-tier vocabulary this kit is built
  around.
- `Claim` and `ProvenanceTierDefinition(s)` types for tagging reader-facing
  claims with a tier and describing what each tier means in your domain.
- `validateClaims(input, options?)`: scans a list of claims (or raw text
  plus a caller-supplied extractor) for certainty language not backed by
  an appropriate tier, tiers missing a required `sourceRef`, and claims
  carrying an unrecognized tier. Returns a structured `ClaimOffense[]`.
  Certainty-phrase matching folds Unicode compatibility forms, spacing,
  and hyphenation before comparing, checks a word boundary at the start
  of a match, and treats a configurable window of preceding text as a
  negation check (with a short list of negation-shaped idioms — "no
  doubt," "not only" — excluded so they don't wrongly suppress a real
  offense).
- `DEFAULT_CERTAINTY_PHRASES`: an 11-entry generic starter list of
  overclaiming phrases, frozen against in-place mutation.
- `provenanceBadgeText(tier, definitions, options?)`: pure badge-label
  string builder, framework-agnostic.
- `methodologyPageOutline(definitions, options?)`: Markdown scaffold for a
  "how we know what we publish" page.

### Security

- `provenanceBadgeText` and `methodologyPageOutline` copy caller-supplied
  definition text into their output verbatim, with no HTML/Markdown
  escaping. Documented in both TSDoc and the README's Honest limits — see
  those for when this matters and what to do about it.

