/**
 * Selection of a golden set (G7): the smallest set of conversations that covers the declared cells,
 * then the k best when k is smaller than that cover. Pure: reads nothing, never throws on its input.
 *
 * - The cover is greedy set cover (Chvatal): at each step the spec that adds the most uncovered required
 *   cells, then the most uncovered cells. Ties go to the spec that turns the most faults red that no chosen
 *   spec turns red yet, then to the pool order. The cover stops when no spec adds a cell or a required cell.
 * - The k best is greedy maximum coverage with a budget of k specs, ranked in tiers: new required cells
 *   first, then new faults turned red (the mutation evidence of the gate report), then new cells. A fault
 *   no chosen conversation detects outranks any number of cells: a golden set exists to say what is wrong.
 * - Both are deterministic: the same pool, cells and evidence give the same picks in the same order.
 */

import { coverWork } from './cover-meter';

/** One thing a golden set should hold: an allowed cell, or a required cell, and the specs that cover it. */
export type CoverElement = {
  /** A stable key, unique within its list. */
  key: string;
  /** How the cover table names it. */
  label: string;
  specs: readonly string[];
};

export type CoverInput = {
  /** The spec ids of the pool. Ties go to the earlier id in this order. */
  pool: readonly string[];
  /** The allowed cells at the strength of the selection. A cell no spec covers stays uncovered. */
  cells: readonly CoverElement[];
  /** The required cells: the map's required values and the flow deviations the inventory requires. */
  required: readonly CoverElement[];
  /** The faults each spec turns red, from the gate report. Absent or empty when there is no evidence. */
  evidence?: ReadonlyMap<string, readonly string[]>;
  /** The size of the golden set. Without it, the golden set is the whole cover. */
  k?: number;
};

/** One spec of a selection, in the order it was picked, and what it adds to the specs before it. */
export type Pick = {
  id: string;
  /** The labels of the required cells it adds. */
  required: string[];
  /** The number of cells it adds. */
  cells: number;
  /** The faults it adds: red on this spec and on no spec picked before it. */
  faults: string[];
  /** Cells covered by this spec and the ones before it. */
  cumulative: number;
};

export type Selection = {
  /** The greedy cover: every coverable cell and required cell, in pick order. */
  cover: Pick[];
  /** The golden set: the cover, or the k best when k is smaller than the cover. */
  golden: Pick[];
  /** True when k cut the cover: the golden set is the k best, ranked by required cells, faults, cells. */
  kBest: boolean;
  /** What the whole pool covers: the ceiling of any selection. */
  pool: { specs: number; cells: number; required: number; faults: number };
  /** What the golden set covers. */
  covered: { cells: number; required: number; faults: number };
  /** All allowed cells and all required cells, covered or not. */
  totals: { cells: number; required: number };
  /** Required cells no spec of the pool covers. */
  uncoverable: string[];
  /** Required cells the pool covers and the golden set does not (k too small). */
  missed: string[];
};

type Tier = Map<string, number[]>;

/** Selects a golden set. Pure. */
export function selectGolden(input: CoverInput): Selection {
  const pool = [...new Set(input.pool)];
  const inPool = new Set(pool);
  const cells = membership(input.cells, inPool);
  const required = membership(input.required, inPool);
  const evidence = input.evidence;
  const faultIds = evidence ? [...new Set(pool.flatMap((id) => evidence.get(id) ?? []))].sort() : [];
  const faultIndex = new Map(faultIds.map((id, index) => [id, index]));
  const faults: Tier = new Map();
  if (evidence) {
    for (const id of pool) {
      const found = evidence.get(id);
      if (!found?.length) continue;
      faults.set(
        id,
        [...new Set(found)].flatMap((fault) => {
          const index = faultIndex.get(fault);
          return index === undefined ? [] : [index];
        }),
      );
    }
  }

  const coverOrder = greedy(pool, [required, cells, faults], 2, Number.POSITIVE_INFINITY);
  const k = input.k;
  const kBest = k !== undefined && k < coverOrder.length;
  const goldenOrder = kBest ? greedy(pool, [required, faults, cells], 3, k) : coverOrder;

  const describe = (order: readonly string[]): Pick[] => {
    const seenCells = new Set<number>();
    const seenRequired = new Set<number>();
    const seenFaults = new Set<number>();
    return order.map((id) => {
      const addRequired = newlyCovered(required.get(id), seenRequired);
      const addCells = newlyCovered(cells.get(id), seenCells);
      const addFaults = newlyCovered(faults.get(id), seenFaults);
      return {
        id,
        required: addRequired.map((index) => input.required[index]?.label ?? String(index)),
        cells: addCells.length,
        faults: addFaults.map((index) => faultIds[index] ?? String(index)),
        cumulative: seenCells.size,
      };
    });
  };

  const cover = describe(coverOrder);
  const golden = kBest ? describe(goldenOrder) : cover;
  const reach = (tier: Tier, order: readonly string[]) => {
    const seen = new Set<number>();
    for (const id of order) {
      const members = tier.get(id);
      if (members) for (const index of members) seen.add(index);
    }
    return seen;
  };
  const poolRequired = reach(required, pool);
  const goldenRequired = reach(required, goldenOrder);
  return {
    cover,
    golden,
    kBest,
    pool: {
      specs: pool.length,
      cells: reach(cells, pool).size,
      required: poolRequired.size,
      faults: faultIds.length,
    },
    covered: {
      cells: reach(cells, goldenOrder).size,
      required: goldenRequired.size,
      faults: reach(faults, goldenOrder).size,
    },
    totals: { cells: input.cells.length, required: input.required.length },
    uncoverable: input.required.flatMap((element, index) => (poolRequired.has(index) ? [] : [element.label])),
    missed: input.required.flatMap((element, index) =>
      poolRequired.has(index) && !goldenRequired.has(index) ? [element.label] : [],
    ),
  };
}

/** Records the new memberships without temporary filter callbacks and fallback arrays per pick. */
function newlyCovered(members: readonly number[] | undefined, seen: Set<number>): number[] {
  const added: number[] = [];
  if (members) {
    for (const index of members) {
      if (seen.has(index)) continue;
      seen.add(index);
      added.push(index);
    }
  }
  return added;
}

/** For each spec of the pool, the indices of the elements it covers. */
function membership(elements: readonly CoverElement[], pool: ReadonlySet<string>): Tier {
  const tier: Tier = new Map();
  elements.forEach((element, index) => {
    for (const id of element.specs) {
      if (!pool.has(id)) continue;
      const held = tier.get(id) ?? [];
      // Elements are visited in order. A repeated spec in this element has this index already last.
      if (held[held.length - 1] === index) continue;
      held.push(index);
      tier.set(id, held);
    }
  });
  return tier;
}

/**
 * Greedy picks over ranked tiers. Each step takes the spec whose gains, read tier by tier, are largest;
 * equal gains go to the earlier spec of the pool. The first `goals` tiers decide when to stop: a spec that
 * adds nothing on them is never picked, and the picks stop at `limit`.
 */
function greedy(pool: readonly string[], tiers: readonly Tier[], goals: number, limit: number): string[] {
  const covered = tiers.map(() => new Set<number>());
  const gainsOf = (id: string, gains: number[] = []): number[] => {
    for (let position = 0; position < tiers.length; position += 1) {
      let gain = 0;
      const members = tiers[position]?.get(id);
      if (members) for (const index of members) if (!covered[position]?.has(index)) gain += 1;
      gains[position] = gain;
    }
    return gains;
  };
  // Lazy greedy: a gain only falls as cells get covered, so the stored gains of a candidate are an upper
  // bound. The candidate on top is re-read; if it still leads, no other candidate can beat it. The picks
  // and the ties (the earlier spec of the pool) are those of a full scan at every step.
  type Entry = { id: string; order: number; gains: number[] };
  const heap: Entry[] = [];
  const before = (x: Entry, y: Entry) => {
    coverWork.comparisons += 1;
    for (let position = 0; position < x.gains.length; position += 1) {
      const left = x.gains[position] ?? 0;
      const right = y.gains[position] ?? 0;
      if (left !== right) return left > right;
    }
    return x.order < y.order;
  };
  const swap = (a: number, b: number) => {
    const held = heap[a] as Entry;
    heap[a] = heap[b] as Entry;
    heap[b] = held;
  };
  const up = (from: number) => {
    let i = from;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i] as Entry, heap[parent] as Entry)) break;
      swap(i, parent);
      i = parent;
    }
  };
  const down = (from: number) => {
    let i = from;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let top = i;
      if (l < heap.length && before(heap[l] as Entry, heap[top] as Entry)) top = l;
      if (r < heap.length && before(heap[r] as Entry, heap[top] as Entry)) top = r;
      if (top === i) return;
      swap(i, top);
      i = top;
    }
  };
  pool.forEach((id, order) => {
    heap.push({ id, order, gains: gainsOf(id) });
    up(heap.length - 1);
  });
  const chosen: string[] = [];
  while (chosen.length < limit && heap.length > 0) {
    const top = heap[0] as Entry;
    gainsOf(top.id, top.gains);
    down(0);
    if (heap[0] !== top) continue;
    let contributes = false;
    for (let position = 0; position < goals; position += 1) {
      if (top.gains[position] !== 0) contributes = true;
    }
    if (!contributes) break;
    heap[0] = heap[heap.length - 1] as Entry;
    heap.pop();
    down(0);
    chosen.push(top.id);
    for (let position = 0; position < tiers.length; position += 1) {
      const members = tiers[position]?.get(top.id);
      if (members) for (const index of members) covered[position]?.add(index);
    }
  }
  return chosen;
}
