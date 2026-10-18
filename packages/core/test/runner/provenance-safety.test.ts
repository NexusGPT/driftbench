import { processAdapter } from '@agent-nexus/driftbench-adapters';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { cellId, planRadiusCampaign, radiusOf } from '../../src/index';
import { provenanceHash, runProvenance } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { echoAdapter, specOf } from './support';

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing test fixture');
  return value;
}

const spec = specOf({ id: 'acme-safe-carry', metadata: { depends: {} }, blocks: [{ user: 'hello' }] });
const options = {
  adapter: echoAdapter(),
  driver: createScriptedDriver(),
  checks: [],
  mode: 'F' as const,
  repeat: 0,
  target: { adapter: 'echo', variant: 'v1' },
  recordProvenance: true,
};
it('never copies private driver, seed, adapter, or stimulus values into the stamp', async () => {
  const marker = 'ACME_PRIVATE_SENTINEL';
  const run = await runSpec(spec, {
    ...options,
    adapter: {
      ...echoAdapter(),
      id: `${marker}-adapter`,
      version: `${marker}-version`,
      cacheIdentity: `${marker}-command`,
    },
    driver: {
      ...createScriptedDriver(),
      id: `${marker}-driver`,
      seeds: { [marker]: `${marker}-seed` },
      next: (ctx) =>
        ctx.blockIndex > 0
          ? { kind: 'stop', reason: 'done' }
          : { kind: 'block', blockIndex: 0, stimulus: { user: `${marker}-stimulus` } },
    },
  });
  const bytes = Buffer.from(
    JSON.stringify({ run: run.provenance, blocks: run.blocks.map((b) => b.provenance) }),
  );
  expect(bytes.includes(Buffer.from(marker))).toBe(false);
});
it('distinguishes actual process command and argument identities without starting a process', () => {
  const stamp = (command: string, args: string[] = []) =>
    runProvenance({
      ...options,
      target: { adapter: 'process', variant: 'v1' },
      adapter: processAdapter({ command, args, provider: localProvider() }),
    });
  expect(stamp('acme-one').executionHash).not.toBe(stamp('acme-two').executionHash);
  expect(stamp('acme-one', ['a b']).executionHash).not.toBe(stamp('acme-one', ['a', 'b']).executionHash);
});
it('the public planner refuses an unstamped observation even outside the declared radius', async () => {
  const run = await runSpec(spec, { ...options, recordProvenance: false });
  const target = { ...options.target, variant: 'v2' };
  const cell = { ...run, target, cellId: cellId({ ...run, target }), blocks: 1 };
  const manifest = { from: 'v1', to: 'v2', changes: [{ kind: 'criterion' as const, id: 'unused-review' }] };
  const radius = radiusOf([{ spec, hash: run.specHash }], manifest);
  expect(radius.specs[0]?.cells[0]?.in).toBe(false);
  const planned = planRadiusCampaign(
    [cell],
    radius,
    manifest,
    { campaignId: 'base', runs: [run] },
    { now: new Date() },
  );
  expect(planned.carried).toHaveLength(0);
  expect(planned.fresh).toHaveLength(1);
});

it('rejects every incomplete stamp at the public planner boundary', async () => {
  const run = await runSpec(spec, options);
  const target = { ...options.target, variant: 'v2' };
  const cell = { ...run, target, cellId: cellId({ ...run, target }), blocks: 1 };
  const manifest = { from: 'v1', to: 'v2', changes: [{ kind: 'criterion' as const, id: 'unused-review' }] };
  const radius = radiusOf([{ spec, hash: run.specHash }], manifest);
  const baseline = {
    campaignId: 'base',
    runs: [run],
    provenance: {
      version: 2 as const,
      adapters: [
        {
          ...present(run.provenance).adapter,
          targetHash: provenanceHash(run.target),
          agentVersionHash: provenanceHash('v1'),
        },
      ],
    },
  };
  const plan = (base: typeof baseline) =>
    planRadiusCampaign([cell], radius, manifest, base, {
      now: new Date(),
      currentSpec: () => spec,
      currentProvenance: () => runProvenance({ ...options, target }),
    });
  expect(plan(baseline).carried).toHaveLength(1);
  const paths = [
    'provenance',
    'provenance.version',
    'provenance.adapters',
    ...Object.keys(present(baseline.provenance.adapters[0])).map((key) => `provenance.adapters.0.${key}`),
    'runs.0.provenance',
    ...Object.keys(present(run.provenance)).map((key) => `runs.0.provenance.${key}`),
    ...Object.keys(present(run.provenance).driver).map((key) => `runs.0.provenance.driver.${key}`),
    ...Object.keys(present(run.provenance).adapter).map((key) => `runs.0.provenance.adapter.${key}`),
    'runs.0.blocks.0.provenance',
    ...Object.keys(present(present(run.blocks[0]).provenance)).map(
      (key) => `runs.0.blocks.0.provenance.${key}`,
    ),
  ];
  for (const path of paths) {
    const partial = structuredClone(baseline);
    const parts = path.split('.');
    let value = partial as unknown as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) value = value[part] as Record<string, unknown>;
    delete value[present(parts.at(-1))];
    expect(plan(partial).carried, path).toHaveLength(0);
    expect(plan(partial).fresh, path).toHaveLength(1);
  }
  for (const mutate of [
    (base: typeof baseline) => {
      base.provenance.adapters = [];
    },
    (base: typeof baseline) => {
      present(base.provenance.adapters[0]).targetHash = provenanceHash('other-target');
    },
    (base: typeof baseline) => {
      present(base.provenance.adapters[0]).versionHash = provenanceHash('other-adapter');
    },
    (base: typeof baseline) => {
      present(present(base.runs[0]).provenance).driver.seedsHash = null;
    },
    (base: typeof baseline) => {
      present(base.runs[0]).target.adapter = 'process';
    },
    (base: typeof baseline) => {
      present(present(base.runs[0]).provenance).adapter.requiresCacheIdentity = true;
    },
  ]) {
    const partial = structuredClone(baseline);
    mutate(partial);
    expect(plan(partial).carried).toHaveLength(0);
  }
});

it('compares every current stamp field by default, including future fields', async () => {
  const run = await runSpec(spec, options);
  const stamp = present(run.provenance);
  const target = { ...options.target, variant: 'v2' };
  const cell = { ...run, target, cellId: cellId({ ...run, target }), blocks: 1 };
  const manifest = { from: 'v1', to: 'v2', changes: [{ kind: 'criterion' as const, id: 'unused-review' }] };
  const radius = radiusOf([{ spec, hash: run.specHash }], manifest);
  const baseline = {
    campaignId: 'base',
    runs: [run],
    provenance: {
      version: 2 as const,
      adapters: [
        {
          ...stamp.adapter,
          targetHash: provenanceHash(run.target),
          agentVersionHash: provenanceHash('v1'),
        },
      ],
    },
  };
  const current = runProvenance({ ...options, target });
  const plan = (context: typeof current | undefined) =>
    planRadiusCampaign([cell], radius, manifest, baseline, {
      now: new Date(),
      currentSpec: () => spec,
      currentProvenance: () => context,
    });
  expect(plan(current).carried).toHaveLength(1);
  const leaves = (value: Record<string, unknown>, path: string[] = []): string[][] =>
    Object.entries(value).flatMap(([key, child]) =>
      child !== null && typeof child === 'object'
        ? leaves(child as Record<string, unknown>, [...path, key])
        : [[...path, key]],
    );
  for (const path of leaves(current)) {
    const changed = structuredClone(current);
    let object = changed as Record<string, unknown>;
    for (const part of path.slice(0, -1)) object = object[part] as Record<string, unknown>;
    const key = present(path.at(-1));
    object[key] =
      typeof object[key] === 'boolean'
        ? !object[key]
        : typeof object[key] === 'number'
          ? 999
          : provenanceHash('changed field');
    expect(plan(changed).carried, path.join('.')).toHaveLength(0);
    expect(plan(changed).fresh, path.join('.')).toHaveLength(1);
  }
  expect(plan(undefined).carried).toHaveLength(0);
  // A newly introduced dimension cannot disappear behind the known schema or the execution digest.
  expect(
    plan({ ...current, futureExecutionField: provenanceHash('new') } as typeof current).carried,
  ).toHaveLength(0);
  for (const delta of [
    { driver: { ...options.driver, id: 'other' } },
    { driver: { ...options.driver, seeds: { sample: 2 } } },
    { adapter: { ...options.adapter, version: 'other' } },
    { adapter: { ...options.adapter, cacheIdentity: 'other' } },
    { target: { ...target, agent: 'other' } },
    { mode: 'T' as const },
    { repeat: 1 },
    { perturbationId: 'changed' },
    { maxSteps: 1 },
  ])
    expect(plan(runProvenance({ ...options, target, ...delta })).carried).toHaveLength(0);
});
