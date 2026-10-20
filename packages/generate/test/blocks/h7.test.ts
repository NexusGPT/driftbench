import { readFileSync } from 'node:fs';
import {
  type BlockLink,
  parseSectionRegistry,
  type SectionRegistry,
  sectionsReaching,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { writeBlocks } from '../../src/blocks/writer';

/**
 * The H7 study (research/block-links): 19 conversations of the Acme sales prompt, each block with the sections
 * it was written for, and for each mutant of a section the blocks that flipped (E). A mutant is missed when a
 * stable block flips that no link reaches: neither its own links nor a link of an earlier block of the same
 * conversation (forward closure). Fictional data only.
 */
type H7 = {
  flaky: string[];
  conversations: { id: string; blocks: { id: string; links: string[] }[] }[];
  mutants: { variant: string; sections: string[]; control: boolean; pair: boolean; E: string[] }[];
};
const h7: H7 = JSON.parse(
  readFileSync(new URL('../../../core/test/fixtures/sections/h7-selection.json', import.meta.url), 'utf8'),
);
const parsed = parseSectionRegistry(
  parseYaml(
    readFileSync(
      new URL('../../../../examples/acme/prompts/acme-sales.sections.yaml', import.meta.url),
      'utf8',
    ),
  ),
);
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const committed: SectionRegistry = parsed.registry;

/**
 * The registry with the two references the prompt states and the committed registry leaves out: the recap ends
 * with "Reply CONFIRM to place the order", which the explicit confirmation rule decides; a number that is not
 * eligible may "take a new Acme number", the new mobile line flow.
 */
const declared: SectionRegistry = {
  ...committed,
  sections: committed.sections.map((section) =>
    section.id === 'recap'
      ? { ...section, references: [...(section.references ?? []), 'explicit_confirm'] }
      : section.id === 'porting_ineligible'
        ? { ...section, references: [...(section.references ?? []), 'mobile_new_line'] }
        : section,
  ),
};

const globals = committed.sections
  .filter((section) => section.scope === 'global')
  .map((section) => section.id);

/** The links the block writer writes for every block of the suite, with or without the registry's reach. */
function suiteLinks(registry?: SectionRegistry): Map<string, BlockLink[]> {
  const out = new Map<string, BlockLink[]>();
  const options = registry ? { reaches: sectionsReaching(registry) } : {};
  for (const conversation of h7.conversations) {
    const { links } = writeBlocks(
      conversation.blocks.map((block) => ({
        block: { id: block.id },
        origin: {
          rules: [...block.links, ...globals].map((rule) => ({ rule })),
          row: { id: conversation.id, values: {} },
        },
      })),
      'v1',
      options,
    );
    out.set(conversation.id, links);
  }
  return out;
}

/** The stable blocks each mutant flips that no link reaches, by mutant. */
function missed(links: Map<string, BlockLink[]>, which: (mutant: H7['mutants'][number]) => boolean) {
  const flaky = new Set(h7.flaky);
  const out: Record<string, string[]> = {};
  for (const mutant of h7.mutants.filter(which)) {
    const reached = new Set<string>();
    for (const conversation of h7.conversations) {
      const own = links.get(conversation.id) ?? [];
      const first = conversation.blocks.findIndex((block) =>
        own.some(
          (link) =>
            link.block === block.id && link.to.kind === 'rule' && mutant.sections.includes(link.to.rule),
        ),
      );
      if (first >= 0) for (const block of conversation.blocks.slice(first)) reached.add(block.id);
    }
    const lost = mutant.E.filter((block) => !flaky.has(block) && !reached.has(block));
    if (lost.length > 0) out[mutant.variant] = lost;
  }
  return out;
}

const single = (mutant: H7['mutants'][number]) => !mutant.control && !mutant.pair;
const all = (mutant: H7['mutants'][number]) => !mutant.control;

describe('the H7 cases of missing links, written by the block writer', () => {
  it('without the reach of the registry, the two cases of the ledger study are missed', () => {
    expect(missed(suiteLinks(), single)).toEqual({
      explicit_confirm__negate: ['h3', 'ly2', 'of1', 'p2', 'pl2', 'u3'],
      mobile_new_line__negate: ['pl3'],
    });
  });

  it('with the registry that declares the two references, every recap block links explicit_confirm and porting-locked links mobile_new_line', () => {
    const links = suiteLinks(declared);
    const rulesOf = (conversation: string, block: string) =>
      (links.get(conversation) ?? [])
        .filter((link) => link.block === block && link.to.kind === 'rule')
        .map((link) => (link.to.kind === 'rule' ? link.to.rule : ''));
    for (const [conversation, block] of [
      ['home-happy', 'h3'],
      ['upgrade-loose-yes', 'ly2'],
      ['order-failure', 'of1'],
      ['porting-ok', 'p2'],
      ['porting-locked', 'pl2'],
      ['upgrade-happy', 'u3'],
    ] as const)
      expect(rulesOf(conversation, block), `${conversation} ${block}`).toContain('explicit_confirm');
    expect(rulesOf('porting-locked', 'pl2')).toContain('mobile_new_line');
    const through = (links.get('home-happy') ?? []).find(
      (link) => link.block === 'h3' && link.to.kind === 'rule' && link.to.rule === 'explicit_confirm',
    );
    expect(through).toMatchObject({ status: 'declared', evidence: { declared: { through: 'recap' } } });
  });

  it('with them, no mutant of one section misses a stable block, and none of the pairs does', () => {
    expect(missed(suiteLinks(declared), single)).toEqual({});
    expect(missed(suiteLinks(declared), all)).toEqual({});
  });
});
