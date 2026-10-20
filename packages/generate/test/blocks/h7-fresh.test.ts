import { readFileSync } from 'node:fs';
import {
  type BlockLink,
  type ChangeManifest,
  parseSectionRegistry,
  type RadiusSpec,
  type RerunMark,
  type Spec,
  sectionSelection,
} from '@agent-nexus/driftbench-core';
import { wilson } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { blockSections, sectionsNamingTools } from '../../src/blocks/sections';

/**
 * The fresh sample of the H7 study (research/ledger-h7/PREREG-fresh.md): mutants drawn after the links of PR 960
 * and the marks of PR 961 were fixed. Selection: declared links, tool-name links, the frozen marks. Registered
 * flip definition. Flaky blocks excluded.
 */
const repo = (path: string) => new URL(`../../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(repo(path), 'utf8');
const fixtures = 'packages/core/test/fixtures/sections';
const parsed = parseSectionRegistry(parseYaml(read('examples/acme/prompts/acme-sales.sections.yaml')));
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const registry = parsed.registry;
const sections = blockSections([
  { path: 'acme-sales.md', text: read('examples/acme/prompts/acme-sales.md'), registry },
]);

type Mutants = { variant: string; sections: string[]; E: string[] }[];
const h7: { flaky: string[]; conversations: { id: string; blocks: { id: string; links: string[] }[] }[] } =
  JSON.parse(read(`${fixtures}/h7-selection.json`));
const fresh: { mutants: Mutants } = JSON.parse(read(`${fixtures}/h7-selection-fresh.json`));
const stored: { gate_failed: string[]; mutants: { variant: string }[] } = JSON.parse(
  read(`${fixtures}/h7-mutants-fresh.json`),
);
const toolsOf: { tools: string[]; blocks: Record<string, string[]> } = JSON.parse(
  read(`${fixtures}/h7-block-tools.json`),
);
const marks: RerunMark[] = JSON.parse(read(`${fixtures}/h7-rerun-marks.json`)).marks;
const globals = registry.sections
  .filter((section) => section.scope === 'global')
  .map((section) => section.id);
const flaky = new Set(h7.flaky);
const stable = h7.conversations.flatMap((c) => c.blocks.map((b) => b.id)).filter((id) => !flaky.has(id));

const specs: RadiusSpec[] = h7.conversations.map((conversation) => ({
  hash: conversation.id,
  spec: {
    id: conversation.id,
    kind: 'conversation',
    blocks: conversation.blocks.map((block) => ({ id: block.id, when: { user: '.' } })),
    metadata: {
      rerun: marks.filter((mark) => conversation.blocks.some((block) => block.id === mark.block)),
      links: conversation.blocks.flatMap((block) =>
        [
          ...[...block.links, ...globals],
          ...sectionsNamingTools(sections, toolsOf.blocks[block.id] ?? [], (label) =>
            toolsOf.tools.includes(label),
          ).map((ref) => ref.section),
        ].map(
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

function study(rows: Mutants) {
  const misses: { variant: string; section: string; blocks: string[] }[] = [];
  let ratio = 0;
  for (const mutant of rows) {
    const manifest: ChangeManifest = {
      from: 'v1',
      to: 'mutant',
      changes: mutant.sections.map((section) => ({ kind: 'prompt_section', id: `acme-sales#${section}` })),
    };
    const selection = sectionSelection(specs, manifest, [registry]);
    const T = new Set(
      selection.specs
        .flatMap((spec) => spec.blocks.filter((b) => b.state !== 'out').map((b) => b.id))
        .filter((id) => !flaky.has(id)),
    );
    const outside = mutant.E.filter((id) => !T.has(id));
    if (outside.length > 0)
      misses.push({ variant: mutant.variant, section: mutant.sections[0] as string, blocks: outside });
    ratio += T.size / stable.length;
  }
  return {
    n: rows.length,
    misses,
    upper: wilson(misses.length, rows.length).upper,
    ratio: ratio / rows.length,
  };
}

describe('the H7 fresh sample', () => {
  it('misses none of 274 fresh mutants: the Wilson upper bound is below 5%', () => {
    expect(stored.mutants.length + stored.gate_failed.length).toBe(300);
    expect(stored.gate_failed).toHaveLength(26);
    expect(fresh.mutants.map((m) => m.variant)).toEqual(stored.mutants.map((m) => m.variant));
    const result = study(fresh.mutants);
    expect(result.n).toBe(274);
    expect(fresh.mutants.filter((m) => m.E.length > 0)).toHaveLength(82);
    expect(result.misses).toEqual([]);
    expect(result.upper).toBeCloseTo(0.0138, 3);
    expect(result.upper).toBeLessThanOrEqual(0.05);
    expect(result.ratio).toBeCloseTo(0.5735, 3);
  }, 300_000);

  it('would miss without the marks: the same sample with the links alone', () => {
    const bare = specs.map(({ spec, hash }) => ({
      hash,
      spec: { ...spec, metadata: { ...spec.metadata, rerun: [] } } as Spec,
    }));
    const keep = specs.splice(0, specs.length, ...bare);
    try {
      const result = study(fresh.mutants);
      expect(result.misses).toHaveLength(7);
      expect(result.upper).toBeCloseTo(0.0518, 3);
      expect(result.ratio).toBeCloseTo(0.4978, 3);
    } finally {
      specs.splice(0, specs.length, ...keep);
    }
  }, 300_000);
});
