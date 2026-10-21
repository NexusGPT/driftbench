import type { VariableStore } from './schema';

/**
 * The tuple counter of the variable store (docs/variables.md R12). A group names variables and a strength t; its
 * tuples are the combinations of values of every `min(t, k)` of its k variables. A tuple is allowed when some
 * valid full row holds it: a full row gives each variable one value that counts (its own approval flag, else its
 * variable's) and holds no approved constraint. The counter returns how many distinct allowed tuples the groups
 * hold and how many of them the rows hold. A row covers a tuple only when it assigns every variable of the tuple.
 * Two groups that share a tuple count it once, and a repeated row counts once.
 *
 * The allowed count is a formula whenever the space allows one, so a space of hundreds of variables is counted
 * without listing a tuple: the elementary symmetric polynomial of the arities when nothing is forbidden, and a
 * product of small polynomials when the forbidden combinations are pairs on disjoint pairs of variables. Any other
 * space is enumerated, under a work limit that names itself when it is crossed.
 */

export type TupleGroup = { variables: readonly string[]; strength: number };

/** The counts are numbers while they are exact as numbers, and bigint beyond 2^53. */
export type TupleCount = {
  allowed: number | bigint;
  covered: number | bigint;
  /** Allowed tuples no row holds, as variable id to value id: at most `options.uncovered`. */
  uncovered?: Array<Record<string, string>>;
};

export type TupleCountOptions = {
  /** List up to this many uncovered tuples (distinct, allowed, held by no row). Absent: no list. */
  uncovered?: number;
};

/** The most distinct subsets of variables the counter lists, and the most tuples it tests, before it refuses. */
const MAX_SUBSETS = 3_000_000;
const MAX_TUPLES = 20_000_000;
const MAX_ROW_WORK = 200_000_000;
const MAX_SEARCH_STEPS = 5_000_000;

type Cell = readonly [variable: number, value: number];

const fit = (value: bigint): number | bigint =>
  value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;

function* combinations(n: number, k: number): Generator<number[]> {
  if (k > n || k < 0) return;
  const index = Array.from({ length: k }, (_, i) => i);
  if (k === 0) {
    yield [];
    return;
  }
  for (;;) {
    yield [...index];
    let i = k - 1;
    while (i >= 0 && index[i] === n - k + i) i -= 1;
    if (i < 0) return;
    index[i] = (index[i] as number) + 1;
    for (let j = i + 1; j < k; j += 1) index[j] = (index[j - 1] as number) + 1;
  }
}

/** n choose k as a bigint. */
function choose(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let result = 1n;
  for (let i = 1; i <= k; i += 1) result = (result * BigInt(n - k + i)) / BigInt(i);
  return result;
}

type Space = {
  names: string[];
  /** Per variable: the value ids that count, in store order. */
  values: string[][];
  /** Per variable: which value indexes are forbidden on their own. */
  banned: boolean[][];
  /** Per variable: the number of values that count and are not forbidden on their own. */
  arity: number[];
  /** Constraints of two or more cells, none of them on a forbidden value. */
  constraints: Cell[][];
  /** For a (variable, value) cell: the constraints that name it. */
  byCell: Map<number, Cell[][]>;
  stride: number;
  /** Every variable has a value that no constraint names, so a tuple without a violation always extends. */
  universal: boolean;
};

function spaceOf(store: VariableStore): Space {
  const names = store.variables.map((variable) => variable.id);
  const index = new Map(names.map((name, i) => [name, i] as const));
  const values = store.variables.map((variable) =>
    variable.values.filter((value) => value.approved ?? variable.approved).map((value) => value.id),
  );
  const valueIndex = values.map((list) => new Map(list.map((id, j) => [id, j] as const)));
  const banned = values.map((list) => list.map(() => false));
  const seen = new Set<string>();
  const multi: Cell[][] = [];
  for (const constraint of store.constraints ?? []) {
    if (!constraint.approved) continue;
    const cells: Cell[] = [];
    let known = true;
    for (const [name, id] of Object.entries(constraint.forbid)) {
      const v = index.get(name);
      const j = v === undefined ? undefined : valueIndex[v]?.get(id);
      if (v === undefined || j === undefined) {
        known = false;
        break;
      }
      cells.push([v, j]);
    }
    if (!known || cells.length === 0) continue;
    if (cells.length === 1) {
      const [v, j] = cells[0] as Cell;
      (banned[v] as boolean[])[j] = true;
      continue;
    }
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const key = cells.map(([v, j]) => `${v}:${j}`).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    multi.push(cells);
  }
  // Two cells on one variable never hold together: that constraint excludes nothing. A cell on a forbidden value
  // makes the constraint moot.
  const constraints = multi.filter(
    (cells) =>
      new Set(cells.map(([v]) => v)).size === cells.length &&
      cells.every(([v, j]) => !(banned[v] as boolean[])[j]),
  );
  const arity = banned.map((flags) => flags.filter((flag) => !flag).length);
  const stride = Math.max(1, ...values.map((list) => list.length));
  const byCell = new Map<number, Cell[][]>();
  for (const cells of constraints) {
    for (const [v, j] of cells) {
      const key = v * stride + j;
      const list = byCell.get(key);
      if (list) list.push(cells);
      else byCell.set(key, [cells]);
    }
  }
  const universal = names.every((_, v) =>
    (banned[v] as boolean[]).some((flag, j) => !flag && !byCell.has(v * stride + j)),
  );
  return { names, values, banned, arity, constraints, byCell, stride, universal };
}

function checkGroups(space: Space, groups: readonly TupleGroup[], options: TupleCountOptions): number[][] {
  const index = new Map(space.names.map((name, i) => [name, i] as const));
  if (options.uncovered !== undefined && !(Number.isInteger(options.uncovered) && options.uncovered >= 0)) {
    throw new RangeError(`uncovered must be a whole number from 0 up, got ${String(options.uncovered)}`);
  }
  return groups.map((group) => {
    if (!Number.isInteger(group.strength) || group.strength < 1) {
      throw new RangeError(`strength must be a positive whole number, got ${String(group.strength)}`);
    }
    if (!Array.isArray(group.variables) || group.variables.length === 0) {
      throw new RangeError('variables must list at least one variable id');
    }
    const picked: number[] = [];
    const taken = new Set<number>();
    for (const name of group.variables) {
      const v = index.get(name);
      if (v === undefined) throw new RangeError(`unknown variable ${String(name)}`);
      if (taken.has(v)) throw new RangeError(`variable ${String(name)} is listed twice in a group`);
      taken.add(v);
      picked.push(v);
    }
    return picked.sort((a, b) => a - b);
  });
}

/** Whether some valid full row holds the given cells. The search stops with an error past its step limit. */
function extendable(space: Space, cells: readonly Cell[]): boolean {
  const n = space.names.length;
  const assign = new Int32Array(n).fill(-1);
  const violates = (v: number, j: number): boolean => {
    const list = space.byCell.get(v * space.stride + j);
    if (!list) return false;
    for (const constraint of list) {
      if (constraint.every(([cv, cj]) => (cv === v && cj === j) || assign[cv] === cj)) return true;
    }
    return false;
  };
  for (const [v, j] of cells) {
    if ((space.banned[v] as boolean[])[j]) return false;
    if (assign[v] !== -1 && assign[v] !== j) return false;
    if (violates(v, j)) return false;
    assign[v] = j;
  }
  const open = Array.from({ length: n }, (_, v) => v)
    .filter((v) => assign[v] === -1)
    .sort((a, b) => (space.arity[a] as number) - (space.arity[b] as number));
  let steps = 0;
  const search = (at: number): boolean => {
    if (at === open.length) return true;
    const v = open[at] as number;
    for (let j = 0; j < (space.values[v] as string[]).length; j += 1) {
      if ((space.banned[v] as boolean[])[j]) continue;
      steps += 1;
      if (steps > MAX_SEARCH_STEPS) {
        throw new RangeError(
          'the constraints are too tangled to decide whether a tuple extends to a valid row: use fewer constraints',
        );
      }
      if (violates(v, j)) continue;
      assign[v] = j;
      if (search(at + 1)) return true;
      assign[v] = -1;
    }
    return false;
  };
  return search(0);
}

/** Whether a tuple is allowed: it holds no constraint, and some valid full row holds it. */
function allowedTuple(space: Space, subset: readonly number[], tuple: readonly number[]): boolean {
  const cells: Cell[] = subset.map((v, i) => [v, tuple[i] as number] as const);
  if (space.universal) {
    for (const [v, j] of cells) {
      if ((space.banned[v] as boolean[])[j]) return false;
      const list = space.byCell.get(v * space.stride + j);
      if (!list) continue;
      for (const constraint of list) {
        if (constraint.every(([cv, cj]) => cells.some(([tv, tj]) => tv === cv && tj === cj))) return false;
      }
    }
    return true;
  }
  return extendable(space, cells);
}

/** The elementary symmetric polynomial e_m of the arities, exact. */
function symmetric(arities: readonly number[], m: number): bigint {
  const e: bigint[] = Array.from({ length: m + 1 }, () => 0n);
  e[0] = 1n;
  for (const arity of arities) {
    const a = BigInt(arity);
    for (let j = m; j >= 1; j -= 1) e[j] = (e[j] as bigint) + (e[j - 1] as bigint) * a;
  }
  return e[m] as bigint;
}

/** When every multi-cell constraint is a pair on two variables and no variable has two partners, the pairs of the matching. */
function matching(space: Space): Map<number, { partner: number; forbidden: number }> | undefined {
  const partner = new Map<number, number>();
  const count = new Map<string, number>();
  for (const cells of space.constraints) {
    if (cells.length !== 2) return undefined;
    const [[u], [v]] = cells as [Cell, Cell];
    if (partner.get(u) !== undefined && partner.get(u) !== v) return undefined;
    if (partner.get(v) !== undefined && partner.get(v) !== u) return undefined;
    partner.set(u, v);
    partner.set(v, u);
    const key = `${Math.min(u, v)}:${Math.max(u, v)}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const out = new Map<number, { partner: number; forbidden: number }>();
  for (const [u, v] of partner) {
    out.set(u, { partner: v, forbidden: count.get(`${Math.min(u, v)}:${Math.max(u, v)}`) ?? 0 });
  }
  return out;
}

/** The coefficient of z^m in the product of the factors of a group's variables, exact. */
function matchedCount(space: Space, group: readonly number[], m: number, pairs: ReturnType<typeof matching>): bigint {
  const inGroup = new Set(group);
  let poly: bigint[] = Array.from({ length: m + 1 }, () => 0n);
  poly[0] = 1n;
  const times = (factor: readonly bigint[]) => {
    const next: bigint[] = Array.from({ length: m + 1 }, () => 0n);
    for (let i = 0; i <= m; i += 1) {
      if (poly[i] === 0n) continue;
      for (let j = 0; j < factor.length && i + j <= m; j += 1) {
        next[i + j] = (next[i + j] as bigint) + (poly[i] as bigint) * (factor[j] as bigint);
      }
    }
    poly = next;
  };
  for (const v of group) {
    const mate = pairs?.get(v);
    const a = BigInt(space.arity[v] as number);
    if (mate === undefined || !inGroup.has(mate.partner)) {
      times([1n, a]);
    } else if (v < mate.partner) {
      const b = BigInt(space.arity[mate.partner] as number);
      times([1n, a + b, a * b - BigInt(mate.forbidden)]);
    }
  }
  return poly[m] as bigint;
}

/** The distinct subsets of all groups, each once, in group order. */
function* subsetsOf(groups: readonly number[][], strengths: readonly number[]): Generator<number[]> {
  const seen = groups.length > 1 ? new Set<string>() : undefined;
  let listed = 0;
  for (const [g, group] of groups.entries()) {
    const m = Math.min(strengths[g] as number, group.length);
    for (const picked of combinations(group.length, m)) {
      const subset = picked.map((i) => group[i] as number);
      if (seen) {
        const key = subset.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
      }
      listed += 1;
      if (listed > MAX_SUBSETS) {
        throw new RangeError(
          `the groups hold more than ${MAX_SUBSETS} subsets of variables to list: lower the strength or the groups`,
        );
      }
      yield subset;
    }
  }
}

/** Whether two groups can share a subset: same size of subset and at least that many variables in common. */
function overlap(groups: readonly number[][], strengths: readonly number[]): boolean {
  for (let a = 0; a < groups.length; a += 1) {
    for (let b = a + 1; b < groups.length; b += 1) {
      const ma = Math.min(strengths[a] as number, (groups[a] as number[]).length);
      const mb = Math.min(strengths[b] as number, (groups[b] as number[]).length);
      if (ma !== mb) continue;
      const other = new Set(groups[b]);
      const shared = (groups[a] as number[]).filter((v) => other.has(v)).length;
      if (shared >= ma) return true;
    }
  }
  return false;
}

/** Every tuple of the allowed values of a subset, as value indexes in order. */
function* tuplesOf(space: Space, subset: readonly number[]): Generator<number[]> {
  const options = subset.map((v) =>
    (space.values[v] as string[]).map((_, j) => j).filter((j) => !(space.banned[v] as boolean[])[j]),
  );
  if (options.some((list) => list.length === 0)) return;
  const at = options.map(() => 0);
  for (;;) {
    yield at.map((position, i) => (options[i] as number[])[position] as number);
    let i = options.length - 1;
    while (i >= 0 && at[i] === (options[i] as number[]).length - 1) {
      at[i] = 0;
      i -= 1;
    }
    if (i < 0) return;
    at[i] = (at[i] as number) + 1;
  }
}

/** The allowed count by enumeration of every distinct subset and every tuple of values. */
function enumerated(space: Space, groups: readonly number[][], strengths: readonly number[]): bigint {
  let total = 0n;
  let work = 0n;
  for (const subset of subsetsOf(groups, strengths)) {
    let product = 1n;
    for (const v of subset) product *= BigInt(space.arity[v] as number);
    work += product;
    if (work > BigInt(MAX_TUPLES)) {
      throw new RangeError(
        `the groups hold more than ${MAX_TUPLES} tuples to test under these constraints: lower the strength or the groups`,
      );
    }
    for (const tuple of tuplesOf(space, subset)) if (allowedTuple(space, subset, tuple)) total += 1n;
  }
  return total;
}

function allowedCount(space: Space, groups: readonly number[][], strengths: readonly number[]): bigint {
  if (space.arity.some((a) => a === 0)) return 0n;
  const plain = space.constraints.length === 0;
  const apart = !overlap(groups, strengths);
  const sizes = groups.map((group, g) => Math.min(strengths[g] as number, group.length));
  if (plain && apart) {
    return groups.reduce(
      (sum, group, g) =>
        sum +
        symmetric(
          group.map((v) => space.arity[v] as number),
          sizes[g] as number,
        ),
      0n,
    );
  }
  if (space.universal && apart) {
    const pairs = matching(space);
    if (pairs) {
      return groups.reduce(
        (sum, group, g) => sum + matchedCount(space, group, sizes[g] as number, pairs),
        0n,
      );
    }
  }
  if (plain) {
    // Overlapping groups with nothing forbidden: the distinct subsets are listed, each counted by its product.
    let total = 0n;
    for (const subset of subsetsOf(groups, strengths)) {
      let product = 1n;
      for (const v of subset) product *= BigInt(space.arity[v] as number);
      total += product;
    }
    return total;
  }
  return enumerated(space, groups, strengths);
}

type RowCodes = Int32Array[];

function rowCodes(space: Space, rows: readonly Record<string, string>[]): RowCodes {
  const index = new Map(space.names.map((name, i) => [name, i] as const));
  const valueIndex = space.values.map((list) => new Map(list.map((id, j) => [id, j] as const)));
  return rows.map((row) => {
    const codes = new Int32Array(space.names.length).fill(-1);
    for (const [name, id] of Object.entries(row)) {
      const v = index.get(name);
      if (v === undefined) continue;
      const j = (valueIndex[v] as Map<string, number>).get(id);
      if (j !== undefined) codes[v] = j;
    }
    return codes;
  });
}

/** The distinct tuples (as value indexes) the rows hold on a subset. */
function heldOn(space: Space, codes: RowCodes, subset: readonly number[]): Map<string, number[]> {
  const held = new Map<string, number[]>();
  for (const row of codes) {
    const tuple: number[] = [];
    let whole = true;
    for (const v of subset) {
      const j = row[v] as number;
      if (j < 0) {
        whole = false;
        break;
      }
      tuple.push(j);
    }
    if (!whole) continue;
    const key = tuple.join(',');
    if (!held.has(key)) held.set(key, tuple);
  }
  void space;
  return held;
}

/** The most distinct rows the formula for covered tuples takes: it sums over the subsets of the rows. */
const MAX_FORMULA_ROWS = 14;

/**
 * Covered tuples when nothing is forbidden and the groups share no subset: every tuple a row holds is allowed, so
 * the count is the number of distinct tuples the rows hold, without listing a subset. A row adds the subsets of the
 * variables it assigns that no earlier row agrees with on all of them. With A_i the variables row i assigns to a
 * value that counts, and A_ij those where rows i and j assign the same value, the subsets of size m inside A_i and
 * inside no A_ij (j before i) are counted by inclusion and exclusion over the earlier rows.
 */
function coveredFormula(
  space: Space,
  codes: RowCodes,
  groups: readonly number[][],
  strengths: readonly number[],
): bigint | undefined {
  const rows: Int32Array[] = [];
  const keys = new Set<string>();
  for (const row of codes) {
    const clean = Int32Array.from(row, (j, v) => (j >= 0 && !(space.banned[v] as boolean[])[j] ? j : -1));
    const key = clean.join(',');
    if (keys.has(key)) continue;
    keys.add(key);
    rows.push(clean);
  }
  if (rows.length > MAX_FORMULA_ROWS) return undefined;
  let total = 0n;
  groups.forEach((group, g) => {
    const m = Math.min(strengths[g] as number, group.length);
    rows.forEach((row, i) => {
      const own = group.filter((v) => (row[v] as number) >= 0);
      const agree = rows.slice(0, i).map((earlier) => own.filter((v) => earlier[v] === row[v]));
      for (let mask = 0; mask < 1 << agree.length; mask += 1) {
        let common = own;
        let sign = 1n;
        for (let j = 0; j < agree.length; j += 1) {
          if (!(mask & (1 << j))) continue;
          const set = new Set(agree[j]);
          common = common.filter((v) => set.has(v));
          sign = -sign;
        }
        total += sign * choose(common.length, m);
      }
    });
  });
  return total;
}

function coveredCount(
  space: Space,
  codes: RowCodes,
  groups: readonly number[][],
  strengths: readonly number[],
): bigint {
  if (codes.length === 0 || space.arity.some((a) => a === 0)) return 0n;
  if (space.constraints.length === 0 && !overlap(groups, strengths)) {
    const formula = coveredFormula(space, codes, groups, strengths);
    if (formula !== undefined) return formula;
  }
  let subsets = 0n;
  groups.forEach((group, g) => {
    subsets += choose(group.length, Math.min(strengths[g] as number, group.length));
  });
  if (subsets * BigInt(codes.length) > BigInt(MAX_ROW_WORK)) {
    throw new RangeError(
      `the groups hold too many subsets to compare with ${codes.length} rows: lower the strength or the groups`,
    );
  }
  let covered = 0n;
  for (const subset of subsetsOf(groups, strengths)) {
    for (const tuple of heldOn(space, codes, subset).values()) {
      if (allowedTuple(space, subset, tuple)) covered += 1n;
    }
  }
  return covered;
}

function uncoveredList(
  space: Space,
  codes: RowCodes,
  groups: readonly number[][],
  strengths: readonly number[],
  limit: number,
): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  if (limit === 0 || space.arity.some((a) => a === 0)) return out;
  for (const subset of subsetsOf(groups, strengths)) {
    const held = heldOn(space, codes, subset);
    for (const tuple of tuplesOf(space, subset)) {
      if (held.has(tuple.join(','))) continue;
      if (!allowedTuple(space, subset, tuple)) continue;
      out.push(
        Object.fromEntries(
          subset.map((v, i) => [space.names[v] as string, (space.values[v] as string[])[tuple[i] as number] as string]),
        ),
      );
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Counts the distinct allowed tuples of the groups and the ones the rows hold (docs/variables.md R12). A group with
 * an unknown or repeated variable, a strength that is not a positive whole number, or no variable throws a
 * RangeError that names the argument.
 */
export function countVariableTuples(
  store: VariableStore,
  rows: readonly Record<string, string>[],
  groups: readonly TupleGroup[],
  options: TupleCountOptions = {},
): TupleCount {
  const space = spaceOf(store);
  const lists = checkGroups(space, groups, options);
  const strengths = groups.map((group) => group.strength);
  const allowed = allowedCount(space, lists, strengths);
  const codes = rowCodes(space, rows);
  const covered = coveredCount(space, codes, lists, strengths);
  const result: TupleCount = { allowed: fit(allowed), covered: fit(covered) };
  if (options.uncovered !== undefined) {
    result.uncovered = uncoveredList(space, codes, lists, strengths, options.uncovered);
  }
  return result;
}
