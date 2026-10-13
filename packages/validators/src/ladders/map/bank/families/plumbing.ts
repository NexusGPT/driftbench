import { type LoadResult, validateSpec } from '@agent-nexus/driftbench-core';
import {
  approveDimensions,
  type Proposal,
  QuoteIndex,
  renderProposal,
  toSpaceMap,
} from '@agent-nexus/driftbench-generate';
import {
  chaoCoverage,
  completeness,
  fromInventory,
  type SpaceMap,
  validateSpaceMap,
} from '@agent-nexus/driftbench-space';
import { stringify } from 'yaml';
import type { Draw } from '../../spec';
import { drawFor, inventoryYaml, miniInventory, TOOL_POOL } from '../common';
import { runCase } from '../run';
import { type BankItem, levelOf, type Outcome, type Tier } from '../types';

/**
 * Items on the code around the proposal and the space map: the quote index, the space map a proposal
 * becomes, approving dimensions in a proposal file, and the estimators, seed map and loader of the space
 * package. Each compares the code with a reference computed here by brute force, by a formula or by
 * construction. They sit in the constraints family, next to the space items.
 */

const ALL_CLASSES = [
  'D1_off_topic',
  'D2_goal_shift',
  'D3_contradiction',
  'D4_loose_confirmation',
  'D5_language_switch',
  'D6_instruction_in_data',
  'D7_silence_or_burst',
  'D8_tool_failure',
  'D9_out_of_scope',
  'D10_return',
] as const;

type PlumbingCase = {
  slug: string;
  tier: Tier;
  title: string;
  cause: string;
  component: string;
  run(draw: Draw): Promise<Outcome> | Outcome;
};

const same = (label: string, actual: unknown, expected: unknown): Outcome =>
  JSON.stringify(actual) === JSON.stringify(expected)
    ? { pass: true, detail: `${label}: as expected` }
    : {
        pass: false,
        detail: `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
      };

const first = (outcomes: Outcome[]): Outcome =>
  outcomes.find((outcome) => !outcome.pass) ?? { pass: true, detail: 'as expected' };

/** The proposal the pipeline gives for a drawn inventory and one tool file, tools listed first. */
async function proposalOf(draw: Draw): Promise<{ proposal: Proposal; inventoryPath: string } | Outcome> {
  const inventory = miniInventory(draw);
  const inventoryPath = draw.pick(['inventory.yaml', 'behaviours/inventory.yaml', 'phase0/inventory.yaml']);
  const tool = draw.pick(TOOL_POOL);
  const tools = `# Tool schemas written by the map validator. Every name is fictional.\n${stringify(
    {
      tools: [
        {
          name: tool,
          description: 'A fictional tool of the map validator.',
          input_schema: {
            type: 'object',
            required: ['level'],
            properties: { level: { type: 'string', enum: ['low', 'high'] } },
          },
        },
      ],
    },
    { lineWidth: 0 },
  )}`;
  const run = await runCase({
    label: 'plumbing',
    sources: [
      { kind: 'tools', path: 'tools.yaml', text: tools },
      { kind: 'inventory', path: inventoryPath, text: inventoryYaml(inventory) },
    ],
    planted: [],
  });
  if (!run.result.ok) {
    return {
      pass: false,
      detail: `the extractor gave no proposal: ${run.result.errors[0]?.message ?? run.error}`,
    };
  }
  return { proposal: run.result.proposal, inventoryPath };
}

const isOutcome = (value: unknown): value is Outcome =>
  typeof value === 'object' && value !== null && 'pass' in value;

/** The space map of a proposal by its documented rule, written out here. */
function referenceMap(proposal: Proposal, inventoryPath: string) {
  const dimensions = proposal.dimensions
    .filter((dimension) => dimension.role === 'axis')
    .map((dimension) => {
      const values = dimension.values.map((value) => ({ id: value.id, title: value.title }));
      const withNone =
        dimension.kind === 'deviation' && !values.some((value) => value.id === 'none')
          ? [{ id: 'none', title: 'No deviation' }, ...values]
          : values;
      return { id: dimension.id, title: dimension.title, kind: dimension.kind, values: withNone };
    })
    .filter((dimension) => dimension.values.length > 0);
  return { inventory: inventoryPath, dimensions };
}

/** A spec on a one-dimension map that shows the cell of `stage`. */
function stageSpec(stage: string, index: number): LoadResult {
  const result = validateSpec(
    { id: `s${index}`, blocks: [{ user: 'next', expect: { stage, must: ['ok'] } }] },
    `specs/s${index}.yaml`,
  );
  if (!result.ok) throw new Error(`the item built an invalid spec: ${JSON.stringify(result.errors[0])}`);
  return result;
}

const GENERATE = 'packages/generate/src/extract';
const SPACE = 'packages/space/src';

export const PLUMBING_CASES: readonly PlumbingCase[] = [
  {
    slug: 'quote-index',
    tier: 1,
    title:
      'the quote index finds a quote its source holds (white space folded), misses one it does not, and never finds a blank quote',
    cause: 'quote:index',
    component: GENERATE,
    run: (draw) => {
      const words = draw.subset(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'], 4);
      const text = `${words.join('\n   ')}\n`;
      const index = new QuoteIndex(new Map([['source.md', text]]));
      return first([
        same(
          'a quote the source holds, across lines',
          index.contains('source.md', `${words[0]} ${words[1]}`),
          true,
        ),
        same(
          'a quote the source does not hold',
          index.contains('source.md', `${words[1]} ${words[0]}`),
          false,
        ),
        same('a blank quote', index.contains('source.md', draw.pick(['', ' ', '\n\t '])), false),
        same('an unknown source', index.contains('other.md', words[0] as string), false),
      ]);
    },
  },
  {
    slug: 'proposal-space-map',
    tier: 2,
    title:
      'the space map of a proposal (tools listed first) keeps its axis dimensions, puts none first among the deviation values, and names the inventory file as its inventory',
    cause: 'spacemap:from-proposal',
    component: GENERATE,
    run: async (draw) => {
      const got = await proposalOf(draw);
      if (isOutcome(got)) return got;
      const map = toSpaceMap(got.proposal);
      return same(
        'the space map',
        { inventory: map.inventory, dimensions: map.dimensions },
        referenceMap(got.proposal, got.inventoryPath),
      );
    },
  },
  {
    slug: 'approve-twice',
    tier: 2,
    title:
      'approving a dimension, then it and another, reports the first as already approved and only the second as newly approved',
    cause: 'approve:already',
    component: GENERATE,
    run: async (draw) => {
      const got = await proposalOf(draw);
      if (isOutcome(got)) return got;
      const ids = got.proposal.dimensions.filter((dimension) => dimension.approved !== true).map((d) => d.id);
      if (ids.length < 2)
        return { pass: false, detail: 'the proposal has fewer than two unapproved dimensions' };
      const [a, b] = draw.subset(ids, 2) as [string, string];
      const once = approveDimensions(renderProposal(got.proposal), [a]);
      if (!once.ok) return { pass: false, detail: `the first approval failed: ${once.errors[0]?.message}` };
      const twice = approveDimensions(once.text, [a, b]);
      if (!twice.ok)
        return { pass: false, detail: `the second approval failed: ${twice.errors[0]?.message}` };
      return first([
        same(
          `first approval of ${a}`,
          { approved: once.approved, already: once.already },
          { approved: [a], already: [] },
        ),
        same(
          `second approval of ${a} and ${b}`,
          { approved: twice.approved, already: twice.already },
          { approved: [b], already: [a] },
        ),
      ]);
    },
  },
  {
    slug: 'space-chao-coverage',
    tier: 2,
    title: 'chaoCoverage equals 1 - (f1/n)((n-1)f1/((n-1)f1+2f2)) on drawn counts, and 1 when f1 is 0',
    cause: 'space:chao-coverage',
    component: SPACE,
    run: (draw) => {
      const outcomes: Outcome[] = [];
      for (let i = 0; i < 6; i++) {
        const n = draw.int(2, 60);
        const f1 = i === 0 ? 0 : draw.int(1, n);
        const f2 = draw.int(0, Math.floor((n - f1) / 2));
        const want = f1 === 0 ? 1 : 1 - (f1 / n) * (((n - 1) * f1) / ((n - 1) * f1 + 2 * f2));
        outcomes.push(
          same(
            `chaoCoverage(${f1}, ${f2}, ${n})`,
            Math.round(chaoCoverage(f1, f2, n) * 1e9),
            Math.round(want * 1e9),
          ),
        );
      }
      return first(outcomes);
    },
  },
  {
    slug: 'space-printable-at-cells',
    tier: 2,
    title: 'completeness is printable with as many conversations as cells, and not with one fewer',
    cause: 'space:printable',
    component: SPACE,
    run: (draw) => {
      const stages = Array.from({ length: draw.int(2, 5) }, (_, i) => `s${i + 1}`);
      const loaded = validateSpaceMap({
        version: '1',
        agent: 'a',
        dimensions: [
          { id: 'stage', title: 'Stage', kind: 'stage', values: stages.map((id) => ({ id, title: id })) },
        ],
        constraints: [],
        prior: { kind: 'declared' },
      });
      if (!loaded.ok)
        return { pass: false, detail: `the item built an invalid map: ${loaded.errors[0]?.message}` };
      const map: SpaceMap = loaded.map;
      const specs = stages.map((stage, index) => stageSpec(stage, index));
      const full = completeness(map, specs, { iterations: 20 });
      const short = completeness(map, specs.slice(1), { iterations: 20 });
      return first([
        same(
          `${specs.length} conversations for ${stages.length} cells`,
          [full.cells, full.conversations, full.printable],
          [stages.length, stages.length, true],
        ),
        same(`${specs.length - 1} conversations for ${stages.length} cells`, short.printable, false),
      ]);
    },
  },
  {
    slug: 'space-seed-deviations',
    tier: 2,
    title:
      'the seed map from an inventory lists none, then exactly the deviation classes its flows require, in class order',
    cause: 'space:seed-deviations',
    component: SPACE,
    run: (draw) => {
      const required = draw.subset([...ALL_CLASSES], draw.int(1, 4));
      const inventory = {
        channels: ['chat'],
        behaviours: [{ id: 'B-001', title: 'Greet the customer' }],
        flows: required.map((deviation, index) => ({
          id: `flow-${index + 1}`,
          title: `Flow ${index + 1}`,
          behaviours: ['B-001'],
          deviations: [deviation],
        })),
      };
      const map = fromInventory(inventory as Parameters<typeof fromInventory>[0], []);
      const deviation = map.dimensions.find((dimension) => dimension.id === 'deviation');
      return same(
        `deviation values for ${required.join(', ')}`,
        deviation?.values.map((value) => value.id),
        ['none', ...ALL_CLASSES.filter((id) => required.includes(id))],
      );
    },
  },
  {
    slug: 'space-partial-weights',
    tier: 2,
    title:
      'a space map that weighs some values of a dimension only is refused with SPACE_PRIOR_INCOMPLETE; one that weighs all of them loads',
    cause: 'space:prior-incomplete',
    component: SPACE,
    run: (draw) => {
      const count = draw.int(2, 4);
      const ids = Array.from({ length: count }, (_, i) => `v${i + 1}`);
      const gap = draw.int(0, count - 1);
      const mapWith = (weights: Array<number | undefined>) =>
        validateSpaceMap({
          version: '1',
          agent: 'a',
          dimensions: [
            {
              id: 'stage',
              title: 'Stage',
              kind: 'stage',
              values: ids.map((id, i) => ({
                id,
                title: id,
                ...(weights[i] === undefined ? {} : { weight: weights[i] }),
              })),
            },
          ],
          constraints: [],
          prior: { kind: 'declared' },
        });
      const partial = mapWith(ids.map((_, i) => (i === gap ? undefined : i + 1)));
      const all = mapWith(ids.map((_, i) => i + 1));
      return first([
        same(
          `weights on all values but v${gap + 1}`,
          partial.ok ? 'loaded' : partial.errors.map((error) => error.code),
          ['SPACE_PRIOR_INCOMPLETE'],
        ),
        same('weights on every value', all.ok ? 'loaded' : all.errors.map((error) => error.code), 'loaded'),
      ]);
    },
  },
];

export function plumbingItems(): BankItem[] {
  return PLUMBING_CASES.map((item) => ({
    id: `constraints.plumbing-${item.slug}`,
    family: 'constraints',
    tier: item.tier,
    level: levelOf('relations'),
    component: item.component,
    title: item.title,
    cause: item.cause,
    generate: () => [],
    check: () => ({ pass: false, detail: 'runs through run()' }),
    run: async (seed) => {
      // Three draws per seed: a reference over one draw proves little.
      for (let round = 0; round < 3; round++) {
        const outcome = await item.run(drawFor(seed, `plumbing.${item.slug}.${round}`));
        if (!outcome.pass) return outcome;
      }
      return { pass: true, detail: 'three draws as expected' };
    },
  }));
}
