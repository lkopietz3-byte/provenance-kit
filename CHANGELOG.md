# Changelog

All notable changes to this project are documented in this file. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
  suppressed. The rule errs toward reporting; see the README's Honest limits
  for the noisy cases (commas inside numbers, a negated list, hard-wrapped
  claims). A line break still reads as a space for matching, so a phrase
  wrapped across lines is still found.
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

