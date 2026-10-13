import { AgentFailure, type CostUnit, RunResult } from '@agent-nexus/driftbench-core';
import { mde } from '@agent-nexus/driftbench-stats';
import { openMemoryStore, projectCost, cellId as storeCellId } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
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
  minimalChecks,
  pricedAcmeAdapter,
  putCampaign,
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

  it('computes the same cell id as the store, the run id the store keys runs by', () => {
    const cells = [
      ...planCampaign(loaded, [acme], ['F'], 2).cells,
      ...planCampaign(loaded, [{ adapter: 'http', agent: 'acme', options: { b: 1, a: [2] } }], ['P'], 1)
        .cells,
    ];
    for (const cell of cells) {
      expect(cell.cellId).toMatch(/^[0-9a-f]{16}$/);
      expect(cell.cellId).toBe(storeCellId(cell));
    }
    expect(cellId({ specHash: 'aaa', target: acme, mode: 'F', repeat: 0 })).toBe(
      cellId({ repeat: 0, mode: 'F', target: { agent: 'acme', adapter: 'function' }, specHash: 'aaa' }),
    );
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
      unmeasured: ['function'],
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
    expect(plan.cost.unmeasured).toEqual([]);
    expect(plan).toMatchObject({ budgetUsd: 0.5, withinBudget: false });
    expect(planCampaign(loaded, [acme], ['F'], 2, { units, budgetUsd: 1 }).withinBudget).toBe(true);
  });

  it('projects what projectCost of the store projects for the same cells and units', () => {
    const units: CostUnit[] = [
      { adapter: 'function', metric: 'block', usd: 0.03, measuredAt: '2026-10-09T08:00:00+02:00' },
      { adapter: 'function', metric: 'block', usd: 0.02, measuredAt: '2026-10-09T07:00:00.000Z' },
    ];
    const targets = [acme, { adapter: 'http', agent: 'acme' }];
    const plan = planCampaign(loaded, targets, ['F'], 3, { units });
    const store = projectCost(
      plan.cells.map((cell) => ({ adapter: cell.target.adapter, blocks: cell.blocks })),
      units,
    );
    expect(plan.cost.usd).toBeCloseTo(store.usd, 10);
    expect(plan.cost.unmeasured).toEqual(store.unmeasured);
    expect(plan.cost.unmeasured).toEqual(['http']);
    // 08:00 at +02:00 is 06:00 UTC, earlier than 07:00 UTC: dates compare as dates, not as text.
    expect(plan.cost.byAdapter[0]?.usdPerBlock).toBe(0.02);
  });

  it('prints the minimum detectable effect of stats.mde, with the specs as the units', () => {
    const plan = planCampaign(loaded, [acme, { adapter: 'http', agent: 'acme' }], ['F'], 3);
    expect(plan.mde).toHaveLength(1);
    expect(plan.mde[0]).toMatchObject({
      mode: 'F',
      runsPerArm: 18,
      specs: 6,
      baselineRate: 0.5,
      rho: 0,
      designEffect: 1,
      alpha: 0.05,
      power: 0.8,
    });
    expect(plan.mde[0]?.effect).toBe(mde({ n: 6, repeats: 3, baselineRate: 0.5 }).effect);
    // 6 specs x 5 repeats on a 90% pass rate: 30.9 points.
    const five = planCampaign(loaded, [acme], ['F'], 5, { baselineRate: 0.9 });
    expect(five.mde[0]?.effect).toBeCloseTo(0.308915, 5);
  });

  it('counts repeats through the design effect of a measured rho', () => {
    const plan = planCampaign(loaded, [acme], ['F'], 5, { baselineRate: 0.9, rho: 0.3 });
    const want = mde({ n: 6, repeats: 5, baselineRate: 0.9, rho: 0.3 });
    expect(plan.mde[0]).toMatchObject({ rho: 0.3, designEffect: want.designEffect });
    expect(plan.mde[0]?.effect).toBe(want.effect);
    expect(plan.mde[0]?.designEffect).toBeCloseTo(2.2, 12);
    expect(() => planCampaign(loaded, [acme], ['F'], 5, { rho: 1.5 })).toThrow(/rho/);
    expect(() => planCampaign(loaded, [acme], ['F'], 5, { rho: -0.1 })).toThrow(RangeError);
  });

  it('leaves the effect out when no drop below the baseline is detectable', () => {
    const plan = planCampaign(loaded, [acme], ['F'], 1, { baselineRate: 0.5 });
    expect(plan.mde[0]?.effect).toBeUndefined();
    expect(plan.mde[0]?.runsPerArm).toBe(6);
    // The independent-run approximation stays exported.
    expect(minimumDetectableEffect(500, 0.9)).toBeCloseTo(0.053157, 5);
    expect(minimumDetectableEffect(0)).toBeUndefined();
  });
});

describe('outcomeOf', () => {
  it('passes a completed run whose blocks pass and whose end state matches, and lists what fails', async () => {
    const plan = planCampaign(loaded, [acme], ['F'], 1);
    const store = openMemoryStore();
    await putCampaign(store, 'c-outcome', loaded);
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
    const store = openMemoryStore();
    await putCampaign(store, 'c-resume', loaded);
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
    const stored = await store.listRuns({ campaignId: 'c-resume' });
    expect(stored).toHaveLength(12);
    expect(stored.filter((run) => run.status === 'failed').map((run) => run.specId)).toEqual([
      'acme-number-porting',
      'acme-number-porting',
    ]);
    for (const run of stored) expect(RunResult.safeParse(run).success).toBe(true);

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
    // A cell's run id is its cell id, so the resumed runs replace the failed ones.
    const after = await store.listRuns({ campaignId: 'c-resume' });
    expect(after).toHaveLength(12);
    expect(after.every((run) => run.status === 'completed')).toBe(true);
    for (const outcome of second) {
      expect(cellIdOf(outcome.run as RunResult)).toBe(outcome.cell.cellId);
      expect(outcome.run?.runId).toBe(outcome.cell.cellId);
    }
    await store.close();
  });

  it('keeps campaigns apart', async () => {
    const store = openMemoryStore();
    await putCampaign(store, 'c-one', loaded);
    await putCampaign(store, 'c-two', loaded);
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
    // The same cell in two campaigns has the same run id; each campaign holds its own run.
    const [cell] = options.cells;
    expect((await store.getRun(cell?.cellId ?? '', 'c-one'))?.runId).toBe(cell?.cellId);
    expect((await store.getRun(cell?.cellId ?? '', 'c-two'))?.runId).toBe(cell?.cellId);
    await store.close();
  });
});

describe('the worker pool', () => {
  const plan = planCampaign(loaded, [acme], ['F'], 1);
  const FIRST = "I'm new here"; // the first block of the first cell, acme-new-customer-coverage
  const SECOND = 'keep my phone number'; // the first block of the second cell, acme-number-porting

  /**
   * The Acme agent, counting the sends in flight. With `hold`, the first cell's first block waits until the
   * second cell has closed, so the second cell always finishes first: no clock decides the order.
   */
  function counted(hold: boolean) {
    const adapter = acmeAdapter();
    const send = adapter.send.bind(adapter);
    const flight = { now: 0, max: 0 };
    const finished: string[] = [];
    const firstStimulus = new Map<string, string>();
    let release = () => {};
    const secondClosed = new Promise<void>((resolve) => {
      release = resolve;
    });
    adapter.send = async (session, turn) => {
      const stimulus = JSON.stringify(turn.stimulus);
      if (turn.index === 0) firstStimulus.set(session.id, stimulus);
      flight.now += 1;
      flight.max = Math.max(flight.max, flight.now);
      if (hold && turn.index === 0 && stimulus.includes(FIRST)) await secondClosed;
      else await new Promise((resolve) => setImmediate(resolve));
      flight.now -= 1;
      return send(session, turn);
    };
    adapter.close = async (session) => {
      const stimulus = firstStimulus.get(session.id) ?? '';
      finished.push(stimulus.includes(FIRST) ? 'first' : stimulus.includes(SECOND) ? 'second' : 'other');
      if (stimulus.includes(SECOND)) release();
    };
    return { adapter, flight, finished };
  }

  async function campaign(concurrency: number) {
    const store = openMemoryStore();
    await putCampaign(store, 'c-pool', loaded);
    const { adapter, flight, finished } = counted(concurrency > 1);
    const heard: string[] = [];
    const outcomes = await runCampaign({
      campaignId: 'c-pool',
      cells: plan.cells,
      specFor: specOf,
      adapterFor: () => adapter,
      driver: () => createScriptedDriver(),
      checks: minimalChecks,
      store,
      concurrency,
      onCell: (outcome) => heard.push(outcome.cell.specId),
    });
    const stored = await store.listRuns({ campaignId: 'c-pool' });
    await store.close();
    return { outcomes, heard, flight, stored, finished };
  }

  it('runs up to 4 cells at once by default and reports them in cell order', async () => {
    const { outcomes, heard, flight, stored, finished } = await campaign(4);
    const order = plan.cells.map((cell) => cell.specId);
    expect(flight.max).toBe(4);
    // The first cell finished after the second, yet both are reported and returned in cell order.
    expect(finished.indexOf('second')).toBeLessThan(finished.indexOf('first'));
    expect(outcomes.map((outcome) => outcome.cell.specId)).toEqual(order);
    expect(heard).toEqual(order);
    expect(outcomes.every((outcome) => outcome.state === 'pass')).toBe(true);
    // Every run is stored; the store lists them by start time, then run id, which is its own order.
    expect(new Set(stored.map((run) => run.runId))).toEqual(new Set(plan.cells.map((cell) => cell.cellId)));
  });

  it('runs one cell at a time with a concurrency of 1', async () => {
    const { flight, heard, finished } = await campaign(1);
    expect(flight.max).toBe(1);
    expect(heard).toEqual(plan.cells.map((cell) => cell.specId));
    expect(finished.slice(0, 2)).toEqual(['first', 'second']);
  });
});

describe('the budget', () => {
  const plan = planCampaign(loaded, [acme], ['F'], 1);
  const priced = pricedAcmeAdapter;
  const options = (store: ReturnType<typeof openMemoryStore>, adapter: ReturnType<typeof priced>) => ({
    campaignId: 'c-budget',
    cells: plan.cells,
    specFor: specOf,
    adapterFor: () => adapter,
    driver: () => createScriptedDriver(),
    checks: minimalChecks,
    store,
    concurrency: 1,
  });

  it('starts no cell once the spend reaches the budget, and says which cells it stopped', async () => {
    const store = openMemoryStore();
    await putCampaign(store, 'c-budget', loaded);
    const adapter = priced();
    const outcomes = await runCampaign({ ...options(store, adapter), budgetUsd: 0.05 });
    // 4 blocks then 5 blocks at one cent: $0.04 is under the budget, $0.09 is past it.
    expect(outcomes.map((outcome) => outcome.state)).toEqual([
      'pass',
      'pass',
      'stopped',
      'stopped',
      'stopped',
      'stopped',
    ]);
    const stop = outcomes[2]?.budgetStop;
    expect(stop?.budgetUsd).toBe(0.05);
    expect(stop?.spentUsd).toBeCloseTo(0.09, 10);
    expect(outcomes[2]?.run).toBeUndefined();
    expect(adapter.calls.open).toBe(2);
    expect(await store.listRuns({ campaignId: 'c-budget' })).toHaveLength(2);

    // Resumed, the spend already in the store counts: with the same budget nothing starts.
    const again = priced();
    const held = await runCampaign({ ...options(store, again), budgetUsd: 0.05 });
    expect(held.map((outcome) => outcome.state)).toEqual([
      'pass',
      'pass',
      'stopped',
      'stopped',
      'stopped',
      'stopped',
    ]);
    expect(again.calls.open).toBe(0);

    // A larger budget lets the stopped cells run until it is reached again.
    const more = priced();
    const resumed = await runCampaign({ ...options(store, more), budgetUsd: 0.15 });
    expect(resumed.map((outcome) => [outcome.state, outcome.reused])).toEqual([
      ['pass', true],
      ['pass', true],
      ['pass', false],
      ['pass', false],
      ['stopped', false],
      ['stopped', false],
    ]);
    expect(resumed[4]?.budgetStop?.spentUsd).toBeCloseTo(0.18, 10);
    await store.close();
  });

  it('never counts a run replayed from the cache as spend', async () => {
    const store = openMemoryStore();
    await putCampaign(store, 'c-budget', loaded);
    await putCampaign(store, 'c-replay', loaded);
    await runCampaign({ ...options(store, priced()), cache: store });
    const replayed = await runCampaign({
      ...options(store, priced()),
      campaignId: 'c-replay',
      cache: store,
      budgetUsd: 0,
    });
    // Budget 0: no cell may start; every cell is stopped, and the cache is never asked.
    expect(replayed.every((outcome) => outcome.state === 'stopped')).toBe(true);
    const free = await runCampaign({
      ...options(store, priced()),
      campaignId: 'c-replay',
      cache: store,
      budgetUsd: 0.01,
    });
    expect(free.every((outcome) => outcome.state === 'pass' && outcome.run?.cacheHit)).toBe(true);
    await store.close();
  });
});

function specOf(cell: PlannedCell) {
  const found = loaded.find((entry) => entry.spec.id === cell.specId && entry.hash === cell.specHash);
  if (!found) throw new Error(`no spec ${cell.specId}`);
  return found.spec;
}

describe('runCampaign earlyStop', () => {
  const plan = planCampaign(loaded, [acme], ['F'], 4);
  const run = async (wrap: typeof dropsFirstToolCall | undefined, earlyStop: boolean, concurrency = 1) => {
    const store = openMemoryStore();
    await putCampaign(store, 'c-early', loaded);
    const outcomes = await runCampaign({
      campaignId: 'c-early',
      cells: plan.cells.filter((cell) => cell.specId === 'acme-plan-upgrade'),
      specFor: (cell) => specOf(cell),
      adapterFor: () => acmeAdapter(wrap ? { wrap } : {}),
      driver: () => createScriptedDriver(),
      checks: minimalChecks,
      store,
      concurrency,
      earlyStop,
    });
    return { outcomes, stored: await store.listRuns({ campaignId: 'c-early' }) };
  };

  it('stops repeats 2 and 3 of a spec whose first two repeats failed a gating machine check', async () => {
    for (const concurrency of [1, 4]) {
      const { outcomes, stored } = await run(dropsFirstToolCall, true, concurrency);
      expect(outcomes.map((o) => o.state)).toEqual(['fail', 'fail', 'stopped', 'stopped']);
      expect(outcomes[2]?.earlyStop).toEqual({ after: 2 });
      expect(outcomes[2]?.run).toBeUndefined();
      expect(stored).toHaveLength(2);
    }
  });

  it('runs every repeat of a passing spec, and every repeat without the option', async () => {
    const passing = await run(undefined, true);
    expect(passing.outcomes.map((o) => o.state)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(passing.stored).toHaveLength(4);
    const off = await run(dropsFirstToolCall, false);
    expect(off.outcomes.map((o) => o.state)).toEqual(['fail', 'fail', 'fail', 'fail']);
    expect(off.stored).toHaveLength(4);
  });
});
