import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { between, list, pick, type Rng, rngFor, SHOP, shuffled } from '../harness';
import type { BlocksProduct } from '../product';
import { type BankItem, expectAll, fail, PASS, type Tier } from '../types';

/**
 * Level 10: personas, one test played by different simulated users (PRs 418 and 444; the contract is
 * research/block-redesign/framework/persona/hf12/SCHEMA.md on research/block-framework-persona, and the object
 * kinds `persona` and `scenario` of PR 446). A persona owns who the user is (language, behaviour, stable
 * knowledge, expertise, misconceptions); a scenario owns what they want (intent, goal, start state); a block
 * owns its situational facts and its `requires`. The loader refuses an ownership violation, a slot the block
 * sets that a persona owns, a block belief contradicting a persona misconception, and a persona set that
 * changes along a parent chain. A block listing several personas is one cell per persona; a persona that fails
 * a `requires` key is refused as a `not_run` cell (`persona_incompatible`, naming the first failing key the
 * block lists) while the others run. Nothing here is built on main: every item is the roadmap of the feature.
 */

const PERSONA_LOADER = 'packages/users/src/simulated.ts';
const CAMPAIGN_PLAN = 'packages/cli/src/commands/campaign.ts';

type Persona = Record<string, unknown> & { id: string };

const LEVELS = ['novice', 'intermediate', 'advanced'] as const;

function persona(rng: Rng, id: string, overrides: Record<string, unknown> = {}): Persona {
  const name = pick(rng, SHOP.customers);
  return {
    kind: 'persona',
    id,
    language: 'en',
    lines: [`I rent a ${pick(rng, SHOP.bikes)} most weekends.`],
    behaviour: {
      verbosity: {
        short_turn_share: Number((0.2 + 0.6 * rng()).toFixed(2)),
        words_per_turn: between(rng, 3, 20),
      },
    },
    stable_knowledge: { email: `${name.split(' ')[0]?.toLowerCase()}@larkspur.example`, has_account: true },
    expertise: { level: pick(rng, LEVELS), always_known: ['where_booking_ref_is'] },
    misconceptions: [{ fact: 'helmets are free', true: false }],
    ...overrides,
  };
}

function scenario(id: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'scenario',
    id,
    intent: 'rent_a_bike',
    goal: {
      constraints: [{ slot: 'bike', value: 'Fern 3' }],
      requests: [{ slot: 'price' }],
      success_when: { must_be_told: ['price'] },
    },
    start_state: { prior_failed_contacts: 0 },
    ...overrides,
  };
}

/** A project folder with persona and scenario objects and one spec; returns the spec path. */
function project(
  dir: string,
  personas: readonly Persona[],
  scenarios: readonly Record<string, unknown>[],
  blocks: readonly Record<string, unknown>[],
): string {
  mkdirSync(join(dir, 'driftbench', 'persona'), { recursive: true });
  mkdirSync(join(dir, 'driftbench', 'scenario'), { recursive: true });
  writeFileSync(join(dir, 'driftbench.yaml'), stringify({}));
  for (const each of personas)
    writeFileSync(join(dir, 'driftbench', 'persona', `${each.id}.yaml`), stringify(each));
  for (const each of scenarios)
    writeFileSync(join(dir, 'driftbench', 'scenario', `${each.id as string}.yaml`), stringify(each));
  const path = join(dir, 'spec.yaml');
  writeFileSync(path, stringify({ id: 'larkspur-personas', channel: 'chat', blocks }));
  return path;
}

const simBlock = (
  id: string,
  personas: readonly string[] | undefined,
  extra: Record<string, unknown> = {},
  parent?: string,
) => ({
  id,
  ...(parent ? { parent } : {}),
  user: `[${id}] I would like to rent a bike.`,
  simulated_user: { scenario: 'rent-a-bike', ...(personas ? { personas: [...personas] } : {}), ...extra },
  expect: { must: ['bike'] },
});

type LoadCase = {
  id: string;
  tier: Tier;
  /** The class the loader must name, or undefined for a clean case that loads. */
  refuses: RegExp | undefined;
  build(
    rng: Rng,
    ids: string[],
  ): { personas: Persona[]; scenarios: Record<string, unknown>[]; blocks: Record<string, unknown>[] };
};

const LOAD_CASES: LoadCase[] = [
  {
    id: 'clean',
    tier: 1,
    refuses: undefined,
    build: (rng, ids) => ({
      personas: ids.map((id) => persona(rng, id)),
      scenarios: [scenario('rent-a-bike')],
      blocks: [simBlock('b1', ids)],
    }),
  },
  {
    id: 'clean-ref-slot',
    tier: 2,
    refuses: undefined,
    build: (rng, ids) => ({
      personas: ids.map((id) => persona(rng, id)),
      scenarios: [scenario('rent-a-bike')],
      blocks: [
        simBlock('b1', ids, {
          situational: { holds: [{ slot: 'email', ref: 'persona.email', reveal: 'on_request' }] },
        }),
      ],
    }),
  },
  {
    id: 'clean-override-belief',
    tier: 3,
    refuses: undefined,
    build: (rng, ids) => ({
      personas: ids.map((id) => persona(rng, id)),
      scenarios: [scenario('rent-a-bike')],
      blocks: [
        simBlock('b1', ids, {
          situational: { case_beliefs: [{ fact: 'Helmets are free', true: true, override: true }] },
        }),
      ],
    }),
  },
  {
    id: 'clean-chain-inherits',
    tier: 3,
    refuses: undefined,
    build: (rng, ids) => ({
      personas: ids.map((id) => persona(rng, id)),
      scenarios: [scenario('rent-a-bike')],
      blocks: [
        simBlock('b1', ids),
        simBlock('b2', undefined, {}, 'b1'),
        simBlock('b3', [...ids].reverse(), {}, 'b2'),
      ],
    }),
  },
  {
    id: 'scenario-sets-language',
    tier: 2,
    refuses: /ownership/i,
    build: (rng, ids) => ({
      personas: ids.map((id) => persona(rng, id)),
      scenarios: [scenario('rent-a-bike', { language: 'fr' })],
      blocks: [simBlock('b1', ids)],
    }),
  },
  {
    id: 'scenario-sets-verbosity',
    tier: 3,
    refuses: /ownership/i,
    build: (rng, ids) => ({
      personas: ids.map((id) => persona(rng, id)),
      scenarios: [scenario('rent-a-bike', { verbosity: { words_per_turn: 4 } })],
      blocks: [simBlock('b1', ids)],
    }),
  },
  {
    id: 'persona-sets-goal',
    tier: 2,
    refuses: /ownership/i,
    build: (rng, ids) => ({
      personas: ids.map((id, i) =>
        persona(rng, id, i === 0 ? { goal: { requests: [{ slot: 'price' }] } } : {}),
      ),
      scenarios: [scenario('rent-a-bike')],
      blocks: [simBlock('b1', ids)],
    }),
  },
  {
    id: 'situational-sets-behaviour',
    tier: 4,
    refuses: /ownership/i,
    build: (rng, ids) => ({
      personas: ids.map((id) => persona(rng, id)),
      scenarios: [scenario('rent-a-bike')],
      blocks: [simBlock('b1', ids, { situational: { behaviour: { patience: { turn_budget: 3 } } } })],
    }),
  },
  {
    id: 'slot-collision',
    tier: 3,
    refuses: /slot/i,
    build: (rng, ids) => ({
      personas: ids.map((id) => persona(rng, id)),
      scenarios: [scenario('rent-a-bike')],
      blocks: [
        simBlock('b1', ids, {
          situational: {
            holds: [{ slot: 'email', value: 'someone@larkspur.example', reveal: 'on_request' }],
          },
        }),
      ],
    }),
  },
  {
    id: 'contradictory-belief',
    tier: 4,
    refuses: /contradict/i,
    build: (rng, ids) => ({
      personas: ids.map((id) => persona(rng, id)),
      scenarios: [scenario('rent-a-bike')],
      blocks: [
        simBlock('b1', ids, { situational: { case_beliefs: [{ fact: '  Helmets are FREE ', true: true }] } }),
      ],
    }),
  },
  {
    id: 'persona-switch-in-chain',
    tier: 5,
    refuses: /switch|persona set/i,
    build: (rng, ids) => ({
      personas: [...ids, 'stranger'].map((id) => persona(rng, id)),
      scenarios: [scenario('rent-a-bike')],
      blocks: [
        simBlock('b1', ids),
        simBlock('b2', undefined, {}, 'b1'),
        simBlock('b3', [...ids.slice(1), 'stranger'], {}, 'b2'),
      ],
    }),
  },
];

function loaderItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const loadCase of LOAD_CASES) {
    for (const count of [2, 3]) {
      const id = `personas/loader/${loadCase.id}/${count}`;
      items.push({
        id,
        family: 'personas-loader',
        tier: loadCase.tier,
        level: 10,
        component: PERSONA_LOADER,
        title: `spec validate on a block played by ${count} personas (${loadCase.id.replace(/-/g, ' ')}) ${loadCase.refuses ? `is refused and names the class (${loadCase.refuses.source})` : 'loads'}`,
        cause: loadCase.refuses
          ? `The persona loader refuses ${loadCase.id.replace(/-/g, ' ')} as a load error naming its class.`
          : 'The loader accepts blocks played by persona and scenario objects.',
        check: async ({ seed, scratch, product }) => {
          const rng = rngFor(seed, id);
          const ids = shuffled(rng, [
            'terse-regular',
            'chatty-newcomer',
            'persistent-skeptic',
            'careful-planner',
          ]).slice(0, count);
          const dir = join(scratch, `${id.replace(/\//g, '-')}-${seed}`);
          const built = loadCase.build(rng, ids);
          const spec = project(dir, built.personas, built.scenarios, built.blocks);
          const result = await product.cli(['spec', 'validate', spec], dir);
          const text = `${result.out}\n${result.err}`;
          if (!loadCase.refuses)
            return result.code === 0
              ? PASS
              : fail(`spec validate exited ${result.code}: ${text.trim().slice(0, 240)}`);
          return expectAll([
            [result.code !== 0, 'spec validate accepted the spec'],
            [
              loadCase.refuses.test(text) && !/unknown key|unrecognized/i.test(text),
              `the refusal does not name the class: ${text.trim().slice(0, 240)}`,
            ],
          ]);
        },
      });
    }
  }
  return items;
}

type Requirement = { key: string; value: unknown; breaks: Record<string, unknown> };

const REQUIREMENTS: Requirement[] = [
  { key: 'language', value: 'en', breaks: { language: 'fr' } },
  { key: 'has_account', value: true, breaks: { stable_knowledge: { email: 'new@larkspur.example' } } },
  {
    key: 'concepts',
    value: ['where_booking_ref_is'],
    breaks: { expertise: { level: 'advanced', always_known: [] } },
  },
  {
    key: 'min_expertise',
    value: 'intermediate',
    breaks: { expertise: { level: 'novice', always_known: ['where_booking_ref_is'] } },
  },
];

/** One cell per persona; a persona failing a `requires` key is a not_run cell naming the key, the others run. */
function cellItems(): BankItem[] {
  const items: BankItem[] = [];
  const shapes = [
    { id: 'all-compatible', tier: 2, failing: 0 },
    { id: 'one-incompatible', tier: 3, failing: 1 },
    { id: 'two-incompatible', tier: 4, failing: 2 },
  ] as const;
  for (const requirement of REQUIREMENTS) {
    for (const shape of shapes) {
      for (const count of [2, 3]) {
        if (shape.failing >= count) continue;
        const id = `personas/cells/${requirement.key}/${shape.id}/${count}`;
        items.push({
          id,
          family: 'personas-cells',
          tier: Math.min(5, shape.tier + (count === 3 ? 1 : 0)) as Tier,
          level: 10,
          component: CAMPAIGN_PLAN,
          title: `campaign plan on a block played by ${count} personas that requires ${requirement.key} (${shape.id.replace(/-/g, ' ')}) plans one cell per persona and refuses only the incompatible ones as persona_incompatible on ${requirement.key}`,
          cause:
            shape.failing === 0
              ? 'A block listing several personas is planned as one cell per persona.'
              : `A persona failing the ${requirement.key} requirement is a not_run cell (persona_incompatible) while the other personas run.`,
          check: async ({ seed, scratch, product }) =>
            planCells(product, seed, scratch, id, requirement, shape.failing, count),
        });
      }
    }
  }
  for (const count of [2, 3, 4]) {
    const id = `personas/cells/first-failing-key/${count}`;
    items.push({
      id,
      family: 'personas-cells',
      tier: 5,
      level: 10,
      component: CAMPAIGN_PLAN,
      title: `a persona failing two requires keys of a block played by ${count} personas is refused once, naming the first failing key in the block's order`,
      cause:
        'A persona failing several requires keys is refused naming the first failing key the block lists.',
      check: async ({ seed, scratch, product }) => {
        const rng = rngFor(seed, id);
        const [first, second] = shuffled(rng, REQUIREMENTS).slice(0, 2) as [Requirement, Requirement];
        const ids = Array.from({ length: count }, (_, i) => `rider-${i}`);
        const personas = ids.map((pid, i) =>
          persona(rng, pid, i === 0 ? { ...first.breaks, ...second.breaks } : {}),
        );
        const dir = join(scratch, `${id.replace(/\//g, '-')}-${seed}`);
        const spec = project(
          dir,
          personas,
          [scenario('rent-a-bike')],
          [simBlock('b1', ids, { requires: { [first.key]: first.value, [second.key]: second.value } })],
        );
        const result = await product.cli(
          ['campaign', 'plan', spec, '--target', 'function:acme', '--json'],
          dir,
        );
        const text = `${result.out}\n${result.err}`;
        const refusals = text.match(/persona_incompatible/g)?.length ?? 0;
        return expectAll([
          [result.code === 0, `campaign plan exited ${result.code}: ${text.trim().slice(0, 200)}`],
          [refusals >= 1, 'the plan names no persona_incompatible cell'],
          [
            new RegExp(`"requirement"\\s*:\\s*"${first.key}"`).test(text),
            `the refusal does not name the first failing key ${first.key}`,
          ],
          [
            !new RegExp(`"requirement"\\s*:\\s*"${second.key}"`).test(text),
            `the refusal names the second key ${second.key} too`,
          ],
        ]);
      },
    });
  }
  return items;
}

async function planCells(
  product: BlocksProduct,
  seed: number,
  scratch: string,
  id: string,
  requirement: Requirement,
  failing: number,
  count: number,
) {
  const rng = rngFor(seed, id);
  const ids = Array.from({ length: count }, (_, i) => `rider-${i}-${between(rng, 10, 99)}`);
  const bad = new Set(shuffled(rng, ids).slice(0, failing));
  const personas = ids.map((pid) => persona(rng, pid, bad.has(pid) ? requirement.breaks : {}));
  const dir = join(scratch, `${id.replace(/\//g, '-')}-${seed}`);
  const spec = project(
    dir,
    personas,
    [scenario('rent-a-bike')],
    [simBlock('b1', ids, { requires: { [requirement.key]: requirement.value } })],
  );
  const result = await product.cli(['campaign', 'plan', spec, '--target', 'function:acme', '--json'], dir);
  const text = `${result.out}\n${result.err}`;
  if (result.code !== 0) return fail(`campaign plan exited ${result.code}: ${text.trim().slice(0, 200)}`);
  let plan: { cells?: Record<string, unknown>[] };
  try {
    plan = JSON.parse(result.out);
  } catch {
    return fail(`campaign plan --json printed no JSON: ${result.out.slice(0, 120)}`);
  }
  const cells = plan.cells ?? [];
  const named = ids.filter((pid) => cells.some((cell) => JSON.stringify(cell).includes(pid)));
  const refused = cells.filter((cell) => JSON.stringify(cell).includes('persona_incompatible'));
  const refusedIds = ids.filter((pid) => refused.some((cell) => JSON.stringify(cell).includes(pid)));
  return expectAll([
    [cells.length === count, `the plan holds ${cells.length} cells for ${count} personas`],
    [named.length === count, `the cells name ${list(named)}, expected every persona ${list(ids)}`],
    [
      refusedIds.length === failing && refusedIds.every((pid) => bad.has(pid)),
      `the refused cells are ${list(refusedIds)}, expected ${list([...bad])}`,
    ],
    [
      refused.every((cell) => JSON.stringify(cell).includes(requirement.key)),
      `a refused cell does not name the requirement ${requirement.key}`,
    ],
  ]);
}

/** Level 10 of the blocks bank. */
export function personaItems(): BankItem[] {
  return [...loaderItems(), ...cellItems()];
}
