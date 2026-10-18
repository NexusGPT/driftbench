import { execFileSync } from 'node:child_process';
import type { LoadedSpec, Spec } from '@agent-nexus/driftbench-core';
import { runOnce } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { bankItems, type SeedData } from '../../src/ladders/generator/bank';
import { baselineSuite } from '../../src/ladders/generator/baseline';
import { faultFamily } from '../../src/ladders/generator/faults';
import { createFollower } from '../../src/ladders/generator/follower';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { followerAdapter, type Generation, runAll, runContext } from '../../src/ladders/generator/measure';
import { hiddenProposal, renderPrompt } from '../../src/ladders/generator/render';
import { hiddenSeed } from '../../src/seeds';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing D8 fixture value');
  return value;
}

const derived = hiddenSeed(process.cwd(), (root) =>
  execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
const seeds = [...Array.from({ length: 20 }, (_, index) => index + 1), derived.seed];
const items = bankItems();
const adequacy = required(items.find((item) => item.id === 'adequacy.D8.advance'));
const recoveryItem = required(items.find((item) => item.id === 'perturbation.recovery.D8_tool_failure'));

function fixture(seed: number, selfLoop: boolean) {
  const hidden = hiddenSpec(seed);
  const recovery = required(
    hiddenProposal(hidden).relations?.find(
      (entry) => entry.kind === 'recovery' && entry.class === 'D8_tool_failure',
    ),
  );
  if (recovery.kind !== 'recovery') throw new Error('not a recovery');
  const call = required(recovery.tools?.[0]);
  const tool = required(hidden.tools.find((entry) => entry.name === call.tool));
  const loaded = structuredClone(required(baselineSuite(hidden)[0]));
  loaded.spec.blocks = loaded.spec.blocks.filter((block) => !('injection' in (block.when ?? {})));
  const at = loaded.spec.blocks.findIndex((block) => block.expect?.stage === tool.stage);
  if (at < 0) throw new Error('no read-tool move');
  loaded.spec.blocks = loaded.spec.blocks.slice(0, at + (selfLoop ? 1 : 0));
  const from = selfLoop ? tool.stage : required(loaded.spec.blocks.at(-1)?.expect?.stage);
  const phrase = required(
    hidden.phrases.find(
      (entry) => entry.intent.kind === 'transition' && entry.intent.edge === `${from}-to-${tool.stage}`,
    ),
  );
  const property = required(tool.input[0]);
  if (property.type !== 'enum') throw new Error('missing read slot');
  loaded.spec.blocks.push({
    id: 'failed-read',
    given: { world: { tools: { [tool.name]: { error: 'service unavailable' } } } },
    when: {
      injection: {
        class: 'D8_tool_failure',
        user: phrase.text.replace(`{${tool.slot}}`, required(property.members[0])),
      },
    },
    expect: {
      stage: from,
      must: recovery.must,
      tools: [{ label: tool.name, count: call.count }],
    },
  });
  delete loaded.spec.end_state;
  return { hidden, loaded, recovery };
}

async function check(seed: number, hidden: ReturnType<typeof hiddenSpec>, loaded: LoadedSpec) {
  const generated: Generation = {
    hidden,
    generatorSeed: seed,
    first: new Map(),
    second: new Map(),
    loaded: [loaded],
    complete: [loaded],
  };
  const runs = await runAll(generated, {
    k: 1,
    cheaters: [],
    faults: (spec) =>
      faultFamily(spec).filter(
        (fault) =>
          ['D8.advance', 'D8.retry-many'].includes(fault.class) && fault.where === 'any' && fault.rate === 1,
      ),
  });
  expect(runs.errors).toEqual([]);
  expect(runs.blocks.every((block) => block.reference[0] === 'pass')).toBe(true);
  const data = { generated: async () => generated, runs: async () => runs } as SeedData;
  return { runs, adequate: await adequacy.check(data), recovery: await recoveryItem.check(data) };
}

describe('D8 recovery and adequacy share the retry contract', () => {
  it.each(seeds)('seed %i: the rendered contract catches the first divergent turn', async (seed) => {
    const specimen = hiddenSpec(seed);
    const stage = required(specimen.tools.find((tool) => tool.role === 'read')).stage;
    const selfLoop = specimen.transitions.some((edge) => edge.from === stage && edge.to === stage);
    const { hidden, loaded, recovery } = fixture(seed, selfLoop);
    expect(renderPrompt(hidden)).toContain('A failed read-only tool gets one retry');
    expect(renderPrompt(hidden)).toContain(recovery.evidence.quote);
    const result = await check(seed, hidden, loaded);
    expect(result.recovery.pass, result.recovery.detail).toBe(true);
    expect(result.adequate.pass, result.adequate.detail).toBe(true);
    expect(required(loaded.spec.blocks.at(-1)?.expect?.tools?.[0]).count).toBe(2);
    expect(required(result.runs.blocks.at(-1)).faults['D8.retry-many@any/r1']).toBe('fail');
  });

  it.each([1, 3])('seed %i: exact calls satisfy both items; a maximum alone cannot', async (seed) => {
    const { hidden, loaded } = fixture(seed, true);
    const last = required(loaded.spec.blocks.at(-1));
    required(last.expect?.tools?.[0]).count = 2;
    const exact = await check(seed, hidden, loaded);
    expect(exact.adequate.pass, exact.adequate.detail).toBe(true);
    expect(exact.recovery.pass, exact.recovery.detail).toBe(true);
    required(last.expect?.tools?.[0]).count = { max: 2 };
    const weak = await check(seed, hidden, loaded);
    expect(weak.adequate.pass).toBe(false);
    expect(weak.recovery.pass).toBe(false);
  });

  it('still requires staying on a non-self-loop after the failed attempts', async () => {
    const { hidden, loaded } = fixture(1, false);
    const result = await check(1, hidden, loaded);
    expect(result.adequate.pass, result.adequate.detail).toBe(true);
    expect(result.recovery.pass, result.recovery.detail).toBe(true);
  });

  it('the self-loop traces differ only in failed call multiplicity', async () => {
    const { hidden, loaded } = fixture(1, true);
    const fault = required(
      faultFamily(hidden).find(
        (entry) => entry.class === 'D8.advance' && entry.where === 'any' && entry.rate === 1,
      ),
    );
    const run = (spec: Spec, mutation = {}) =>
      runOnce(spec, followerAdapter(createFollower(hidden, mutation)), 1, runContext());
    const good = required((await run(loaded.spec)).blocks.at(-1)).observed;
    const bad = required((await run(loaded.spec, fault.mutation)).blocks.at(-1)).observed;
    expect(good.text).toBe(bad.text);
    expect(good.runtime).toEqual(bad.runtime);
    expect(good.toolCalls).toHaveLength(2);
    expect(bad.toolCalls).toHaveLength(1);
    expect(good.toolCalls.map(({ id: _id, ...call }) => call)).toEqual([
      ...bad.toolCalls.map(({ id: _id, ...call }) => call),
      ...bad.toolCalls.map(({ id: _id, ...call }) => call),
    ]);
  });
});
