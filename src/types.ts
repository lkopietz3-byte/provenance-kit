// src/types.ts
//
// Core types for provenance-kit. Deliberately small: three tiers, one
// claim shape, one caller-supplied definitions shape. The library has no
// opinion on your domain's wording — you supply that via
// ProvenanceTierDefinition — but it is opinionated about the tier count.
// Three is the set: a checked fact, an estimate, and a judgment are three
// genuinely different epistemic states. Do not add a fourth tier here
// without a clear generic reason; "we need a special case for X" is
// usually better solved by a more specific sourceRef or a domain-level
// wrapper, not a new tier that every consumer of this library must now
// also handle.

/**
 * The three provenance tiers. Every reader-facing factual claim in a
 * content-heavy product should be labeled with exactly one of these:
 *
 * - `verified`  — a structural fact checked directly against the
 *                 source's own published material. Checkable, and
 *                 someone checked it.
 * - `modeled`   — an estimate derived from public signal. Explicitly
 *                 NOT a measurement, NOT a guarantee, and NOT a
 *                 "proprietary dataset."
 * - `editorial` — stated judgment or opinion, clearly marked as such.
 */
export type ProvenanceTier = 'verified' | 'modeled' | 'editorial';

/**
 * All valid tiers, in the order most products should present them.
 * `readonly` at the type level and `Object.freeze`d at runtime, so a
 * caller who reaches this shared module-level array through a type
 * assertion or plain JS cannot mutate it out from under every other
 * consumer in the process.
 */
export const PROVENANCE_TIERS: readonly ProvenanceTier[] = Object.freeze([
  'verified',
  'modeled',
  'editorial',
]);

/**
 * A caller-supplied human-readable definition of what a tier means in
 * their domain. "Verified" means something different for a cruise-ship
 * spec page than it does for a nutrition-label scanner or a legal-fact
 * checker — this type is how a caller states that meaning once and
 * reuses it everywhere (badges, methodology pages, validation messages).
 */
export interface ProvenanceTierDefinition {
  /** Short display label for a badge, e.g. "Verified". */
  label: string;
  /**
   * One-line human description of what this tier means, e.g. "Checked
   * directly against the source's own published material." Used in
   * compact UI (badge tooltips, list rows).
   */
  shortDescription: string;
  /**
   * The fuller criteria a claim must meet to earn this tier, and/or the
   * honest disclosure that should accompany it when shown to a reader.
   * Used to build the methodology page.
   */
  criteria: string;
}

/**
 * A map from each tier to its caller-supplied definition. Callers may
 * supply all three or a subset (e.g. a product with no editorial
 * content can omit `editorial`); helpers that need a missing definition
 * throw with a clear message rather than silently rendering nothing.
 */
export type ProvenanceTierDefinitions = Partial<
  Record<ProvenanceTier, ProvenanceTierDefinition>
>;

/**
 * A single reader-facing factual claim, tagged with its provenance
 * tier. This is the unit `validateClaims` operates on.
 */
export interface Claim {
  /** Stable identifier for the claim (slug, DB id, DOM id — caller's choice). */
  id: string;
  /** The claim text as it would be shown to a reader. */
  text: string;
  /** Which provenance tier backs this claim. */
  tier: ProvenanceTier;
  /**
   * Optional pointer to what backs the claim — a URL, a document
   * citation, an internal record id. Not enforced as a specific format;
   * `validateClaims` can be configured to require it be visibly non-empty
   * for given tiers (by default, `verified`): a value made only of
   * whitespace, zero-width or bidi control characters counts as empty. It
   * must be a string, `null` or `undefined`. The reference is never opened
   * or checked.
   */
  sourceRef?: string;
}
