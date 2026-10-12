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
  const faultIds = [...new Set(pool.flatMap((id) => [...(input.evidence?.get(id) ?? [])]))].sort();
  const faultIndex = new Map(faultIds.map((id, index) => [id, index]));
  const faults: Tier = new Map(
    pool.map((id) => [
      id,
      [...new Set(input.evidence?.get(id) ?? [])].flatMap((fault) => {
        const index = faultIndex.get(fault);
        return index === undefined ? [] : [index];
      }),
    ]),
  );

  const coverOrder = greedy(pool, [required, cells, faults], 2, Number.POSITIVE_INFINITY);
  const k = input.k;
  const kBest = k !== undefined && k < coverOrder.length;
  const goldenOrder = kBest ? greedy(pool, [required, faults, cells], 3, k) : coverOrder;

  const describe = (order: readonly string[]): Pick[] => {
    const seenCells = new Set<number>();
    const seenRequired = new Set<number>();
    const seenFaults = new Set<number>();
    return order.map((id) => {
      const addRequired = (required.get(id) ?? []).filter((index) => !seenRequired.has(index));
      const addCells = (cells.get(id) ?? []).filter((index) => !seenCells.has(index));
      const addFaults = (faults.get(id) ?? []).filter((index) => !seenFaults.has(index));
      for (const index of addRequired) seenRequired.add(index);
      for (const index of addCells) seenCells.add(index);
      for (const index of addFaults) seenFaults.add(index);
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
  const reach = (tier: Tier, order: readonly string[]) => new Set(order.flatMap((id) => tier.get(id) ?? []));
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

/** For each spec of the pool, the indices of the elements it covers. */
function membership(elements: readonly CoverElement[], pool: ReadonlySet<string>): Tier {
  const tier: Tier = new Map();
  elements.forEach((element, index) => {
    for (const id of new Set(element.specs)) {
      if (!pool.has(id)) continue;
      const held = tier.get(id) ?? [];
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
  const chosen: string[] = [];
  const left = new Set(pool);
  while (chosen.length < limit) {
    let best: { id: string; gains: number[] } | undefined;
    for (const id of pool) {
      if (!left.has(id)) continue;
      const gains = tiers.map(
        (tier, position) => (tier.get(id) ?? []).filter((index) => !covered[position]?.has(index)).length,
      );
      if (gains.slice(0, goals).every((gain) => gain === 0)) continue;
      if (!best || ahead(gains, best.gains)) best = { id, gains };
    }
    if (!best) break;
    const picked = best.id;
    chosen.push(picked);
    left.delete(picked);
    tiers.forEach((tier, position) => {
      for (const index of tier.get(picked) ?? []) covered[position]?.add(index);
    });
  }
  return chosen;
}

/** True when `a` beats `b` read tier by tier. */
function ahead(a: readonly number[], b: readonly number[]): boolean {
  for (let position = 0; position < a.length; position += 1) {
    const left = a[position] ?? 0;
    const right = b[position] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}
