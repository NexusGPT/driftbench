import type { RunResult } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_AGGREGATES, evaluateAggregates } from '../src/aggregate';
import { compareCampaigns } from '../src/compare';
import { blockScore, runPassed, scoredRuns } from '../src/data';
import { renderHtml, renderRun } from '../src/html';
import { renderJunit } from '../src/junit';
import { reliability, successionOf } from '../src/reliability';
import { buildScorecard } from '../src/scorecard';
import { dataOf, run } from './support';

/** A run whose block `at` was not run: the Given carried a layer the adapter could not apply. */
function notRunAt(specId: string, at: number, blocks = 2): RunResult {
  const base = run({ specId, blocks: Array.from({ length: blocks }, () => ({})) });
  return {
    ...base,
    blocks: base.blocks.map((entry) =>
      entry.index < at
        ? entry
        : {
            ...entry,
            pass: false,
            status: 'not_run' as const,
            notRun: {
              kind: 'unsupported' as const,
              layer: '5 world',
              check: 'capability',
              expected: 'the adapter applies forced tool results (lookup) (toolStubs)',
              got: 'echo declares toolStubs false: the agent would never see it',
            },
            verdicts: [],
          },
    ),
  };
}

/** n goldens that pass, plus the not-run one. */
function campaign(id: string, n: number, extra: RunResult[] = []) {
  const runs = Array.from({ length: n }, (_, i) => run({ specId: `g${String(i).padStart(2, '0')}` }));
  return dataOf([...runs, ...extra], {}, id);
}

describe('a run with a block not run is neither a pass nor a fail', () => {
  const skipped = notRunAt('g-skip', 1);

  it('runPassed is false, and scoredRuns leaves it out', () => {
    expect(runPassed(skipped)).toBe(false);
    expect(scoredRuns([skipped, run({ specId: 'x' })]).map((entry) => entry.specId)).toEqual(['x']);
    // Only the block that ran counts toward the block score.
    expect(blockScore(skipped)).toBe(1);
  });

  it('the pass-rate aggregate counts only scored runs', () => {
    const [result] = evaluateAggregates(campaign('c', 3, [skipped]), [BUILT_IN_AGGREGATES.passRate(1)]);
    expect(result?.value).toBe(1);
    expect(result?.interval?.n).toBe(3);
  });

  it('reliability has no line for a golden whose only run was not run', () => {
    const lines = reliability(campaign('c', 2, [skipped]));
    expect(lines.map((line) => line.specId).sort()).toEqual(['g00', 'g01']);
  });

  it('the scorecard prints the not-run count beside pass and fail, and marks the run', () => {
    const card = buildScorecard(campaign('c', 2, [skipped]));
    expect(card.campaign).toMatchObject({ passing: 2, failing: 0, notRun: 1, broken: 0 });
    const detail = card.drilldown.find((entry) => entry.specId === 'g-skip');
    expect(detail?.outcome).toBe('not_run');
    expect(detail?.blocks[1]?.status).toBe('not_run');
    expect(detail?.blocks[1]?.notRun?.check).toBe('capability');
    // A campaign without one keeps the scorecard it always had: no notRun key.
    expect('notRun' in buildScorecard(campaign('c', 2)).campaign).toBe(false);
  });

  it('JUnit reports it as skipped, with the reason, never as a failure', () => {
    const xml = renderJunit(campaign('c', 1, [skipped]));
    expect(xml).toContain('failures="0"');
    expect(xml).toContain('skipped="1"');
    expect(xml).toContain('<skipped message="block 1 not run: capability: echo declares toolStubs false');
  });

  it('compare leaves a not-run unit unpaired with why, never a regression', () => {
    const result = compareCampaigns(
      campaign('b', 40, [run({ specId: 'g-skip' })]),
      campaign('c', 40, [skipped]),
      {
        margin: 0.1,
      },
    );
    expect(result.pairs).toHaveLength(40);
    expect(result.allPass.table.regressed).toBe(0);
    expect(result.unpaired).toContainEqual({
      unit: 'g-skip · F',
      reason:
        'not measured in the candidate: block 1 not run (capability: echo declares toolStubs false: the agent would never see it)',
    });
  });

  it('the run page shows its own badge and the reason, never a fail', () => {
    const card = buildScorecard(campaign('c', 1, [skipped]));
    const detail = card.drilldown.find((entry) => entry.specId === 'g-skip');
    if (!detail) throw new Error('no drilldown entry');
    const page = renderRun(detail);
    expect(page).toContain('<span class="badge skip">not run</span> <span class="mono">g-skip');
    expect(page).toContain('<span class="badge skip">not run</span> Block 1');
    expect(page).toContain(
      'Not run (unsupported, check capability, layer 5 world): expected the adapter applies forced tool results (lookup) (toolStubs); got echo declares toolStubs false: the agent would never see it.',
    );
    expect(page).not.toContain('<span class="badge bad">fail</span>');
  });

  it('the scorecard page counts it apart from the failing runs, with its own chip and reason', () => {
    const html = renderHtml(buildScorecard(campaign('c', 2, [skipped])));
    expect(html).toContain('Shown: 0 failing runs, 1 run not run or blocked, and 2 passing runs.');
    expect(html).toContain('<span class="chip skip">Not run</span>');
    expect(html).toContain('<tr class="run-row r-skip');
    expect(html).toContain('Failed<span class="c">0</span>');
    expect(html).toContain('Not run (unsupported, check capability');
    expect(html).not.toContain('<tr class="run-row r-fail');
  });

  it('the page rates runs and blocks over the scored ones, the rest counted beside', () => {
    const blocked: RunResult = {
      ...notRunAt('g-blocked', 0, 1),
      blocks: notRunAt('g-blocked', 0, 1).blocks.map((entry) => {
        const { notRun: _n, ...rest } = entry;
        return { ...rest, status: 'blocked' as const, blocked: { by: 'parent#0', root: 'parent#0' } };
      }),
    };
    const html = renderHtml(buildScorecard(campaign('c', 1, [notRunAt('g-skip', 0, 1), blocked])));
    // One pass, one not run, one blocked, no failure: 1 of 1 scored runs pass, 100%.
    expect(html).toContain(
      '<p class="n">1<small>of 1</small></p><a class="l" href="#drilldown">Runs passing</a><p class="s">100.0% · 0 failed · 1 not run · 1 blocked · 0 did not complete</p>',
    );
    expect(html).toContain('1 of 1 blocks pass, 2 not run or blocked');
  });

  it('the drift rate counts the scored blocks only', () => {
    // Block 0 drifts, block 1 was not run: one of one scored block drifts.
    const base = run({ specId: 'g-drift', blocks: [{ pass: false }, {}] });
    const mixed = notRunAt('g-drift', 1);
    const drifting = {
      ...mixed,
      blocks: [base.blocks[0] as RunResult['blocks'][number], mixed.blocks[1] as RunResult['blocks'][number]],
    };
    expect(successionOf([drifting]).driftRate?.estimate).toBe(1);
  });
});
