import type { UnitsTruth } from './units-estate';

/** A limit the producer returned on the atom of a unit (the id is the id of the units table). */
export type Produced = { unit: string; limit: number; comparison: string; role: string };

export type LimitScore = {
  /** Limits of the truth: found = a limit with the same number on the unit it governs; exact = also the same comparison and role. */
  limits: { truth: number; found: number; exact: number; missing: string[]; unreachable: string[] };
  /** Limits produced, once for each unit, number, comparison and role. */
  produced: { total: number; matched: number; nonLimitHits: number; otherExtras: number };
  /** Non-limits of the truth that got a limit on their unit. */
  nonLimits: { truth: number; hit: string[] };
  recall: number;
  exactRecall: number;
  precision: number;
};

const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

/**
 * Scores the producer against a units-table truth. Limits and non-limits are scored apart: recall is over the limits
 * of the truth, precision over the limits produced, and a limit produced on a unit that the truth lists as a
 * non-limit counts as a hit on that non-limit and as an extra. The comparison and the role are compared as written,
 * with no normal form: the units table does not say which units are prohibitions. So `exactRecall` understates: a
 * prohibition read as its trigger (more than 5) instead of its constraint (at most 5) is found by number but not exact.
 * Read `recall` (the number on the governed unit) first and `exactRecall` second. `limits.unreachable` lists the limits
 * whose governed unit got no request (given the units that did): they are in `missing` too, and are counted apart.
 */
export function scoreLimits(
  truth: UnitsTruth,
  produced: readonly Produced[],
  reachable?: ReadonlySet<string>,
): LimitScore {
  const seen = new Set<string>();
  const unique = produced.filter((item) => {
    const key = `${item.unit}|${item.limit}|${item.comparison}|${item.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const claimed = new Set<number>();
  const found = new Set<number>();
  const exact = new Set<number>();
  let matched = 0;
  const nonLimitUnits = new Set(truth.nonLimits.map((entry) => entry.unit));
  const hits = new Set<string>();
  let nonLimitHits = 0;
  let otherExtras = 0;
  for (const item of unique) {
    const at = truth.limits.findIndex(
      (limit, index) => !claimed.has(index) && limit.governs === item.unit && limit.limit === item.limit,
    );
    if (at >= 0) {
      claimed.add(at);
      found.add(at);
      const limit = truth.limits[at];
      if (limit !== undefined && limit.comparison === item.comparison && limit.role === item.role)
        exact.add(at);
      matched++;
    } else if (nonLimitUnits.has(item.unit)) {
      nonLimitHits++;
      hits.add(item.unit);
    } else otherExtras++;
  }
  const missing = truth.limits.filter((_, index) => !found.has(index)).map((limit) => limit.unit);
  // Limits whose governed unit got no request: the producer cannot return them, by construction.
  const unreachable =
    reachable === undefined
      ? []
      : truth.limits.filter((limit) => !reachable.has(limit.governs)).map((limit) => limit.unit);
  return {
    limits: { truth: truth.limits.length, found: found.size, exact: exact.size, missing, unreachable },
    produced: { total: unique.length, matched, nonLimitHits, otherExtras },
    nonLimits: { truth: nonLimitUnits.size, hit: [...hits] },
    recall: ratio(found.size, truth.limits.length),
    exactRecall: ratio(exact.size, truth.limits.length),
    precision: ratio(matched, unique.length),
  };
}
