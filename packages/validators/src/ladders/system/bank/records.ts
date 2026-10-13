import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type Campaign,
  type CellOutcome,
  canonicalJson,
  cellId,
  outcomeOf,
  type PlannedCell,
  planCampaign,
  type RunResult,
  runCampaign,
  type Spec,
  type Store,
  type TargetRef,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import {
  openMemoryStore,
  openStore,
  projectCost,
  readCampaignBundle,
  type SqliteStore,
} from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { SYSTEM_COMPONENTS } from '../components';
import type { Behaviour } from '../plant';
import { between, rngFor } from '../random';
import { type BankItem, expectAll, fail, PASS, type Tier } from './types';
import { adapterFor, behavioursFor, FAST_RETRY, loadRaw, plantedFlow, runScenario } from './world';

/**
 * Level 1: records. A run of every shape goes into a SQLite file and comes back equal after the file is
 * closed and reopened; filters, replacement, ambiguity, campaign order, bundles, the cache's expiry, specs
 * and cost units hold their contract (docs/running.md "The store"); a campaign resumes after an
 * interruption at any point and keeps its budget (docs/running.md "The worker pool", "The budget").
 */

const STORE = SYSTEM_COMPONENTS.store;
const CAMPAIGN = SYSTEM_COMPONENTS.campaign;
const CLOCK = '2026-10-11T00:00:00.000Z';
const TARGET: TargetRef = { adapter: 'function', agent: 'planted-bank' };

function campaignOf(
  campaignId: string,
  specs: ReadonlyArray<{ id: string; hash: string }>,
  extra: Partial<Campaign> = {},
): Campaign {
  return {
    campaignId,
    specs: specs.map((spec) => ({ id: spec.id, hash: spec.hash })),
    targets: [TARGET],
    modes: ['F'],
    repeats: { T: 0, F: 1, P: 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt: CLOCK,
    ...extra,
  };
}

/** One real run of a planted flow, the base every record variant starts from. */
async function baseRun(seed: number, tag: string, faulty = true): Promise<RunResult> {
  const planted = plantedFlow(seed, tag, 3);
  const faults = faulty ? new Map([[1, ['X1_local']]]) : new Map<number, string[]>();
  return runScenario(planted.spec, behavioursFor(planted, faults), { target: TARGET });
}

/** A record variant: one field family of RunResult set the way a real run could set it. */
type Variant = { name: string; tier: Tier; apply(run: RunResult, seed: number): RunResult };

const LONG = 'Reference text. '.repeat(6250);

const VARIANTS: Variant[] = [
  { name: 'plain', tier: 1, apply: (run) => run },
  { name: 'perturbation-id', tier: 1, apply: (run) => ({ ...run, mode: 'P', perturbationId: 'p-d2' }) },
  {
    name: 'error-text',
    tier: 1,
    apply: (run) => ({ ...run, status: 'failed', error: 'the agent failed on block 2: a planted error' }),
  },
  {
    name: 'recovery-full',
    tier: 2,
    apply: (run) => ({
      ...run,
      mode: 'P',
      perturbationId: 'p-d4',
      recovery: {
        injectedAt: 1,
        turnsToRecover: 1,
        label: 'late',
        collateral: 1,
        safeAction: false,
        clarified: true,
      },
    }),
  },
  {
    name: 'recovery-never',
    tier: 2,
    apply: (run) => ({
      ...run,
      mode: 'P',
      perturbationId: 'p-d8',
      recovery: { injectedAt: 2, label: 'never', collateral: 0 },
    }),
  },
  {
    name: 'end-state-diff',
    tier: 2,
    apply: (run) => ({
      ...run,
      endState: {
        match: false,
        diff: [
          { field: 'tool:orders.place.plan', expected: { regex: '^fiber' }, observed: { absent: true } },
        ],
      },
    }),
  },
  {
    name: 'injected-block',
    tier: 2,
    apply: (run) => ({
      ...run,
      mode: 'P',
      perturbationId: 'p-x',
      blocks: run.blocks.map((block, index) =>
        index === 1 ? { ...block, injected: true, blockId: 'p-x' } : block,
      ),
    }),
  },
  {
    name: 'judge-votes',
    tier: 3,
    apply: (run) => ({
      ...run,
      blocks: run.blocks.map((block, index) =>
        index === 0
          ? {
              ...block,
              verdicts: [
                ...block.verdicts,
                {
                  id: 'judge.tone',
                  kind: 'judge',
                  name: 'tone',
                  gating: false,
                  outcome: 'pass',
                  score: 0.75,
                  evidence: 'two of three judges passed',
                  reasoning: 'polite and short',
                  judge: {
                    cls: 'system2',
                    votes: [
                      { judge: 'a', outcome: 'pass', score: 1 },
                      { judge: 'b', outcome: 'fail', reasoning: 'too long' },
                      { judge: 'c', outcome: 'pass' },
                    ],
                  },
                },
              ],
            }
          : block,
      ),
    }),
  },
  {
    name: 'artifacts-workspace',
    tier: 2,
    apply: (run) => ({
      ...run,
      blocks: run.blocks.map((block) => ({
        ...block,
        observed: {
          ...block.observed,
          artifacts: [{ path: 'out/sheet.xlsx', kind: 'xlsx', sha256: 'ab'.repeat(32), bytes: 4096 }],
          workspaceDiff: { created: ['out/sheet.xlsx'], changed: [], deleted: ['README.txt'] },
        },
      })),
    }),
  },
  {
    name: 'executions-sandbox',
    tier: 2,
    apply: (run) => ({
      ...run,
      blocks: run.blocks.map((block) => ({
        ...block,
        observed: {
          ...block.observed,
          executions: [
            {
              command: 'node check.mjs',
              role: 'command',
              exitCode: 3,
              stdout: 'ok',
              stderr: 'warn',
              truncated: true,
            },
          ],
          sandbox: { kind: 'local', isolation: 'weak', root: '/tmp/sandbox' },
        },
      })),
    }),
  },
  {
    name: 'raw-unicode',
    tier: 3,
    apply: (run) => ({
      ...run,
      blocks: run.blocks.map((block) => ({
        ...block,
        observed: {
          ...block.observed,
          raw: { note: 'é 漢字 😀 ‮ltr \u0000 nul', nested: [{ deep: [1, 2.5, null, true] }] },
        },
      })),
    }),
  },
  {
    name: 'text-100k',
    tier: 4,
    apply: (run) => ({
      ...run,
      blocks: run.blocks.map((block) => ({
        ...block,
        observed: { ...block.observed, text: LONG, segments: [{ type: 'text', text: LONG }] },
      })),
    }),
  },
  {
    name: 'segment-costs',
    tier: 2,
    apply: (run) => ({
      ...run,
      blocks: run.blocks.map((block) => ({
        ...block,
        observed: {
          ...block.observed,
          segments: block.observed.segments.map((segment) => ({
            ...segment,
            cost: { usd: 0.0001, inputTokens: 12, outputTokens: 3 },
            latencyMs: 7,
          })),
        },
      })),
    }),
  },
  {
    name: 'tool-error',
    tier: 2,
    apply: (run) => ({
      ...run,
      blocks: run.blocks.map((block) => ({
        ...block,
        observed: {
          ...block.observed,
          toolCalls: [
            {
              label: 'records.lookup',
              input: { email: 'a@example.org' },
              error: 'timeout',
              latencyMs: 30000,
              startedAt: CLOCK,
            },
          ],
        },
      })),
    }),
  },
  {
    name: 'card-segment',
    tier: 2,
    apply: (run) => ({
      ...run,
      blocks: run.blocks.map((block) => ({
        ...block,
        observed: {
          ...block.observed,
          segments: [
            ...block.observed.segments,
            { type: 'card', name: 'plan_picker', data: { options: ['a', 'b'] } },
          ],
        },
      })),
    }),
  },
  {
    name: 'runtime-trace',
    tier: 2,
    apply: (run) => ({
      ...run,
      blocks: run.blocks.map((block) => ({
        ...block,
        observed: {
          ...block.observed,
          runtime: {
            skills: [{ name: 'xlsx', at: CLOCK }],
            guards: [{ name: 'policy', verdict: 'deny', at: CLOCK }],
            stages: [{ name: 'open' }, { name: 'verify', at: CLOCK }],
          },
        },
      })),
    }),
  },
  {
    name: 'ledger-contradictions',
    tier: 2,
    apply: (run) => ({
      ...run,
      blocks: run.blocks.map((block) => ({
        ...block,
        ledgerCheck: { ok: false, contradictions: ['email: the ledger holds "a", the block adds "b"'] },
      })),
    }),
  },
  {
    name: 'drift-classes',
    tier: 2,
    apply: (run) => ({
      ...run,
      blocks: run.blocks.map((block) => ({ ...block, drift: ['X1_local', 'X2_contradiction', 'X5_tool'] })),
    }),
  },
  { name: 'cache-hit', tier: 1, apply: (run) => ({ ...run, cacheHit: true, cost: 0 }) },
  {
    name: 'stopped',
    tier: 2,
    apply: (run) => ({
      ...run,
      status: 'stopped',
      error: 'the driver scripted did not stop within 16 steps',
    }),
  },
  {
    name: 'no-blocks',
    tier: 3,
    apply: (run) => ({
      ...run,
      status: 'failed',
      error: 'open failed',
      blocks: [],
      succession: { driftCount: 0, driftRate: 0, longestClean: 0, minOverBlocks: false },
      cost: 0,
      latencyMs: 0,
    }),
  },
  {
    name: 'target-options',
    tier: 3,
    apply: (run) => ({
      ...run,
      target: {
        adapter: 'http',
        agent: 'sales',
        variant: 'v2',
        deployment: 'eu',
        options: { url: 'http://x.invalid', retries: 2, nested: { on: true } },
      },
    }),
  },
  { name: 'fractional-cost', tier: 3, apply: (run) => ({ ...run, cost: 0.1 + 0.2, latencyMs: 1234.5678 }) },
];

async function withStore<T>(path: string, use: (store: SqliteStore) => Promise<T>): Promise<T> {
  const store = openStore(path);
  try {
    return await use(store);
  } finally {
    await store.close();
  }
}

function storeRoundTrip(): BankItem[] {
  const out: BankItem[] = VARIANTS.map((variant) => ({
    id: `store/round-trip/${variant.name}`,
    family: 'store-roundtrip',
    cause: `the store writes the ${variant.name} part of a run record and reads it back unchanged after a reopen`,
    tier: variant.tier,
    level: 1,
    component: STORE,
    source: 'contract',
    title: `a run record with ${variant.name} comes back equal after the store is closed and reopened`,
    async check({ seed, scratch }) {
      const run = variant.apply(await baseRun(seed, `store-${variant.name}`), seed);
      const path = join(scratch, `round-${variant.name}-${seed}.sqlite`);
      await withStore(path, async (store) => {
        await store.putCampaign(
          campaignOf('c-round', [{ id: run.specId, hash: run.specHash }], { modes: [run.mode] }),
        );
        await store.putRun('c-round', run);
      });
      const back = await withStore(path, async (store) => ({
        one: await store.getRun(run.runId, 'c-round'),
        listed: await store.listRuns({ campaignId: 'c-round' }),
      }));
      return expectAll([
        [back.one !== undefined, 'getRun found nothing after the reopen'],
        [canonicalJson(back.one) === canonicalJson(run), `getRun differs: ${diffKeys(run, back.one)}`],
        [
          back.listed.length === 1 && canonicalJson(back.listed[0]) === canonicalJson(run),
          'listRuns does not give the run back equal',
        ],
      ]);
    },
  }));

  const extra: Array<
    Omit<BankItem, 'family' | 'level' | 'component' | 'source' | 'cause'> & { component?: string }
  > = [
    {
      id: 'store/filters',
      tier: 2,
      title: 'listRuns filters by campaign, spec, mode and status, each exactly',
      async check({ seed, scratch }) {
        const runs: RunResult[] = [];
        for (const [index, mode, status] of [
          [0, 'F', 'completed'],
          [1, 'T', 'completed'],
          [2, 'F', 'failed'],
          [3, 'P', 'stopped'],
        ] as const) {
          const base = await baseRun(seed, `filter-${index}`);
          runs.push({
            ...base,
            runId: `${base.runId.slice(0, 12)}${index}000`,
            mode,
            status,
            ...(mode === 'P' ? { perturbationId: 'p' } : {}),
          });
        }
        const path = join(scratch, `filters-${seed}.sqlite`);
        return withStore(path, async (store) => {
          await store.putCampaign(
            campaignOf(
              'c-a',
              runs.map((run) => ({ id: run.specId, hash: run.specHash })),
            ),
          );
          await store.putCampaign(
            campaignOf(
              'c-b',
              runs.map((run) => ({ id: run.specId, hash: run.specHash })),
            ),
          );
          for (const run of runs.slice(0, 3)) await store.putRun('c-a', run);
          await store.putRun('c-b', runs[3] as RunResult);
          const ids = async (filter: Parameters<Store['listRuns']>[0]) =>
            (await store.listRuns(filter))
              .map((run) => run.runId)
              .sort()
              .join(',');
          const want = (list: RunResult[]) =>
            list
              .map((run) => run.runId)
              .sort()
              .join(',');
          return expectAll([
            [(await ids({ campaignId: 'c-a' })) === want(runs.slice(0, 3)), 'campaign filter'],
            [(await ids({ specId: runs[1]?.specId })) === want([runs[1] as RunResult]), 'spec filter'],
            [
              (await ids({ mode: 'F' })) === want([runs[0] as RunResult, runs[2] as RunResult]),
              'mode filter',
            ],
            [(await ids({ status: 'stopped' })) === want([runs[3] as RunResult]), 'status filter'],
            [
              (await ids({ campaignId: 'c-a', status: 'failed' })) === want([runs[2] as RunResult]),
              'two filters together',
            ],
          ]);
        });
      },
    },
    {
      id: 'store/replace',
      tier: 2,
      title: 'a run put twice under one campaign keeps one row, the second',
      async check({ seed, scratch }) {
        const first = await baseRun(seed, 'replace');
        const second: RunResult = { ...first, status: 'failed', error: 'second write' };
        return withStore(join(scratch, `replace-${seed}.sqlite`), async (store) => {
          await store.putCampaign(campaignOf('c-r', [{ id: first.specId, hash: first.specHash }]));
          await store.putRun('c-r', first);
          await store.putRun('c-r', second);
          const listed = await store.listRuns({ campaignId: 'c-r' });
          return expectAll([
            [listed.length === 1, `${listed.length} rows`],
            [listed[0]?.error === 'second write', 'the first write survived'],
          ]);
        });
      },
    },
    {
      id: 'store/ambiguous',
      tier: 3,
      title: 'getRun without a campaign refuses a run id two campaigns hold, with the code RUN_AMBIGUOUS',
      async check({ seed, scratch }) {
        const run = await baseRun(seed, 'ambiguous');
        return withStore(join(scratch, `ambiguous-${seed}.sqlite`), async (store) => {
          for (const id of ['c-1', 'c-2']) {
            await store.putCampaign(campaignOf(id, [{ id: run.specId, hash: run.specHash }]));
            await store.putRun(id, run);
          }
          try {
            await store.getRun(run.runId);
            return fail('getRun answered without naming a campaign');
          } catch (cause) {
            const code = (cause as { code?: string }).code;
            return code === 'RUN_AMBIGUOUS' ? PASS : fail(`the error code is ${code}`);
          }
        });
      },
    },
    {
      id: 'store/campaign-order',
      tier: 3,
      title: 'listCampaigns gives the newest first by date, a time that is not a date last, then by id',
      async check({ scratch, seed }) {
        return withStore(join(scratch, `order-${seed}.sqlite`), async (store) => {
          const spec = [{ id: 's', hash: 'h1' }];
          await store.putCampaign(campaignOf('c-old', spec, { createdAt: '2026-01-01T00:00:00Z' }));
          await store.putCampaign(campaignOf('c-new', spec, { createdAt: '2026-10-11T10:00:00.5Z' }));
          await store.putCampaign(campaignOf('c-mid', spec, { createdAt: '2026-10-11T10:00:00Z' }));
          await store.putCampaign(campaignOf('c-odd', spec, { createdAt: 'yesterday' }));
          const order = (await store.listCampaigns()).map((campaign) => campaign.campaignId).join(',');
          return order === 'c-new,c-mid,c-old,c-odd' ? PASS : fail(`order ${order}`);
        });
      },
    },
    {
      id: 'store/campaign-immutable',
      tier: 2,
      title:
        'a campaign put again with other content is refused with CAMPAIGN_CONFLICT; the same content is accepted',
      async check({ scratch, seed }) {
        return withStore(join(scratch, `immutable-${seed}.sqlite`), async (store) => {
          const spec = [{ id: 's', hash: 'h1' }];
          await store.putCampaign(campaignOf('c-i', spec));
          await store.putCampaign(campaignOf('c-i', spec));
          try {
            await store.putCampaign(campaignOf('c-i', spec, { budgetUsd: 5 }));
            return fail('the changed campaign was accepted');
          } catch (cause) {
            const code = (cause as { code?: string }).code;
            return code === 'CAMPAIGN_CONFLICT' ? PASS : fail(`the error code is ${code}`);
          }
        });
      },
    },
    {
      id: 'store/bundle-round-trip',
      tier: 3,
      title:
        'exportCampaign then importCampaign into a new store gives the campaign and every run back equal',
      async check({ seed, scratch }) {
        const runs = [await baseRun(seed, 'bundle-a'), await baseRun(seed, 'bundle-b', false)];
        const campaign = campaignOf(
          'c-bundle',
          runs.map((run) => ({ id: run.specId, hash: run.specHash })),
        );
        const folder = await withStore(join(scratch, `bundle-src-${seed}.sqlite`), async (store) => {
          await store.putCampaign(campaign);
          for (const run of runs) await store.putRun('c-bundle', run);
          return store.exportCampaign('c-bundle', join(scratch, `bundle-${seed}`));
        });
        return withStore(join(scratch, `bundle-dst-${seed}.sqlite`), async (store) => {
          await store.importCampaign(folder);
          const back = await store.listRuns({ campaignId: 'c-bundle' });
          const sort = (list: RunResult[]) =>
            canonicalJson([...list].sort((a, b) => a.runId.localeCompare(b.runId)));
          return expectAll([
            [
              canonicalJson(await store.getCampaign('c-bundle')) === canonicalJson(campaign),
              'the campaign differs',
            ],
            [sort(back) === sort(runs), 'the runs differ'],
          ]);
        });
      },
    },
    {
      id: 'store/bundle-tampered',
      tier: 4,
      component: 'packages/store/src/bundle.ts',
      title: 'a bundle whose run file was edited after the export is refused, and nothing is stored',
      async check({ seed, scratch }) {
        const run = await baseRun(seed, 'tamper');
        const folder = await withStore(join(scratch, `tamper-src-${seed}.sqlite`), async (store) => {
          await store.putCampaign(campaignOf('c-t', [{ id: run.specId, hash: run.specHash }]));
          await store.putRun('c-t', run);
          return store.exportCampaign('c-t', join(scratch, `tamper-${seed}`));
        });
        const file = join(folder, 'runs', `${run.runId}.json`);
        const edited = JSON.parse(readFileSync(file, 'utf8')) as RunResult;
        edited.blocks = edited.blocks.map((block) => ({ ...block, pass: true }));
        writeFileSync(file, JSON.stringify(edited, null, 2));
        return withStore(join(scratch, `tamper-dst-${seed}.sqlite`), async (store) => {
          try {
            await store.importCampaign(folder);
          } catch {
            const left = await store.listRuns({});
            return left.length === 0 ? PASS : fail('a refused import left runs behind');
          }
          return fail('an edited run file was imported: the bundle carries no check of its content');
        });
      },
    },
    {
      id: 'store/bundle-interrupted',
      tier: 3,
      component: 'packages/store/src/bundle.ts',
      title: 'a bundle folder without its manifest (an interrupted export) is refused',
      async check({ seed, scratch }) {
        const run = await baseRun(seed, 'interrupted');
        const folder = await withStore(join(scratch, `int-src-${seed}.sqlite`), async (store) => {
          await store.putCampaign(campaignOf('c-x', [{ id: run.specId, hash: run.specHash }]));
          await store.putRun('c-x', run);
          return store.exportCampaign('c-x', join(scratch, `int-${seed}`));
        });
        writeFileSync(join(folder, 'manifest.json'), '');
        try {
          await readCampaignBundle(folder);
          return fail('a bundle with an empty manifest was read');
        } catch {
          return PASS;
        }
      },
    },
    {
      id: 'store/cache-expiry',
      tier: 3,
      title: 'a cache entry put with a ttl is gone after it; one without a ttl stays',
      async check({ scratch, seed }) {
        return withStore(join(scratch, `ttl-${seed}.sqlite`), async (store) => {
          const observed = { segments: [], text: 'x', toolCalls: [], cost: {}, latencyMs: 0 };
          await store.cachePut('short', observed, 1);
          await store.cachePut('long', observed);
          await new Promise((resolve) => setTimeout(resolve, 15));
          return expectAll([
            [(await store.cacheGet('short')) === undefined, 'the expired entry is still served'],
            [
              canonicalJson(await store.cacheGet('long')) === canonicalJson(observed),
              'the entry without ttl is gone or changed',
            ],
          ]);
        });
      },
    },
    {
      id: 'store/spec-round-trip',
      tier: 1,
      title: 'putSpec then getSpec gives the spec back at its hash, and refuses a spec whose hash lies',
      async check({ seed, scratch }) {
        const planted = plantedFlow(seed, 'spec-round');
        const loaded = validateSpec(planted.spec, 'bank');
        if (!loaded.ok) return fail('the planted spec does not load');
        return withStore(join(scratch, `spec-${seed}.sqlite`), async (store) => {
          await store.putSpec(loaded);
          const back = await store.getSpec(loaded.spec.id, loaded.hash);
          let refused = false;
          try {
            await store.putSpec({ ...loaded, hash: 'f'.repeat(loaded.hash.length) });
          } catch {
            refused = true;
          }
          return expectAll([
            [
              back?.hash === loaded.hash && canonicalJson(back?.spec) === canonicalJson(loaded.spec),
              'the spec came back changed',
            ],
            [refused, 'a spec with a false hash was stored'],
          ]);
        });
      },
    },
    {
      id: 'store/units-latest',
      tier: 3,
      title: 'the projection prices an adapter from its latest unit, dates compared as dates',
      async check({ scratch, seed }) {
        return withStore(join(scratch, `units-${seed}.sqlite`), async (store) => {
          await store.putUnit({
            adapter: 'http',
            metric: 'block',
            usd: 0.5,
            measuredAt: '2026-10-11T09:00:00Z',
          });
          await store.putUnit({
            adapter: 'http',
            metric: 'block',
            usd: 0.2,
            measuredAt: '2026-10-11T10:00:00.250Z',
          });
          await store.putUnit({
            adapter: 'http',
            metric: 'block',
            usd: 0.9,
            measuredAt: '2026-10-11T10:00:00Z',
          });
          const plan = planCampaign(
            [{ spec: loadRaw(plantedFlow(seed, 'units', 2).spec), hash: 'h' }],
            [{ adapter: 'http' }],
            ['F'],
            3,
            { units: await store.listUnits() },
          );
          const line = plan.cost.byAdapter[0];
          return expectAll([
            [line?.usdPerBlock === 0.2, `priced at ${line?.usdPerBlock}`],
            [Math.abs(plan.cost.usd - 0.2 * 6) < 1e-12, `projected ${plan.cost.usd}`],
            [typeof projectCost === 'function', 'projectCost is gone'],
          ]);
        });
      },
    },
  ];
  for (const each of extra) {
    out.push({
      id: each.id,
      family: 'store-roundtrip',
      cause: `store: ${each.title}`,
      tier: each.tier,
      level: 1,
      component: each.component ?? STORE,
      source: 'contract',
      title: each.title,
      check: each.check,
    });
  }
  return out;
}

function diffKeys(a: unknown, b: unknown): string {
  if (b === undefined) return 'absent';
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  const differ = keys.filter((key) => canonicalJson(left[key]) !== canonicalJson(right[key]));
  return differ.length === 0 ? 'key order or types' : differ.join(', ');
}

/** A small campaign of planted flows on the function adapter: specs, their behaviours and cells. */
async function smallCampaign(seed: number, tag: string, specs: number, repeats: number, cost = 0) {
  const behaviours = new Map<string, Behaviour>();
  const loaded: Array<{ spec: Spec; hash: string }> = [];
  for (let index = 0; index < specs; index += 1) {
    const planted = plantedFlow(seed, `${tag}-${index}`, 2);
    for (const [text, behaviour] of behavioursFor(planted)) {
      behaviours.set(text, (target) => {
        const observed = behaviour(target);
        return { ...observed, cost: { usd: cost } };
      });
    }
    const result = validateSpec(planted.spec, 'bank');
    if (!result.ok) throw new Error('a planted spec does not load');
    loaded.push({ spec: result.spec, hash: result.hash });
  }
  const cells = planCampaign(loaded, [TARGET], ['F'], repeats).cells;
  return { behaviours, loaded, cells };
}

type CampaignRunOptions = {
  campaignId: string;
  cells: readonly PlannedCell[];
  loaded: Array<{ spec: Spec; hash: string }>;
  behaviours: Map<string, Behaviour>;
  store: Store;
  concurrency?: number;
  budgetUsd?: number;
  cache?: boolean;
  starts?: Map<string, number>;
  delay?: (text: string) => number;
  failFirst?: Set<string>;
};

async function runCells(options: CampaignRunOptions): Promise<CellOutcome[]> {
  const base = adapterFor('function', options.behaviours);
  const failed = new Set<string>();
  const adapter = {
    ...base,
    send: async (session: Parameters<typeof base.send>[0], turn: Parameters<typeof base.send>[1]) => {
      const text = 'user' in turn.stimulus ? turn.stimulus.user : '';
      if (turn.index === 0) options.starts?.set(text, (options.starts.get(text) ?? 0) + 1);
      if (options.failFirst?.has(text) && !failed.has(text)) {
        failed.add(text);
        throw new Error('a planted agent failure');
      }
      const wait = options.delay?.(text) ?? 0;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      return base.send(session, turn);
    },
  };
  const byHash = new Map(options.loaded.map((entry) => [entry.hash, entry.spec] as const));
  return runCampaign({
    campaignId: options.campaignId,
    cells: options.cells,
    specFor: (cell) => byHash.get(cell.specHash) as Spec,
    adapterFor: () => adapter,
    driver: () => createScriptedDriver(),
    checks: defaultChecks(),
    store: options.store,
    ...(options.cache ? { cache: options.store } : {}),
    retry: FAST_RETRY,
    now: () => new Date(CLOCK),
    concurrency: options.concurrency ?? 1,
    ...(options.budgetUsd !== undefined ? { budgetUsd: options.budgetUsd } : {}),
  });
}

async function memoryCampaign(
  campaignId: string,
  loaded: Array<{ spec: Spec; hash: string }>,
  budgetUsd = 0,
): Promise<Store> {
  const store = openMemoryStore();
  await store.putCampaign(
    campaignOf(
      campaignId,
      loaded.map((entry) => ({ id: entry.spec.id, hash: entry.hash })),
      { budgetUsd },
    ),
  );
  return store;
}

function resumeBudget(): BankItem[] {
  const out: BankItem[] = [];
  const add = (
    id: string,
    tier: Tier,
    component: string,
    title: string,
    check: BankItem['check'],
    cause = `campaign runner: ${title}`,
  ) =>
    out.push({
      id,
      family: 'resume-budget',
      tier,
      level: 1,
      component,
      source: 'contract',
      title,
      cause,
      check,
    });

  for (const concurrency of [1, 4]) {
    for (const cut of ['none', 'one', 'half', 'all-but-one'] as const) {
      add(
        `resume/${cut}/c${concurrency}`,
        concurrency === 1 ? 2 : 3,
        CAMPAIGN,
        `a campaign interrupted after ${cut} of its cells resumes, reusing exactly those and running the rest once, ${concurrency} at a time`,
        async ({ seed }) => {
          const { behaviours, loaded, cells } = await smallCampaign(
            seed,
            `resume-${cut}-${concurrency}`,
            3,
            2,
          );
          const k = cut === 'none' ? 0 : cut === 'one' ? 1 : cut === 'half' ? 3 : cells.length - 1;
          const store = await memoryCampaign('c-resume', loaded);
          const starts = new Map<string, number>();
          await runCells({
            campaignId: 'c-resume',
            cells: cells.slice(0, k),
            loaded,
            behaviours,
            store,
            concurrency,
            starts,
          });
          const before = new Map(starts);
          const outcomes = await runCells({
            campaignId: 'c-resume',
            cells,
            loaded,
            behaviours,
            store,
            concurrency,
            starts,
          });
          const reran = [...starts].reduce((sum, [text, count]) => sum + count - (before.get(text) ?? 0), 0);
          const stored = await store.listRuns({ campaignId: 'c-resume' });
          await store.close();
          return expectAll([
            [outcomes.length === cells.length, `${outcomes.length} outcomes for ${cells.length} cells`],
            [
              outcomes.every((outcome, index) => outcome.reused === index < k),
              `reused flags ${outcomes.map((o) => (o.reused ? 'r' : '-')).join('')}`,
            ],
            [
              reran === cells.length - k,
              `the agent started ${reran} runs after the interruption, ${cells.length - k} expected`,
            ],
            [stored.length === cells.length, `${stored.length} runs stored`],
            [
              outcomes.every((outcome, index) => outcome.cell.cellId === cells[index]?.cellId),
              'outcomes out of cell order',
            ],
          ]);
        },
        'runCampaign reuses the completed cells of a campaign on resume and runs only the others, once each',
      );
    }
  }

  add(
    'resume/failed-runs-again',
    2,
    CAMPAIGN,
    'a cell whose run failed runs again on resume and its new run replaces the old one',
    async ({ seed }) => {
      const { behaviours, loaded, cells } = await smallCampaign(seed, 'failed-again', 2, 1);
      const store = await memoryCampaign('c-f', loaded);
      const firstText = loaded[0]?.spec.blocks[0]?.when;
      const failFirst = new Set<string>(firstText && 'user' in firstText ? [firstText.user] : []);
      const first = await runCells({ campaignId: 'c-f', cells, loaded, behaviours, store, failFirst });
      const second = await runCells({ campaignId: 'c-f', cells, loaded, behaviours, store });
      const stored = await store.listRuns({ campaignId: 'c-f' });
      await store.close();
      return expectAll([
        [first[0]?.state === 'failed', `the planted failure gave ${first[0]?.state}`],
        [
          second[0]?.state === 'pass' && second[0]?.reused === false,
          `resume gave ${second[0]?.state}, reused ${second[0]?.reused}`,
        ],
        [second[1]?.reused === true, 'the passing cell ran again'],
        [
          stored.length === 2 && stored.every((run) => run.status === 'completed'),
          'the failed run was kept beside the new one',
        ],
      ]);
    },
  );

  for (const [budget, cost] of [
    [0, 0.01],
    [0.01, 0.01],
    [0.025, 0.01],
    [0.1, 0.03],
  ] as const) {
    add(
      `budget/stop-${budget}-${cost}`,
      3,
      CAMPAIGN,
      `with a budget of ${budget} and runs costing ${cost * 2} each, exactly the cells that start before the spend reaches the budget run`,
      async ({ seed }) => {
        const { behaviours, loaded, cells } = await smallCampaign(
          seed,
          `budget-${budget}-${cost}`,
          6,
          1,
          cost,
        );
        const store = await memoryCampaign('c-b', loaded, budget);
        const outcomes = await runCells({
          campaignId: 'c-b',
          cells,
          loaded,
          behaviours,
          store,
          budgetUsd: budget,
        });
        await store.close();
        const perRun = cost * 2;
        let spent = 0;
        let expected = 0;
        for (let index = 0; index < cells.length; index += 1) {
          if (spent >= budget - 1e-12) break;
          expected += 1;
          spent += perRun;
        }
        const ran = outcomes.filter((outcome) => outcome.state !== 'stopped').length;
        const stopped = outcomes.filter((outcome) => outcome.budgetStop !== undefined).length;
        return expectAll([
          [ran === expected, `${ran} cells ran, ${expected} expected`],
          [stopped === cells.length - expected, `${stopped} cells carry a budget stop`],
        ]);
      },
      'runCampaign stops a cell before it starts once the campaign spend has reached the budget',
    );
  }

  add(
    'budget/in-flight-bound',
    4,
    CAMPAIGN,
    'with 4 workers the spend passes the budget by at most the runs in flight when it was reached',
    async ({ seed }) => {
      const { behaviours, loaded, cells } = await smallCampaign(seed, 'inflight', 12, 1, 0.01);
      const store = await memoryCampaign('c-in', loaded, 0.05);
      const outcomes = await runCells({
        campaignId: 'c-in',
        cells,
        loaded,
        behaviours,
        store,
        budgetUsd: 0.05,
        concurrency: 4,
        delay: () => 2,
      });
      await store.close();
      const spent = outcomes.reduce((sum, outcome) => sum + (outcome.run?.cost ?? 0), 0);
      // At the cell that reaches the budget the spend is under budget plus one run; the other three workers
      // may each finish one more run. So the spend is at most the budget plus four runs.
      return spent <= 0.05 + 4 * 0.02 + 1e-9 && spent >= 0.05 - 1e-9 ? PASS : fail(`spent ${spent}`);
    },
  );

  add(
    'budget/cache-is-free',
    3,
    CAMPAIGN,
    'runs replayed from the cache cost nothing against the budget',
    async ({ seed }) => {
      const { behaviours, loaded, cells } = await smallCampaign(seed, 'free-cache', 4, 1, 0.01);
      const store = await memoryCampaign('c-live', loaded);
      await runCells({ campaignId: 'c-live', cells, loaded, behaviours, store, cache: true });
      await store.putCampaign(
        campaignOf(
          'c-replay',
          loaded.map((entry) => ({ id: entry.spec.id, hash: entry.hash })),
          { budgetUsd: 0.01 },
        ),
      );
      const outcomes = await runCells({
        campaignId: 'c-replay',
        cells,
        loaded,
        behaviours,
        store,
        cache: true,
        budgetUsd: 0.01,
      });
      await store.close();
      return expectAll([
        [outcomes.every((outcome) => outcome.run?.cacheHit === true), 'a run went live'],
        [
          outcomes.every((outcome) => outcome.state === 'pass'),
          `states ${outcomes.map((o) => o.state).join(',')}`,
        ],
      ]);
    },
  );

  add(
    'workers/order',
    3,
    CAMPAIGN,
    'with 4 workers and uneven run times the outcomes come back in cell order',
    async ({ seed }) => {
      const { behaviours, loaded, cells } = await smallCampaign(seed, 'order', 8, 1);
      const store = await memoryCampaign('c-o', loaded);
      const rng = rngFor(seed, 'order-delay');
      const delays = new Map<string, number>();
      const outcomes = await runCells({
        campaignId: 'c-o',
        cells,
        loaded,
        behaviours,
        store,
        concurrency: 4,
        delay: (text) => {
          if (!delays.has(text)) delays.set(text, between(rng, 0, 6));
          return delays.get(text) ?? 0;
        },
      });
      await store.close();
      return outcomes.map((outcome) => outcome.cell.cellId).join() === cells.map((cell) => cell.cellId).join()
        ? PASS
        : fail('outcomes out of cell order');
    },
  );

  add(
    'workers/throw-stops',
    4,
    CAMPAIGN,
    'when running a cell throws, no new cell starts and the error is raised',
    async ({ seed }) => {
      const { behaviours, loaded, cells } = await smallCampaign(seed, 'throw', 5, 1);
      const store = await memoryCampaign('c-t', loaded);
      let started = 0;
      try {
        await runCampaign({
          campaignId: 'c-t',
          cells,
          specFor: (cell) => {
            started += 1;
            if (cell.cellId === cells[1]?.cellId) throw new Error('planted: no spec');
            return loaded.find((entry) => entry.hash === cell.specHash)?.spec as Spec;
          },
          adapterFor: () => adapterFor('function', behaviours),
          driver: () => createScriptedDriver(),
          checks: defaultChecks(),
          store,
          concurrency: 1,
        });
        return fail('runCampaign returned');
      } catch (cause) {
        return expectAll([
          [
            String((cause as Error).message).includes('planted: no spec'),
            `raised ${(cause as Error).message}`,
          ],
          [started === 2, `${started} cells started`],
        ]);
      } finally {
        await store.close();
      }
    },
  );

  add(
    'cells/stable-ids',
    1,
    'packages/core/src/runner/cell.ts',
    'a cell id is the same in every campaign and equals the documented hash of its key',
    async ({ seed }) => {
      const { loaded, cells } = await smallCampaign(seed, 'ids', 2, 2);
      const again = planCampaign(loaded, [TARGET], ['F'], 2).cells;
      return expectAll([
        [
          cells.map((cell) => cell.cellId).join() === again.map((cell) => cell.cellId).join(),
          'ids change between plans',
        ],
        [
          cells.every(
            (cell) =>
              cell.cellId ===
              cellId({
                specHash: cell.specHash,
                target: cell.target,
                mode: cell.mode,
                repeat: cell.repeat,
                perturbationId: cell.perturbationId,
              }),
          ),
          'an id differs from cellId',
        ],
        [new Set(cells.map((cell) => cell.cellId)).size === cells.length, 'two cells share an id'],
      ]);
    },
  );

  add(
    'cells/perturbed',
    2,
    CAMPAIGN,
    'mode P plans one cell per perturbation and repeat, each one block longer (a message or burst perturbation)',
    async ({ seed }) => {
      const planted = plantedFlow(seed, 'p-cells', 4);
      planted.spec.perturbations = [
        { id: 'a', class: 'D1_off_topic', inject_at: 1, user: 'one' },
        { id: 'b', class: 'D9_out_of_scope', inject_at: 2, user: 'two' },
        { id: 'c', class: 'D7_silence_or_burst', inject_at: 3, burst: ['three', 'four'] },
      ];
      const result = validateSpec(planted.spec, 'bank');
      if (!result.ok) return fail('the perturbed spec does not load');
      const cells = planCampaign([{ spec: result.spec, hash: result.hash }], [TARGET], ['P'], 2).cells;
      return expectAll([
        [cells.length === 6, `${cells.length} cells`],
        [cells.every((cell) => cell.blocks === 5), 'a cell does not count the injected block'],
        [
          new Set(cells.map((cell) => `${cell.perturbationId}/${cell.repeat}`)).size === 6,
          'perturbations and repeats do not cross',
        ],
      ]);
    },
  );

  add(
    'cells/outcome-states',
    2,
    CAMPAIGN,
    'a cell outcome reads pass, fail, failed, stopped or pending from its run as documented',
    async ({ seed }) => {
      const run = await baseRun(seed, 'states', false);
      const failing = await baseRun(seed, 'states-fail');
      const cell = (each: RunResult): PlannedCell => ({
        cellId: each.runId,
        specId: each.specId,
        specHash: each.specHash,
        target: each.target,
        mode: each.mode,
        repeat: each.repeat,
        blocks: each.blocks.length,
      });
      const cases: Array<[string, RunResult | undefined, string]> = [
        ['all blocks pass', run, 'pass'],
        ['a block fails', failing, 'fail'],
        [
          'the end state differs',
          { ...run, endState: { match: false, diff: [{ field: 'x', expected: 1, observed: 2 }] } },
          'fail',
        ],
        ['completed with no block', { ...run, blocks: [] }, 'fail'],
        ['an error ended it', { ...run, status: 'failed', error: 'x' }, 'failed'],
        ['the driver stopped it', { ...run, status: 'stopped' }, 'stopped'],
        ['no run yet', undefined, 'pending'],
      ];
      for (const [what, each, want] of cases) {
        const got = outcomeOf(cell(each ?? run), each).state;
        if (got !== want) return fail(`${what}: ${got}, documented ${want}`);
      }
      return PASS;
    },
  );

  add(
    'budget/resume-keeps',
    3,
    CAMPAIGN,
    'resume keeps the budget the campaign was run with: a stopped cell stays stopped',
    async ({ seed }) => {
      const { behaviours, loaded, cells } = await smallCampaign(seed, 'keep-budget', 4, 1, 0.01);
      const store = await memoryCampaign('c-k', loaded, 0.02);
      await runCells({ campaignId: 'c-k', cells, loaded, behaviours, store, budgetUsd: 0.02 });
      const campaign = await store.getCampaign('c-k');
      const again = await runCells({
        campaignId: 'c-k',
        cells,
        loaded,
        behaviours,
        store,
        budgetUsd: campaign?.budgetUsd ?? 0,
      });
      await store.close();
      return again.filter((outcome) => outcome.state === 'stopped').length === 3
        ? PASS
        : fail(`after resume: ${again.map((outcome) => outcome.state).join(',')}`);
    },
  );

  return out;
}

export function recordItems(): BankItem[] {
  return [...storeRoundTrip(), ...resumeBudget()];
}

/** Makes sure a scratch folder exists. */
export function ensureFolder(path: string): void {
  mkdirSync(path, { recursive: true });
}
