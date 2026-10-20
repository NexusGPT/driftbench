import { readFileSync } from 'node:fs';
import {
  type BlockLink,
  type ChangeManifest,
  parseSectionRegistry,
  type RadiusSpec,
  type RerunMark,
  rerunMarks,
  type Spec,
  sectionSelection,
} from '@agent-nexus/driftbench-core';
import { wilson } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { blockSections, sectionsNamingTools } from '../../src/blocks/sections';

/**
 * The H7 study (research/block-links, and its second sample research/ledger-h7) with the links the block
 * writer gives a block that expects a call of a tool: the sections that name the tool. The registered data
 * are the Acme stand-in prompt of 30 sections, its 19 conversations and 37 blocks with their declared section
 * links, the tools each block's checks expect, and the blocks each mutant flipped (E, confirmed). A mutant
 * violates safety when a block it flipped is outside the selection (flaky blocks excluded, as registered).
 */

const repo = (path: string) => new URL(`../../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(repo(path), 'utf8');
const fixtures = 'packages/core/test/fixtures/sections';
const promptText = read('examples/acme/prompts/acme-sales.md');
const parsed = parseSectionRegistry(parseYaml(read('examples/acme/prompts/acme-sales.sections.yaml')));
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const registry = parsed.registry;
const sections = blockSections([{ path: 'acme-sales.md', text: promptText, registry }]);

type Mutants = { variant: string; sections: string[]; control?: boolean; pair?: boolean; E: string[] }[];
const h7: {
  flaky: string[];
  conversations: { id: string; blocks: { id: string; links: string[] }[] }[];
  mutants: Mutants;
} = JSON.parse(read(`${fixtures}/h7-selection.json`));
const second: { mutants: Mutants } = JSON.parse(read(`${fixtures}/h7-selection-300.json`));
const toolsOf: { tools: string[]; blocks: Record<string, string[]> } = JSON.parse(
  read(`${fixtures}/h7-block-tools.json`),
);

const globals = registry.sections
  .filter((section) => section.scope === 'global')
  .map((section) => section.id);
const flaky = new Set(h7.flaky);
const stable = h7.conversations.flatMap((c) => c.blocks.map((b) => b.id)).filter((id) => !flaky.has(id));

/** The suite with the links of each block: declared, then (when asked) the sections naming its tools. */
function specsWith(withTools: boolean, marks: readonly RerunMark[] = []): RadiusSpec[] {
  return h7.conversations.map((conversation) => ({
    hash: conversation.id,
    spec: {
      id: conversation.id,
      kind: 'conversation',
      blocks: conversation.blocks.map((block) => ({ id: block.id, when: { user: '.' } })),
      metadata: {
        rerun: marks.filter((mark) => conversation.blocks.some((block) => block.id === mark.block)),
        links: conversation.blocks.flatMap((block) => {
          const own = [...block.links, ...globals].map((section) => ({ section }));
          const named = withTools
            ? sectionsNamingTools(sections, toolsOf.blocks[block.id] ?? [], (label) =>
                toolsOf.tools.includes(label),
              ).map((ref) => ({ section: ref.section }))
            : [];
          return [...own, ...named].map(
            ({ section }): BlockLink => ({
              block: block.id,
              to: { kind: 'prompt_section', prompt: 'acme-sales', section },
              status: 'declared',
            }),
          );
        }),
      },
    } as Spec,
  }));
}

function study(rows: Mutants, withTools: boolean, marks: readonly RerunMark[] = []) {
  const specs = specsWith(withTools, marks);
  const misses: string[] = [];
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
    if (mutant.E.some((id) => !T.has(id))) misses.push(mutant.variant);
    ratio += T.size / stable.length;
  }
  return {
    n: rows.length,
    misses,
    upper: wilson(misses.length, rows.length).upper,
    ratio: ratio / rows.length,
  };
}

/** The blocks the links alone select for each mutant: the input of the fragile procedure. */
function selectedByLinks(rows: Mutants) {
  const specs = specsWith(true);
  return rows.map((mutant) => {
    const manifest: ChangeManifest = {
      from: 'v1',
      to: 'mutant',
      changes: mutant.sections.map((section) => ({ kind: 'prompt_section', id: `acme-sales#${section}` })),
    };
    const selection = sectionSelection(specs, manifest, [registry]);
    return {
      id: mutant.variant,
      flipped: mutant.E,
      selected: selection.specs.flatMap((spec) =>
        spec.blocks.filter((b) => b.state !== 'out').map((b) => b.id),
      ),
    };
  });
}
const baseline: { repeats: number; fails: Record<string, boolean[]> } = JSON.parse(
  read(`${fixtures}/h7-baseline.json`),
);
/** Calibration: the marks the two procedures give on the 290, with the flaky blocks left out. */
const calibrated = rerunMarks({
  baseline: baseline.fails,
  mutants: selectedByLinks(second.mutants),
  excluded: flaky,
});
const frozen: RerunMark[] = JSON.parse(read(`${fixtures}/h7-rerun-marks.json`)).marks;

const ninety = h7.mutants.filter((m) => !m.control && !m.pair);
const hundredTen = h7.mutants.filter((m) => !m.control);

describe('the H7 study with the links of the tools a block expects', () => {
  it('names a section for a tool as written: the five Acme tools', () => {
    expect(sections.naming('order_create').map((ref) => ref.section)).toEqual(
      expect.arrayContaining(['explicit_confirm', 'upgrade_order', 'order_failure']),
    );
    expect(sections.naming('port_check').map((ref) => ref.section)).toEqual(
      expect.arrayContaining(['porting_check_first', 'porting_ineligible']),
    );
    expect(sections.naming('nosuchtool')).toEqual([]);
  });

  it('freezes the marks the procedures give on the 290, and marks p1 for failing at baseline', () => {
    expect(calibrated).toEqual(frozen);
    expect(calibrated.find((mark) => mark.block === 'p1')).toMatchObject({
      reason: 'fails_at_baseline',
      evidence: { failed: 12, repeats: 12 },
    });
  });

  it('with the frozen marks: 1 miss of the 290 (calibration), none of the 90 and the 110 (not used to calibrate)', () => {
    const tools = study(second.mutants, true);
    const marked = study(second.mutants, true, frozen);
    expect(tools.misses).toHaveLength(8);
    expect(marked.misses).toEqual(['mobile_new_line__negate__n0']);
    expect(marked.upper).toBeCloseTo(0.0193, 3);
    expect(marked.ratio).toBeCloseTo(0.569, 3);
    expect(study(ninety, true, frozen).misses).toEqual([]);
    expect(study(hundredTen, true, frozen).misses).toEqual([]);
    expect(study(hundredTen, true, frozen).ratio).toBeCloseTo(0.591, 3);
  }, 300_000);

  it('removes 4 of the 12 misses of the 290 mutants, and one of the first sample, at a larger selection', () => {
    const before = study(second.mutants, false);
    const after = study(second.mutants, true);
    expect(before.misses).toHaveLength(12);
    expect(after.misses).toEqual([
      'home_address_unknown__rephrase__n2',
      'mobile_new_line__negate__n0',
      'mobile_new_line__negate__n3',
      'new_customer_details__negate__n0',
      'new_customer_details__negate__n4',
      'order_failure__negate__n1',
      'upgrade_more_data__negate__n0',
      'upgrade_more_data__negate__n1',
    ]);
    expect(before.upper).toBeCloseTo(0.0709, 3);
    expect(after.upper).toBeCloseTo(0.0535, 3);
    expect(before.ratio).toBeCloseTo(0.2326, 3);
    expect(after.ratio).toBeCloseTo(0.493, 3);
    // The gate of the selection is at or below 5%: it is still not met on this set.
    expect(after.upper).toBeGreaterThan(0.05);
    expect(study(ninety, false).misses).toHaveLength(2);
    expect(study(ninety, true).misses).toEqual(['mobile_new_line__negate']);
    expect(study(hundredTen, false).misses).toHaveLength(4);
    expect(study(hundredTen, true).misses).toHaveLength(3);
  }, 300_000);
});
