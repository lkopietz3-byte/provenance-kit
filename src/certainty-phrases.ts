// src/certainty-phrases.ts
//
// A "certainty phrase" is a snippet of copy that asserts more confidence
// than a claim actually has — "(verified)" as a blanket label,
// "independently verified", "proprietary dataset" — unless the claim's
// tier and sourceRef actually earn that language. The list below is a
// generic starting point, not a fixed vocabulary: every product that
// uses this library will have its own vocabulary drift (a nutrition app
// worries about "clinically proven"; a real-estate app worries about
// "off-market exclusive"). Override `certaintyPhrases` in
// `validateClaims` with your own list — this default exists so a first
// integration has something reasonable to start from.

/** A certainty phrase, optionally with a caller-facing reason it matters. */
export interface CertaintyPhraseRule {
  /** The phrase to scan for (case-insensitive by default). */
  phrase: string;
  /** Why this phrase asserts certainty, surfaced in offense messages. */
  reason?: string;
}

/** Accepts a bare string or a full rule; `validateClaims` normalizes both. */
export type CertaintyPhraseInput = string | CertaintyPhraseRule;

/**
 * A sensible, generic starter list of phrases that assert certainty a
 * claim frequently does not have. Fully overridable — pass your own
 * array to `validateClaims({ certaintyPhrases: [...] })` to replace
 * this entirely, or spread `DEFAULT_CERTAINTY_PHRASES` alongside
 * domain-specific additions.
 *
 * This is a shared module-level constant, frozen (top level and each
 * entry) so that one caller mutating it in place — `.push(...)`,
 * `.sort()`, or `list[0].phrase = ...` instead of spreading it — cannot
 * corrupt the default list for every other `validateClaims` call in the
 * same process.
 */
export const DEFAULT_CERTAINTY_PHRASES: readonly CertaintyPhraseRule[] = Object.freeze([
  {
    phrase: '(verified)',
    reason:
      'A parenthetical "(verified)" tag reads as a blanket verification ' +
      'stamp. Only attach it to claims actually checked against a primary source.',
  },
  {
    phrase: 'independently verified',
    reason:
      '"Independently verified" claims a check by a party other than the ' +
      'publisher. Do not use this language for in-house estimates.',
  },
  {
    phrase: 'verified dataset',
    reason: 'Calling a dataset "verified" implies every record was checked, not modeled.',
  },
  {
    phrase: 'proprietary dataset',
    reason:
      '"Proprietary dataset" implies a measured, owned corpus of data. ' +
      'Estimates derived from public signal are not a proprietary dataset.',
  },
  {
    phrase: 'proprietary database',
    reason: 'Same issue as "proprietary dataset" — implies ownership of measured records.',
  },
  {
    phrase: 'reverse-engineered',
    reason: 'Implies a measured derivation process that did not happen; use "modeled" or "estimated" instead.',
  },
  {
    phrase: 'guaranteed',
    reason: '"Guaranteed" is a promise about outcome, not appropriate for an estimate.',
  },
  {
    phrase: 'guarantee',
    reason: 'Same as "guaranteed" — a promise a modeled or editorial claim cannot back.',
  },
  {
    phrase: 'fact-checked',
    reason: '"Fact-checked" implies a specific verification process took place.',
  },
  {
    phrase: 'confirmed by',
    reason: '"Confirmed by X" attributes verification to a named source; only true if that happened.',
  },
  {
    phrase: '100% accurate',
    reason: 'Absolute-accuracy claims are rarely defensible and should not appear outside verified, sourced claims.',
  },
].map((rule) => Object.freeze(rule)));
