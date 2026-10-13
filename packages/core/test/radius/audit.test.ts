import { describe, expect, it } from 'vitest';
import {
  auditBound,
  auditSample,
  auditVerdict,
  type CarriedCell,
  type RunResult,
  type Verdict,
} from '../../src/index';

/** Fictional data only. */
const cells: CarriedCell[] = Array.from({ length: 40 }, (_, index) => ({
  cell: {
    cellId: `cell-${String(index).padStart(2, '0')}`,
    specId: `spec-${index}`,
    specHash: `hash-${index}`,
    target: { adapter: 'function', agent: 'acme-sales', variant: 'v2' },
    mode: 'F',
    repeat: 0,
    blocks: 1,
  },
  source: {} as RunResult,
  carried: { fromCampaign: 'c-base', fromRun: `run-${index}`, age: { campaigns: 1, days: 0 } },
}));
const ids = (sample: readonly CarriedCell[]) => sample.map((entry) => entry.cell.cellId);

describe('auditSample', () => {
  it('draws n distinct cells, the same for the same seed', () => {
    const first = ids(auditSample(cells, 10, 1));
    expect(first).toHaveLength(10);
    expect(new Set(first).size).toBe(10);
    expect(ids(auditSample(cells, 10, 1))).toEqual(first);
    expect(ids(auditSample(cells, 10, 2))).not.toEqual(first);
  });

  it('does not depend on the order the plan lists the cells in', () => {
    expect(ids(auditSample([...cells].reverse(), 10, 1))).toEqual(ids(auditSample(cells, 10, 1)));
  });

  it('takes every cell when asked for more than there are, and none for 0', () => {
    expect(ids(auditSample(cells, 100, 1)).sort()).toEqual(ids(cells));
    expect(auditSample(cells, 0, 1)).toEqual([]);
    expect(() => auditSample(cells, -1, 1)).toThrow(RangeError);
  });

  it('spreads over the cells: across seeds every cell is drawn', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) for (const id of ids(auditSample(cells, 5, seed))) seen.add(id);
    expect(seen.size).toBe(40);
  });
});

const verdict = (id: string, outcome: Verdict['outcome'], gating = true) =>
  ({ id, outcome, gating }) as Verdict;
const run = (blocks: { pass: boolean; verdicts: Verdict[] }[], over: Partial<RunResult> = {}): RunResult =>
  ({
    status: 'completed',
    blocks: blocks.map((block, index) => ({ index, ...block })),
    ...over,
  }) as RunResult;

describe('auditVerdict', () => {
  const stored = run([
    { pass: true, verdicts: [verdict('stage.reached', 'pass'), verdict('judge.tone', 'fail', false)] },
    { pass: true, verdicts: [verdict('tools.order.create.count', 'pass')] },
  ]);

  it('agrees when every gating verdict, every block and the end state are the same', () => {
    const fresh = run([
      // A verdict that does not gate may differ: it decides no pass or fail.
      { pass: true, verdicts: [verdict('stage.reached', 'pass'), verdict('judge.tone', 'pass', false)] },
      { pass: true, verdicts: [verdict('tools.order.create.count', 'pass')] },
    ]);
    expect(auditVerdict(fresh, stored)).toEqual({ agree: true, differing: [] });
  });

  it('names each gating verdict that changed, with the carried outcome then the fresh one', () => {
    const fresh = run([
      { pass: true, verdicts: [verdict('stage.reached', 'pass')] },
      { pass: false, verdicts: [verdict('tools.order.create.count', 'fail')] },
    ]);
    expect(auditVerdict(fresh, stored)).toEqual({
      agree: false,
      differing: ['block 1 tools.order.create.count: pass then fail'],
    });
  });

  it('disagrees on a status, a block count, a block pass or an end state that changed', () => {
    expect(auditVerdict(run([], { status: 'failed' }), stored).differing).toEqual([
      'status: completed then failed',
      'blocks: 2 then 0',
    ]);
    const flipped = run([
      { pass: false, verdicts: [verdict('stage.reached', 'pass')] },
      { pass: true, verdicts: [verdict('tools.order.create.count', 'pass')] },
    ]);
    expect(auditVerdict(flipped, stored).differing).toEqual(['block 0: pass then fail']);
    const ended = run(stored.blocks, { endState: { match: false, diff: [] } });
    expect(auditVerdict(ended, { ...stored, endState: { match: true, diff: [] } }).differing).toEqual([
      'end state: true then false',
    ]);
  });
});

describe('auditBound', () => {
  it('bounds the miss rate after n audits with no miss, at 95%', () => {
    expect(auditBound(20)).toBeCloseTo(0.139, 3);
    expect(auditBound(59)).toBeLessThan(0.05);
    expect(auditBound(58)).toBeGreaterThan(0.05);
    expect(auditBound(0)).toBeUndefined();
  });
});
