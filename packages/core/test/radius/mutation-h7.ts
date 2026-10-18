import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { MutationRecord, SuiteRun } from '../../src/radius/mutants';
import { analyseMutation, promoteLinks } from '../../src/radius/mutation-analysis';
import type { RadiusSpec } from '../../src/radius/radius';
import { parseSectionRegistry, type SectionRegistry } from '../../src/radius/sections';
import type { BlockLink } from '../../src/schema/links';
import type { Spec } from '../../src/schema/spec';

/**
 * The stored H7 mutation runs (research/block-links) as a mutation record, with the H7 suite as specs:
 * 19 conversations, 37 blocks, each conversation one spec, the declared links of the suite.
 */

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/sections/${name}`, import.meta.url), 'utf8'));

const parsed = parseSectionRegistry(
  parseYaml(
    readFileSync(
      new URL('../../../../examples/acme/prompts/acme-sales.sections.yaml', import.meta.url),
      'utf8',
    ),
  ),
);
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
export const registry: SectionRegistry = parsed.registry;

type Selection = {
  flaky: string[];
  conversations: { id: string; blocks: { id: string; links: string[] }[] }[];
  mutants: { variant: string; sections: string[]; control: boolean; pair: boolean; E: string[] }[];
};
type Runs = {
  order: string[];
  baseline: string[];
  mutants: {
    variant: string;
    sections: string[];
    op: string;
    control: boolean;
    pair: boolean;
    stage1: string[];
    confirm: string[];
  }[];
};

export const h7: Selection = fixture('h7-selection.json');
const runs: Runs = fixture('h7-runs.json');

/** The block key `spec#block` of each H7 block id. */
export const keyOf = new Map(h7.conversations.flatMap((c) => c.blocks.map((b) => [b.id, `${c.id}#${b.id}`])));

const toRun = (text: string): SuiteRun =>
  Object.fromEntries(
    [...text].flatMap((char, at) =>
      char === '-' ? [] : [[keyOf.get(runs.order[at] as string) as string, char === '1']],
    ),
  );

export function h7Record(id = 'h7'): MutationRecord {
  return {
    kind: 'driftbench.mutation-run',
    version: 1,
    id,
    prompt: { id: registry.prompt_id, version: registry.version, text_sha256: registry.text_sha256 },
    conversations: h7.conversations.map((c) => c.id),
    rules: { runs: 3, confirm_runs: 3, kill: 2, confirm: 2 },
    baseline: runs.baseline.map(toRun),
    mutants: runs.mutants.map((mutant) => ({
      id: mutant.variant,
      sections: mutant.sections,
      op: mutant.op as MutationRecord['mutants'][number]['op'],
      control: mutant.control,
      pair: mutant.pair,
      sha256: mutant.variant,
      stage1: mutant.stage1.map(toRun),
      confirm: mutant.confirm.map(toRun),
    })),
    refused: [],
    spend: { conversation_runs: 0, cached: 0, usd: 0 },
  };
}

const declared = (block: string, section: string): BlockLink => ({
  block,
  to: { kind: 'prompt_section', prompt: registry.prompt_id, section },
  status: 'declared',
  created_by: 'author',
});

export const h7Specs: Spec[] = h7.conversations.map((conversation) => ({
  id: conversation.id,
  kind: 'conversation',
  blocks: conversation.blocks.map((block) => ({ id: block.id, when: { user: '.' } })),
  metadata: {
    links: conversation.blocks.flatMap((block) => block.links.map((section) => declared(block.id, section))),
  },
}));

/** The H7 specs with the links the H7 run promotes, the evidence naming `run` as the run that verified them. */
export function promotedSpecs(run: string): RadiusSpec[] {
  const promotion = promoteLinks(h7Specs, analyseMutation(h7Record(run)), registry);
  return h7Specs.map((spec, at) => ({
    spec: { ...spec, metadata: { links: promotion.links[at]?.links ?? [] } },
    hash: `hash-${spec.id}`,
  }));
}
