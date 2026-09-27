# Changelog

All notable changes to this project are documented in this file. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-09-25

First release. Not yet published to npm.

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

