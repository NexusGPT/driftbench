/**
 * The calibration of a scale run. CPU time is not the same work on every machine: the same product commit
 * measures up to twice as long on one hosted runner as on another. So the child first runs a fixed workload
 * in the same process, records its CPU time, and the scale time item divides the product's CPU time by the
 * ratio of this calibration to the reference below. A product at the old speed on the reference machine scores
 * as before; a product twice as slow scores twice as slow on any machine.
 *
 * The workload is deterministic, CPU-bound and does no I/O. It mixes what the generator does (object
 * allocation, string building, JSON round trips, sorting, map lookups), so a machine slow at memory is slow
 * here too. Its size is a count of operations, never a duration.
 */

/** Operations per round of the workload. */
export const CALIBRATION_SIZE = 600_000;

/** Rounds run; the fastest counts, so a burst of load in one round does not move the calibration. */
export const CALIBRATION_ROUNDS = 3;

/**
 * The reference calibration, in milliseconds of CPU time: the median of the calibrations of the measured
 * hosted runs listed in validators/generator/evidence/scale-calibration.json, which also records the command and
 * the commit. It is recorded once; changing it moves the bar for every machine.
 */
export const CALIBRATION_REFERENCE_MS = 1_000;

/** A fixed pseudo-random sequence: the workload never reads a clock or a random source. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** One round of the workload. Returns a checksum so the work cannot be dropped. */
export function calibrationRound(size = CALIBRATION_SIZE): number {
  const next = sequence(20261016);
  const rows: Array<{ id: string; weight: number; tags: string[] }> = [];
  for (let index = 0; index < size; index += 1) {
    const weight = Math.floor(next() * 1_000_000);
    rows.push({ id: `row-${weight}-${index}`, weight, tags: [`a${weight % 97}`, `b${weight % 31}`] });
  }
  rows.sort((left, right) => left.weight - right.weight || (left.id < right.id ? -1 : 1));
  const byTag = new Map<string, number>();
  for (const row of rows) for (const tag of row.tags) byTag.set(tag, (byTag.get(tag) ?? 0) + row.weight);
  const text = JSON.stringify(rows.slice(0, size >> 1));
  const back = JSON.parse(text) as typeof rows;
  let sum = 0;
  for (const row of back) sum = (sum + row.id.length * 31 + (byTag.get(row.tags[0] as string) ?? 0)) % 1_000_000_007;
  return sum;
}

/** The CPU time of the calibration in milliseconds: the fastest of the rounds. 0 when the meter reports none. */
export function calibrate(rounds = CALIBRATION_ROUNDS, size = CALIBRATION_SIZE): number {
  let best = Number.POSITIVE_INFINITY;
  let checksum = 0;
  for (let round = 0; round < rounds; round += 1) {
    const before = process.cpuUsage();
    checksum += calibrationRound(size);
    const used = process.cpuUsage(before);
    best = Math.min(best, (used.user + used.system) / 1000);
  }
  return checksum >= 0 && Number.isFinite(best) ? best : 0;
}

/** The CPU time of a run on the reference machine: raw time times reference over calibration. */
export function normalisedMs(rawMs: number, calibrationMs: number, referenceMs = CALIBRATION_REFERENCE_MS): number {
  return calibrationMs > 0 ? Math.round((rawMs * referenceMs) / calibrationMs) : rawMs;
}
