import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { planV2 } from '../../src/plan-v2';
import { counters, Solver } from '../../src/plan-v2/solver';
import { viewOf } from '../../src/plan-v2/view';

/**
 * How the work of the planner grows with the number of variables when many pairs are impossible. The count is
 * the solver's own steps (counters.work), so the test does not depend on the speed of the machine. A store of n
 * variables of four values has 6n impossible pairs and a tenth of the variables as axes.
 */

/** A seeded stream of whole numbers below a bound (mulberry32: the low bits of a power-of-two LCG repeat). */
function stream(seed: number) {
  let state = seed >>> 0;
  return (modulo: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * modulo);
  };
}

function store(n: number) {
  const variables = Array.from({ length: n }, (_, k) => ({
    id: `v${k}`,
    title: `v${k}`,
    kind: 'data',
    role: k < Math.max(2, n / 10) ? 'axis' : 'detail',
    approved: true,
    values: Array.from({ length: 4 }, (_, j) => ({ id: `v${k}x${j}`, title: `x${j}` })),
  }));
  const next = stream(12345);
  const seen = new Set<string>();
  const constraints: object[] = [];
  while (constraints.length < 6 * n) {
    const a = next(n - 1);
    const b = a + 1 + next(n - a - 1);
    const va = next(4);
    const vb = next(4);
    const key = `${a}.${va}.${b}.${vb}`;
    if (seen.has(key)) continue;
    seen.add(key);
    constraints.push({
      forbid: { [`v${a}`]: `v${a}x${va}`, [`v${b}`]: `v${b}x${vb}` },
      reason: 'drawn',
      approved: true,
    });
  }
  const checked = validateVariableStore({
    format: 1,
    agent: 'work',
    version: '1',
    prior: { kind: 'declared' },
    variables,
    constraints,
  });
  if (!checked.ok) throw new Error(checked.errors.map((issue) => issue.message).join('; '));
  return checked.store;
}

function work(n: number) {
  counters.work = 0;
  const plan = planV2(store(n), { seed: 1 });
  return { work: counters.work, rows: plan.rows.length };
}

describe('the work of planner v2 with many impossible pairs', () => {
  it('grows no faster than the square of the variables when they double and double again', () => {
    const one = work(10);
    const two = work(20);
    const four = work(40);
    // Twice and four times the variables: the square is 4 and 16 times the work; the rows grow with the log.
    console.log(`WORK ${JSON.stringify({ one, two, four })}`);
    expect(two.work / one.work).toBeLessThan(6);
    expect(four.work / two.work).toBeLessThan(6);
  });
});

/** Small stores with constraints of one, two and three entries, and their answers by enumeration. */
function small(seed: number) {
  const next = stream(seed * 7919 + 7);
  const n = 4 + next(3);
  const widths = Array.from({ length: n }, () => 2 + next(2));
  const variables = widths.map((width, k) => ({
    id: `v${k}`,
    title: `v${k}`,
    kind: 'data',
    role: 'axis',
    approved: true,
    values: Array.from({ length: width }, (_, j) => ({ id: `v${k}x${j}`, title: `x${j}` })),
  }));
  const seen = new Set<string>();
  const constraints: { forbid: Record<string, string>; reason: string; approved: boolean }[] = [];
  for (let tries = 0; tries < 40 && constraints.length < 3 + next(8); tries += 1) {
    const size = 1 + next(3);
    const chosen = new Set<number>();
    while (chosen.size < size) chosen.add(next(n));
    const forbid = Object.fromEntries(
      [...chosen].map((k) => [`v${k}`, `v${k}x${next(widths[k] as number)}`]),
    );
    const key = JSON.stringify(Object.entries(forbid).sort());
    if (seen.has(key)) continue;
    seen.add(key);
    constraints.push({ forbid, reason: 'drawn', approved: true });
  }
  const checked = validateVariableStore({
    format: 1,
    agent: 'small',
    version: '1',
    prior: { kind: 'declared' },
    variables,
    constraints,
  });
  if (!checked.ok) return undefined;
  return { store: checked.store, widths, next };
}

describe('the solver against enumeration', () => {
  it('answers every partial row of at least 50 small stores as a count of the valid rows does', () => {
    let used = 0;
    for (let seed = 1; seed <= 90; seed += 1) {
      const drawn = small(seed);
      if (!drawn) continue;
      used += 1;
      const { store, widths, next } = drawn;
      const view = viewOf(store, {});
      const solver = new Solver(view);
      const valid: number[][] = [];
      const walk = (row: number[]) => {
        if (row.length === widths.length) {
          const bad = view.constraints.some((c) => c.variables.every((v, at) => row[v] === c.values[at]));
          if (!bad) valid.push(row);
          return;
        }
        for (let value = 0; value < (widths[row.length] as number); value += 1) walk([...row, value]);
      };
      walk([]);
      for (let probe = 0; probe < 40; probe += 1) {
        const partial = Int16Array.from(widths, (width) => (next(3) === 0 ? next(width) : -1));
        const expected = valid.some((row) => partial.every((value, at) => value < 0 || row[at] === value));
        expect(solver.canComplete(partial), `store ${seed} row ${partial.join(',')}`).toBe(expected);
        // The same row reached one variable at a time, and taken back, answers alike.
        const live = solver.frontier(new Int16Array(widths.length).fill(-1));
        const order = [...partial.keys()].filter((at) => (partial[at] as number) >= 0);
        for (const at of order) live.set(at, partial[at] as number);
        expect(live.finish(), `store ${seed} stepwise ${partial.join(',')}`).toBe(expected);
        for (const at of order.reverse()) live.clear(at);
        expect(live.finish(), `store ${seed} cleared`).toBe(valid.length > 0);
        expect(live.row.every((value) => value === -1)).toBe(true);
      }
    }
    expect(used).toBeGreaterThanOrEqual(50);
  });
});
