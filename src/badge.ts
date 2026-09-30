// src/badge.ts
//
// A pure function for rendering a tier badge's text. No UI framework
// dependency on purpose — a React component, a Vue component, a Svelte
// component, or a plain template string can all call this and pass the
// result into whatever markup they render.

import type { ProvenanceTier, ProvenanceTierDefinitions } from './types.js';
import { assertDefinitions, readDefinition, readOptionsObject } from './args.js';
import { describeType, escapeForDisplay } from './text.js';

const FN = 'provenanceBadgeText';

/** Options for `provenanceBadgeText`. */
export interface ProvenanceBadgeTextOptions {
  /**
   * Include the tier's `shortDescription` after the label, separated by
   * ` — `. Useful for a compact tooltip-style badge. Default false
   * (returns just the label). Must be a real boolean when given.
   */
  includeShortDescription?: boolean;
}

/**
 * Return the display text for a tier's badge, sourced entirely from the
 * caller's own tier definitions. Throws if the caller didn't supply a
 * definition for the requested tier — a missing definition means a
 * badge would otherwise silently render blank, which is exactly the
 * kind of unlabeled claim this library exists to prevent.
 *
 * What it checks, and how it fails:
 * - `tier` must be a string (`TypeError` otherwise: an array or `String`
 *   object would be coerced into a lookup key).
 * - `definitions` must be a plain object, and `options` a plain object or
 *   `undefined` (`TypeError`).
 * - A tier with no OWN entry in `definitions` — including an inherited key such
 *   as "constructor" or "toString", or an entry that is `undefined` or `null`
 *   — throws `Error` ("no tier definition supplied").
 * - A definition that is not an object, or whose `label` (and, with
 *   `includeShortDescription`, `shortDescription`) is not a string, throws
 *   `TypeError`; one that is visibly blank (only whitespace, zero-width or bidi
 *   control characters) throws `RangeError`, because it would render an
 *   unlabeled badge.
 * - Everything is read once per call.
 *
 * Security: the returned string is `label` (and optionally
 * `shortDescription`) copied through **verbatim, with no HTML escaping and no
 * control-character escaping**. That is safe as a React/Vue/Svelte text child or
 * a DOM `textContent` assignment (those escape on your behalf), but it is NOT
 * safe to concatenate directly into an HTML string or assign to `innerHTML` — if
 * a tier definition can contain content you did not write yourself (e.g. it
 * comes from a CMS field), escape this return value before doing that. The
 * error message, by contrast, shows the requested tier with control and bidi
 * characters escaped.
 */
export function provenanceBadgeText(
  tier: ProvenanceTier,
  definitions: ProvenanceTierDefinitions,
  options: ProvenanceBadgeTextOptions = {},
): string {
  if (typeof tier !== 'string') {
    throw new TypeError(`${FN}: tier must be a string (received ${describeType(tier)}).`);
  }
  assertDefinitions(definitions, FN);
  const rawOptions = readOptionsObject(options, FN);
  const includeShortDescription = rawOptions.includeShortDescription;
  if (includeShortDescription !== undefined && typeof includeShortDescription !== 'boolean') {
    throw new TypeError(
      `${FN}: options.includeShortDescription must be a boolean (received ${describeType(includeShortDescription)}).`,
    );
  }

  // readDefinition uses Object.hasOwn (not `definitions[tier]` truthiness) so a
  // tier value that collides with an inherited Object.prototype key —
  // "toString", "constructor", "__proto__", "hasOwnProperty" — is treated as
  // missing instead of silently resolving to that inherited value.
  const def = readDefinition(definitions, tier, includeShortDescription === true ? ['shortDescription'] : [], FN);
  if (def === undefined) {
    throw new Error(
      `${FN}: no tier definition supplied for "${escapeForDisplay(tier)}". ` +
        `Every tier rendered in the UI needs a ProvenanceTierDefinition.`,
    );
  }
  if (includeShortDescription === true) {
    return `${def.label} — ${def.shortDescription}`;
  }
  return def.label;
}
