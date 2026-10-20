import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  type BlockLink,
  parseSectionRegistry,
  type RadiusSpec,
  radiusOf,
  type Spec,
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
 * The second sample of the H7 study on the ledger (research/ledger-h7/PREREG.md). The first sample (90 mutants,
 * h7-ledger.test.ts) misses 2 with a Wilson upper bound of 7.7%. The second sample is 300 new mutants drawn
 * before the run; it uses the same suite, links, flaky blocks and ledger selection.
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
};
const h7: H7 = JSON.parse(
  readFileSync(repo('packages/core/test/fixtures/sections/h7-selection.json'), 'utf8'),
);
type Second = {
  v0_fail: string[];
  mutants: { variant: string; sections: string[]; reps: number; E: string[] }[];
};
const second: Second = JSON.parse(
  readFileSync(repo('packages/core/test/fixtures/sections/h7-selection-300.json'), 'utf8'),
);
type Mutants = {
  prompt_sha256: string;
  gate_failed: string[];
  mutants: { variant: string; sha256: string; edits: [number, number, string][] }[];
};
const stored: Mutants = JSON.parse(
  readFileSync(repo('packages/core/test/fixtures/sections/h7-mutants-300.json'), 'utf8'),
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
const flaky = new Set(h7.flaky);
const stable = h7.conversations.flatMap((c) => c.blocks.map((b) => b.id)).filter((id) => !flaky.has(id));

const followed = new Map<string, Ledger>();
const ledgerAfter = (variant: string): Ledger => {
  const known = followed.get(variant);
  if (known) return known;
  const next = ledgerOf(textOf(variant), base.ledger).ledger;
  followed.set(variant, next);
  return next;
};

/** The blocks the ledger selects for a mutant, through the radius proper (advisory units not added). */
function ledgerSelection(variant: string) {
  const next = ledgerAfter(variant);
  const rerun = rerunOf(ledgerChanges(base.ledger, next), base.ledger);
  const manifest = ledgerChangeManifest(rerun, { from: 'v1', to: variant });
  const report = radiusOf(unitSpecs, manifest, { modes: ['F'] });
  return new Set(
    (report.unitAdvisory?.specs ?? []).flatMap((spec) =>
      spec.blocks.filter((b) => b.state !== 'out').map((b) => b.id),
    ),
  );
}

function study() {
  const misses: { variant: string; blocks: string[] }[] = [];
  let ratio = 0;
  for (const mutant of second.mutants) {
    const T = new Set([...ledgerSelection(mutant.variant)].filter((id) => !flaky.has(id)));
    const outside = mutant.E.filter((id) => !T.has(id));
    if (outside.length > 0) misses.push({ variant: mutant.variant, blocks: outside });
    ratio += T.size / stable.length;
  }
  const interval = wilson(misses.length, second.mutants.length);
  return {
    mutants: second.mutants.length,
    misses,
    upper: interval.upper,
    ratio: ratio / second.mutants.length,
  };
}

describe('the H7 study on the ledger, second sample', () => {
  it('rebuilds every stored mutant, and every mutant has a measured row', () => {
    expect(sha256(prompt)).toBe(stored.prompt_sha256);
    expect(stored.mutants.length + stored.gate_failed.length).toBe(300);
    for (const mutant of stored.mutants) expect(() => textOf(mutant.variant)).not.toThrow();
    expect(second.mutants.map((m) => m.variant)).toEqual(stored.mutants.map((m) => m.variant));
    expect(sectionOfUnit.size).toBe(original.units.length);
  });

  it('misses 14 of 290, its Wilson upper bound is above 5%, so a unit change stays advisory', () => {
    const result = study();
    expect(result.mutants).toBe(290);
    expect(result.misses.map((miss) => miss.variant)).toEqual([
      'explicit_confirm__negate__n2',
      'home_address_unknown__rephrase__n2',
      'mobile_new_line__negate__n0',
      'mobile_new_line__negate__n3',
      'new_customer_details__negate__n0',
      'new_customer_details__negate__n4',
      'order_failure__negate__n1',
      'porting_ineligible__rephrase__n4',
      'upgrade_identify__negate__n1',
      'upgrade_identify__negate__n3',
      'upgrade_more_data__negate__n0',
      'upgrade_more_data__negate__n1',
      'upgrade_order__negate__n0',
      'upgrade_unknown_account__negate__n4',
    ]);
    expect(result.upper).toBeCloseTo(0.0794, 3);
    // The gate of the selection: at or below 5%. It does not pass.
    expect(result.upper).toBeGreaterThan(0.05);
    expect(result.ratio).toBeCloseTo(0.2287, 3);
    expect(second.mutants.filter((mutant) => mutant.E.length > 0)).toHaveLength(86);
  }, 300_000);
});
