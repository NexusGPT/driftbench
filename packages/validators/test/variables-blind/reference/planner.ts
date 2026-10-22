import type {
  CoverageResult,
  Group,
  Plan,
  PlanOptions,
  PlanRow,
  PlanWarning,
  Row,
  StoreDoc,
} from '../../../src/ladders/variables/interface';

/**
 * A reference for `plan`, `coverage` and `weightInterval`, written from docs/variables.md (Planner rules R6 to
 * R14, Counter and interval rules R12 and R13) alone. A greedy builder, one row at a time, with forward checking
 * over the constraints. It exists to prove that the items of the blind bank can be passed; it is not the product.
 */

const Z = 1.959963984540054;

/** Switches the mutation tests turn on to break the reference in one place; all off by default. */
export const mutation = {
  ruleStrength: 3,
  noSharedPairs: false,
  detailPairs: false,
  noSingles: false,
  ignoreForbids: false,
  ignoreExtension: false,
  noBoundaryRules: false,
  noWhenRules: false,
};

export function weightInterval(count: number, total: number): [number, number] {
  const p = count / total;
  const d = 1 + (Z * Z) / total;
  const centre = (p + (Z * Z) / (2 * total)) / d;
  const half = (Z * Math.sqrt((p * (1 - p)) / total + (Z * Z) / (4 * total * total))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

type Space = {
  ids: string[];
  doms: string[][];
  index: Map<string, number>;
  valueIndex: Array<Map<string, number>>;
  shared: boolean[];
  rules: number[][];
  /** Forbidden partial assignments, as cells of (variable index, value index). */
  forbids: Array<Array<[number, number]>>;
  logShare: number[][];
  /** Every value the store lists for each variable, approved or not, for seed reading. */
  known: Map<string, { variableApproved: boolean; values: Map<string, boolean> }>;
};

function spaceOf(store: StoreDoc): Space {
  const ids: string[] = [];
  const doms: string[][] = [];
  const index = new Map<string, number>();
  const valueIndex: Array<Map<string, number>> = [];
  const shared: boolean[] = [];
  const logShare: number[][] = [];
  const known: Space['known'] = new Map();
  for (const v of store.variables) {
    const values = new Map<string, boolean>();
    for (const x of v.values) values.set(x.id, x.approved !== false);
    known.set(v.id, { variableApproved: v.approved !== false, values });
    if (v.approved === false) continue;
    const ok = v.values.filter((x) => x.approved !== false);
    if (ok.length === 0) continue;
    index.set(v.id, ids.length);
    ids.push(v.id);
    doms.push(ok.map((x) => x.id));
    valueIndex.push(new Map(ok.map((x, i) => [x.id, i])));
    shared.push(v.shared === true);
    const weighted = ok.some((x) => x.weight !== undefined);
    const w = ok.map((x) => (weighted ? (x.weight ?? 0) : 1));
    const sum = w.reduce((a, b) => a + b, 0);
    logShare.push(w.map((x) => (x === 0 || sum === 0 ? Number.NEGATIVE_INFINITY : Math.log(x / sum))));
  }
  const cellOf = (variable: string, value: string): [number, number] | undefined => {
    const vi = index.get(variable);
    if (vi === undefined) return undefined;
    const xi = (valueIndex[vi] as Map<string, number>).get(value);
    return xi === undefined ? undefined : [vi, xi];
  };
  const forbids: Array<Array<[number, number]>> = [];
  const seen = new Set<string>();
  const addForbid = (cells: Array<[number, number]>): void => {
    if (new Set(cells.map((c) => c[0])).size !== cells.length) return;
    const key = cells
      .map((c) => `${c[0]}:${c[1]}`)
      .sort()
      .join('|');
    if (seen.has(key)) return;
    seen.add(key);
    forbids.push(cells);
  };
  for (const f of store.forbids ?? []) {
    if (f.approved === false) continue;
    const cells = Object.entries(f.forbid).map(([k, x]) => cellOf(k, x));
    if (cells.length > 0 && cells.every((c) => c !== undefined)) addForbid(cells as Array<[number, number]>);
  }
  for (const p of store.impossible) {
    const a = cellOf(p.a.variable, p.a.value);
    const b = cellOf(p.b.variable, p.b.value);
    if (a && b) addForbid([a, b]);
  }
  const rules: number[][] = [];
  const named = new Map<string, Set<string>>(store.rules.map((r) => [r.id, new Set(r.variables)]));
  if (!mutation.noBoundaryRules)
    for (const v of store.variables)
      for (const b of v.boundaries ?? []) if (b.rule !== undefined) named.get(b.rule)?.add(v.id);
  for (const r of store.rules) {
    const own = [
      ...new Set(
        [...(named.get(r.id) ?? [])].map((id) => index.get(id)).filter((i): i is number => i !== undefined),
      ),
    ];
    if (own.length > 0) rules.push(own);
  }
  if (!mutation.noWhenRules)
    for (const v of store.variables) {
      for (const x of v.values) {
        if (x.approved === false || (x.when === undefined && x.unless === undefined)) continue;
        const own = [
          ...new Set(
            [v.id, ...Object.keys(x.when ?? {}), ...Object.keys(x.unless ?? {})]
              .map((id) => index.get(id))
              .filter((i): i is number => i !== undefined),
          ),
        ];
        if (own.length > 0 && index.has(v.id)) rules.push(own);
      }
    }
  return {
    ids,
    doms,
    index,
    valueIndex,
    shared,
    rules,
    forbids: mutation.ignoreForbids ? [] : forbids,
    logShare,
    known,
  };
}

function subsets(items: readonly number[], k: number): number[][] {
  const out: number[][] = [];
  const go = (start: number, chosen: number[]): void => {
    if (chosen.length === k) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      chosen.push(items[i] as number);
      go(i + 1, chosen);
      chosen.pop();
    }
  };
  go(0, []);
  return out;
}

function groupsOf(s: Space): number[][] {
  const out: number[][] = [];
  const seen = new Set<string>();
  const named = new Set<number>();
  const add = (g: number[]): void => {
    const key = [...g].sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push([...g].sort((a, b) => a - b));
    for (const v of g) named.add(v);
  };
  for (const r of s.rules) for (const g of subsets(r, Math.min(mutation.ruleStrength, r.length))) add(g);
  const axes = s.shared.map((x, i) => (x || mutation.detailPairs ? i : -1)).filter((i) => i >= 0);
  if (!mutation.noSharedPairs) {
    for (const g of subsets(axes, 2)) if (!s.rules.some((r) => g.every((v) => r.includes(v)))) add(g);
  }
  if (!mutation.noSingles) for (let v = 0; v < s.ids.length; v += 1) if (!named.has(v)) add([v]);
  return out;
}

function fnv(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Target = { vars: number[]; vals: number[]; lw: number; group: number };

class Builder {
  private readonly n: number;
  private readonly offset: number[] = [];
  private readonly block: Int32Array;
  private readonly free: Int32Array;
  private readonly row: Int32Array;
  private readonly assignedCount: Int32Array;
  private readonly deadCount: Int32Array;
  private readonly forbidsByVar: Array<Array<{ f: number; value: number }>>;
  private trail: Array<[number, number, number]> = [];

  constructor(private readonly s: Space) {
    this.n = s.ids.length;
    let total = 0;
    for (const d of s.doms) {
      this.offset.push(total);
      total += d.length;
    }
    this.block = new Int32Array(total);
    this.free = Int32Array.from(s.doms.map((d) => d.length));
    this.row = new Int32Array(this.n).fill(-1);
    this.assignedCount = new Int32Array(s.forbids.length);
    this.deadCount = new Int32Array(s.forbids.length);
    this.forbidsByVar = Array.from({ length: this.n }, () => []);
    s.forbids.forEach((cells, f) => {
      for (const [v, x] of cells)
        (this.forbidsByVar[v] as Array<{ f: number; value: number }>).push({ f, value: x });
    });
  }

  reset(): void {
    this.block.fill(0);
    for (let v = 0; v < this.n; v += 1) this.free[v] = (this.s.doms[v] as string[]).length;
    this.row.fill(-1);
    this.assignedCount.fill(0);
    this.deadCount.fill(0);
    this.trail = [];
    // A constraint of one cell removes that value before any row is built.
    for (const cells of this.s.forbids) {
      if (cells.length !== 1) continue;
      const [v, x] = cells[0] as [number, number];
      const cell = (this.offset[v] as number) + x;
      this.block[cell] = (this.block[cell] as number) + 1;
      if (this.block[cell] === 1) this.free[v] = (this.free[v] as number) - 1;
    }
  }

  /** True when some variable has no value left. */
  dead(): boolean {
    return this.free.some((f) => f === 0);
  }

  value(v: number): number {
    return this.row[v] as number;
  }

  /** Assigns (v, x) and propagates; returns false when a variable is left with no value. */
  assign(v: number, x: number): boolean {
    if ((this.block[(this.offset[v] as number) + x] as number) > 0) return false;
    this.row[v] = x;
    this.trail.push([0, v, x]);
    let ok = true;
    for (const { f, value } of this.forbidsByVar[v] as Array<{ f: number; value: number }>) {
      if (value === x) this.assignedCount[f] = (this.assignedCount[f] as number) + 1;
      else this.deadCount[f] = (this.deadCount[f] as number) + 1;
      this.trail.push([1, f, value === x ? 1 : 0]);
      const cells = this.s.forbids[f] as Array<[number, number]>;
      if ((this.deadCount[f] as number) === 0 && (this.assignedCount[f] as number) === cells.length - 1) {
        const open = cells.find(([w]) => this.row[w] === -1);
        if (open) {
          const cell = (this.offset[open[0]] as number) + open[1];
          this.block[cell] = (this.block[cell] as number) + 1;
          this.trail.push([2, cell, open[0]]);
          if ((this.block[cell] as number) === 1) {
            this.free[open[0]] = (this.free[open[0]] as number) - 1;
            if (this.free[open[0]] === 0) ok = false;
          }
        }
      }
    }
    return ok;
  }

  mark(): number {
    return this.trail.length;
  }

  undo(mark: number): void {
    while (this.trail.length > mark) {
      const [kind, a, b] = this.trail.pop() as [number, number, number];
      if (kind === 0) this.row[a] = -1;
      else if (kind === 1) {
        if (b === 1) this.assignedCount[a] = (this.assignedCount[a] as number) - 1;
        else this.deadCount[a] = (this.deadCount[a] as number) - 1;
      } else {
        this.block[a] = (this.block[a] as number) - 1;
        if (this.block[a] === 0) this.free[b] = (this.free[b] as number) + 1;
      }
    }
  }

  freeCount(v: number): number {
    return this.free[v] as number;
  }

  available(v: number, x: number): boolean {
    return (this.block[(this.offset[v] as number) + x] as number) === 0;
  }

  snapshot(): number[] {
    return Array.from(this.row);
  }
}

export function plan(store: StoreDoc, options: PlanOptions): Plan {
  const { budget } = options;
  if (budget !== undefined) {
    if (typeof budget !== 'number') throw new TypeError('budget must be a number');
    if (!Number.isFinite(budget) || budget < 0 || !Number.isInteger(budget))
      throw new RangeError('budget must be a non-negative whole number');
  }
  const s = spaceOf(store);
  const warnings: PlanWarning[] = [];
  const warn = (code: string, message: string): void => {
    if (!warnings.some((w) => w.code === code && w.message === message)) warnings.push({ code, message });
  };
  // Seeds first, as given, minus entries the store does not know.
  const seedRows: PlanRow[] = [];
  const seedCells: Array<Array<[number, number]>> = [];
  (options.seeds ?? []).forEach((seed, i) => {
    const values: Row = {};
    const cells: Array<[number, number]> = [];
    for (const [variable, value] of Object.entries(seed)) {
      const info = s.known.get(variable);
      const approved = info?.values.get(value);
      if (!info || approved === undefined) {
        warn(
          'seed_unknown_value',
          `the seed ${i + 1} names ${variable}=${value}, which the store does not have`,
        );
        continue;
      }
      values[variable] = value;
      if (!info.variableApproved || approved === false) {
        warn('seed_unapproved_value', `the seed ${i + 1} names ${variable}=${value}, which nobody approved`);
        continue;
      }
      const vi = s.index.get(variable) as number;
      cells.push([vi, (s.valueIndex[vi] as Map<string, number>).get(value) as number]);
    }
    const held = (f: Array<[number, number]>): boolean =>
      f.every(([v, x]) => cells.some(([cv, cx]) => cv === v && cx === x));
    if (s.forbids.some(held))
      warn('seed_forbidden', `the seed ${i + 1} holds a combination the store forbids`);
    seedRows.push({ id: `seed.${i + 1}`, kind: 'seed', values, logWeight: weightOf(s, cells) });
    seedCells.push(cells);
  });
  const budgetFor = (): number =>
    budget === undefined ? Number.POSITIVE_INFINITY : Math.max(0, budget - seedRows.length);
  if (s.ids.length === 0) {
    warn('no_variables', 'nothing in the store is approved, so the plan is the seeds alone');
    const rows = seedRows.slice(0, Math.max(seedRows.length, budget ?? 0));
    return { rows, report: { allowed: 0, covered: 0 }, warnings };
  }
  // Targets.
  const groups = groupsOf(s);
  const targets: Target[] = [];
  const idByKey = new Map<string, number>();
  groups.forEach((g, gi) => {
    const sizes = g.map((v) => (s.doms[v] as string[]).length);
    const vals = new Array<number>(g.length).fill(0);
    for (;;) {
      let lw = 0;
      g.forEach((v, k) => {
        lw += (s.logShare[v] as number[])[vals[k] as number] as number;
      });
      idByKey.set(`${gi}:${vals.join(',')}`, targets.length);
      targets.push({ vars: g, vals: [...vals], lw, group: gi });
      let k = g.length - 1;
      while (k >= 0 && (vals[k] as number) === (sizes[k] as number) - 1) {
        vals[k] = 0;
        k -= 1;
      }
      if (k < 0) break;
      vals[k] = (vals[k] as number) + 1;
    }
  });
  const T = targets.length;
  const waiting = new Uint8Array(T).fill(1);
  const feasible = new Uint8Array(T).fill(1);
  const coveredBySeeds = new Uint8Array(T);
  seedCells.forEach((cells) => {
    const at = new Map(cells);
    groups.forEach((g, gi) => {
      const vals: number[] = [];
      for (const v of g) {
        const x = at.get(v);
        if (x === undefined) return;
        vals.push(x);
      }
      const id = idByKey.get(`${gi}:${vals.join(',')}`);
      if (id !== undefined) coveredBySeeds[id] = 1;
    });
  });
  for (let t = 0; t < T; t += 1) if (coveredBySeeds[t]) waiting[t] = 0;
  const byVar: number[][] = Array.from({ length: s.ids.length }, () => []);
  targets.forEach((t, i) => {
    for (const v of t.vars) (byVar[v] as number[]).push(i);
  });
  const builder = new Builder(s);
  const newRowsFound: Array<{ values: number[]; covers: number[]; lw: number; hash: number }> = [];
  const seenValue: Uint8Array[] = s.doms.map((d) => new Uint8Array(d.length));
  const constrained = s.forbids.length > 0;

  const covers = (row: number[]): number[] => {
    const out: number[] = [];
    for (let t = 0; t < T; t += 1) {
      if (!waiting[t]) continue;
      const tg = targets[t] as Target;
      let all = true;
      for (let k = 0; k < tg.vars.length; k += 1) {
        if (row[tg.vars[k] as number] !== tg.vals[k]) {
          all = false;
          break;
        }
      }
      if (all) out.push(t);
    }
    return out;
  };

  /** Builds a valid full row that holds the cells, or undefined. */
  const buildRow = (fixed: Array<[number, number]>, guided: boolean): number[] | undefined => {
    builder.reset();
    if (builder.dead()) return undefined;
    for (const [v, x] of fixed) if (!builder.assign(v, x)) return undefined;
    const frames: Array<{ v: number; choices: number[]; at: number; mark: number }> = [];
    let nodes = 0;
    const choicesFor = (v: number): number[] => {
      const dom = s.doms[v] as string[];
      const counts = new Array<number>(dom.length).fill(0);
      if (guided) {
        // Density: a waiting target whose assigned cells match counts for the chance that the cells still open
        // fall as it needs (one over the product of their arities).
        for (const t of byVar[v] as number[]) {
          if (!waiting[t] || !feasible[t]) continue;
          const tg = targets[t] as Target;
          let mine = -1;
          let weight = 1;
          let ok = true;
          for (let k = 0; k < tg.vars.length; k += 1) {
            const w = tg.vars[k] as number;
            if (w === v) mine = tg.vals[k] as number;
            else {
              const placed = builder.value(w);
              if (placed < 0) weight /= (s.doms[w] as string[]).length;
              else if (placed !== tg.vals[k]) {
                ok = false;
                break;
              }
            }
          }
          if (ok && mine >= 0) counts[mine] = (counts[mine] as number) + weight;
        }
      }
      const xs = dom.map((_, x) => x).filter((x) => builder.available(v, x));
      xs.sort(
        (a, b) =>
          (counts[b] as number) - (counts[a] as number) ||
          ((s.logShare[v] as number[])[b] as number) - ((s.logShare[v] as number[])[a] as number) ||
          a - b,
      );
      return xs;
    };
    let fresh = true;
    for (;;) {
      let frame: { v: number; choices: number[]; at: number; mark: number };
      if (fresh) {
        let v = -1;
        let fewest = Number.POSITIVE_INFINITY;
        for (let w = 0; w < s.ids.length; w += 1) {
          if (builder.value(w) !== -1) continue;
          const f = builder.freeCount(w);
          if (f < fewest) {
            fewest = f;
            v = w;
            if (f <= 1) break;
          }
        }
        if (v < 0) return builder.snapshot();
        frame = { v, choices: choicesFor(v), at: 0, mark: builder.mark() };
        frames.push(frame);
      } else frame = frames[frames.length - 1] as typeof frame;
      builder.undo(frame.mark);
      let placed = false;
      while (frame.at < frame.choices.length) {
        const x = frame.choices[frame.at] as number;
        frame.at += 1;
        nodes += 1;
        if (nodes > 200_000) return undefined;
        if (builder.assign(frame.v, x)) {
          placed = true;
          break;
        }
        builder.undo(frame.mark);
      }
      if (placed) fresh = true;
      else {
        frames.pop();
        if (frames.length === 0) return undefined;
        fresh = false;
      }
    }
  };

  const hashOf = (key: string): number => fnv(`${options.seed}:${key}`);
  const thash = new Uint32Array(T);
  for (let t = 0; t < T; t += 1) thash[t] = hashOf(String(t));
  // The greedy loop.
  for (;;) {
    let best = -1;
    let bestLw = Number.NEGATIVE_INFINITY;
    let bestHash = 0;
    for (let t = 0; t < T; t += 1) {
      if (!waiting[t] || !feasible[t]) continue;
      const lw = (targets[t] as Target).lw;
      if (best < 0 || lw > bestLw || (lw === bestLw && (thash[t] as number) < bestHash)) {
        best = t;
        bestLw = lw;
        bestHash = thash[t] as number;
      }
    }
    if (best < 0) break;
    const tg = targets[best] as Target;
    const row = buildRow(
      tg.vars.map((v, k) => [v, tg.vals[k] as number] as [number, number]),
      true,
    );
    if (!row) {
      feasible[best] = 0;
      waiting[best] = 0;
      continue;
    }
    const got = covers(row);
    for (const t of got) waiting[t] = 0;
    let lw = 0;
    row.forEach((x, v) => {
      lw += (s.logShare[v] as number[])[x] as number;
      (seenValue[v] as Uint8Array)[x] = 1;
    });
    newRowsFound.push({ values: row, covers: got, lw, hash: hashOf(row.join(',')) });
  }
  // Warnings for values no valid row can hold.
  if (constrained) {
    for (let v = 0; v < s.ids.length; v += 1) {
      (s.doms[v] as string[]).forEach((id, x) => {
        if ((seenValue[v] as Uint8Array)[x]) return;
        if (!buildRow([[v, x]], false)) warn('value_unreachable', `no valid row holds ${s.ids[v]}=${id}`);
      });
    }
  }
  newRowsFound.sort((a, b) => (a.lw === b.lw ? a.hash - b.hash : b.lw - a.lw));
  const allowed = T - feasible.reduce((n, f) => n + (f ? 0 : 1), 0);
  const keep = Math.min(newRowsFound.length, budgetFor());
  const kept = newRowsFound.slice(0, keep);
  const coveredNow = new Uint8Array(T);
  for (let t = 0; t < T; t += 1) if (coveredBySeeds[t]) coveredNow[t] = 1;
  for (const r of kept) for (const t of r.covers) coveredNow[t] = 1;
  let covered = 0;
  for (let t = 0; t < T; t += 1) if (coveredNow[t] && feasible[t]) covered += 1;
  const rows: PlanRow[] = [...seedRows];
  kept.forEach((r, i) => {
    const values: Row = {};
    r.values.forEach((x, v) => {
      values[s.ids[v] as string] = (s.doms[v] as string[])[x] as string;
    });
    rows.push({
      id: `row.${String(i + 1).padStart(3, '0')}`,
      kind: 'new',
      values,
      logWeight: Number.isFinite(r.lw) ? Number(r.lw.toFixed(9)) : null,
    });
  });
  return { rows, report: { allowed, covered }, warnings };
}

function weightOf(s: Space, cells: Array<[number, number]>): number | null {
  let lw = 0;
  for (const [v, x] of cells) lw += (s.logShare[v] as number[])[x] as number;
  return Number.isFinite(lw) ? Number(lw.toFixed(9)) : null;
}

// ---------------------------------------------------------------------------------------------------------------

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const out = (n: bigint): number | bigint => (n <= SAFE ? Number(n) : n);

function elementary(arities: number[], k: number): bigint {
  const e = new Array<bigint>(k + 1).fill(0n);
  e[0] = 1n;
  for (const a of arities)
    for (let j = k; j >= 1; j -= 1) e[j] = (e[j] as bigint) + (e[j - 1] as bigint) * BigInt(a);
  return e[k] as bigint;
}

function choose(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let c = 1n;
  for (let i = 1; i <= k; i += 1) c = (c * BigInt(n - k + i)) / BigInt(i);
  return c;
}

export function coverage(
  store: StoreDoc,
  rows: Row[],
  groups: Group[],
  options?: { uncovered?: number },
): CoverageResult {
  const s = spaceOf(store);
  for (const g of groups) {
    const seen = new Set<string>();
    for (const id of g.variables) {
      if (!s.index.has(id)) throw new RangeError(`unknown variable ${id} in a group`);
      if (seen.has(id)) throw new RangeError(`duplicate variable ${id} in a group`);
      seen.add(id);
    }
    if (typeof g.strength !== 'number' || !Number.isInteger(g.strength) || g.strength <= 0)
      throw new RangeError(`strength must be a positive whole number, got ${String(g.strength)}`);
  }
  const sizeOf = (g: Group): number => Math.min(g.strength, g.variables.length);
  const constrained = s.forbids.length > 0 && !mutation.ignoreExtension;
  const enumerateLimit = 3_000_000;
  const arity = (id: string): number => (s.doms[s.index.get(id) as number] as string[]).length;
  const fullInDomain = (r: Row, ids: string[]): boolean =>
    ids.every(
      (id) =>
        r[id] !== undefined &&
        (s.valueIndex[s.index.get(id) as number] as Map<string, number>).has(r[id] as string),
    );

  const wantUncovered = options?.uncovered;
  const total = groups.reduce((n, g) => n + Number(choose(g.variables.length, sizeOf(g))), 0);
  if (
    !constrained &&
    groups.length === 1 &&
    wantUncovered === undefined &&
    (rows.length === 0 || total > enumerateLimit)
  ) {
    const g = groups[0] as Group;
    const k = sizeOf(g);
    const allowed = elementary(g.variables.map(arity), k);
    // Rows that assign every variable of the group: inclusion and exclusion over the distinct rows.
    const distinct = new Map<string, Row>();
    for (const r of rows)
      if (fullInDomain(r, g.variables)) distinct.set(g.variables.map((id) => r[id]).join('\u0001'), r);
    const list = [...distinct.values()];
    if (list.length > 14) throw new Error('the reference counts at most 14 distinct rows in closed form');
    let covered = 0n;
    for (let mask = 1; mask < 1 << list.length; mask += 1) {
      const chosen = list.filter((_, i) => mask & (1 << i));
      const agree = g.variables.filter((id) => chosen.every((r) => r[id] === (chosen[0] as Row)[id])).length;
      const term = choose(agree, k);
      covered += chosen.length % 2 === 1 ? term : -term;
    }
    return { allowed: out(allowed), covered: out(covered) };
  }
  // One group, no constraints, rows that assign every variable of the group: count the distinct patterns of each
  // subset with integer codes (the general path below builds a string for every subset and row).
  if (!constrained && groups.length === 1 && wantUncovered === undefined) {
    const g = groups[0] as Group;
    const k = sizeOf(g);
    const arities = g.variables.map(arity);
    const radix = arities.slice().sort((a, b) => b - a);
    let widest = 1;
    for (let i = 0; i < k; i += 1) widest *= radix[i] as number;
    const full = rows.filter((r) => fullInDomain(r, g.variables));
    if (full.length === rows.length && widest < 2 ** 52) {
      const table = full.map((r) =>
        g.variables.map(
          (id) =>
            (s.valueIndex[s.index.get(id) as number] as Map<string, number>).get(r[id] as string) as number,
        ),
      );
      const n = g.variables.length;
      const idx = Array.from({ length: k }, (_, i) => i);
      let covered = 0;
      const seen = new Set<number>();
      for (;;) {
        seen.clear();
        for (const row of table) {
          let code = 0;
          for (let j = 0; j < k; j += 1)
            code = code * (arities[idx[j] as number] as number) + (row[idx[j] as number] as number);
          seen.add(code);
        }
        covered += seen.size;
        let j = k - 1;
        while (j >= 0 && idx[j] === n - k + j) j -= 1;
        if (j < 0) break;
        idx[j] = (idx[j] as number) + 1;
        for (let m = j + 1; m < k; m += 1) idx[m] = (idx[m - 1] as number) + 1;
      }
      return { allowed: out(elementary(arities, k)), covered };
    }
  }
  // Enumerated counting.
  const subsetsSeen = new Map<string, string[]>();
  for (const g of groups) {
    const k = sizeOf(g);
    if (Number(choose(g.variables.length, k)) > enumerateLimit)
      throw new Error('the reference enumerates at most 3,000,000 subsets');
    const idx = g.variables.map((_, i) => i);
    for (const sub of subsets(idx, k)) {
      const ids = sub.map((i) => g.variables[i] as string).sort();
      subsetsSeen.set(ids.join('\u0001'), ids);
    }
  }
  let allowedKeys: Set<string> | undefined;
  let allowedCount = 0n;
  if (!constrained) {
    for (const ids of subsetsSeen.values()) allowedCount += ids.reduce((p, id) => p * BigInt(arity(id)), 1n);
  } else {
    let size = 1;
    for (const d of s.doms) size *= d.length;
    if (size > 400_000) throw new Error('the reference enumerates at most 400,000 rows');
    allowedKeys = new Set<string>();
    const cur = new Array<number>(s.ids.length).fill(-1);
    const walk = (v: number): void => {
      if (v === s.ids.length) {
        for (const ids of subsetsSeen.values())
          allowedKeys?.add(
            `${ids.join('\u0001')}|${ids.map((id) => cur[s.index.get(id) as number]).join(',')}`,
          );
        return;
      }
      for (let x = 0; x < (s.doms[v] as string[]).length; x += 1) {
        cur[v] = x;
        const cut = s.forbids.some((f) => f.every(([fv, fx]) => cur[fv] === fx));
        if (!cut) walk(v + 1);
      }
      cur[v] = -1;
    };
    walk(0);
    allowedCount = BigInt(allowedKeys.size);
  }
  const coveredKeys = new Set<string>();
  for (const [key, ids] of subsetsSeen) {
    for (const r of rows) {
      if (!fullInDomain(r, ids)) continue;
      const pattern = ids
        .map((id) => (s.valueIndex[s.index.get(id) as number] as Map<string, number>).get(r[id] as string))
        .join(',');
      const full = `${key}|${pattern}`;
      if (allowedKeys && !allowedKeys.has(full)) continue;
      coveredKeys.add(full);
    }
  }
  const result: CoverageResult = { allowed: out(allowedCount), covered: coveredKeys.size };
  if (wantUncovered !== undefined) {
    const list: Row[] = [];
    const pool: Iterable<string> = allowedKeys ?? lazyAll(subsetsSeen, arity);
    for (const full of pool) {
      if (list.length >= wantUncovered) break;
      if (coveredKeys.has(full)) continue;
      const [key, pattern] = full.split('|') as [string, string];
      const ids = key.split('\u0001');
      const vals = pattern.split(',').map(Number);
      const row: Row = {};
      ids.forEach((id, i) => {
        row[id] = (s.doms[s.index.get(id) as number] as string[])[vals[i] as number] as string;
      });
      list.push(row);
    }
    result.uncovered = list;
  }
  return result;
}

function* lazyAll(subsetsSeen: Map<string, string[]>, arity: (id: string) => number): Generator<string> {
  for (const [key, ids] of subsetsSeen) {
    const sizes = ids.map(arity);
    const vals = new Array<number>(ids.length).fill(0);
    for (;;) {
      yield `${key}|${vals.join(',')}`;
      let k = ids.length - 1;
      while (k >= 0 && (vals[k] as number) === (sizes[k] as number) - 1) {
        vals[k] = 0;
        k -= 1;
      }
      if (k < 0) break;
      vals[k] = (vals[k] as number) + 1;
    }
  }
}
