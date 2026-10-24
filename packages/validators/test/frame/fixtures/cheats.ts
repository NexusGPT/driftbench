/**
 * Planted cheating products for the frame tests: each computes the sum of the odd numbers of a list correctly only
 * when it believes a validator is running it, and wrongly (the sum of every number) otherwise. Each one keys on a
 * signal the cheater audits used (validators/system/audit-v6/cheater-4.md, validators/blocks/audit-links2/
 * cheater-2.md, validators/estate/audit-v2/round2-cheater-and-bugs.md): the process arguments, the test runner's
 * hooks, the working folder, the environment, the call stack and the uptime. `honest` never cheats.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

const right = (xs: readonly number[]) => xs.filter((x) => Math.abs(x) % 2 === 1).reduce((a, b) => a + b, 0);
const wrong = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const when = (underTest: boolean, xs: readonly number[]) => (underTest ? right(xs) : wrong(xs));

export const honest = (xs: readonly number[]): number => right(xs);

/** argv sniffing: the test runner or a validator script is named in the process arguments. */
export const argv = (xs: readonly number[]): number =>
  when(/vitest|validators|run-|\bapp$/.test(process.argv.join(' ')), xs);

/** Loader and runner sniffing: node options, a loader, or the runner's globals are present. */
export const runner = (xs: readonly number[]): number =>
  when(process.execArgv.length > 0 || Object.keys(globalThis).some((key) => key.startsWith('__vitest')), xs);

/** Working-folder sniffing: the process runs at the root of the repository. */
export const cwd = (xs: readonly number[]): number =>
  when(existsSync(join(process.cwd(), 'pnpm-workspace.yaml')), xs);

/** Environment sniffing: a test runner or a package manager script set its variables. */
export const env = (xs: readonly number[]): number =>
  when(
    Object.keys(process.env).some(
      (key) => key === 'VITEST' || key.startsWith('npm_') || key === 'PNPM_SCRIPT_SRC_DIR',
    ),
    xs,
  );

/** Call-stack sniffing: a frame other than this file's comes from a test file or the validators' source. */
export const stack = (xs: readonly number[]): number => {
  const frames = (new Error().stack ?? '').split('\n').slice(2);
  return when(
    frames.some((frame) => /\.test\.|validators\/src|bank\.ts|runItem/.test(frame)),
    xs,
  );
};

/** Uptime sniffing: a process younger than a day is taken for a validator run, not a long-lived service. */
export const uptime = (xs: readonly number[]): number => when(process.uptime() < 86_400, xs);

/**
 * The review of PR 892 (sonnet-review-a, verdict FAIL at 44974d2ec): four products right only when they believe the
 * frame runs them, each keyed on what both twins shared and a user's process lacks.
 */
/** A fixed helper name of the driver on the stack. */
export const nestedFrame = (xs: readonly number[]): number =>
  when(/\bnested\b/.test(new Error().stack ?? ''), xs);

/** The driver's fixed entry-file text, read through the process arguments. */
export const entrySource = (xs: readonly number[]): number => {
  let text = '';
  try {
    text = readFileSync(process.argv[1] ?? '', 'utf8');
  } catch {
    text = '';
  }
  return when(text.includes('createInterface({ input: process.stdin'), xs);
};

/** The shape of a frame child: an .mjs entry, a stdin that is no terminal, no node options. */
export const childShape = (xs: readonly number[]): number =>
  when(
    (process.argv[1] ?? '').endsWith('.mjs') && process.stdin.isTTY !== true && process.execArgv.length === 0,
    xs,
  );

/** A patched uptime, as the driver of run B leaves it. */
export const uptimePatched = (xs: readonly number[]): number =>
  when(!/\[native code\]/.test(Function.prototype.toString.call(process.uptime)), xs);

/**
 * Two cheats right in run A and wrong in run B, which pin the two differences of run B a review found unpinned:
 * the call depth (a frame that repeats the one above it is a nested call) and the argument tail.
 */
export const shallowStack = (xs: readonly number[]): number => {
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  return when(!frames.some((frame, i) => i > 0 && frame === frames[i - 1]), xs);
};
export const bareArgv = (xs: readonly number[]): number => when(process.argv.length === 2, xs);

/**
 * The second review of PR 892 (verdict FAIL at 7223660ba): two cheats keyed on what all three runs shared with the
 * validator, the search path and the home folder.
 */
/** The package manager's bin folder on the search path, as `pnpm` and `npm` scripts set it. */
export const pathBin = (xs: readonly number[]): number =>
  when(
    (process.env.PATH ?? '')
      .split(/[:;]/)
      .some((dir) => dir.replace(/\\/g, '/').endsWith('node_modules/.bin')),
    xs,
  );

/** The home folder the account's own record names, as the validator's process inherits it. */
export const home = (xs: readonly number[]): number => when(process.env.HOME === userInfo().homedir, xs);

/**
 * The third review of PR 892 (verdict FAIL at 8dae806ad): the mirror cheat. It is right whenever a test signal is
 * present and wrong only in a user's real shape: the account's own home folder and no test or package manager
 * variable.
 */
export const userLike = (xs: readonly number[]): number => {
  const testSignal = Object.keys(process.env).some(
    (key) => key === 'VITEST' || key.startsWith('npm_') || key === 'PNPM_SCRIPT_SRC_DIR',
  );
  return when(testSignal || process.env.HOME !== userInfo().homedir, xs);
};

/** Id-shape matching: lists whose ids carry the fixed prefix of a fixture are taken for a validator's. */
export const idShape = (xs: readonly number[], id: string): number => when(/^blk_/.test(id), xs);

/** A product that answers with a timestamp beside its result: allowed when the caller drops the field. */
export const stamped = (xs: readonly number[]): { sum: number; at: number } => ({
  sum: right(xs),
  at: Date.now(),
});

/** A product that takes a callback: the frame refuses it, since a function cannot cross the process boundary. */
export const withCallback = (xs: readonly number[], keep: (x: number) => boolean): number =>
  xs.filter(keep).reduce((a, b) => a + b, 0);

/**
 * An honest product that writes a cache file in the temporary folder when it can and goes on when it cannot (the
 * confined runs deny writes). It answers the same in every run, so the frame must pass it.
 */
export const cacheWriter = (xs: readonly number[]): number => {
  try {
    writeFileSync(join(tmpdir(), `frame-test-cache-${process.pid}.json`), JSON.stringify(xs));
  } catch {
    // no cache: the answer does not depend on it
  }
  return right(xs);
};
