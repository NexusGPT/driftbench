import { defaultChecks } from '@driftbench/checks';
import {
  type Campaign,
  type Observed,
  planCampaign,
  type RunResult,
  runCampaign,
  type Spec,
  validateSpec,
} from '@driftbench/core';
import { openMemoryStore } from '@driftbench/store';
import { createScriptedDriver } from '@driftbench/users';
import { SYSTEM_COMPONENTS } from '../components';
import { type Behaviour, followerReply } from '../plant';
import { type BankItem, expectAll, fail, type ItemResult, PASS, type Tier } from './types';
import {
  adapterFor,
  behavioursFor,
  FAST_RETRY,
  type Faults,
  memoryCache,
  plantedFlow,
  runScenario,
} from './world';

/**
 * Level 11: scale (section 12.2, item 4). Each subject runs at one, ten and a hundred times a base size. At
 * every size the answer must be the planted one; and the time from ten to a hundred times must grow at most
 * GROWTH_BOUND times (linear growth is ten; a quadratic path is a hundred), with the largest size under its
 * budget. Correct and slow is a failing item.
 */

export const GROWTH_BOUND = 25;

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await work();
  return { value, ms: performance.now() - started };
}

type Subject = {
  name: string;
  base: number;
  /** The largest size must finish within this budget. */
  budgetMs: number;
  component: string;
  run(seed: number, size: number): Promise<ItemResult>;
};

/** A long flow with a planted X1 fault on every fourth block: exactly those blocks fail. */
async function longFlow(
  seed: number,
  size: number,
  mode: 'F' | 'T' = 'F',
  cached = false,
): Promise<ItemResult> {
  const planted = plantedFlow(seed, `scale-flow-${mode}-${size}`, size);
  const faults: Faults = new Map(
    Array.from({ length: Math.floor(size / 4) }, (_, index) => [index * 4 + 3, ['X1_local']] as const),
  );
  const behaviours = behavioursFor(planted, faults);
  const cache = cached ? memoryCache() : undefined;
  let run: RunResult = await runScenario(planted.spec, behaviours, { mode, ...(cache ? { cache } : {}) });
  if (cache) run = await runScenario(planted.spec, behaviours, { mode, cache });
  const failing = run.blocks.filter((block) => !block.pass).map((block) => block.index);
  const want = [...faults.keys()];
  return expectAll([
    [run.status === 'completed', `the run ${run.status}: ${run.error}`],
    [run.blocks.length === size, `${run.blocks.length} blocks of ${size}`],
    [
      failing.join() === want.join(),
      `failing ${failing.slice(0, 10).join(',')}, planted ${want.slice(0, 10).join(',')}`,
    ],
    [!cached || run.cacheHit, 'the second run did not replay'],
  ]);
}

/** A reply of `size` characters that holds the code once, at the end. */
async function longReply(seed: number, size: number): Promise<ItemResult> {
  const planted = plantedFlow(seed, `scale-reply-${size}`, 2);
  const behaviours = behavioursFor(planted);
  const truth = planted.truths[1];
  if (!truth) return fail('no block');
  const filler = 'The line is clear and the plan is ready for you today. ';
  behaviours.set(planted.texts[1] as string, () => {
    const reply = followerReply(truth);
    const text = `${filler.repeat(Math.ceil(size / filler.length)).slice(0, size)} Reference ${truth.code}.`;
    return {
      ...reply,
      text,
      segments: [...reply.segments.filter((segment) => segment.type !== 'text'), { type: 'text', text }],
    };
  });
  const run = await runScenario(planted.spec, behaviours);
  return run.status === 'completed' && run.blocks.every((block) => block.pass)
    ? PASS
    : fail(`the run ${run.status}, blocks ${run.blocks.map((block) => block.pass).join(',')}`);
}

/** A block whose agent makes `size` read calls beside the expected lookup. */
async function manyCalls(seed: number, size: number): Promise<ItemResult> {
  const planted = plantedFlow(seed, `scale-calls-${size}`, 2);
  const behaviours = behavioursFor(planted);
  const truth = planted.truths[1];
  if (!truth) return fail('no block');
  behaviours.set(planted.texts[1] as string, () => {
    const reply = followerReply(truth);
    const calls = Array.from({ length: size }, (_, index) => ({
      id: `read-${index}`,
      label: 'catalog.search',
      input: { page: index },
      output: { items: [] },
    }));
    return { ...reply, toolCalls: [...reply.toolCalls, ...calls] } as Observed;
  });
  const run = await runScenario(planted.spec, behaviours);
  return run.status === 'completed' && run.blocks.every((block) => block.pass)
    ? PASS
    : fail(`the run ${run.status}: ${run.error ?? ''}`);
}

/** A campaign of `size` one-block cells through the campaign runner and the store. */
async function manyCells(seed: number, size: number): Promise<ItemResult> {
  const behaviours = new Map<string, Behaviour>();
  const loaded: Array<{ spec: Spec; hash: string }> = [];
  for (let index = 0; index < size; index += 1) {
    const planted = plantedFlow(seed, `scale-cells-${size}-${index}`, 1);
    for (const [text, behaviour] of behavioursFor(
      planted,
      index % 7 === 0 ? new Map([[0, ['X5_tool']]]) : new Map(),
    ))
      behaviours.set(text, behaviour);
    const result = validateSpec(planted.spec, 'bank');
    if (!result.ok) return fail('a spec does not load');
    loaded.push({ spec: result.spec, hash: result.hash });
  }
  const store = openMemoryStore();
  try {
    const campaign: Campaign = {
      campaignId: 'c-scale',
      specs: loaded.map((entry) => ({ id: entry.spec.id, hash: entry.hash })),
      targets: [{ adapter: 'function' }],
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-11T00:00:00.000Z',
    };
    await store.putCampaign(campaign);
    const cells = planCampaign(loaded, [{ adapter: 'function' }], ['F'], 1).cells;
    const byHash = new Map(loaded.map((entry) => [entry.hash, entry.spec] as const));
    const adapter = adapterFor('function', behaviours);
    const outcomes = await runCampaign({
      campaignId: 'c-scale',
      cells,
      specFor: (cell) => byHash.get(cell.specHash) as Spec,
      adapterFor: () => adapter,
      driver: () => createScriptedDriver(),
      checks: defaultChecks(),
      store,
      retry: FAST_RETRY,
    });
    const stored = await store.listRuns({ campaignId: 'c-scale' });
    const failing = outcomes.filter((outcome) => outcome.state === 'fail').length;
    return expectAll([
      [stored.length === size, `${stored.length} runs stored of ${size}`],
      [failing === Math.ceil(size / 7), `${failing} cells fail, ${Math.ceil(size / 7)} planted`],
    ]);
  } finally {
    await store.close();
  }
}

const SUBJECTS: Subject[] = [
  {
    name: 'flow-blocks',
    base: 4,
    budgetMs: 4_000,
    component: SYSTEM_COMPONENTS.runner,
    run: (seed, size) => longFlow(seed, size),
  },
  {
    name: 'flow-blocks-teacher-forced',
    base: 4,
    budgetMs: 4_000,
    component: 'packages/core/src/runner/given.ts',
    run: (seed, size) => longFlow(seed, size, 'T'),
  },
  {
    name: 'flow-blocks-replayed',
    base: 4,
    budgetMs: 6_000,
    component: SYSTEM_COMPONENTS.cache,
    run: (seed, size) => longFlow(seed, size, 'F', true),
  },
  {
    name: 'reply-characters',
    base: 1000,
    budgetMs: 20_000,
    component: 'packages/checks/src/checks/lang.ts',
    run: longReply,
  },
  {
    name: 'tool-calls',
    base: 10,
    budgetMs: 20_000,
    component: 'packages/checks/src/checks/tools.ts',
    run: manyCalls,
  },
  {
    name: 'campaign-cells',
    base: 20,
    budgetMs: 10_000,
    component: SYSTEM_COMPONENTS.campaign,
    run: manyCells,
  },
];

/** One measurement per seed and subject, shared by the subject's four items. */
const measured = new Map<string, Promise<Array<{ size: number; result: ItemResult; ms: number }>>>();

function measure(seed: number, subject: Subject) {
  const key = `${seed} ${subject.name}`;
  let held = measured.get(key);
  if (!held) {
    held = (async () => {
      const out: Array<{ size: number; result: ItemResult; ms: number }> = [];
      for (const factor of [1, 10, 100]) {
        const size = subject.base * factor;
        const { value, ms } = await timed(() => subject.run(seed, size));
        out.push({ size, result: value, ms });
      }
      return out;
    })();
    measured.clear();
    measured.set(key, held);
  }
  return held;
}

export function scaleItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const subject of SUBJECTS) {
    ([1, 10, 100] as const).forEach((factor, index) => {
      out.push({
        id: `scale/${subject.name}/x${factor}`,
        family: 'scale',
        tier: (factor === 1 ? 2 : factor === 10 ? 3 : 4) as Tier,
        level: 11,
        component: subject.component,
        source: 'scale',
        title: `${subject.name} at ${subject.base * factor} gives the planted answer${factor === 100 ? ` within ${subject.budgetMs / 1000} s` : ''}`,
        async check({ seed }) {
          const rows = await measure(seed, subject);
          const row = rows[index];
          if (!row) return fail('not measured');
          if (!row.result.pass) return row.result;
          return factor === 100 && row.ms > subject.budgetMs
            ? fail(`${Math.round(row.ms)} ms at ${row.size}, budget ${subject.budgetMs} ms`)
            : PASS;
        },
      });
    });
    out.push({
      id: `scale/${subject.name}/growth`,
      family: 'scale',
      tier: 5,
      level: 11,
      component: subject.component,
      source: 'scale',
      title: `${subject.name}: the time from ten to a hundred times the size grows at most ${GROWTH_BOUND} times`,
      async check({ seed }) {
        const rows = await measure(seed, subject);
        const ten = rows[1]?.ms ?? 0;
        const hundred = rows[2]?.ms ?? 0;
        const growth = hundred / Math.max(ten, 1);
        return growth <= GROWTH_BOUND
          ? PASS
          : fail(
              `${Math.round(ten)} ms at ${rows[1]?.size}, ${Math.round(hundred)} ms at ${rows[2]?.size}: ${growth.toFixed(1)} times`,
            );
      },
    });
  }
  return out;
}
