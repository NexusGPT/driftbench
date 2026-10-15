import type { RunResult } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { rankOutcome } from '../src/commands/compare-rank';
import { decayOf, type SessionEvidence } from '../src/commands/estate-stats';
import { metricOf, standardErrorOf } from '../src/commands/monitor';
import { passingAndFailing } from '../src/view/server';

/** A completed run of one block: pass, fail, or not run. */
function run(kind: 'pass' | 'fail' | 'not_run'): RunResult {
  return {
    runId: kind,
    specId: 's',
    specHash: 'h',
    target: { adapter: 'function' },
    mode: 'F',
    repeat: 0,
    status: 'completed',
    blocks: [
      {
        index: 0,
        givenHash: 'abcdefabcdef',
        observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0 },
        verdicts: [],
        ledgerCheck: { ok: true, contradictions: [] },
        drift: [],
        pass: kind === 'pass',
        ...(kind === 'not_run'
          ? {
              status: 'not_run' as const,
              notRun: {
                kind: 'unsupported' as const,
                layer: '1 history',
                check: 'capability',
                expected: 'e',
                got: 'g',
              },
            }
          : {}),
      },
    ],
    succession: { driftCount: 0, driftRate: 0, longestClean: 0, minOverBlocks: false },
    cost: 0,
    latencyMs: 0,
    startedAt: '2026-10-15T00:00:00.000Z',
    finishedAt: '2026-10-15T00:00:00.000Z',
    cacheHit: false,
  };
}

describe('rates over runs leave out the runs neither passed nor failed', () => {
  const runs = [run('pass'), run('fail'), run('not_run'), run('not_run')];

  it('monitor pass_rate: 1 of 2 scored runs, with the standard error of 2 runs', () => {
    expect(metricOf(runs, 'pass_rate')).toBe(0.5);
    expect(standardErrorOf(runs, 'pass_rate')).toBeCloseTo(Math.sqrt(0.25 / 2), 12);
  });

  it('compare --rank: a not-run run is no outcome', () => {
    expect(rankOutcome(run('pass'))).toBe(true);
    expect(rankOutcome(run('fail'))).toBe(false);
    expect(rankOutcome(run('not_run'))).toBeUndefined();
  });

  it('the viewer index: passing and failing leave the not-run runs out of both columns', () => {
    expect(passingAndFailing(runs)).toEqual({ passing: 1, failing: 1, unscored: 2 });
  });

  it('estate stats decay: a session whose block was only not run leaves that block out', () => {
    const session = (blocks: number, passed: number[], unscored: number[]) =>
      ({
        entry: { session: { blocks: Array.from({ length: blocks }, () => ({})) } },
        passedBlocks: new Set(passed),
        unscoredBlocks: new Set(unscored),
        followed: new Set<string>(),
      }) as unknown as SessionEvidence;
    // Block 1: one session passed, one was only not run there: 1 of 1, not 1 of 2.
    expect(decayOf([session(2, [0, 1], []), session(2, [0], [1])])).toEqual([
      { block: 0, runs: 2, passRate: 1 },
      { block: 1, runs: 1, passRate: 1 },
    ]);
  });
});
