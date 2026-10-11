import { AgentFailure, type CostUnit, RunResult } from '@driftbench/core';
import { createScriptedDriver } from '@driftbench/users';
import { describe, expect, it } from 'vitest';
import {
  type CellOutcome,
  cellId,
  cellIdOf,
  minimumDetectableEffect,
  outcomeOf,
  type PlannedCell,
  planCampaign,
  runCampaign,
} from '../../src/runner';
import {
  acmeAdapter,
  dropsFirstToolCall,
  loadAcmeConversations,
  MemoryStore,
  minimalChecks,
} from './support';

const loaded = await loadAcmeConversations();
const acme = { adapter: 'function', agent: 'acme' };
const blocksPerRun = loaded.reduce((sum, entry) => sum + entry.spec.blocks.length, 0);

describe('planCampaign', () => {
  it('expands specs x targets x modes x repeats into cells with stable ids', () => {
    const plan = planCampaign(loaded, [acme], ['F'], 3);
    expect(plan.cells).toHaveLength(18);
    expect(plan.blocks).toBe(3 * blocksPerRun);
    expect(plan.cells.slice(0, 3).map((cell) => [cell.specId, cell.repeat, cell.mode, cell.blocks])).toEqual([
      ['acme-new-customer-coverage', 0, 'F', 4],
      ['acme-new-customer-coverage', 1, 'F', 4],
      ['acme-new-customer-coverage', 2, 'F', 4],
    ]);
    expect(new Set(plan.cells.map((cell) => cell.cellId)).size).toBe(18);
    expect(planCampaign(loaded, [acme], ['F'], 3).cells.map((cell) => cell.cellId)).toEqual(
      plan.cells.map((cell) => cell.cellId),
    );
    const first = plan.cells[0] as PlannedCell;
    expect(first.cellId).toBe(
      cellId({
        specHash: first.specHash,
        target: { agent: 'acme', adapter: 'function' },
        mode: 'F',
        repeat: 0,
      }),
    );
  });

  it('gives a new id to a new spec version, target, mode or repeat', () => {
    const base = { specHash: 'aaa', target: acme, mode: 'F' as const, repeat: 0 };
    const ids = [
      cellId(base),
      cellId({ ...base, specHash: 'bbb' }),
      cellId({ ...base, target: { adapter: 'http', agent: 'acme' } }),
      cellId({ ...base, mode: 'P', perturbationId: 'shop-hours' }),
      cellId({ ...base, repeat: 1 }),
    ];
    expect(new Set(ids).size).toBe(5);
  });

  it('expands P mode into one cell per perturbation and repeat, each with one injected block', () => {
    const plan = planCampaign(loaded, [acme], ['P'], 2);
    const perturbations = loaded.reduce((sum, entry) => sum + (entry.spec.perturbations?.length ?? 0), 0);
    expect(plan.cells).toHaveLength(perturbations * 2);
    const cell = plan.cells[0] as PlannedCell;
    expect(cell).toMatchObject({ mode: 'P', perturbationId: 'shop-hours', blocks: 5 });
  });

  it('projects 0 and says no unit measured when the store has none', () => {
    const plan = planCampaign(loaded, [acme], ['F'], 2);
    expect(plan.cost).toEqual({
      usd: 0,
      byAdapter: [{ adapter: 'function', blocks: 2 * blocksPerRun, usd: 0, note: 'no unit measured' }],
    });
  });

  it('prices the blocks with the latest unit of the target adapter and compares with the budget', () => {
    const units: CostUnit[] = [
      { adapter: 'function', metric: 'block', usd: 0.5, measuredAt: '2026-10-01T00:00:00.000Z' },
      { adapter: 'function', metric: 'block', usd: 0.01, measuredAt: '2026-10-10T00:00:00.000Z' },
      { adapter: 'function', metric: 'judge_call', usd: 1, measuredAt: '2026-10-11T00:00:00.000Z' },
      { adapter: 'http', metric: 'block', usd: 9, measuredAt: '2026-10-11T00:00:00.000Z' },
    ];
    const plan = planCampaign(loaded, [acme], ['F'], 2, { units, budgetUsd: 0.5 });
    expect(plan.cost.byAdapter).toEqual([
      { adapter: 'function', blocks: 2 * blocksPerRun, usdPerBlock: 0.01, usd: 2 * blocksPerRun * 0.01 },
    ]);
    expect(plan.cost.usd).toBeCloseTo(0.52, 10);
    expect(plan).toMatchObject({ budgetUsd: 0.5, withinBudget: false });
    expect(planCampaign(loaded, [acme], ['F'], 2, { units, budgetUsd: 1 }).withinBudget).toBe(true);
  });

  it('prints the minimum detectable effect of the two-proportion normal approximation', () => {
    const plan = planCampaign(loaded, [acme, { adapter: 'http', agent: 'acme' }], ['F'], 3);
    expect(plan.mde).toHaveLength(1);
    expect(plan.mde[0]).toMatchObject({
      mode: 'F',
      runsPerArm: 18,
      baselineRate: 0.5,
      alpha: 0.05,
      power: 0.8,
    });
    // (1.959964 + 0.841621) * sqrt(2 * 0.5 * 0.5 / 18)
    expect(plan.mde[0]?.effect).toBeCloseTo(0.466931, 5);
    // 100 goldens x 5 repeats on a 90% pass rate: a drop of 5.3 points, the design note's "5-point drop".
    expect(minimumDetectableEffect(500, 0.9)).toBeCloseTo(0.053157, 5);
    expect(minimumDetectableEffect(0)).toBeUndefined();
    // More runs, smaller effect.
    expect(minimumDetectableEffect(200) ?? 1).toBeLessThan(minimumDetectableEffect(50) ?? 0);
  });
});

describe('outcomeOf', () => {
  it('passes a completed run whose blocks pass and whose end state matches, and lists what fails', async () => {
    const plan = planCampaign(loaded, [acme], ['F'], 1);
    const store = new MemoryStore();
    const outcomes = await runCampaign({
      campaignId: 'c-outcome',
      cells: plan.cells.filter((cell) => cell.specId === 'acme-plan-upgrade'),
      specFor: (cell) => specOf(cell),
      adapterFor: () => acmeAdapter({ wrap: dropsFirstToolCall }),
      driver: () => createScriptedDriver(),
      checks: minimalChecks,
      store,
    });
    const [outcome] = outcomes as [CellOutcome];
    expect(outcome.state).toBe('fail');
    expect(outcome.failing).toEqual([
      'block 1 tools.catalog.search.count',
      'block 3 tools.order.create.count',
    ]);
    expect(outcomeOf(outcome.cell, undefined)).toEqual({
      cell: outcome.cell,
      reused: false,
      state: 'pending',
      failing: [],
    });
    const run = outcome.run as RunResult;
    const mismatched = {
      ...run,
      blocks: run.blocks.map((block) => ({ ...block, pass: true, verdicts: [] })),
    };
    const diff = [{ field: 'plan_id', expected: 'mobile-m', observed: 'mobile-l' }];
    expect(outcomeOf(outcome.cell, { ...mismatched, endState: { match: false, diff } })).toMatchObject({
      state: 'fail',
      failing: ['end_state plan_id'],
    });
    expect(outcomeOf(outcome.cell, mismatched).state).toBe('pass');
  });
});

describe('runCampaign', () => {
  const plan = planCampaign(loaded, [acme], ['F'], 2);

  it('runs every cell, files every run, and resumes by reusing the completed cells', async () => {
    const store = new MemoryStore();
    const flaky = acmeAdapter();
    const send = flaky.send.bind(flaky);
    flaky.send = async (session, turn) => {
      if (JSON.stringify(turn.stimulus).includes('keep my phone number')) {
        throw new AgentFailure('the porting service is down');
      }
      return send(session, turn);
    };
    const first = await runCampaign({
      campaignId: 'c-resume',
      cells: plan.cells,
      specFor: specOf,
      adapterFor: () => flaky,
      driver: () => createScriptedDriver(),
      checks: minimalChecks,
      store,
    });
    expect(first.map((outcome) => outcome.state)).toEqual([
      'pass',
      'pass',
      'failed',
      'failed',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
    ]);
    expect(store.runs).toHaveLength(12);
    for (const { run } of store.runs) expect(RunResult.safeParse(run).success).toBe(true);

    const healthy = acmeAdapter();
    const seen: string[] = [];
    const second = await runCampaign({
      campaignId: 'c-resume',
      cells: plan.cells,
      specFor: specOf,
      adapterFor: () => healthy,
      driver: () => createScriptedDriver(),
      checks: minimalChecks,
      store,
      onCell: (outcome) =>
        seen.push(
          `${outcome.cell.specId}/${outcome.cell.repeat} ${outcome.state}${outcome.reused ? ' reused' : ''}`,
        ),
    });
    expect(second.every((outcome) => outcome.state === 'pass')).toBe(true);
    expect(second.filter((outcome) => !outcome.reused).map((outcome) => outcome.cell.specId)).toEqual([
      'acme-number-porting',
      'acme-number-porting',
    ]);
    expect(healthy.calls.open).toBe(2);
    expect(seen[2]).toBe('acme-number-porting/0 pass');
    expect(seen[0]).toBe('acme-new-customer-coverage/0 pass reused');
    expect(store.runs).toHaveLength(14);
    for (const outcome of second) expect(cellIdOf(outcome.run as RunResult)).toBe(outcome.cell.cellId);
  });

  it('keeps campaigns apart', async () => {
    const store = new MemoryStore();
    const options = {
      cells: plan.cells.slice(0, 2),
      specFor: specOf,
      adapterFor: () => acmeAdapter(),
      driver: () => createScriptedDriver(),
      checks: minimalChecks,
      store,
    };
    await runCampaign({ ...options, campaignId: 'c-one' });
    const other = await runCampaign({ ...options, campaignId: 'c-two' });
    expect(other.some((outcome) => outcome.reused)).toBe(false);
  });
});

function specOf(cell: PlannedCell) {
  const found = loaded.find((entry) => entry.spec.id === cell.specId && entry.hash === cell.specHash);
  if (!found) throw new Error(`no spec ${cell.specId}`);
  return found.spec;
}
