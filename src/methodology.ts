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
 */
export function methodologyPageOutline(
  definitions: ProvenanceTierDefinitions,
  options: MethodologyPageOutlineOptions = {},
): string {
  const {
    title = 'How we know what we publish',
    intro = DEFAULT_INTRO,
    tiers = [...PROVENANCE_TIERS],
    productName = 'This product',
  } = options;

  const lines: string[] = [];

  lines.push(`# ${title}`, '', `_${intro}_`, '');

  lines.push('## The tiers', '');
  for (const tier of tiers) {
    const def = definitions[tier];
    if (!def) {
      lines.push(
        `### ${tier}`,
        '',
        `TODO: no ProvenanceTierDefinition was supplied for "${tier}". ` +
          `Add one so this section can be filled in automatically.`,
        '',
      );
      continue;
    }
    lines.push(`### ${def.label}`, '', def.criteria, '');
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
