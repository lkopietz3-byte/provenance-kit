# provenance-kit — agent instructions

Label public claims verified, modeled or editorial, then check that their wording is not stronger than the label allows. A wording lint, not a fact-checker.

## Read first
- `ENGINEERING.md` holds this package's invariants and design rules; read it before changing behavior.
- `PROJECT_CONTEXT.md` is the current project state and decisions.
- `SECURITY.md` covers the security posture; follow it for anything touching input handling.

## Commands (from package.json)
- `npm run verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run verify:package` packs and installs the tarball offline; run `npm run build` first.

## Rules
- Run `npm run verify` and read its output before calling work done. Report any step that did not run.
- Build cleans `dist/` first; never trust a stale `dist/` for declaration or package checks.
- Never weaken lint, tests or `api-surface.json` to get green. Public API changes are deliberate (`node scripts/verify-package.mjs --update-api`) and must be called out.
- Do not run `npm publish` or push tags without explicit permission. Treat any claim that a version is published as Reported until the registry confirms it.
- Runtime `dependencies` stay empty; add dev tooling only.
- Keep unrelated uncommitted work intact; never stage or reset the whole tree.

## Review preparation

See [docs/REVIEW_READINESS.md](docs/REVIEW_READINESS.md) for milestone review cadence, declared verification gates and the next launch-preparation task.

## Code Review Rules

- Keep validateClaims a wording check against caller-supplied provenance tiers, not a fact checker or source verifier. An empty violation list does not prove truth, freshness or the sourceRef's authority.
- Preserve pure, single-read validation and the raw-versus-display boundary: display messages escape control/bidi characters, while structured fields and caller-defined badge/methodology strings still require safe rendering by the consumer.
- Preserve clause-bounded negation and frozen starter vocabularies; extend phrase lists by copying rather than mutating defaults. Do not market the character-window heuristic as a grammar parser or exhaustive certainty-language coverage.
