import { fileURLToPath } from 'node:url';
import type { RunResult } from '@driftbench/core';
import * as stats from '@driftbench/stats';
import { beforeAll, describe, expect, it } from 'vitest';
import { runLadder } from '../../src/index';
import { type ChainState, type EffectState, runChain, runEffect } from '../../src/ladders/system/chain';
import { SYSTEM_COMPONENTS } from '../../src/ladders/system/components';
import { loadFamily, OPERATORS } from '../../src/ladders/system/family';
import { systemLadder } from '../../src/ladders/system/index';
import {
  calibrationLevel,
  classLevel,
  parityLevel,
  precisionLevel,
  recallLevel,
  recoveryLevel,
  replayLevel,
  storedLevel,
} from '../../src/ladders/system/levels';
import { SAFE_ACTION_CLASSES } from '../../src/ladders/system/plant';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

let chain: ChainState;
let effect: EffectState;

beforeAll(async () => {
  chain = await runChain(1, await loadFamily(ROOT));
  effect = await runEffect(1);
}, 120_000);

/** A copy of the chain state whose stored runs can be changed without touching the shared one. */
function copy(state: ChainState): ChainState {
  const campaign = (c: ChainState['defectCampaign']) => ({
    ...c,
    stored: new Map([...c.stored].map(([id, run]) => [id, structuredClone(run)] as const)),
    outcomes: new Map(c.outcomes),
  });
  return {
    ...state,
    defectCampaign: campaign(state.defectCampaign),
    recoveryCampaign: campaign(state.recoveryCampaign),
    resume: { before: new Set(state.resume.before), startsAfter: new Map(state.resume.startsAfter) },
    replays: state.replays.map((replay) => ({
      ...replay,
      runs: new Map([...replay.runs].map(([id, run]) => [id, structuredClone(run)] as const)),
    })),
  };
}

function firstRun(state: ChainState, specId: string): RunResult {
  const cell = state.defectCampaign.cells.find((each) => each.specId === specId && each.repeat === 0);
  return state.defectCampaign.stored.get(cell?.cellId ?? '') as RunResult;
}

describe('the system ladder', () => {
  it('has the eight levels of docs/validators.md section 5, in order', () => {
    expect(systemLadder().levels.map((level) => level.id)).toEqual([
      'stored-resumable',
      'defect-recall',
      'defect-precision',
      'drift-class',
      'recovery',
      'calibration',
      'parity-power',
      'replay',
    ]);
  });

  it('passes levels 1 to 3 on the current code, and runs each seed chain once', async () => {
    const ladder = systemLadder();
    const run = await runLadder(ladder, { seed: 1, root: ROOT });
    expect(run.rows.slice(0, 3).map((row) => [row.observed, row.pass])).toEqual([
      [1, true],
      [1, true],
      [1, true],
    ]);
    expect(run.level).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('stops at level 1 and names the cell when the store loses a run', async () => {
    const ladder = systemLadder({
      tamper: (state) => {
        const [first] = state.defectCampaign.cells;
        if (first) state.defectCampaign.stored.delete(first.cellId);
      },
    });
    const run = await runLadder(ladder, { seed: 1, root: ROOT });
    expect(run.level).toBe(0);
    expect(run.rows[1]?.pass).toBeNull();
    expect(run.failing?.items).toHaveLength(1);
    expect(run.failing?.items[0]?.component).toBe(SYSTEM_COMPONENTS.store);
    expect(run.failing?.items[0]?.detail).toMatch(/the reopened store holds no run for this cell/);
  }, 120_000);
});

describe('level 1: stored, loadable, resumable', () => {
  it('holds on the chain: every cell stored and equal, the first half reused, the rest run once', () => {
    expect(storedLevel(chain)).toEqual({ value: 1, items: [] });
    expect(chain.resume.before.size).toBeGreaterThan(0);
  });

  it('names a cell the resume ran again, and a cell whose stored run differs', () => {
    const state = copy(chain);
    const cell = [...state.resume.before][0] as string;
    const outcome = state.defectCampaign.outcomes.get(cell);
    if (outcome) state.defectCampaign.outcomes.set(cell, { ...outcome, reused: false });
    const other = state.defectCampaign.cells.find((each) => !state.resume.before.has(each.cellId));
    const stored = state.defectCampaign.stored.get(other?.cellId ?? '');
    if (stored) stored.latencyMs += 1;
    const measure = storedLevel(state);
    expect(measure.value).toBeLessThan(1);
    expect(measure.items.map((item) => item.component).sort()).toEqual(
      [SYSTEM_COMPONENTS.campaign, SYSTEM_COMPONENTS.store].sort(),
    );
    expect(measure.items.map((item) => item.detail).join('\n')).toMatch(/the resume ran it again/);
    expect(measure.items.map((item) => item.detail).join('\n')).toMatch(
      /differs from the run the campaign returned/,
    );
  });

  it('names the cells of a spec the agent started too often after the interruption', () => {
    const state = copy(chain);
    const spec = state.defectCampaign.cells[0]?.specId as string;
    state.resume.startsAfter.set(spec, (state.resume.startsAfter.get(spec) ?? 0) + 1);
    const measure = storedLevel(state);
    expect(measure.items.length).toBeGreaterThan(0);
    for (const item of measure.items) {
      expect(item.id).toContain(spec);
      expect(item.component).toBe(SYSTEM_COMPONENTS.campaign);
    }
  });
});

describe('levels 2 to 4: recall, precision, class', () => {
  it('recall and precision hold on the chain', () => {
    expect(recallLevel(chain)).toEqual({ value: 1, items: [] });
    expect(precisionLevel(chain)).toEqual({ value: 1, items: [] });
  });

  it('names a planted defect whose block passed, with the check that must catch it', () => {
    const state = copy(chain);
    const defect = state.defects.defects.find((each) => each.class === 'X4_format');
    const run = firstRun(state, defect?.specId ?? '');
    const block = run.blocks.find((each) => each.index === defect?.block);
    if (block) block.pass = true;
    const measure = recallLevel(state);
    expect(measure.value).toBeLessThan(1);
    expect(measure.items).toHaveLength(1);
    expect(measure.items[0]).toMatchObject({
      id: `${defect?.specId}/r0/b${defect?.block}/x4-wrong-language`,
      component: 'packages/checks/src/checks/lang.ts',
    });
  });

  it('names a failing block with no planted defect, and a control is no defect', () => {
    const state = copy(chain);
    const control = state.defects.defects.find((each) => each.kind === 'control');
    const run = firstRun(state, control?.specId ?? '');
    const block = run.blocks.find((each) => each.index === control?.block);
    if (block) {
      block.pass = false;
      block.verdicts.push({
        id: 'stage.reached',
        kind: 'machine',
        name: 'stage',
        gating: true,
        outcome: 'fail',
        evidence: 'planted by the test',
      });
    }
    const measure = precisionLevel(state);
    expect(measure.value).toBeLessThan(1);
    expect(measure.items[0]?.component).toBe('packages/checks/src/checks/stage.ts');
    expect(measure.items[0]?.detail).toMatch(/the control control-sales-identity sits here/);
  });

  it('compares the class of every failing planted block with the operator table', () => {
    const state = copy(chain);
    for (const defect of state.defects.defects) {
      if (defect.kind === 'control') continue;
      for (const cell of state.defectCampaign.cells.filter((each) => each.specId === defect.specId)) {
        const block = state.defectCampaign.stored.get(cell.cellId)?.blocks[defect.block];
        if (block) block.drift = [OPERATORS[defect.class]?.drift ?? 'X1_local'];
      }
    }
    expect(classLevel(state, ROOT)).toEqual({ value: 1, items: [] });
    const x3 = state.defects.defects.find((each) => each.class === 'X3_flow');
    const block = firstRun(state, x3?.specId ?? '').blocks[x3?.block ?? 0];
    if (block) block.drift = ['X5_tool'];
    const measure = classLevel(state, ROOT);
    expect(measure.items).toHaveLength(1);
    expect(measure.items[0]?.detail).toMatch(/must carry X3_flow; the block carries X5_tool/);
  });

  it('on the current code, names only the planted classes the runner does not assign', () => {
    for (const item of classLevel(chain, ROOT).items) {
      expect(item.detail).toMatch(/must carry (X1_local|X2_contradiction)/);
    }
  });
});

describe('level 5: recovery', () => {
  function withRecords(state: ChainState): ChainState {
    for (const planted of state.recoveries.recoveries) {
      const cell = state.recoveryCampaign.cells.find((each) => each.specId === planted.specId);
      const run = state.recoveryCampaign.stored.get(cell?.cellId ?? '');
      if (!run) continue;
      run.recovery = {
        injectedAt: planted.injectedAt,
        ...(planted.turns === undefined ? {} : { turnsToRecover: planted.turns }),
        label: planted.turns === undefined ? 'never' : planted.turns === 0 ? 'immediate' : 'late',
        collateral: planted.collateral,
        ...(SAFE_ACTION_CLASSES.has(planted.class) ? { safeAction: !planted.unsafe } : {}),
      };
    }
    return state;
  }

  it('injects each perturbation as its own block at the planted position', () => {
    for (const planted of chain.recoveries.recoveries) {
      const cell = chain.recoveryCampaign.cells.find((each) => each.specId === planted.specId);
      const run = chain.recoveryCampaign.stored.get(cell?.cellId ?? '');
      expect(run?.blocks.findIndex((block) => block.injected === true)).toBe(planted.injectedAt);
      expect(run?.blocks).toHaveLength(9);
    }
  });

  it('passes when every record equals the plant, and names each field that differs', () => {
    const state = withRecords(copy(chain));
    expect(recoveryLevel(state, ROOT)).toEqual({ value: 1, items: [] });
    const planted = state.recoveries.recoveries[0];
    const cell = state.recoveryCampaign.cells.find((each) => each.specId === planted?.specId);
    const run = state.recoveryCampaign.stored.get(cell?.cellId ?? '');
    if (run?.recovery) run.recovery = { ...run.recovery, collateral: run.recovery.collateral + 1 };
    const measure = recoveryLevel(state, ROOT);
    expect(measure.value).toBeCloseTo(1 - 1 / state.recoveries.recoveries.length);
    expect(measure.items[0]?.detail).toMatch(/^collateral: recorded \d, planted \d/);
  });

  it('names the runner when a run record holds no recovery', () => {
    const state = withRecords(copy(chain));
    const cell = state.recoveryCampaign.cells[0];
    const run = state.recoveryCampaign.stored.get(cell?.cellId ?? '');
    if (run) delete run.recovery;
    const measure = recoveryLevel(state, ROOT);
    expect(measure.items).toHaveLength(1);
    expect(measure.items[0]).toMatchObject({ component: SYSTEM_COMPONENTS.runner });
    expect(measure.items[0]?.detail).toMatch(/the run record holds no recovery; planted \{/);
  });
});

describe('levels 6 and 7: calibration and parity on the planted effect', () => {
  it('hold on seed 1 with the real statistics', () => {
    expect(effect.problems).toEqual([]);
    expect(effect.flags).toHaveLength(100);
    expect(calibrationLevel(effect, 1, stats).value).toBeGreaterThanOrEqual(0.93);
    expect(parityLevel(effect, 1, stats).value).toBeGreaterThanOrEqual(0.95);
  });

  it('level 6 fails on a Wilson interval that is too narrow, naming the campaigns that miss', () => {
    const narrow = (k: number, n: number) => stats.wilson(k, n, 1.3);
    const measure = calibrationLevel(effect, 1, { ...stats, wilson: narrow });
    expect(measure.value).toBeLessThan(0.93);
    expect(measure.items[0]?.id).toMatch(/^wilson\/c\d+$/);
    expect(measure.items[0]?.component).toBe(SYSTEM_COMPONENTS.wilson);
  });

  it('level 6 fails when the design effect ignores the clustering', () => {
    const measure = calibrationLevel(effect, 1, {
      ...stats,
      icc: () => [{ level: 'spec', icc: 0, share: 0 }],
    });
    expect(measure.value).toBe(0);
    const item = measure.items.find((each) => each.id === 'design-effect');
    expect(item?.detail).toMatch(/misses the true design effect 1\.75/);
  });

  it('level 7 fails on a verdict that never sees a drop, and on one that always alarms', () => {
    const never = parityLevel(effect, 1, {
      ...stats,
      nonInferiority: (input) => ({ ...stats.nonInferiority(input), nonInferior: true }),
    });
    expect(never.value).toBe(0);
    expect(never.items[0]?.id).toMatch(/^parity-miss\/c\d+$/);
    const always = parityLevel(effect, 1, {
      ...stats,
      nonInferiority: (input) => ({ ...stats.nonInferiority(input), nonInferior: false }),
    });
    expect(always.value).toBe(0);
    expect(always.items.some((item) => item.id.startsWith('parity-alarm/'))).toBe(true);
  });

  it('levels 6 and 7 read 0 when a planted-effect run is missing', () => {
    const broken: EffectState = { ...effect, problems: ['effect-1-0 eff-1-c0-s0 baseline'] };
    expect(calibrationLevel(broken, 1, stats).value).toBe(0);
    expect(parityLevel(broken, 1, stats).value).toBe(0);
  });
});

describe('level 8: replay', () => {
  it('holds: every run replayed from the cache, with the live verdicts', () => {
    expect(replayLevel(chain)).toEqual({ value: 1, items: [] });
  });

  it('names a run that went live, and a run whose replayed verdicts differ', () => {
    const state = copy(chain);
    const replay = state.replays[0];
    const [first, second] = [...(replay?.runs.values() ?? [])];
    if (first) first.cacheHit = false;
    const verdict = second?.blocks[0]?.verdicts[0];
    if (verdict) verdict.outcome = verdict.outcome === 'pass' ? 'fail' : 'pass';
    const measure = replayLevel(state);
    expect(measure.items.map((item) => item.component).sort()).toEqual(
      [SYSTEM_COMPONENTS.cache, SYSTEM_COMPONENTS.runner].sort(),
    );
    expect(measure.items.map((item) => item.detail).join('\n')).toMatch(/went live/);
    expect(measure.items.map((item) => item.detail).join('\n')).toMatch(
      /replayed verdicts differ from the live ones from block 0/,
    );
  });
});
