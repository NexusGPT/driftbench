import { type RunResult, RunResult as RunSchema } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { observationOf } from '../../src/pilot/run';

const FACTORS = { cell: 'behaviour=B-1', conversation: 's1', wording: 1, map: 'map-1', suite: 4 };

function run(blocks: Array<{ pFail?: number; verdicts?: Array<[string, 'pass' | 'fail']> }>): RunResult {
  return RunSchema.parse({
    runId: 'r1',
    specId: 's1.w1',
    specHash: 'h1',
    target: { adapter: 'function', agent: 'acme-random' },
    mode: 'F',
    repeat: 2,
    status: 'completed',
    blocks: blocks.map((block, index) => {
      const verdicts = (block.verdicts ?? []).map(([name, outcome]) => ({
        id: `${name}.x`,
        kind: 'machine',
        name,
        gating: true,
        outcome,
        evidence: 'test',
      }));
      return {
        index,
        givenHash: 'g',
        observed: {
          segments: [],
          text: 'ok',
          toolCalls: [],
          cost: { usd: 0 },
          latencyMs: 0,
          ...(block.pFail === undefined
            ? {}
            : { raw: { pilotControl: { pFail: block.pFail, model: { seed: 7 } } } }),
        },
        verdicts,
        ledgerCheck: { ok: true, contradictions: [] },
        drift: [],
        pass: verdicts.every((verdict) => verdict.outcome === 'pass'),
      };
    }),
    succession: { driftCount: 0, driftRate: 0, longestClean: 0, minOverBlocks: true },
    cost: 0,
    latencyMs: 0,
    startedAt: '2026-10-11T12:00:00.000Z',
    finishedAt: '2026-10-11T12:00:01.000Z',
    cacheHit: false,
  });
}

describe('observationOf', () => {
  it('keeps the factors and the repeat, and reads the pass as the runner does', () => {
    const observation = observationOf(run([{}, {}]), FACTORS);
    expect(observation).toMatchObject({
      ...FACTORS,
      specId: 's1.w1',
      repeat: 2,
      pass: true,
      blocks: [true, true],
    });
    expect(observation?.planted).toBeUndefined();
    expect(observationOf(run([{}]), undefined)).toBeUndefined();
  });

  it('turns the blocks stated chances into the run chance: 1 minus the product of passing', () => {
    const observation = observationOf(run([{ pFail: 0.5 }, { pFail: 0.2 }]), FACTORS);
    expect(observation?.planted).toBeCloseTo(1 - 0.5 * 0.8, 12);
    expect(observation?.model).toEqual({ seed: 7 });
  });

  it('counts a run the wrapped agent fails on another check as a certain failure', () => {
    const failed = observationOf(
      run([{ pFail: 0.05, verdicts: [['lang', 'fail']] }, { pFail: 0.05 }]),
      FACTORS,
    );
    expect(failed?.planted).toBe(1);
    // The control check's own failure is the planted draw, not the wrapped agent's.
    const planted = observationOf(run([{ pFail: 0.05, verdicts: [['pilot_control', 'fail']] }]), FACTORS);
    expect(planted?.planted).toBeCloseTo(0.05, 12);
    expect(planted?.pass).toBe(false);
  });

  it('gives no observation for a run with a block not run and no failure: it is no measurement', () => {
    const base = run([{ verdicts: [['must', 'pass']] }, { verdicts: [] }]);
    const notRun: RunResult = {
      ...base,
      blocks: base.blocks.map((block, index) =>
        index === 1
          ? {
              ...block,
              pass: false,
              status: 'not_run',
              notRun: { kind: 'unsupported', layer: '5 world', check: 'capability', expected: 'e', got: 'g' },
            }
          : block,
      ),
    };
    expect(observationOf(notRun, FACTORS)).toBeUndefined();
    expect(observationOf(base, FACTORS)?.pass).toBe(true);
  });
});
