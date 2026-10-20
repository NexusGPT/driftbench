import { mulberry32 } from '@agent-nexus/driftbench-stats';
import { SLOT_SURFACE, surfaceValues, type UtteranceClass } from './schema';

/**
 * The class planner: a covering array over the class's axes. slot_surface (which approved spelling each slot
 * takes) is always an axis; the style axes the file declares are the others. Exclusions go to the planner, so
 * an excluded combination is never written, and the tuples it would have held are not required.
 */

export type Axis = { name: string; values: string[] };
/** One planned realisation: a value per axis. */
export type Row = Record<string, string>;

/** The axes of a class, slot_surface first. */
export function classAxes(cls: UtteranceClass): Axis[] {
  return [
    { name: SLOT_SURFACE, values: surfaceValues(cls) },
    ...Object.entries(cls.axes).map(([name, values]) => ({ name, values: Object.keys(values) })),
  ];
}

const MAX_ROWS = 200_000;

function allowed(cls: UtteranceClass, row: Row): boolean {
  return !cls.exclude.some((combination) =>
    Object.entries(combination).every(([axis, value]) => row[axis] === value),
  );
}

/** Every allowed row of the full grid. Throws a RangeError on a grid above 200,000 rows. */
export function allRows(cls: UtteranceClass): Row[] {
  const axes = classAxes(cls);
  const size = axes.reduce((product, axis) => product * axis.values.length, 1);
  if (size > MAX_ROWS)
    throw new RangeError(`the class grid has ${size} rows, above ${MAX_ROWS}: declare fewer axis values`);
  let rows: Row[] = [{}];
  for (const axis of axes)
    rows = rows.flatMap((row) => axis.values.map((value) => ({ ...row, [axis.name]: value })));
  return rows.filter((row) => allowed(cls, row));
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [first as T, ...c]), ...combinations(rest, k)];
}

/** The t-way tuples of a row, as keys such as `register=casual|slot_surface=s1`. */
export function tuplesOf(row: Row, axes: readonly string[], t: number): string[] {
  const k = Math.min(t, axes.length);
  return combinations(axes, k).map((names) => names.map((name) => `${name}=${row[name]}`).join('|'));
}

/** The t-way tuples some allowed row holds: what a strength-t array must cover. */
export function requiredTuples(cls: UtteranceClass, t: number): Set<string> {
  const names = classAxes(cls).map((a) => a.name);
  const out = new Set<string>();
  for (const row of allRows(cls)) for (const key of tuplesOf(row, names, t)) out.add(key);
  return out;
}

export type Coverage = { t: number; covered: number; required: number; share: number; missing: string[] };

/** The share of the required t-way tuples the rows hold, with the ones they miss. */
export function coverageOf(cls: UtteranceClass, rows: readonly Row[], t: number): Coverage {
  const names = classAxes(cls).map((a) => a.name);
  const required = requiredTuples(cls, t);
  const seen = new Set<string>();
  for (const row of rows) for (const key of tuplesOf(row, names, t)) if (required.has(key)) seen.add(key);
  const missing = [...required].filter((key) => !seen.has(key)).sort();
  return {
    t,
    covered: seen.size,
    required: required.size,
    share: required.size === 0 ? 1 : seen.size / required.size,
    missing,
  };
}

function greedy(cls: UtteranceClass, t: number, seed: number): Row[] {
  const names = classAxes(cls).map((a) => a.name);
  const pool = allRows(cls);
  const random = mulberry32(seed);
  const left = requiredTuples(cls, t);
  const keys = pool.map((row) => tuplesOf(row, names, t));
  const rows: Row[] = [];
  while (left.size > 0) {
    let best = -1;
    let bestGain = -1;
    let ties = 0;
    keys.forEach((rowKeys, index) => {
      const gain = rowKeys.filter((key) => left.has(key)).length;
      if (gain > bestGain) {
        bestGain = gain;
        best = index;
        ties = 1;
      } else if (gain === bestGain) {
        ties += 1;
        if (random() < 1 / ties) best = index;
      }
    });
    rows.push(pool[best] as Row);
    for (const key of keys[best] as string[]) left.delete(key);
  }
  return rows;
}

export type PlanOptions = {
  /** Strength; the class file's `strength` (default 2) without it. */
  t?: number;
  /** Seed of the tie-breaks. Default 1. */
  seed?: number;
  /** Seeds tried from `seed`; the smallest array wins. Default 5. */
  tries?: number;
  /** Rows wanted: the array is extended with rows adding the most uncovered (t+1)-way tuples. */
  rows?: number;
};

/** A strength-t covering array over the class's axes, the smallest of `tries` seeded greedy constructions. */
export function planClass(cls: UtteranceClass, options: PlanOptions = {}): Row[] {
  const t = options.t ?? cls.strength;
  const seed = options.seed ?? 1;
  let best: Row[] | undefined;
  for (let n = 0; n < (options.tries ?? 5); n++) {
    const rows = greedy(cls, t, seed + n);
    if (!best || rows.length < best.length) best = rows;
  }
  const rows = best as Row[];
  return options.rows !== undefined && options.rows > rows.length
    ? extend(cls, rows, options.rows, t, seed)
    : rows;
}

function extend(cls: UtteranceClass, rows: Row[], n: number, t: number, seed: number): Row[] {
  const names = classAxes(cls).map((a) => a.name);
  const out = [...rows];
  const random = mulberry32(seed);
  const pool = allRows(cls);
  const seen = new Set(out.flatMap((row) => tuplesOf(row, names, t + 1)));
  // Past the full grid a row repeats: the next copy of the least used row.
  while (out.length < n) {
    let best = 0;
    let bestGain = Number.NEGATIVE_INFINITY;
    let ties = 0;
    pool.forEach((row, index) => {
      const uses = out.filter((r) => names.every((a) => r[a] === row[a])).length;
      const gain = tuplesOf(row, names, t + 1).filter((key) => !seen.has(key)).length - uses * 1000;
      if (gain > bestGain) {
        bestGain = gain;
        best = index;
        ties = 1;
      } else if (gain === bestGain) {
        ties += 1;
        if (random() < 1 / ties) best = index;
      }
    });
    const row = pool[best] as Row;
    out.push(row);
    for (const key of tuplesOf(row, names, t + 1)) seen.add(key);
  }
  return out;
}

/** The row a cell key holds, and its axis names in order: the inverse of `cellKey`. */
export function rowOfCell(cell: string): { row: Row; axes: string[] } {
  const row: Row = {};
  const axes: string[] = [];
  for (const part of cell.split('|')) {
    const at = part.indexOf('=');
    axes.push(part.slice(0, at));
    row[part.slice(0, at)] = part.slice(at + 1);
  }
  return { row, axes };
}

/** The cell of a row as one text, axes in class order: `slot_surface=s1|register=casual`. */
export function cellKey(cls: UtteranceClass, row: Row): string {
  return classAxes(cls)
    .map((axis) => `${axis.name}=${row[axis.name]}`)
    .join('|');
}

export type Observation = { row: Row; passes: number; runs: number };
export type Suspect = { tuple: string; t: number; failRate: number; runs: number; inPassing: boolean };

/**
 * The localiser on pass rates. A realisation passes consistently when it passed every run; a tuple is a
 * suspect first when no consistently passing realisation holds it. Suspects rank first, then by failure rate
 * over the runs that hold them, simpler tuples first on a tie, then by support.
 */
export function localise(
  axes: UtteranceClass | readonly string[],
  observations: readonly Observation[],
  maxT = 2,
): Suspect[] {
  const names = Array.isArray(axes)
    ? (axes as readonly string[])
    : classAxes(axes as UtteranceClass).map((a) => a.name);
  const passing = new Set<string>();
  for (const o of observations) {
    if (o.passes === o.runs)
      for (let t = 1; t <= maxT; t++) for (const key of tuplesOf(o.row, names, t)) passing.add(key);
  }
  const stats = new Map<string, { t: number; fails: number; runs: number }>();
  for (const o of observations) {
    for (let t = 1; t <= Math.min(maxT, names.length); t++) {
      for (const key of tuplesOf(o.row, names, t)) {
        const s = stats.get(key) ?? { t, fails: 0, runs: 0 };
        s.fails += o.runs - o.passes;
        s.runs += o.runs;
        stats.set(key, s);
      }
    }
  }
  return [...stats.entries()]
    .map(([tuple, s]) => ({
      tuple,
      t: s.t,
      failRate: s.runs === 0 ? 0 : s.fails / s.runs,
      runs: s.runs,
      inPassing: passing.has(tuple),
    }))
    .sort(
      (a, b) =>
        Number(a.inPassing) - Number(b.inPassing) ||
        b.failRate - a.failRate ||
        a.t - b.t ||
        b.runs - a.runs ||
        (a.tuple < b.tuple ? -1 : 1),
    );
}
