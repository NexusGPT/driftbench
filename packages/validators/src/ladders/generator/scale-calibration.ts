import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

/**
 * The calibration of a scale run. CPU time is not the same work on every machine: the same product commit
 * measures up to twice as long on one hosted runner as on another. So the child first runs a fixed workload
 * in the same process, records its CPU time, and the scale time item divides the product's CPU time by the
 * ratio of this calibration to the reference below. A product at the old speed on the reference machine scores
 * as before; a product twice as slow scores twice as slow on any machine.
 *
 * The workload is deterministic and mirrors what the timed window does, in about the proportions a profile of
 * the 100x window shows: object allocation and sorting, JSON canonicalisation with sha256 hashing (the spec
 * hash), yaml parsing (loading every spec), and fs.statSync / existsSync of every parent directory of a path
 * (the spec validator resolving files). The only I/O is one small temp tree, created before the first round
 * and removed after the last, and stat calls on it; there is no network. Its size is a count of operations,
 * never a duration.
 * The parts are weighted by hand toward the profile of the 100x window: allocation and sorting about half,
 * yaml and stat each about a seventh, hashing about a tenth.
 */

/** Rows of the allocation and sort part, per round. */
export const CALIBRATION_SIZE = 600_000;

/** Rounds run; the fastest counts, so a burst of load in one round does not move the calibration. */
export const CALIBRATION_ROUNDS = 3;

/** Depth of the temp tree, and the paths statted per round (each stats every parent directory). */
const TREE_DEPTH = 8;
const STAT_PATHS = 8_000;

/** The reference calibration, in milliseconds of CPU time. See validators/generator/evidence/scale-calibration.json. */
export const CALIBRATION_REFERENCE_MS = 1_354;

/** A fixed pseudo-random sequence: the workload never reads a clock or a random source. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** The temp tree the stat part walks: one deep chain of directories with a file at each level. */
function makeTree(): { root: string; files: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-calibration-'));
  const files: string[] = [];
  let dir = root;
  for (let level = 0; level < TREE_DEPTH; level += 1) {
    dir = join(dir, `level-${level}`);
    mkdirSync(dir);
    const file = join(dir, `spec-${level}.yaml`);
    writeFileSync(file, 'id: x\n');
    files.push(file);
  }
  return { root, files };
}

/** Allocation, sorting and map lookups. */
function allocationPart(next: () => number, size: number): number {
  const rows: Array<{ id: string; weight: number; tags: string[] }> = [];
  for (let index = 0; index < size; index += 1) {
    const weight = Math.floor(next() * 1_000_000);
    rows.push({ id: `row-${weight}-${index}`, weight, tags: [`a${weight % 97}`, `b${weight % 31}`] });
  }
  rows.sort((left, right) => left.weight - right.weight || (left.id < right.id ? -1 : 1));
  const byTag = new Map<string, number>();
  for (const row of rows) for (const tag of row.tags) byTag.set(tag, (byTag.get(tag) ?? 0) + row.weight);
  let sum = 0;
  for (const row of rows) sum = (sum + row.id.length * 31 + (byTag.get(row.tags[0] as string) ?? 0)) % 1_000_000_007;
  return sum;
}

/** Canonical JSON (sorted keys) and sha256, as a spec hash does. */
function hashPart(next: () => number, size: number): number {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([key, entry]) => [key, sorted(entry)]),
          )
        : value;
  let sum = 0;
  for (let index = 0; index < size / 100; index += 1) {
    const doc = { id: `spec-${index}`, blocks: Array.from({ length: 12 }, (_, at) => ({ z: next(), a: `turn ${at}`, m: [at, index] })) };
    sum = (sum + createHash('sha256').update(JSON.stringify(sorted(doc))).digest()[0]!) % 251;
  }
  return sum;
}

/** Yaml parsing, as loading a spec does. */
function yamlPart(size: number): number {
  const text = Array.from({ length: 12 }, (_, at) => `- id: block-${at}\n  when:\n    user: Please keep rule number ${at}.\n  expect:\n    stage: intake\n    must: [a, b]\n`).join('');
  let sum = 0;
  for (let index = 0; index < size / 1_875; index += 1) sum += (parse(text) as unknown[]).length;
  return sum;
}

/** statSync and existsSync of every parent directory of a file, as resolving a spec's files does. */
function statPart(tree: { root: string; files: string[] }, paths: number): number {
  let sum = 0;
  for (let index = 0; index < paths; index += 1) {
    let path = tree.files[index % tree.files.length] as string;
    while (path.length > tree.root.length) {
      if (existsSync(path)) sum += statSync(path).isDirectory() ? 1 : 2;
      path = path.slice(0, path.lastIndexOf('/'));
    }
  }
  return sum;
}

/** One round of the workload. Returns a checksum so the work cannot be dropped. */
export function calibrationRound(size = CALIBRATION_SIZE, tree?: { root: string; files: string[] }, paths = STAT_PATHS): number {
  const next = sequence(20261016);
  const own = tree ?? makeTree();
  try {
    return (allocationPart(next, size) + hashPart(next, size) + yamlPart(size) + statPart(own, paths)) % 1_000_000_007;
  } finally {
    if (!tree) rmSync(own.root, { recursive: true, force: true });
  }
}

/** The CPU time of the calibration in milliseconds: the fastest of the rounds. 0 when the meter reports none. */
export function calibrate(rounds = CALIBRATION_ROUNDS, size = CALIBRATION_SIZE, paths = STAT_PATHS): number {
  const tree = makeTree();
  let best = Number.POSITIVE_INFINITY;
  let checksum = 0;
  try {
    for (let round = 0; round < rounds; round += 1) {
      const before = process.cpuUsage();
      checksum += calibrationRound(size, tree, paths);
      const used = process.cpuUsage(before);
      best = Math.min(best, (used.user + used.system) / 1000);
    }
  } finally {
    rmSync(tree.root, { recursive: true, force: true });
  }
  return checksum >= 0 && Number.isFinite(best) ? best : 0;
}

/** The CPU time of a run on the reference machine: raw time times reference over calibration. */
export function normalisedMs(rawMs: number, calibrationMs: number, referenceMs = CALIBRATION_REFERENCE_MS): number {
  return calibrationMs > 0 ? Math.round((rawMs * referenceMs) / calibrationMs) : rawMs;
}
