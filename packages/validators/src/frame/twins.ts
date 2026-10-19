import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The two runs of the frame, drawn from the seed (docs/validators.md, "The frame: the product runs apart, the
 * parent decides"). Each signal the cheater audits found a product reading about how it is run takes a different
 * value in the two runs, so a product whose answer depends on one of them answers differently, and the frame
 * reports the call. Nothing is fixed that a product could key on: every name and folder is drawn.
 *
 * | Signal | Run A | Run B |
 * |---|---|---|
 * | process arguments | the driver's path alone | the driver's path and drawn arguments |
 * | working folder | the validator's own | a fresh folder |
 * | environment | the validator's own | the path, the home folder and drawn variables only |
 * | uptime | as it is | shifted by a drawn day to month |
 * | call stack | a drawn driver file in the project's cache | a drawn driver file in the temporary folder, nested |
 * | node options | none | none: a loader, when needed, is registered inside the driver |
 */

/** A seeded generator in [0, 1): the hash of the seed and the tag, then mulberry32. */
export function rngOf(seed: number, tag: string): () => number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < tag.length; i += 1) h = Math.imul(h ^ tag.charCodeAt(i), 16777619);
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const REST = `${FIRST}._-`;

/**
 * A name drawn from the seed and the tag: a seeded length of 3 to 20, a letter or digit first, then letters of both
 * cases, digits, dots, underscores and hyphens. It matches the id pattern of the spec schema and has no fixed
 * prefix, length or alphabet, so a product cannot tell a validator's ids from a user's by their shape.
 */
export function neutralName(seed: number, tag: string): string {
  const rng = rngOf(seed, `name:${tag}`);
  const length = 3 + Math.floor(rng() * 18);
  let out = FIRST[Math.floor(rng() * FIRST.length)] as string;
  while (out.length < length) out += REST[Math.floor(rng() * REST.length)];
  return out;
}

/** A drawn name that is also a safe file or folder name and an environment variable name: letters only. */
function plainName(rng: () => number, low: number, high: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const length = low + Math.floor(rng() * (high - low + 1));
  let out = '';
  while (out.length < length) out += letters[Math.floor(rng() * letters.length)];
  return out;
}

export type TwinPlan = {
  /** Which run: A is read by the validator, B is its twin. */
  run: 'A' | 'B';
  /** The folder the driver file is written to, and its file name. */
  driverDir: string;
  driverFile: string;
  /** Arguments after the driver's path. */
  argvTail: string[];
  /** The working folder: undefined is the validator's own. */
  cwd?: string;
  /** The environment: undefined is the validator's own. */
  env?: Record<string, string>;
  /** Seconds added to process.uptime and to performance.now. */
  uptimeShift: number;
  /** How many calls deep the product is called from the driver. */
  depth: number;
  /** The driver program, its identifiers drawn (driver.ts); set by the frame. */
  driverSource?: string;
};

/** The two runs of one frame. `projectCache` is a cache folder of the project (its node_modules/.cache). */
export function twinPlans(seed: number, tag: string, projectCache: string): [TwinPlan, TwinPlan] {
  const rng = rngOf(seed, `twins:${tag}`);
  const folderA = plainName(rng, 6, 14);
  const folderB = plainName(rng, 6, 14);
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'TMPDIR', 'TEMP', 'TMP']) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  for (let i = 0; i < 1 + Math.floor(rng() * 3); i += 1)
    env[plainName(rng, 4, 9).toUpperCase()] = plainName(rng, 3, 12);
  const a: TwinPlan = {
    run: 'A',
    driverDir: join(projectCache, folderA),
    driverFile: `${plainName(rng, 3, 12)}.mjs`,
    argvTail: [],
    uptimeShift: 0,
    depth: 0,
  };
  const b: TwinPlan = {
    run: 'B',
    driverDir: join(tmpdir(), folderB),
    driverFile: `${plainName(rng, 3, 12)}.mjs`,
    argvTail: Array.from({ length: 1 + Math.floor(rng() * 3) }, () => `--${plainName(rng, 3, 8)}`),
    cwd: join(tmpdir(), folderB),
    env,
    uptimeShift: 86_400 + Math.floor(rng() * 30 * 86_400),
    depth: 2 + Math.floor(rng() * 6),
  };
  return [a, b];
}
