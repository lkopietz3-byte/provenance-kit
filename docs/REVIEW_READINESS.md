# Review and launch readiness

Prepared September 30, 2026 against GitHub main `b4875ebcab75c2bd23422fdf7c966315d98d2d43`. This is a preparation plan, not a completed product audit or marketing certification.

## Review cadence

Keep automatic code reviews off during preparation. Request one focused `@codex review` on a meaningful candidate PR after relevant checks; repeat only when material changes invalidate that review. Do not add a recurring review schedule.

When this repo enters sustained launch or customer-facing development, enable its repository setting individually with **All PRs / On PR open / Exhaustive Off**. Keep the personal automatic default and credit-funded reviews off. Inspect the first result before expanding cadence. Review guidance lives in the root [AGENTS.md](../AGENTS.md); it supplements existing tests and release requirements.

On September 30, 2026, this repository was verified to **Follow personal preferences**, with personal automatic code reviews, exhaustive reviews and credit-funded reviews off. These settings are managed in ChatGPT; this file does not activate them.

## Next preparation task

Prepare a synthetic product-claims example distinguishing a human-checked primary source, a modeled estimate and editorial judgment, including a custom certainty phrase. State that sourceRef does not verify evidence or track its staleness.

Finish condition: The real packed API reproduces the intended wording violations and negation boundaries; the example labels tier, date and human review separately and makes no unsupported customer or production claims.

## Declared verification commands

Read from the inspected main's `package.json`. These are declared gates, not execution receipts; see the candidate PR for hosted-check results and report unavailable checks explicitly. Use focused checks during implementation and the existing release gates on the frozen candidate.

- `npm run verify`: `npm run lint && npm run typecheck && npm test && npm run build && npm run verify:package`
- `npm run lint`: `eslint . --max-warnings=0`
- `npm run typecheck`: `tsc --noEmit`
- `npm run test`: `vitest run`
- `npm run build`: `node -e "require('fs').rmSync('dist',{recursive:true,force:true})" && tsc -p tsconfig.build.json`
- `npm run verify:package`: `node scripts/verify-package.mjs`
- `npm run attw`: `attw --pack . --ignore-rules cjs-resolves-to-esm`

Local tests, hosted authorization, installed package behavior, deployment and buyer evidence are separate outcomes. A dated receipt applies to its recorded revision.

## Source basis

- [ENGINEERING.md](../ENGINEERING.md)
- [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md)
- [src/validate.ts](../src/validate.ts)
- [README.md](../README.md)

Public claims require current candidate evidence. Private-data transfers, commercial commitments, package publication, database promotion and deployment retain their existing authorization boundaries.
