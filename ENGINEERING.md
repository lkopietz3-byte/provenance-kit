# Engineering contract

## Invariants

- Zero runtime dependencies (`dependencies` in `package.json` stays `{}`).
  Everything under `devDependencies` is build/test/lint tooling only.
- `validateClaims` never mutates its input `claims` array or any claim
  object, and never touches `Date.now()`, `Math.random()`, or object key
  order — for the same input and options, it always returns the same
  output.
- `PROVENANCE_TIERS` and `DEFAULT_CERTAINTY_PHRASES` are frozen
  (`Object.freeze`, including each phrase entry). Extend them by
  spreading into a new array, never by mutating in place.
- `provenanceBadgeText` and `methodologyPageOutline` return plain strings
  with **no HTML/Markdown escaping** of caller-supplied text. This is a
  documented, tested contract (`test/rendering-safety.test.ts`), not an
  oversight — see the README's Honest limits before rendering
  CMS-sourced tier definitions as HTML.
- The public API surface (the value exports importable at runtime) is
  pinned in `api-surface.json`. A deliberate change to it is made with
  `node scripts/verify-package.mjs --update-api` and reviewed as a diff,
  never edited by hand.

## Setup and verification

```bash
npm ci                 # install pinned dependencies
npm run verify          # lint + typecheck + test + build + verify:package
npm audit --include=dev # 0 findings as of this release
```

`npm run verify:package` builds the tarball a consumer would actually
install, checks it does not leak source/config/test files, installs it
into a throwaway project, imports every `exports` entry by its public
specifier, diffs the exported names against `api-surface.json`, and runs
`scripts/consumer-probe.mjs` (a real API exercise) and
`scripts/consumer-probe.mts` (a strict NodeNext type check) against the
installed package — not the local source tree.

## What is NOT certified

- **Not a fact-checker.** `validateClaims` checks wording against a
  declared tier; it cannot verify that a claim is actually true or that a
  `sourceRef` actually supports it.
- **Not a citation/evidence tracker.** No staleness concept, no evidence
  storage beyond a single `sourceRef` string per claim.
- **Not an exhaustive overclaiming vocabulary.** `DEFAULT_CERTAINTY_PHRASES`
  covers the phrases from one real incident. Extend it per product.
- **Negation is a character-count window, not a grammar parser.** See the
  README's Honest limits for the specific trade-offs this implies.

## Release / rollback

Not yet published to any registry. Point consumers at a git URL or commit
SHA until `npm publish` happens. Version stays `0.1.0` until a real
release; `CHANGELOG.md` follows Keep a Changelog. A published version can
be deprecated with `npm deprecate` (not yet applicable, nothing is
published) but cannot be unpublished after 72 hours on the npm registry —
treat any published `0.1.x` as permanent.
