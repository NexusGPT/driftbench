import type { BlockResult, RunResult } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_AGGREGATES, evaluateAggregates } from '../src/aggregate';
import { compareCampaigns } from '../src/compare';
import { blockScore, runPassed, scoredRuns } from '../src/data';
import { headlineNote, unscoredReason, unscoredRuns, verdictOf } from '../src/format';
import { suiteHeadline } from '../src/headline';
import { renderHtml, renderRun } from '../src/html';
import { overview, pageModel } from '../src/html-zones';
import { renderJunit } from '../src/junit';
import { blockAccuracy, modeReliability, recoveryOf, reliability, successionOf } from '../src/reliability';
import { buildScorecard, toolAccuracy } from '../src/scorecard';
import { spread } from '../src/spread';
import { compareText } from '../src/text';
import { block, dataOf, run } from './support';

/**
 * Every rate over runs or blocks counts only the scored ones (not_run and blocked are left out). The fixture holds 1 pass, 1 not_run and 1 blocked, so
 * each rate must read 100% of what was scored.
 */

const NOT_RUN = {
  kind: 'unsupported' as const,
  layer: '5 world',
  check: 'capability',
  expected: 'the adapter applies forced tool results (lookup) (toolStubs)',
  got: 'echo declares toolStubs false: the agent would never see it',
};
const BLOCKED = { by: 'block 0', root: 'block 0', reason: 'the ancestor failed' };

function notRunBlock(index: number): BlockResult {
  return {
    ...block(index),
    observed: { ...block(index).observed, text: '' },
    drift: [],
    pass: false,
    status: 'not_run',
    notRun: NOT_RUN,
  };
}

function blockedBlock(index: number): BlockResult {
  return {
    ...block(index),
    observed: { ...block(index).observed, text: '' },
    drift: [],
    pass: false,
    status: 'blocked',
    blocked: BLOCKED,
  };
}

/** A run of golden `g` whose last block is replaced by `last`. */
function withLast(repeat: number, last: (index: number) => BlockResult, specId = 'g'): RunResult {
  const base = run({ specId, repeat, blocks: [{}, {}] });
  return { ...base, blocks: [base.blocks[0] as BlockResult, last(1)] };
}

const passing = run({ specId: 'g', repeat: 0, blocks: [{}, {}] });
const notRun = withLast(1, notRunBlock);
const blocked = withLast(2, blockedBlock);
const three = [passing, notRun, blocked];

/** One run holding one scored pass, one not_run and one blocked block. */
const mixedBlocks: RunResult = (() => {
  const base = run({ specId: 'g', repeat: 0, blocks: [{}, {}, {}] });
  return { ...base, blocks: [base.blocks[0] as BlockResult, notRunBlock(1), blockedBlock(2)] };
})();

describe('rates over 1 pass, 1 not_run, 1 blocked read 100% of the scored', () => {
  it('runPassed and scoredRuns: only the pass run is scored', () => {
    expect(three.map(runPassed)).toEqual([true, false, false]);
    expect(scoredRuns(three)).toEqual([passing]);
  });

  it('the pass-rate aggregate is 1 over 1 scored run', () => {
    const [result] = evaluateAggregates(dataOf(three), [BUILT_IN_AGGREGATES.passRate(1)]);
    expect(result?.value).toBe(1);
    expect(result?.interval?.n).toBe(1);
    expect(result?.passed).toBe(true);
  });

  it('reliability: the golden line has 1 run and a pass rate of 1', () => {
    const [line, ...rest] = reliability(dataOf(three));
    expect(rest).toEqual([]);
    expect(line?.runs).toBe(1);
    expect(line?.passRate.k).toBe(1);
    expect(line?.passRate.n).toBe(1);
    expect(line?.passRate.estimate).toBe(1);
  });

  it('modeReliability: runs and the run pass rate count only the scored run', () => {
    const data = dataOf(three);
    const [mode] = modeReliability(data, reliability(data));
    expect(mode?.runs).toBe(1);
    expect(mode?.runPass?.estimate).toBe(1);
  });

  it('blockScore and blockAccuracy count only scored blocks', () => {
    expect(blockScore(mixedBlocks)).toBe(1);
    expect(blockAccuracy([mixedBlocks])?.estimate).toBe(1);
  });

  it('spread: the cell rate is 1 over the scored run', () => {
    const result = spread(dataOf(three), { margin: 0.1 });
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]?.rate.estimate).toBe(1);
  });

  it('compare: the candidate unit pairs on its scored run, all-pass 1 of 1, no regression', () => {
    const baseline = dataOf([run({ specId: 'g', repeat: 0, blocks: [{}, {}] })], {}, 'base');
    const result = compareCampaigns(baseline, dataOf(three, {}, 'cand'), { margin: 0.1 });
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]?.candidate.runs).toBe(1);
    expect(result.pairs[0]?.candidate.allPass).toBe(true);
    expect(result.allPass.candidate.k).toBe(1);
    expect(result.allPass.candidate.n).toBe(1);
    expect(result.allPass.table.regressed).toBe(0);
  });

  it('compare: a unit only blocked in the candidate is unpaired with the blocked reason', () => {
    const baseline = dataOf([run({ specId: 'h' })], {}, 'base');
    const candidate = dataOf([withLast(0, blockedBlock, 'h')], {}, 'cand');
    expect(() => compareCampaigns(baseline, candidate, { margin: 0.1 })).toThrow();
    const both = compareCampaigns(
      dataOf([run({ specId: 'h' }), run({ specId: 'g' })], {}, 'base'),
      dataOf([withLast(0, blockedBlock, 'h'), run({ specId: 'g' })], {}, 'cand'),
      { margin: 0.1 },
    );
    expect(both.unpaired).toContainEqual({
      unit: 'h · F',
      reason: 'not measured in the candidate: block 1 blocked by block 0',
    });
  });

  it('the scorecard counts 1 passing, 0 failing, 1 not run, 1 blocked', () => {
    const card = buildScorecard(dataOf(three));
    expect(card.campaign).toMatchObject({
      runs: 3,
      passing: 1,
      failing: 0,
      notRun: 1,
      blocked: 1,
      broken: 0,
    });
    expect(card.drilldown.map((detail) => detail.outcome ?? 'scored').sort()).toEqual([
      'blocked',
      'not_run',
      'scored',
    ]);
  });

  it('JUnit: 0 failures, 2 skipped, the blocked one with its ancestor', () => {
    const xml = renderJunit(dataOf(three));
    expect(xml).toContain('tests="3" failures="0" errors="0"');
    expect(xml).toContain('skipped="2"');
    expect(xml).toContain('<skipped message="block 1 blocked by block 0"/>');
  });

  it('the format helpers name blocked apart from not run', () => {
    expect(verdictOf('blocked')).toEqual({ cls: 'skip', text: 'blocked' });
    expect(verdictOf('fail')).toEqual({ cls: 'bad', text: 'fail' });
    expect(unscoredReason(blockedBlock(1))).toBe('Blocked by block 0 (root block 0): the ancestor failed.');
    expect(unscoredRuns({ notRun: 1, blocked: 1 })).toBe('1 not run, 1 blocked, ');
    expect(unscoredRuns({})).toBe('');
  });

  it('the drilldown index counts the unscored runs apart', () => {
    const html = renderHtml(buildScorecard(dataOf(three)));
    expect(html).toContain('Shown: 0 failing runs, 2 runs not run or blocked, and 1 passing run.');
    expect(html).toContain('<span class="chip skip">Blocked</span>');
  });

  it('the run page of a blocked run shows its badge, never a fail', () => {
    const card = buildScorecard(dataOf(three));
    const detail = card.drilldown.find((entry) => entry.outcome === 'blocked');
    if (!detail) throw new Error('no blocked run');
    const page = renderRun(detail);
    expect(page).toContain('<span class="badge skip">blocked</span>');
    expect(page).not.toContain('<span class="badge bad">fail</span>');
  });

  it('the overview reads Runs passing 100% of the scored runs', () => {
    const html = overview(pageModel(buildScorecard(dataOf(three))));
    expect(html).toMatch(/Runs passing<\/a><p class="s">100\.0%/);
  });

  it('the page model counts only scored blocks: 1 of 1 blocks pass', () => {
    const m = pageModel(buildScorecard(dataOf([mixedBlocks])));
    expect(m.blocksPassing).toBe(1);
    expect(m.blocks).toBe(1);
  });

  it('the run panel reads Blocks passing 1 of 1 for a run with one scored block', () => {
    const html = renderHtml(buildScorecard(dataOf([mixedBlocks])));
    expect(html).toContain('Blocks passing <b>1 of 1</b>');
  });

  it('the succession drift rate is 1 over a run whose only scored block drifted', () => {
    const base = run({ specId: 'g', blocks: [{ pass: false }, {}, {}] });
    const failed: RunResult = {
      ...base,
      blocks: [base.blocks[0] as BlockResult, notRunBlock(1), blockedBlock(2)],
    };
    expect(successionOf([failed]).driftRate?.estimate).toBe(1);
  });

  it('tool recall is 1 when the scored block made its expected call', () => {
    const specs = {
      g: {
        blocks: [{ when: { user: 'a' }, expect: { tools: [{ label: 'lookup' }] } }, { when: { user: 'b' } }],
      },
    } as never;
    const called = run({ specId: 'g', repeat: 0, blocks: [{ toolCalls: ['lookup'] }, {}] });
    const unrun = (repeat: number, each: (index: number) => BlockResult) => {
      const r = run({ specId: 'g', repeat, blocks: [{}, {}] });
      return { ...r, blocks: [each(0), each(1)] } as RunResult;
    };
    const accuracy = toolAccuracy(dataOf([called, unrun(1, notRunBlock), unrun(2, blockedBlock)], specs));
    expect(accuracy.expected).toBe(1);
    expect(accuracy.recall?.estimate).toBe(1);
  });
});

describe('every rate says how many runs it left out', () => {
  it('reliability: the line counts its unscored runs, and the HTML table shows them', () => {
    const [line] = reliability(dataOf(three));
    expect(line?.unscored).toBe(2);
    expect(renderHtml(buildScorecard(dataOf(three)))).toContain('1 of 1 (2 not run or blocked)');
  });

  it('spread: the mode counts its unscored runs, and the HTML section shows them', () => {
    expect(spread(dataOf(three), { margin: 0.1 }).unscored).toBe(2);
    expect(renderHtml(buildScorecard(dataOf(three)))).toContain(
      '2 runs left out: a block not run or blocked',
    );
  });

  it('compare: a paired unit that left runs out lists them in the text', () => {
    const baseline = dataOf([run({ specId: 'g', repeat: 0, blocks: [{}, {}] })], {}, 'base');
    const result = compareCampaigns(baseline, dataOf(three, {}, 'cand'), { margin: 0.1 });
    expect(result.excluded).toEqual([{ unit: 'g · F', side: 'candidate', runs: 2 }]);
    expect(compareText(result)).toContain('Runs left out of a pair');
    expect(compareText(result)).toMatch(/g · F\s+candidate\s+2 runs/);
  });

  it('recovery: a run whose injected block was not run measures no recovery, even with a stored label', () => {
    const sent = run({
      mode: 'P',
      perturbationId: 'x',
      blocks: [{}, { injected: true, blockId: 'x' }],
      recovery: { injectedAt: 1, turnsToRecover: 1, label: 'immediate', collateral: 0 },
    });
    const unsent = run({
      mode: 'P',
      perturbationId: 'x',
      repeat: 1,
      blocks: [{}, { injected: true, blockId: 'x' }],
      recovery: { injectedAt: 1, label: 'never', collateral: 0 },
    });
    unsent.blocks[1] = { ...notRunBlock(1), injected: true, blockId: 'x' };
    const summary = recoveryOf([sent, unsent]);
    expect(summary?.labels).toEqual({ immediate: 1, late: 0, never: 0 });
  });
});

describe('the suite headline counts the scored runs and names the share left out', () => {
  it('two goldens, one with a pass, a not_run and a blocked run: 2 scored runs, rate 1, 25% not run, 25% blocked', () => {
    const runs = [...three, run({ specId: 'h', repeat: 0, blocks: [{}, {}] })];
    const headline = suiteHeadline(runs, (entry) => entry.specId);
    expect(headline).toMatchObject({
      trees: 2,
      runs: 2,
      estimate: 1,
      shares: { incomplete: 0, notRun: 0.25, blocked: 0.25 },
    });
    const note = headline ? headlineNote(headline) : '';
    expect(note).toContain('not run');
    expect(note).toContain('blocked');
    expect(suiteHeadline([notRun, blocked], (entry) => entry.specId)).toBeUndefined();
  });
});
