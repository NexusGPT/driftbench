import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import type { RunResult } from '@agent-nexus/driftbench-core';
import { lastUserText } from '../agent';
import type { Behaviour } from '../plant';
import { withPerturbation } from './reach';
import { type BankItem, type Draft, expectAll, fail, PASS, type Tier, withCauses } from './types';
import {
  type AdapterKind,
  behavioursFor,
  type Faults,
  memoryCache,
  plantedFlow,
  runScenario,
  verdictProjection,
} from './world';

/**
 * Level 9: replay equals live. A run recorded through the cache and replayed from it gives the same verdicts,
 * drift, succession, end state and recovery, in every mode and through every adapter; and the cache key keeps
 * what docs/running.md ("The cache and replay") says it keeps.
 */

const CACHE = 'packages/core/src/runner/cache.ts';

function replayEqual(live: RunResult, replay: RunResult) {
  return expectAll([
    [live.cacheHit === false, 'the live run came from the cache'],
    [replay.cacheHit === true, 'the replay went live'],
    [
      verdictProjection(live) === verdictProjection(replay),
      'the replayed verdicts differ from the live ones',
    ],
    [replay.cost === 0, `the replay cost ${replay.cost}`],
  ]);
}

export function replayItems(): BankItem[] {
  const out: Draft[] = [];
  const shapes: Array<{ name: string; faults: Array<[number, string[]]>; tier: Tier }> = [
    { name: 'clean', faults: [], tier: 1 },
    { name: 'one-fault', faults: [[2, ['X1_local']]], tier: 2 },
    {
      name: 'three-faults',
      faults: [
        [0, ['X5_tool']],
        [3, ['X3_flow']],
        [5, ['D6_instruction_in_data']],
      ],
      tier: 3,
    },
  ];
  const routes: Array<{ mode: 'F' | 'T' | 'P'; adapter: AdapterKind }> = [
    { mode: 'F', adapter: 'function' },
    { mode: 'T', adapter: 'function' },
    { mode: 'P', adapter: 'function' },
    { mode: 'F', adapter: 'http' },
    { mode: 'T', adapter: 'http' },
    { mode: 'P', adapter: 'http-flaky' },
  ];
  for (const shape of shapes) {
    for (const route of routes) {
      const id = `replay/${shape.name}/${route.mode}/${route.adapter}`;
      out.push({
        id,
        family: 'replay',
        tier: (route.mode === 'F' && route.adapter === 'function'
          ? shape.tier
          : Math.min(5, shape.tier + 1)) as Tier,
        level: 9,
        component: CACHE,
        source: 'combination',
        title: `a ${shape.name} run in mode ${route.mode} through ${route.adapter} replays from the cache with the live verdicts`,
        async check({ seed }) {
          const planted = plantedFlow(seed, id, 6);
          const behaviours = behavioursFor(planted, new Map(shape.faults) as Faults);
          const perturbationId = route.mode === 'P' ? withPerturbation(planted, behaviours, 3) : undefined;
          const cache = memoryCache();
          const options = {
            mode: route.mode,
            adapter: route.adapter,
            cache,
            ...(perturbationId ? { perturbationId } : {}),
          };
          const live = await runScenario(planted.spec, behaviours, options);
          const replay = await runScenario(planted.spec, behaviours, options);
          return replayEqual(live, replay);
        },
      });
    }
  }

  const keyItem = (
    name: string,
    tier: Tier,
    title: string,
    replays: boolean,
    change: (spec: Record<string, unknown>, options: Record<string, unknown>) => void,
  ) =>
    out.push({
      id: `replay/key/${name}`,
      family: 'replay',
      tier,
      level: 9,
      component: CACHE,
      source: 'contract',
      title,
      async check({ seed }) {
        const planted = plantedFlow(seed, `key-${name}`, 3);
        const behaviours = behavioursFor(planted);
        const cache = memoryCache();
        await runScenario(planted.spec, behaviours, { cache });
        const spec = structuredClone(planted.spec);
        const options: Record<string, unknown> = { cache };
        change(spec, options);
        const second = await runScenario(spec as typeof planted.spec, behaviours, options);
        return second.cacheHit === replays
          ? PASS
          : fail(
              `the second run ${second.cacheHit ? 'replayed' : 'went live'}; documented: ${replays ? 'replay' : 'live'}`,
            );
      },
    });
  keyItem('same', 1, 'the same spec, repeat, target and adapter replay', true, () => undefined);
  keyItem(
    'repeat',
    2,
    'another repeat goes live: repeats are independent samples',
    false,
    (_spec, options) => {
      options.repeat = 1;
    },
  );
  keyItem('adapter-version', 2, 'another adapter version goes live', false, (_spec, options) => {
    options.version = 'bank-2';
  });
  keyItem('version-label', 3, "the spec's version label plays no part: it still replays", true, (spec) => {
    spec.version = '9.9';
  });
  keyItem('ledger', 2, 'a changed Given (the ledger) goes live', false, (spec) => {
    spec.given = {
      ledger: { ...((spec.given as { ledger: Record<string, unknown> }).ledger ?? {}), plan: 'fiber' },
    };
  });
  keyItem('target-variant', 2, 'another target variant goes live', false, (_spec, options) => {
    options.target = { adapter: 'function', variant: 'v2' };
  });
  keyItem(
    'expectation-only',
    3,
    'a change to the expectations only changes the spec hash, so the run goes live',
    false,
    (spec) => {
      (
        (spec.blocks as Array<{ expect: Record<string, unknown> }>)[0] as { expect: Record<string, unknown> }
      ).expect.must_not = ['refund', 'discount'];
    },
  );

  out.push({
    id: 'replay/end-state',
    family: 'replay',
    tier: 3,
    level: 9,
    component: CACHE,
    source: 'contract',
    title:
      'end-state reads are cached and replayed with the run, and the replayed end state equals the live one',
    async check({ seed }) {
      const planted = plantedFlow(seed, 'replay-end', 3);
      planted.spec.end_state = { source: 'tool:records.lookup', expect: { email: planted.truths[2]?.email } };
      const behaviours = behavioursFor(planted);
      const cache = memoryCache();
      const live = await runScenario(planted.spec, behaviours, { cache });
      const replay = await runScenario(planted.spec, behaviours, { cache });
      return expectAll([
        [replay.cacheHit, 'the replay went live'],
        [JSON.stringify(live.endState) === JSON.stringify(replay.endState), 'the end states differ'],
        [live.endState?.match === true, 'the live end state does not match'],
      ]);
    },
  });
  out.push({
    id: 'replay/sandbox-never-cached',
    family: 'replay',
    tier: 4,
    level: 9,
    component: 'packages/core/src/runner/run.ts',
    source: 'contract',
    title: 'an adapter that runs in a sandbox is never cached nor replayed',
    async check({ seed }) {
      const planted = plantedFlow(seed, 'replay-sandbox', 2);
      const behaviours = behavioursFor(planted);
      const base = functionAdapter({
        respond: (messages) => (behaviours.get(lastUserText(messages)) as Behaviour)({}),
      });
      const adapter = { ...base, capabilities: () => ({ ...base.capabilities(), sandbox: true }) };
      const cache = memoryCache();
      await runScenario(planted.spec, behaviours, { adapter, cache });
      const second = await runScenario(planted.spec, behaviours, { adapter, cache });
      return cache.size() === 0 && !second.cacheHit
        ? PASS
        : fail(`${cache.size()} entries cached, second run cacheHit ${second.cacheHit}`);
    },
  });
  out.push({
    id: 'replay/partial-cache-goes-live',
    family: 'replay',
    tier: 4,
    level: 9,
    component: CACHE,
    source: 'contract',
    title: 'a cache that misses one block sends the whole run live, and the run records it as live',
    async check({ seed }) {
      const planted = plantedFlow(seed, 'replay-partial', 4);
      const behaviours = behavioursFor(planted);
      const cache = memoryCache();
      const keys: string[] = [];
      const recording = {
        cacheGet: cache.cacheGet,
        cachePut: async (key: string, observed: never) => {
          keys.push(key);
          await cache.cachePut(key, observed);
        },
      };
      await runScenario(planted.spec, behaviours, { cache: recording });
      const dropLast = {
        cacheGet: async (key: string) => (key === keys[keys.length - 1] ? undefined : cache.cacheGet(key)),
        cachePut: cache.cachePut,
      };
      const second = await runScenario(planted.spec, behaviours, { cache: dropLast });
      return second.cacheHit === false && second.blocks.length === 4
        ? PASS
        : fail(`cacheHit ${second.cacheHit}, ${second.blocks.length} blocks`);
    },
  });
  return withCauses(out, (item) =>
    item.id === 'replay/key/version-label'
      ? 'runSpec in run.ts hashes the spec without its version label for the cache key.'
      : item.id.startsWith('replay/key/')
        ? undefined
        : `replay from the cache in mode ${item.id.split('/')[2]} through ${item.id.split('/')[3]} gives the live verdicts`,
  );
}
