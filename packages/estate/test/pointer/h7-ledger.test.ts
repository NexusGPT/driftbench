import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  type BlockLink,
  type ChangeManifest,
  parseSectionRegistry,
  type RadiusSpec,
  radiusOf,
  type Spec,
  sectionSelection,
} from '@agent-nexus/driftbench-core';
import { wilson } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  cut,
  type Ledger,
  ledgerChangeManifest,
  ledgerChanges,
  nextLedger,
  rerunOf,
} from '../../src/pointer';

/**
 * The H7 study (research/block-links) repeated on the ledger. The Acme stand-in prompt of 30 sections, its
 * 19 conversations and 37 blocks, the blocks' declared section links and the blocks each mutant flipped (E)
 * are the registered data. Here a block links to every ledger unit of the sections it declared, and the
 * change is read from the mutant's text by the ledger instead of being named by hand. A mutant violates
 * safety when a block it flipped is outside the selection (flaky blocks excluded, as registered).
 */

const repo = (path: string) => new URL(`../../../../${path}`, import.meta.url);
const prompt = readFileSync(repo('examples/acme/prompts/acme-sales.md'), 'utf8');
const parsed = parseSectionRegistry(
  parseYaml(readFileSync(repo('examples/acme/prompts/acme-sales.sections.yaml'), 'utf8')),
);
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const registry = parsed.registry;

type H7 = {
  flaky: string[];
  conversations: { id: string; blocks: { id: string; links: string[] }[] }[];
  mutants: { variant: string; sections: string[]; control: boolean; pair: boolean; E: string[] }[];
};
const h7: H7 = JSON.parse(
  readFileSync(repo('packages/core/test/fixtures/sections/h7-selection.json'), 'utf8'),
);
type Mutants = {
  prompt_sha256: string;
  mutants: { variant: string; sha256: string; edits: [number, number, string][] }[];
};
const stored: Mutants = JSON.parse(
  readFileSync(repo('packages/core/test/fixtures/sections/h7-mutants.json'), 'utf8'),
);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const textOf = (variant: string): string => {
  const entry = stored.mutants.find((each) => each.variant === variant);
  if (!entry) throw new Error(`no mutant ${variant}`);
  let text = prompt;
  for (const [start, end, replacement] of [...entry.edits].sort((a, b) => b[0] - a[0]))
    text = text.slice(0, start) + replacement + text.slice(end);
  if (sha256(text) !== entry.sha256) throw new Error(`the mutant ${variant} does not rebuild`);
  return text;
};

const PATH = 'acme-sales.md';
const ledgerOf = (text: string, previous?: Ledger) =>
  nextLedger([{ path: PATH, cut: cut(text) }], previous, 'acme');
const base = ledgerOf(prompt);
const original = cut(prompt);

// Each unit of the original falls in the one section whose span holds it.
const sectionOfUnit = new Map<string, string>();
original.units.forEach((unit, index) => {
  const id = base.ids.get(`${PATH}\0${index}`) as string;
  const section = registry.sections.find(
    (each) => each.span.start <= unit.start && unit.end <= each.span.end,
  );
  if (section) sectionOfUnit.set(id, section.id);
});
const globals = registry.sections
  .filter((section) => section.scope === 'global')
  .map((section) => section.id);
const unitsOf = (sections: readonly string[]) =>
  [...sectionOfUnit].filter(([, section]) => sections.includes(section)).map(([id]) => id);

/** The suite with block links to units: the units of every section a block declared, and of every global one. */
const unitSpecs: RadiusSpec[] = h7.conversations.map((conversation) => ({
  hash: conversation.id,
  spec: {
    id: conversation.id,
    kind: 'conversation',
    blocks: conversation.blocks.map((block) => ({ id: block.id, when: { user: '.' } })),
    metadata: {
      links: conversation.blocks.flatMap((block) =>
        unitsOf([...block.links, ...globals]).map(
          (unit): BlockLink => ({ block: block.id, to: { kind: 'estate_unit', unit }, status: 'declared' }),
        ),
      ),
    },
  } as Spec,
}));
/** The same suite with the section links the study registered, for the comparison. */
const sectionSpecs: RadiusSpec[] = h7.conversations.map((conversation) => ({
  hash: conversation.id,
  spec: {
    id: conversation.id,
    kind: 'conversation',
    blocks: conversation.blocks.map((block) => ({ id: block.id, when: { user: '.' } })),
    metadata: {
      links: conversation.blocks.flatMap((block) =>
        [...block.links, ...globals].map(
          (section): BlockLink => ({
            block: block.id,
            to: { kind: 'prompt_section', prompt: 'acme-sales', section },
            status: 'declared',
          }),
        ),
      ),
    },
  } as Spec,
}));

const flaky = new Set(h7.flaky);
const stable = h7.conversations.flatMap((c) => c.blocks.map((b) => b.id)).filter((id) => !flaky.has(id));

const followed = new Map<string, Ledger>();
/** The ledger of a mutant, followed from the original once. */
const ledgerAfter = (variant: string): Ledger => {
  const known = followed.get(variant);
  if (known) return known;
  const next = ledgerOf(textOf(variant), base.ledger).ledger;
  followed.set(variant, next);
  return next;
};

/** The blocks the ledger selects for a mutant, through the radius proper; `advisory` adds the advisory units. */
function ledgerSelection(variant: string, advisory = false) {
  const next = ledgerAfter(variant);
  const rerun = rerunOf(ledgerChanges(base.ledger, next), base.ledger);
  if (advisory) for (const [id, why] of rerun.advisory) rerun.units.set(id, why);
  const manifest = ledgerChangeManifest(rerun, { from: 'v1', to: variant });
  const report = radiusOf(unitSpecs, manifest, { modes: ['F'] });
  const selection = report.unitAdvisory;
  return {
    whole: report.whole,
    manifest,
    selected: new Set(
      (selection?.specs ?? []).flatMap((spec) =>
        spec.blocks.filter((b) => b.state !== 'out').map((b) => b.id),
      ),
    ),
  };
}

function sectionSelected(sections: readonly string[]) {
  const manifest: ChangeManifest = {
    from: 'v1',
    to: 'mutant',
    changes: sections.map((section) => ({ kind: 'prompt_section', id: `acme-sales#${section}` })),
  };
  const selection = sectionSelection(sectionSpecs, manifest, [registry]);
  return new Set(
    selection.specs.flatMap((spec) => spec.blocks.filter((b) => b.state !== 'out').map((b) => b.id)),
  );
}

function study(rows: H7['mutants'], select: (mutant: H7['mutants'][number]) => Set<string>) {
  const misses: string[] = [];
  let ratio = 0;
  for (const mutant of rows) {
    const T = new Set([...select(mutant)].filter((id) => !flaky.has(id)));
    if (mutant.E.some((id) => !T.has(id))) misses.push(mutant.variant);
    ratio += T.size / stable.length;
  }
  const interval = wilson(misses.length, rows.length);
  return { mutants: rows.length, misses, upper: interval.upper, ratio: ratio / rows.length };
}

const single = h7.mutants.filter((m) => !m.control && !m.pair);
const all = h7.mutants.filter((m) => !m.control);

describe('the H7 study on the ledger', () => {
  it('rebuilds every stored mutant and links every unit of the prompt to a section', () => {
    expect(sha256(prompt)).toBe(stored.prompt_sha256);
    expect(stored.mutants).toHaveLength(170);
    for (const mutant of stored.mutants) expect(() => textOf(mutant.variant)).not.toThrow();
    expect(sectionOfUnit.size).toBe(original.units.length);
  });

  it('keeps the radius the whole suite: a unit change is advisory', () => {
    const { whole, manifest } = ledgerSelection('explicit_confirm__negate');
    expect(manifest.changes.every((change) => change.kind === 'unit')).toBe(true);
    expect(whole?.reason).toMatch(/advisory until links are verified by mutation/);
  });

  it('misses what section links miss, and its Wilson upper bound is above 5%', () => {
    const ninety = study(single, (mutant) => ledgerSelection(mutant.variant).selected);
    const hundredTen = study(all, (mutant) => ledgerSelection(mutant.variant).selected);
    expect([...ninety.misses].sort()).toEqual(['explicit_confirm__negate', 'mobile_new_line__negate']);
    expect(hundredTen.misses).toHaveLength(4);
    expect(ninety.upper).toBeCloseTo(0.0774, 3);
    expect(hundredTen.upper).toBeCloseTo(0.0896, 3);
    // The gate of the selection: at or below 5%. It does not pass, so unit selection stays advisory.
    expect(ninety.upper).toBeGreaterThan(0.05);
    expect(hundredTen.upper).toBeGreaterThan(0.05);
    expect(ninety.ratio).toBeCloseTo(0.2238, 3);

    const sections90 = study(single, (mutant) => sectionSelected(mutant.sections));
    const sections110 = study(all, (mutant) => sectionSelected(mutant.sections));
    expect(ninety.misses).toEqual(sections90.misses);
    expect(hundredTen.misses).toEqual(sections110.misses);
  }, 120_000);

  it('gains nothing from the advisory units but a larger selection', () => {
    const ninety = study(single, (mutant) => ledgerSelection(mutant.variant, true).selected);
    expect([...ninety.misses].sort()).toEqual(['explicit_confirm__negate', 'mobile_new_line__negate']);
    expect(ninety.ratio).toBeCloseTo(0.3162, 3);
  }, 120_000);

  it('sees every control edit: punctuation and synonyms change units too', () => {
    const controls = h7.mutants.filter((m) => m.control);
    const selected = controls.filter((mutant) => ledgerSelection(mutant.variant).selected.size > 0);
    expect(controls).toHaveLength(60);
    expect(selected).toHaveLength(60);
  }, 120_000);
});
