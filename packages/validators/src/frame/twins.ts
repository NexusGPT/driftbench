import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The two runs of the frame, drawn from the seed (docs/validators.md, "The frame: the product runs apart, the
 * parent decides"). Each signal the cheater audits found a product reading about how it is run takes a different
 * value in the two runs, so a product whose answer depends on one of them answers differently, and the frame
 * reports the call. Nothing is fixed that a product could key on: every name and folder is drawn.
 *
 * The rule, for every trait the frame controls: at least two of the three runs differ in it, and run C (isolate.ts)
 * is user-shaped in it. Run C is a plain entry file under the tsx loader, run from the project's folder, with the
 * user's environment (`userEnv`).
 *
 * | Signal | Run A | Run B | Run C (user-shaped) |
 * |---|---|---|---|
 * | process arguments | the driver's path alone | the driver's path and drawn arguments | the entry's path alone |
 * | working folder | the validator's own | a fresh folder | the project's folder |
 * | search path | the validator's own | the node binary's folder and the system folders | the user's, without the project's `node_modules/.bin` |
 * | home folder | the validator's own | a fresh drawn folder | the real one |
 * | variables | the validator's own | drawn | the user's, without test runner and package manager variables |
 * | stdin | the driver's pipe | the driver's pipe | none (`/dev/null`) |
 * | call depth | direct | nested to a drawn depth | direct, from the entry's top level |
 * | uptime | as it is | shifted by a drawn day to month | a fresh process per call |
 * | node options | none: a loader is registered inside the driver | none | the tsx loader, as a user runs a TypeScript script |
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
  /** The fresh home folder of a bare environment, made before the run starts. */
  home?: string;
  /** Seconds added to process.uptime and to performance.now. */
  uptimeShift: number;
  /** How many calls deep the product is called from the driver. */
  depth: number;
  /** The driver program, its identifiers drawn (driver.ts); set by the frame. */
  driverSource?: string;
};

/**
 * A bare environment, as a user's own shell gives a script: a search path of the node binary's folder and the
 * system folders (never the project's `node_modules/.bin`), the given fresh home folder, the temporary folder and
 * one to three drawn variables. Second review of PR 892: run B copied the validator's PATH and HOME, so a product
 * keyed on either answered the same in every run.
 */
export function bareEnv(rng: () => number, home: string): Record<string, string> {
  const windows = process.platform === 'win32';
  const root = process.env.SYSTEMROOT ?? process.env.SystemRoot;
  const system = windows
    ? [root ? join(root, 'System32') : '', root ?? '']
    : ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const env: Record<string, string> = {
    PATH: [dirname(process.execPath), ...system].filter((dir) => dir !== '').join(windows ? ';' : ':'),
    HOME: home,
  };
  if (windows) env.USERPROFILE = home;
  for (const name of ['SYSTEMROOT', 'TMPDIR', 'TEMP', 'TMP']) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  for (let i = 0; i < 1 + Math.floor(rng() * 3); i += 1)
    env[plainName(rng, 4, 9).toUpperCase()] = plainName(rng, 3, 12);
  return env;
}

/** Whether a variable name is one a test runner or a package manager script sets. */
function testVariable(name: string, value: string): boolean {
  return (
    name.startsWith('VITEST') ||
    name.startsWith('__VITEST') ||
    name.startsWith('npm_') ||
    name.startsWith('PNPM_') ||
    name === 'TINYPOOL_WORKER_ID' ||
    name === 'JEST_WORKER_ID' ||
    ((name === 'NODE_ENV' || name === 'TEST') && (value === 'test' || value === 'true'))
  );
}

/**
 * The environment of run C, user-shaped: the validator's own, which is the user's shell, without the variables a
 * test runner or a package manager script sets and without the project's `node_modules/.bin` on the search path. The
 * home folder is the real one. Third review of PR 892: with run B and run C both drawn, no run had the user's
 * real shape, so a product wrong only for a real user passed every run.
 */
export function userEnv(): Record<string, string> {
  const windows = process.platform === 'win32';
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined && !testVariable(name, value)) env[name] = value;
  const path = env.PATH ?? env.Path ?? '';
  const kept = path
    .split(windows ? ';' : ':')
    .filter((dir) => dir !== '' && !dir.replace(/\\/g, '/').replace(/\/$/, '').endsWith('node_modules/.bin'));
  env[env.PATH === undefined && env.Path !== undefined ? 'Path' : 'PATH'] = kept.join(windows ? ';' : ':');
  return env;
}

/** The two runs of one frame. `projectCache` is a cache folder of the project (its node_modules/.cache). */
export function twinPlans(seed: number, tag: string, projectCache: string): [TwinPlan, TwinPlan] {
  const rng = rngOf(seed, `twins:${tag}`);
  const folderA = plainName(rng, 6, 14);
  const folderB = plainName(rng, 6, 14);
  const homeB = join(tmpdir(), folderB, plainName(rng, 6, 14));
  const env = bareEnv(rng, homeB);
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
    home: homeB,
    env,
    uptimeShift: 86_400 + Math.floor(rng() * 30 * 86_400),
    depth: 2 + Math.floor(rng() * 6),
  };
  return [a, b];
}
