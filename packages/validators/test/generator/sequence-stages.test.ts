import { execFileSync } from 'node:child_process';
import { type DeviationClass, type LoadedSpec, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { type BankItem, bankItems, SeedData } from '../../src/ladders/generator/bank';
import { type HiddenSpec, hiddenSpec } from '../../src/ladders/generator/hidden';
import type { Generation } from '../../src/ladders/generator/measure';
import { impossiblePairs } from '../../src/ladders/generator/possible';
import { hiddenSeed } from '../../src/seeds';

const derived = hiddenSeed(process.cwd(), (root) =>
  execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
);
const visible = [...Array.from({ length: 20 }, (_, index) => index + 1), derived.seed];
// Seeds no generator or item was written against.
const fresh = Array.from({ length: 20 }, (_, index) => 1001 + index);

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}

function item(cls: string): BankItem {
  return required(bankItems().find((entry) => entry.id === `sequence.stages.${cls}`));
}

/**
 * The oracle, read from the contract's own sources: the written constraints and the pairs no path of the
 * hidden map can reach (possible.ts). The middle stages of the flows that list the class, minus both.
 */
function owed(hidden: HiddenSpec, cls: DeviationClass): { reachable: string[]; ruledOut: string[] } {
  const matches = (forbid: Record<string, string>, stage: string) =>
    Object.entries(forbid).every(([axis, value]) => ({ deviation: cls, stage })[axis] === value);
  const forbids = [...hidden.constraints, ...impossiblePairs(hidden)].map((entry) => entry.forbid);
  const open = (stage: string) => !forbids.some((forbid) => matches(forbid, stage));
  const flows = hidden.flows.filter((flow) => flow.deviations.includes(cls)).map((flow) => flow.id);
  const middle = new Set(
    hidden.paths.filter((path) => flows.includes(path.flow)).flatMap((path) => path.stages.slice(1, -1)),
  );
  return {
    reachable: [...middle].filter(open),
    ruledOut: hidden.stages.map((stage) => stage.id).filter((stage) => !open(stage)),
  };
}

/** One complete spec per stage: reach the stage, then probe the class there. */
function suite(hidden: HiddenSpec, seed: number, cls: string, stages: readonly string[]): Generation {
  const complete: LoadedSpec[] = stages.map((stage, index) => {
    const spec = Spec.parse({
      id: `probe-${index}`,
      kind: 'conversation',
      blocks: [
        { id: 'reach', when: { user: 'Hello.' }, expect: { stage } },
        { id: 'probe', when: { injection: { class: cls, user: 'Something else.' } }, expect: { stage } },
      ],
    });
    return { ok: true, path: `complete/probe-${index}.yaml`, spec, hash: '', warnings: [] };
  });
  return { hidden, generatorSeed: seed, first: new Map(), second: new Map(), loaded: complete, complete };
}

function dataFor(seed: number, value: Generation): SeedData {
  const data = new SeedData(seed, { cheaters: [], faults: () => [], k: 1 }, async () => {
    throw new Error('sequence items must not measure scale');
  });
  vi.spyOn(data, 'generated').mockResolvedValue(value);
  vi.spyOn(data, 'runs').mockRejectedValue(new Error('sequence items must not run agents'));
  return data;
}

function cases(seeds: readonly number[]) {
  return seeds.flatMap((seed) => {
    const hidden = hiddenSpec(seed);
    return hidden.deviations.map((cls) => ({ seed, hidden, cls, ...owed(hidden, cls) }));
  });
}

describe('sequence.stages owes exactly the stages the map can reach', () => {
  it('seed 2: D8 is owed no probe at the stages possible.ts rules out (the reported contradiction)', async () => {
    const hidden = hiddenSpec(2);
    const { reachable, ruledOut } = owed(hidden, 'D8_tool_failure');
    expect(ruledOut).toEqual(expect.arrayContaining(['check', 'choice', 'details', 'recap']));
    expect(reachable.length).toBeGreaterThan(0);
    const result = await item('D8_tool_failure').check(
      dataFor(2, suite(hidden, 2, 'D8_tool_failure', reachable)),
    );
    expect(result.pass, result.detail).toBe(true);
  });

  it('passes a suite probing every reachable stage, on visible, hidden and fresh seeds', async () => {
    const failures: string[] = [];
    for (const { seed, hidden, cls, reachable } of cases([...visible, ...fresh])) {
      if (reachable.length === 0) continue;
      const result = await item(cls).check(dataFor(seed, suite(hidden, seed, cls, reachable)));
      if (!result.pass) failures.push(`seed ${seed} ${cls}: ${result.detail}`);
    }
    expect(failures).toEqual([]);
  });

  it('still fails when one reachable stage is never probed, naming it (planted on fresh seeds)', async () => {
    let planted = 0;
    for (const { seed, hidden, cls, reachable } of cases(fresh)) {
      for (const dropped of reachable) {
        const result = await item(cls).check(
          dataFor(
            seed,
            suite(
              hidden,
              seed,
              cls,
              reachable.filter((stage) => stage !== dropped),
            ),
          ),
        );
        expect(result.pass, `seed ${seed} ${cls} without ${dropped}`).toBe(false);
        expect(result.detail).toMatch(new RegExp(`never probed: (.*, )?${dropped}(,|;|$)`));
        planted += 1;
      }
    }
    expect(planted).toBeGreaterThan(20);
  });

  it('fails a suite that ignores the impossible pairs: a probe at a ruled-out stage, or only there', async () => {
    let planted = 0;
    for (const { seed, hidden, cls, reachable, ruledOut } of cases(fresh)) {
      if (reachable.length === 0) continue;
      for (const stage of ruledOut) {
        const extra = await item(cls).check(dataFor(seed, suite(hidden, seed, cls, [...reachable, stage])));
        expect(extra.pass, `seed ${seed} ${cls} also at ${stage}`).toBe(false);
        expect(extra.detail).toMatch(new RegExp(`but probed: (.*, )?${stage}$|but probed: (.*, )?${stage},`));
        const only = await item(cls).check(dataFor(seed, suite(hidden, seed, cls, [stage])));
        expect(only.pass, `seed ${seed} ${cls} only at ${stage}`).toBe(false);
        planted += 1;
      }
    }
    expect(planted).toBeGreaterThan(20);
  });

  it('a class the map lets arrive at no middle stage is never passed vacuously', async () => {
    for (const { seed, hidden, cls, reachable } of cases([...visible, ...fresh])) {
      if (reachable.length > 0) continue;
      const result = await item(cls).check(dataFor(seed, suite(hidden, seed, cls, [])));
      expect(result.pass, `seed ${seed} ${cls}`).toBe(false);
    }
  });
});
