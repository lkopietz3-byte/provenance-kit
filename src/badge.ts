// src/badge.ts
//
// A pure function for rendering a tier badge's text. No UI framework
// dependency on purpose — a React component, a Vue component, a Svelte
// component, or a plain template string can all call this and pass the
// result into whatever markup they render.

import type { ProvenanceTier, ProvenanceTierDefinitions } from './types.js';

export interface ProvenanceBadgeTextOptions {
  /**
   * Include the tier's `shortDescription` after the label, separated by
   * ` — `. Useful for a compact tooltip-style badge. Default false
   * (returns just the label).
   */
  includeShortDescription?: boolean;
}

/**
 * Return the display text for a tier's badge, sourced entirely from the
 * caller's own tier definitions. Throws if the caller didn't supply a
 * definition for the requested tier — a missing definition means a
 * badge would otherwise silently render blank, which is exactly the
 * kind of unlabeled claim this library exists to prevent.
 */
export function provenanceBadgeText(
  tier: ProvenanceTier,
  definitions: ProvenanceTierDefinitions,
  options: ProvenanceBadgeTextOptions = {},
): string {
  // Object.hasOwn (not `definitions[tier]` truthiness) so a tier value that
  // happens to collide with an inherited Object.prototype key — "toString",
  // "constructor", "__proto__", "hasOwnProperty" — is treated as missing
  // instead of silently resolving to that inherited (non-)function and
  // rendering "undefined" text instead of throwing.
  const def = Object.hasOwn(definitions, tier) ? definitions[tier] : undefined;
  if (!def) {
    throw new Error(
      `provenanceBadgeText: no tier definition supplied for "${tier}". ` +
        `Every tier rendered in the UI needs a ProvenanceTierDefinition.`,
    );
  }
  if (options.includeShortDescription) {
    return `${def.label} — ${def.shortDescription}`;
  }
  return def.label;
}
