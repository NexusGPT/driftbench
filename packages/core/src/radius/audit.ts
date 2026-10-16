import { blockStatus } from '../runner/verdicts';
import type { RunResult } from '../schema/run';
import type { CarriedCell } from './carry';

/**
 * The audit sample of a radius campaign. Cells drawn at random from those about to be carried are run
 * fresh, and each fresh run is compared with the stored run it would have copied. A disagreement is a
 * radius miss: the change reached a block the radius left out. One miss fails closed: nothing is carried.
 * No miss in n audits bounds the share of carried cells the new agent would not reproduce.
 */

/** The same small generator as @agent-nexus/driftbench-stats: one seed, one sequence. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws `n` of the cells about to be carried, without replacement. The draw depends on the seed and on
 * the cells, taken in the order of their cell ids, never on the order the plan lists them in.
 */
export function auditSample<T extends Pick<CarriedCell, 'cell'>>(
  carried: readonly T[],
  n: number,
  seed: number,
): T[] {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(`auditSample: n must be a whole number of at least 0, got ${n}`);
  const pool = [...carried].sort((a, b) => a.cell.cellId.localeCompare(b.cell.cellId));
  const rng = mulberry32(seed);
  // A partial Fisher-Yates shuffle: the first `take` places hold the sample.
  const take = Math.min(n, pool.length);
  for (let index = 0; index < take; index++) {
    const pick = index + Math.floor(rng() * (pool.length - index));
    const held = pool[index] as T;
    pool[index] = pool[pick] as T;
    pool[pick] = held;
  }
  return pool.slice(0, take);
}

export type AuditVerdict = {
  agree: boolean;
  /** What differs, as `block <index> <verdict id>: <carried> then <fresh>`, or a line about the run. */
  differing: string[];
};

/**
 * Compares a fresh run of a cell with the stored run a radius campaign would have carried for it, on what
 * decides pass or fail: the status, each block's gating verdicts, each block's pass, the end state.
 * Wording, latency and cost are not compared: a carried result stands for the verdicts, not the text.
 */
export function auditVerdict(fresh: RunResult, carried: RunResult): AuditVerdict {
  const differing: string[] = [];
  if (fresh.status !== carried.status) differing.push(`status: ${carried.status} then ${fresh.status}`);
  if (fresh.blocks.length !== carried.blocks.length) {
    differing.push(`blocks: ${carried.blocks.length} then ${fresh.blocks.length}`);
  }
  const blocks = Math.min(fresh.blocks.length, carried.blocks.length);
  for (let at = 0; at < blocks; at++) {
    const now = fresh.blocks[at];
    const before = carried.blocks[at];
    if (!now || !before) continue;
    const gating = (run: typeof now) =>
      new Map(
        run.verdicts.filter((verdict) => verdict.gating).map((verdict) => [verdict.id, verdict.outcome]),
      );
    const was = gating(before);
    const is = gating(now);
    for (const id of new Set([...was.keys(), ...is.keys()])) {
      if (was.get(id) !== is.get(id)) {
        differing.push(
          `block ${before.index} ${id}: ${was.get(id) ?? 'absent'} then ${is.get(id) ?? 'absent'}`,
        );
      }
    }
    const [statusBefore, statusNow] = [blockStatus(before), blockStatus(now)];
    if (statusBefore !== statusNow && !differing.some((line) => line.startsWith(`block ${before.index} `))) {
      differing.push(`block ${before.index}: ${statusBefore} then ${statusNow}`);
    }
  }
  if (fresh.endState?.match !== carried.endState?.match) {
    differing.push(`end state: ${String(carried.endState?.match)} then ${String(fresh.endState?.match)}`);
  }
  return { agree: differing.length === 0, differing };
}

/**
 * With no miss in `n` audits, the largest share of carried cells that could still disagree, at the given
 * confidence (one-sided, default 95%): 1 - alpha^(1/n). 0 of 20 reads under 13.9%, 0 of 59 under 5%.
 * Undefined when nothing was audited.
 */
export function auditBound(n: number, alpha = 0.05): number | undefined {
  if (n <= 0) return undefined;
  return 1 - alpha ** (1 / n);
}
