import { readFileSync } from 'node:fs';
import {
  type BlockLink,
  parseSpecText,
  type SectionRegistry,
  type Spec,
  sectionsFromHeadings,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { blockSections } from '../../src/blocks/sections';
import { generateSuite } from '../../src/enumerate/generate';
import { generateEstateSuite } from '../../src/estate/generate';
import { prepareMap } from '../../src/seed/map';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';
import { FIXTURE, fixtureInputs, HAND_PATHS } from '../estate/support';

// Fictional data only: Zed Bank and the Northwind estate.

function registryOf(text: string, promptId: string, references: Record<string, string[]>): SectionRegistry {
  const made = sectionsFromHeadings(text, { promptId, version: 'v1' });
  if (!made.ok) throw new Error(made.errors.join('\n'));
  return {
    ...made.registry,
    sections: made.registry.sections.map((section) => ({
      ...section,
      scope: 'local' as const,
      ...(references[section.id] ? { references: references[section.id] } : {}),
    })),
  };
}

function parsed(files: ReadonlyArray<{ path: string; text: string }>): Spec[] {
  return files
    .filter((file) => file.path.endsWith('.yaml'))
    .map((file) => {
      const loaded = parseSpecText(file.text, 'yaml', file.path);
      if (!loaded.ok) throw new Error(`${file.path}: ${JSON.stringify(loaded.errors)}`);
      return loaded.spec;
    });
}

const sectionLinks = (spec: Spec, block: string) =>
  ((spec.metadata?.links ?? []) as BlockLink[]).filter(
    (link) => link.block === block && link.to.kind === 'prompt_section',
  );

/** The Zed prompt: the card rule ends on a confirmation, which its own section decides. */
const ZED_PROMPT = [
  '# Zed Bank assistant',
  '',
  '## Stages',
  'Stages, in order: greet, verify, help.',
  '',
  '## Cards',
  'A lost card is blocked at once. Reply CONFIRM to block it.',
  '',
  '## Confirmation',
  'Act only after the customer writes CONFIRM.',
  '',
  '## Balance',
  'Read the balance with lookup and say it in euros.',
  '',
].join('\n');

function zedWithQuotes() {
  const proposal = zedProposal();
  return {
    ...proposal,
    dimensions: proposal.dimensions.map((dimension) =>
      dimension.id === 'flow'
        ? {
            ...dimension,
            values: dimension.values.map((value) => ({
              ...value,
              evidence: {
                source: 'prompt.md',
                quote:
                  value.id === 'card'
                    ? 'A lost card is blocked at once.'
                    : 'Read the balance with lookup and say it in euros.',
              },
            })),
          }
        : dimension,
    ),
  };
}

describe('generate with a section registry of the prompt', () => {
  const registry = registryOf(ZED_PROMPT, 'zed', { cards: ['confirmation'] });
  const sections = blockSections([{ path: 'prompt.md', text: ZED_PROMPT, registry }]);

  it('links each block to the sections that hold its values, and to the sections that reach them', () => {
    const prepared = prepareMap(zedWithQuotes(), { tools: ZED_TOOLS });
    const specs = parsed(generateSuite(prepared, { mapPath: '../map.yaml', sections }).files);
    let card = 0;
    let balance = 0;
    for (const spec of specs) {
      const generated = spec.metadata?.generated as {
        blocks: Array<{ block: string; cell: Record<string, string> }>;
      };
      for (const record of generated.blocks) {
        const own = sectionLinks(spec, record.block);
        const ids = own.map((link) => (link.to.kind === 'prompt_section' ? link.to.section : ''));
        if (record.cell.flow === 'card') {
          card++;
          expect(ids, `${spec.id} ${record.block}`).toEqual(
            expect.arrayContaining(['cards', 'confirmation']),
          );
          expect(
            own.find((link) => link.to.kind === 'prompt_section' && link.to.section === 'confirmation'),
          ).toMatchObject({
            to: { kind: 'prompt_section', prompt: 'zed', section: 'confirmation' },
            status: 'declared',
            created_by: 'generator',
            at_version: 'v1',
            evidence: { declared: { through: 'cards' } },
          });
        }
        if (record.cell.flow === 'balance') {
          balance++;
          expect(ids, `${spec.id} ${record.block}`).toContain('balance');
          expect(ids).not.toContain('confirmation');
        }
        // Every value of the other dimensions is quoted from the stages line.
        for (const id of ids) expect(['stages', 'cards', 'confirmation', 'balance']).toContain(id);
      }
    }
    expect(card).toBeGreaterThan(0);
    expect(balance).toBeGreaterThan(0);
  });

  it('writes no section link without a registry, and none for a quote of another file', () => {
    const prepared = prepareMap(zedWithQuotes(), { tools: ZED_TOOLS });
    const plain = parsed(generateSuite(prepared, { mapPath: '../map.yaml' }).files);
    for (const spec of plain)
      expect(
        ((spec.metadata?.links ?? []) as BlockLink[]).some((link) => link.to.kind === 'prompt_section'),
      ).toBe(false);
    const elsewhere = blockSections([{ path: 'other.md', text: ZED_PROMPT, registry }]);
    const none = parsed(generateSuite(prepared, { mapPath: '../map.yaml', sections: elsewhere }).files);
    // No quote is found in another file, so no section is linked for a rule; a tool a prompt names still is.
    for (const spec of none)
      expect(
        ((spec.metadata?.links ?? []) as BlockLink[]).some(
          (link) => link.to.kind === 'prompt_section' && link.relation !== 'exercises',
        ),
      ).toBe(false);
  });

  it('links a block that expects a tool call to the sections that name the tool', () => {
    const prepared = prepareMap(zedWithQuotes(), { tools: ZED_TOOLS });
    const specs = parsed(generateSuite(prepared, { mapPath: '../map.yaml', sections }).files);
    const expecting = (spec: Spec, block: string) =>
      (spec.blocks.find((each) => each.id === block)?.expect?.tools ?? []).map(
        (tool: { label: string }) => tool.label,
      );
    let named = 0;
    let unnamed = 0;
    for (const spec of specs) {
      for (const block of spec.blocks) {
        const id = block.id as string;
        const labels = expecting(spec, id);
        const byTool = sectionLinks(spec, id).filter((link) => link.relation === 'exercises');
        if (labels.includes('lookup')) {
          named++;
          const link = byTool.find(
            (each) => each.to.kind === 'prompt_section' && each.to.section === 'balance',
          );
          expect(link, `${spec.id} ${id}`).toMatchObject({
            to: { kind: 'prompt_section', prompt: 'zed', section: 'balance' },
            relation: 'exercises',
            status: 'declared',
            created_by: 'generator',
            evidence: { declared: { through: 'lookup' } },
          });
        } else if (labels.length === 0) {
          unnamed++;
          expect(byTool, `${spec.id} ${id}`).toEqual([]);
        }
      }
    }
    expect(named).toBeGreaterThan(0);
    expect(unnamed).toBeGreaterThan(0);
  });

  it('finds the sections that name a declared identifier as written, never a stale one or a part of a word', () => {
    expect(sections.naming('lookup').map((ref) => ref.section)).toEqual(['balance']);
    expect(sections.naming('look')).toEqual([]);
    expect(sections.naming('lookups')).toEqual([]);
    expect(sections.naming('')).toEqual([]);
    expect(sections.naming('nosuchtool')).toEqual([]);
    const stale = blockSections([
      {
        path: 'prompt.md',
        text: ZED_PROMPT,
        registry: {
          ...registry,
          sections: registry.sections.map((section) =>
            section.id === 'balance' ? { ...section, stale: true } : section,
          ),
        },
      },
    ]);
    expect(stale.naming('lookup')).toEqual([]);
  });
});

describe('estate generate with a section registry of CLAUDE.md', () => {
  it('links each block to the sections that hold its atoms, and to the sections that reach them', async () => {
    const text = readFileSync(`${FIXTURE}CLAUDE.md`, 'utf8');
    const registry = registryOf(text, 'northwind', { rules: ['output'] });
    const sections = blockSections([{ path: 'CLAUDE.md', text, registry }]);
    const input = await fixtureInputs();
    const specs = parsed(generateEstateSuite(input, { paths: HAND_PATHS, sections }).files);
    const inSection = (id: string) =>
      new Set(
        input.map.atoms
          .filter((atom) => atom.provenance?.file === 'CLAUDE.md')
          .filter((atom) => {
            const at = text.indexOf(atom.provenance?.quote ?? '\u0000');
            const section = registry.sections.find((each) => each.id === id);
            return section !== undefined && at >= section.span.start && at < section.span.end;
          })
          .map((atom) => atom.id),
      );
    const inRules = inSection('rules');
    const inOutput = inSection('output');
    expect(inRules.size).toBeGreaterThan(0);
    let checked = 0;
    for (const spec of specs) {
      const estate = spec.metadata?.estate as { atoms: string[]; testType: string };
      // A spec with an atom of the output section links it directly, not through the rules.
      if (!estate.atoms.some((id) => inRules.has(id)) || estate.atoms.some((id) => inOutput.has(id)))
        continue;
      const own = sectionLinks(spec, String(spec.blocks[0]?.id));
      const output = own.find((link) => link.to.kind === 'prompt_section' && link.to.section === 'output');
      expect(
        own.map((link) => (link.to.kind === 'prompt_section' ? link.to.section : '')),
        spec.id,
      ).toContain('rules');
      expect(output, spec.id).toMatchObject({ evidence: { declared: { through: 'rules' } } });
      const negative = ['outside_trigger', 'route_near_miss', 'guard_negative'].includes(estate.testType);
      expect(output?.relation).toBe(negative ? 'exercises' : 'verifies');
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
