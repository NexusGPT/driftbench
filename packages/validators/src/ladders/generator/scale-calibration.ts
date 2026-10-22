import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

/**
 * The calibration of a scale run. CPU time is not the same work on every machine: the same product commit
 * measures up to twice as long on one hosted runner as on another. So the child first runs a fixed workload
 * in the same process, before any product code is imported, records its CPU time, and the scale time item
 * divides the product's CPU time by the ratio of this calibration to the reference below. A product at the old
 * speed on the reference machine scores as before; a product twice as slow scores twice as slow on any machine.
 *
 * The workload is deterministic and mirrors what the timed window does: object allocation and sorting, JSON
 * canonicalisation with sha256 hashing (the spec hash), yaml parsing (loading every spec), and fs.statSync /
 * existsSync of every parent directory of a path (the spec validator resolving files). The only I/O is one
 * small temp tree, created before the first round and removed after the last, and stat calls on it; there is
 * no network. Its size is a count of operations, never a duration.
 *
 * The calibration is the weighted sum of the fastest time of each part, with the weights below. The weights
 * were chosen on 40 hosted runs (validators/generator/evidence/scale-calibration.json): the CPU types differ
 * more in sha256 hashing and string parsing than in allocation, so those two carry most of the weight.
 */

/** Rows of the allocation and sort part, per round. */
export const CALIBRATION_SIZE = 600_000;

/** Rounds run; the fastest of each part counts, so a burst of load in one round does not move the calibration. */
export const CALIBRATION_ROUNDS = 3;

/** Depth of the temp tree, and the paths statted per round (each stats every parent directory). */
const TREE_DEPTH = 8;
const STAT_PATHS = 8_000;

/**
 * The reference calibration, in milliseconds of CPU time: the median weighted calibration of 40 hosted runs
 * (ubuntu-latest, 4 CPUs; AMD EPYC and Intel Xeon), listed in validators/generator/evidence/scale-calibration.json
 * with the command and the commit. It is recorded once; changing it moves the bar for every machine.
 */
export const CALIBRATION_REFERENCE_MS = 271;

/** The most credit a slow calibration earns: the normalised time is never below the raw time over this. */
export const CALIBRATION_MAX_CREDIT = 1.5;

/** The environment variable through which the child's first module hands the calibration to its second. */
export const CALIBRATION_ENV = 'DRIFTBENCH_SCALE_CALIBRATION_MS';

/** Weight of each part in the calibration. */
export const CALIBRATION_WEIGHTS = { allocation: 0.1, hash: 0.4, yaml: 0.4, stat: 0.1 } as const;

type Tree = { root: string; files: string[] };

/** A fixed pseudo-random sequence: the workload never reads a clock or a random source. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** The temp tree the stat part walks: one deep chain of directories with a file at each level. */
function makeTree(): Tree {
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
  for (const row of rows) {
    sum = (sum + row.id.length * 31 + (byTag.get(row.tags[0] as string) ?? 0)) % 1_000_000_007;
  }
  return sum;
}

/** A value with its object keys sorted at every depth, as a canonical hash reads it. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return Object.fromEntries(entries.map(([key, entry]) => [key, sorted(entry)]));
}

/** Canonical JSON and sha256, as a spec hash does. */
function hashPart(next: () => number, size: number): number {
  let sum = 0;
  for (let index = 0; index < size / 100; index += 1) {
    const blocks = Array.from({ length: 12 }, (_, at) => ({ z: next(), a: `turn ${at}`, m: [at, index] }));
    const text = JSON.stringify(sorted({ id: `spec-${index}`, blocks }));
    const digest = createHash('sha256').update(text).digest();
    sum = (sum + (digest[0] ?? 0)) % 251;
  }
  return sum;
}

/** One block of a spec in yaml. */
function blockYaml(at: number): string {
  const lines = [
    `- id: block-${at}`,
    '  when:',
    `    user: Please keep rule number ${at}.`,
    '  expect:',
    '    stage: intake',
    '    must: [a, b]',
  ];
  return lines.join('\n');
}

/** A spec of twelve blocks in yaml: what loading a spec parses. */
const SPEC_YAML = Array.from({ length: 12 }, (_, at) => blockYaml(at)).join('\n');

/** Yaml parsing, as loading a spec does. */
function yamlPart(size: number): number {
  let sum = 0;
  for (let index = 0; index < size / 1_875; index += 1) sum += (parse(SPEC_YAML) as unknown[]).length;
  return sum;
}

/** statSync and existsSync of every parent directory of a file, as resolving a spec's files does. */
function statPart(tree: Tree, paths: number): number {
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

/** One round of every part. Returns a checksum so the work cannot be dropped. */
export function calibrationRound(size = CALIBRATION_SIZE, tree?: Tree, paths = STAT_PATHS): number {
  const next = sequence(20261016);
  const own = tree ?? makeTree();
  try {
    const parts = allocationPart(next, size) + hashPart(next, size) + yamlPart(size) + statPart(own, paths);
    return parts % 1_000_000_007;
  } finally {
    if (!tree) rmSync(own.root, { recursive: true, force: true });
  }
}

/** The CPU time of one call, in milliseconds, with its checksum. */
function cpuMs(work: () => number): { ms: number; checksum: number } {
  const before = process.cpuUsage();
  const checksum = work();
  const used = process.cpuUsage(before);
  return { ms: (used.user + used.system) / 1000, checksum };
}

/**
 * The CPU time of the calibration in milliseconds: per part the fastest of the rounds, then the weighted sum.
 * 0 when the meter reports none.
 */
export function calibrate(rounds = CALIBRATION_ROUNDS, size = CALIBRATION_SIZE, paths = STAT_PATHS): number {
  const tree = makeTree();
  const next = sequence(20261016);
  const best = { allocation: Infinity, hash: Infinity, yaml: Infinity, stat: Infinity };
  let checksum = 0;
  try {
    for (let round = 0; round < rounds; round += 1) {
      const done = {
        allocation: cpuMs(() => allocationPart(next, size)),
        hash: cpuMs(() => hashPart(next, size)),
        yaml: cpuMs(() => yamlPart(size)),
        stat: cpuMs(() => statPart(tree, paths)),
      };
      for (const name of ['allocation', 'hash', 'yaml', 'stat'] as const) {
        checksum += done[name].checksum;
        best[name] = Math.min(best[name], done[name].ms);
      }
    }
  } finally {
    rmSync(tree.root, { recursive: true, force: true });
  }
  const total =
    CALIBRATION_WEIGHTS.allocation * best.allocation +
    CALIBRATION_WEIGHTS.hash * best.hash +
    CALIBRATION_WEIGHTS.yaml * best.yaml +
    CALIBRATION_WEIGHTS.stat * best.stat;
  return checksum >= 0 && Number.isFinite(total) ? total : 0;
}

/**
 * The factor that scales a raw time to the reference machine: reference over calibration, with the credit a slow
 * calibration earns capped at CALIBRATION_MAX_CREDIT. `capped` is true when the cap applied. 1 when the meter
 * reported no calibration.
 */
export function calibrationFactor(
  calibrationMs: number,
  referenceMs = CALIBRATION_REFERENCE_MS,
): { factor: number; capped: boolean } {
  if (!(calibrationMs > 0)) return { factor: 1, capped: false };
  const factor = referenceMs / calibrationMs;
  const floor = 1 / CALIBRATION_MAX_CREDIT;
  return factor < floor ? { factor: floor, capped: true } : { factor, capped: false };
}

/** The CPU time of a run on the reference machine: raw time times the calibration factor. */
export function normalisedMs(
  rawMs: number,
  calibrationMs: number,
  referenceMs = CALIBRATION_REFERENCE_MS,
): number {
  return Math.round(rawMs * calibrationFactor(calibrationMs, referenceMs).factor);
}
