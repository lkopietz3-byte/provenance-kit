// src/methodology.ts
//
// A scaffold generator for the "how we know what we know" page every
// product using this pattern should publish and link from every badge.
// cruise-almanac hand-wrote this page once
// (src/components/HowWeKnow.jsx); this generalizes the skeleton so the
// next product doesn't start from a blank file. It intentionally leaves
// TODO placeholders for the parts that are genuinely domain-specific
// (what the product does NOT do, its correction history, its FAQ) —
// this library can't know those for you, and pretending otherwise would
// itself be the kind of overclaiming this pattern exists to prevent.

import type { ProvenanceTier, ProvenanceTierDefinitions } from './types.js';
import { PROVENANCE_TIERS } from './types.js';
import { assertDefinitions, optionalString, readDefinition, readDenseArray, readOptionsObject } from './args.js';
import { describeType, escapeForDisplay } from './text.js';

const FN = 'methodologyPageOutline';

/** Options for `methodologyPageOutline`. Every field is optional; `undefined` means the default. */
export interface MethodologyPageOutlineOptions {
  /** Page title. Default: "How we know what we publish". */
  title?: string;
  /** One-line standfirst under the title. Default is a generic honest framing. */
  intro?: string;
  /** Which tiers to include, and in what order. Default: all three, verified/modeled/editorial. */
  tiers?: ProvenanceTier[];
  /** Product name to reference in the placeholder sections. Default: "This product". */
  productName?: string;
}

/** `options.tiers`: `undefined` means all three tiers; otherwise a dense array of strings, copied once. */
function readTiers(value: unknown): string[] {
  if (value === undefined) return [...PROVENANCE_TIERS];
  if (!Array.isArray(value)) {
    throw new TypeError(`${FN}: options.tiers must be an array (received ${describeType(value)}).`);
  }
  return readDenseArray(value, 'options.tiers', FN).map((tier, i) => {
    if (typeof tier !== 'string') {
      throw new TypeError(`${FN}: options.tiers[${i}] must be a string (received ${describeType(tier)}).`);
    }
    return tier;
  });
}

const DEFAULT_INTRO =
  'A publication or product earns trust by telling readers what it knows, ' +
  'what it estimates, and what it merely judges — and never confusing the three.';

/**
 * Generate a Markdown skeleton for a methodology / "how we know what we
 * know" page from the caller's own tier definitions. Pure string
 * output — no framework, no filesystem access — so it can be piped into
 * a CMS field, a static markdown file, or a component prop.
 *
 * Sections with genuinely domain-specific content (what the product
 * does not do, its correction log, its FAQ) are left as `TODO` markers
 * for the caller to fill in; this function only auto-fills what it can
 * honestly know from the tier definitions themselves.
 *
 * What it checks, and how it fails:
 * - `definitions` must be a plain object, and `options` a plain object or
 *   `undefined` (`TypeError`; a `Map` or `null` used to read as "no
 *   definitions" or crash deep inside).
 * - `title`, `intro` and `productName` must be strings when given, and `tiers`
 *   a dense array of strings (`TypeError`; a bare string used to be iterated one
 *   character at a time).
 * - A tier with no OWN entry in `definitions` (including an inherited key such as
 *   "constructor", or an entry that is `undefined` or `null`) becomes a `TODO`
 *   line, not an error. A definition that is present but not an object, or whose
 *   `label` or `criteria` is not a string, throws `TypeError`; a visibly blank
 *   `label` throws `RangeError`.
 * - The tier name shown in a `TODO` line or fallback heading has control and
 *   bidi characters escaped, so a tier name cannot forge a heading or line.
 * - Everything is read once per call.
 *
 * Security: `label` and `criteria` from each tier definition, and `title`,
 * `intro` and `productName`, are copied into the output **verbatim** — no
 * Markdown escaping, no HTML escaping, no control-character escaping
 * (`criteria` may legitimately span several lines).
 * This is Markdown text, not HTML, so it is not directly injectable by
 * itself; but if you (or a later step in your pipeline) render this
 * Markdown to HTML with a renderer that passes through raw HTML (several
 * popular ones do by default), a tier definition sourced from anywhere
 * other than your own source code — a CMS field a non-developer can
 * edit, for example — is an HTML/script-injection path. Sanitize the
 * rendered HTML, or configure your Markdown renderer to disable raw HTML,
 * before showing it to anyone else.
 */
export function methodologyPageOutline(
  definitions: ProvenanceTierDefinitions,
  options: MethodologyPageOutlineOptions = {},
): string {
  assertDefinitions(definitions, FN);
  const raw = readOptionsObject(options, FN);
  const title = optionalString(raw.title, 'title', FN) ?? 'How we know what we publish';
  const intro = optionalString(raw.intro, 'intro', FN) ?? DEFAULT_INTRO;
  const productName = optionalString(raw.productName, 'productName', FN) ?? 'This product';
  const tiers = readTiers(raw.tiers);

  const lines: string[] = [];

  lines.push(`# ${title}`, '', `_${intro}_`, '');

  lines.push('## The tiers', '');
  for (const tier of tiers) {
    // See badge.ts: readDefinition uses Object.hasOwn, which guards against a
    // `tier` value that collides with an inherited Object.prototype key
    // (e.g. "constructor").
    const def = readDefinition(definitions, tier, ['criteria'], FN);
    if (def === undefined) {
      const shown = escapeForDisplay(tier);
      lines.push(
        `### ${shown}`,
        '',
        `TODO: no ProvenanceTierDefinition was supplied for "${shown}". ` +
          `Add one so this section can be filled in automatically.`,
        '',
      );
      continue;
    }
    lines.push(`### ${def.label}`, '', def.criteria as string, '');
  }

  lines.push(
    '## What we do not do',
    '',
    `TODO: list the specific overclaiming ${productName} has committed to avoiding ` +
      '(e.g. "we do not call an estimate a measurement", "we do not attach unsourced ' +
      'claims to named individuals"). This section is what makes the tiers above ' +
      'credible — a generic list is a weaker signal than a specific one.',
    '',
  );

  lines.push(
    '## Corrections we have made to ourselves',
    '',
    'TODO: a dated log of provenance corrections (mislabeled claims found and fixed). ' +
      'A publication that records its own corrections is demonstrating the standard, ' +
      'not just asserting it.',
    '',
  );

  lines.push(
    '## Common questions',
    '',
    'TODO: FAQ entries addressing what each tier does and does not mean in practice, ' +
      'and what a reader should do with a modeled or editorial claim before acting on it.',
    '',
  );

  return lines.join('\n');
}
