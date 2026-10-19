/**
 * Planted cheating products for the frame tests: each computes the sum of the odd numbers of a list correctly only
 * when it believes a validator is running it, and wrongly (the sum of every number) otherwise. Each one keys on a
 * signal the cheater audits used (validators/system/audit-v6/cheater-4.md, validators/blocks/audit-links2/
 * cheater-2.md, validators/estate/audit-v2/round2-cheater-and-bugs.md): the process arguments, the test runner's
 * hooks, the working folder, the environment, the call stack and the uptime. `honest` never cheats.
 */
import { existsSync } from 'node:fs';
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
