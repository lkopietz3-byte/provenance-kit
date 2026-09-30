# Engineering contract

## Invariants

- Zero runtime dependencies (`dependencies` in `package.json` stays `{}`).
  Everything under `devDependencies` is build/test/lint tooling only.
- `validateClaims` never mutates its input `claims` array or any claim
  object, and never touches `Date.now()`, `Math.random()`, or object key
  order — for the same input and options, it always returns the same
  output.
- Caller input is read once. `validateClaims`, `provenanceBadgeText` and
  `methodologyPageOutline` copy claims, options and definitions a single time
  (through an indexed traversal that rejects holes in sparse arrays) and only
  use the copies, so a getter or Proxy cannot answer differently after it was
  validated. Malformed input throws `TypeError` or `RangeError`; it is never
  skipped or read as "off". Only `undefined` means "use the default".
- Messages built from caller strings (offense `message`, thrown error text,
  fallback headings) escape control and bidi characters as `\uXXXX`. Structured
  fields (`claimId`, `claimText`, `phrase`) and the verbatim definition text
  the helpers return are not escaped.
- A negation only suppresses a certainty phrase within its own clause: a
  boundary (`, ; . : ! ?`, an em or en dash, or a line break) between the two
  ends it.
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
  is a small generic starter list. Extend it per product.
- **Negation is a character window cut at clause punctuation, not a grammar
  parser.** See the README's Honest limits for the specific trade-offs this
  implies (it errs toward reporting).

## Are the types wrong? (attw)

CI runs [`arethetypeswrong`](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
(`npm run attw`, which is `attw --pack . --ignore-rules cjs-resolves-to-esm`)
against the packed tarball after the build step. The `cjs-resolves-to-esm` rule is ignored on
purpose: this is an ESM-only package (`"type": "module"`, no `require` entry point), so a
CommonJS consumer must use Node's `require(esm)` support (Node >=20.19 or >=22.12 — see
"Runtime support policy" below) rather than a native `require`. A dual CJS+ESM build was
rejected to avoid the dual-package hazard (two separately-identified copies of the same module,
with broken `instanceof` checks and duplicated module state across the CJS and ESM entry
points).

## Release and rollback

`npm run verify` (lint, typecheck, test, build, verify:package) runs automatically before
publish via the `prepublishOnly` script, so a broken build cannot reach the registry by
accident. To release: add a dated entry to `CHANGELOG.md`, bump `version` in
`package.json`, commit, and push a `vX.Y.Z` tag that matches the new version, then let
`.github/workflows/release.yml` install, audit, verify, check types (`npm run attw`), and
publish it. (You can also run `npm publish` locally; `prepublishOnly` still guards it.)

npm's unpublish policy is deliberately narrow. Within 72 hours of publishing, a version can be
unpublished only if no other published package depends on it. After 72 hours, unpublishing also
requires fewer than 300 downloads in the last week and a single maintainer — most released
versions won't qualify either way. A given `name@version` can never be reused, published or
not, even after an unpublish. Treat unpublish as unavailable: prefer fixing forward with a new
patch version, and use `npm deprecate <name>@"<range>" "<message>"` to warn consumers off a
bad release while it stays installable for anyone already pinned to it.

### Runtime support policy

- **Recommended for production:** Node 22 and 24 (LTS). Node 26 (current) is what the main
  `verify` job runs on.
- **Compatibility-tested:** Node 20 (CI pins 20.19.0 and 22.12.0, the `require(esm)` floors,
  as well as the latest 20, 22 and 24). Node 20 is end-of-life — nodejs.org's release page
  (<https://nodejs.org/en/about/previous-releases>) lists it as `EOL`, with its final release
  dated Mar 24, 2026. The `compat` job in `verify.yml` still runs on Node 20 to catch
  regressions, but that runtime gets no security fixes upstream; don't run production traffic
  on it.
- CommonJS `require()` of this package needs Node >=20.19 or >=22.12 (`require(esm)`
  support). ESM `import` works on every version this package tests (20, 22, 24).
- `engines` in `package.json` is unchanged by this policy.

### Publishing with provenance

`.github/workflows/release.yml` publishes using npm trusted publishing: it triggers on
`workflow_dispatch` or a pushed `v*` tag, requests a short-lived OIDC token instead of
reading a stored npm token (`permissions: id-token: write`), and runs a plain `npm publish`
with no token and no `--provenance` flag, because provenance attestation is generated
automatically under trusted publishing. On both triggers the workflow requires that it runs
on a tag whose name matches `package.json`'s `version` (a manual run from a branch fails),
then runs `npm run audit:dependencies`, `npm run verify` and `npm run attw`. It checks whether
the version is already on the registry: only a confirmed `E404` counts as "not published";
an existing version is a no-op, and any other registry error (outage, auth, network) fails
the job instead of guessing. Trusted publishing must be configured for this package on npmjs.com (linking it to this
GitHub repository and the `release.yml` workflow) before the first automated release will
work.
