import { type ChildProcess, fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rngFor } from '@agent-nexus/driftbench-generate';
import { type PointerSut, ReaderNotReachable } from '../sut/port';
import type { Control } from './controls';
import { fail, type Outcome, type PointerItem, Problem } from './types';

/** The longest an item may take before it fails, in milliseconds. */
export const ITEM_TIMEOUT_MS = 180_000;
/** Scale items run children that may take ten minutes each. */
export const SCALE_TIMEOUT_MS = 1_500_000;
/** How long the parent waits past an item's own limit before it stops a process that has not answered. */
const KILL_GRACE_MS = 10_000;

const cache = new Map<string, Promise<Outcome>>();

/** Forgets seed-free results: the tests call it when they change the system under test. */
export function clearSeedFreeCache(): void {
  cache.clear();
}

/** The limit of an item in milliseconds: its own cap, else the family's. `DRIFTBENCH_POINTER_LIMIT_MS` lowers it for tests. */
export function limitOf(item: PointerItem): number {
  const own = item.capMs ?? (item.family === 'scale' ? SCALE_TIMEOUT_MS : ITEM_TIMEOUT_MS);
  const override = Number(process.env.DRIFTBENCH_POINTER_LIMIT_MS);
  return Number.isFinite(override) && override > 0 ? Math.min(own, override) : own;
}

/** A failure that says the reader does not give the observation the item reads, not that it gave a wrong one. */
const MISSING_OBSERVATION = /does not expose|offers no |exports no |records no /;

/**
 * A failure for a missing observation names the behaviour under test: the exact oracle of the item. Without it the
 * message is the same for every item that reads the observation (an event, a link state), and says nothing of what
 * the reader must do with it.
 */
function named(item: PointerItem, outcome: Outcome): Outcome {
  if (
    outcome.pass ||
    !MISSING_OBSERVATION.test(outcome.detail) ||
    outcome.detail.includes('Behaviour under test')
  )
    return outcome;
  return { ...outcome, detail: `${outcome.detail}. Behaviour under test: ${item.oracle}` };
}

/**
 * Runs the item in this process, under its limit. A loop that never returns in this process is stopped only by
 * `isolated`. When `stop` is given, the reader runs in a process of its own (`reader-link.ts`) and a loop there does
 * not block this one: the limit stops the reader's process and fails the item.
 */
export async function executeHere(
  item: PointerItem,
  seed: number,
  sut: PointerSut,
  stop?: () => void,
): Promise<Outcome> {
  let timer: NodeJS.Timeout | undefined;
  const limit = limitOf(item);
  try {
    const timeout = new Promise<Outcome>((resolveTimeout) => {
      timer = setTimeout(() => {
        stop?.();
        resolveTimeout(
          fail(
            stop
              ? `the item did not finish within ${Math.round(limit / 1000)} s: the reader did not return, and its process was stopped`
              : `the item did not finish within ${Math.round(limit / 1000)} s`,
          ),
        );
      }, limit);
    });
    const work = item.run({ seed, id: item.id, sut, rng: rngFor(seed, item.id) });
    return named(item, await Promise.race([work, timeout]));
  } catch (cause) {
    if (cause instanceof ReaderNotReachable) return fail(cause.message);
    if (cause instanceof Problem) return named(item, fail(cause.message));
    return fail(`the item threw: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ----- items in a child process that can be stopped ----- */

const HERE = dirname(fileURLToPath(import.meta.url));
const ITEM_CHILD = join(HERE, 'item-child.ts');
const IN_ITEM_CHILD = process.env.DRIFTBENCH_POINTER_ITEM_CHILD === '1';

type Worker = { child: ChildProcess; busy: boolean };
/** A process that started and did not become ready: the item fails with this reason, it never runs in the parent. */
type Failed = { failed: string };

/**
 * A process that serves items, and what the runner keeps of it. The runner has one for the system under test the
 * environment names; a control starts another for a planted reader (`harness-probe.ts`), with the module named.
 */
export type Pool = {
  /** The module the child resolves the system under test from; absent: the environment names it. */
  readonly sutModule?: string;
  worker?: Promise<Worker | Failed | undefined>;
  /** The child last started, for the exit of this process. */
  started?: ChildProcess;
};
const shared: Pool = {};
const everStarted = new Set<ChildProcess>();

/** A pool of its own, whose child resolves the system under test from `sutModule`. */
export function newPool(sutModule: string): Pool {
  return { sutModule };
}

/**
 * Stops the child and everything it started. The child leads a process group of its own, and a scan it runs may
 * start processes of its own (the bank's sandboxed children): killing the child alone leaves them spinning.
 */
function killGroup(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The group is gone already, or the platform has none: stop the child itself.
  }
  child.kill('SIGKILL');
}

/**
 * Starts the process that serves the items. Undefined only when the checkout has no such process to start (no
 * source file, no loader); a process that starts and does not become ready gives a reason, because an item must
 * never fall back to the parent: the parent holds the report and the reader must not share its process.
 */
function spawnWorker(pool: Pool): Promise<Worker | Failed | undefined> {
  const repo = resolve(HERE, '../../../../../..');
  const loader = join(repo, 'node_modules/tsx/dist/esm/index.mjs');
  if (!existsSync(ITEM_CHILD) || !existsSync(loader)) return Promise.resolve(undefined);
  return new Promise((done) => {
    const child = fork(ITEM_CHILD, [], {
      execArgv: ['--import', pathToFileURL(loader).href],
      detached: true,
      env: {
        ...process.env,
        ...(pool.sutModule !== undefined ? { DRIFTBENCH_POINTER_SUT: pool.sutModule } : {}),
        DRIFTBENCH_POINTER_ITEM_CHILD: '1',
        TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH ?? join(repo, 'tsconfig.json'),
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const gave = setTimeout(() => {
      killGroup(child);
      done({ failed: 'the process that serves the items did not become ready within 120 s' });
    }, 120_000);
    pool.started = child;
    everStarted.add(child);
    // The child must not keep this process alive once the run is over: a pending item holds the loop with its
    // limit timer, and the exit hook below stops the group.
    child.unref();
    child.channel?.unref();
    child.once('message', (message: { ready?: boolean }) => {
      clearTimeout(gave);
      if (message.ready) done({ child, busy: false });
      else {
        killGroup(child);
        done({ failed: 'the process that serves the items answered something other than ready' });
      }
    });
    child.once('exit', (code) => {
      clearTimeout(gave);
      everStarted.delete(child);
      done({ failed: `the process that serves the items ended before it was ready (exit code ${code})` });
    });
  });
}

/**
 * Runs the item in a child process of its own, which the parent stops when the item overruns: a reader that loops
 * without returning blocks a process, and a timer in that process never fires. The child is started once and
 * serves the items one after the other; a stopped child is started again for the next item. The child holds the
 * oracle of the items and starts a second process for the reader (`item-child.ts`). Undefined when the checkout has
 * no such process to start, and the caller runs the item in this process.
 */
export async function isolated<T>(
  request:
    | { run: { id: string; seed: number } }
    | { blind: { id: string; seed: number } }
    | { control: Control },
  limit: number,
  stopped: (why: string) => T,
  pool: Pool = shared,
): Promise<T | undefined> {
  pool.worker ??= spawnWorker(pool);
  const live = await pool.worker;
  if (!live) return undefined;
  if (!('child' in live)) {
    pool.worker = undefined;
    return stopped(live.failed);
  }
  return new Promise<T>((done) => {
    let finished = false;
    const end = (outcome: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      live.child.off('message', onMessage);
      live.child.off('exit', onExit);
      done(outcome);
    };
    const stop = (why: string) => {
      pool.worker = undefined;
      killGroup(live.child);
      end(stopped(why));
    };
    const timer = setTimeout(
      () =>
        stop(
          `the item did not finish within ${Math.round(limit / 1000)} s: the reader did not return, and its process was stopped`,
        ),
      limit + KILL_GRACE_MS,
    );
    const onMessage = (message: { done?: T }) => {
      if (message.done !== undefined) end(message.done);
    };
    const onExit = (code: number | null) => {
      pool.worker = undefined;
      end(stopped(`the item stopped the reader's process (exit code ${code})`));
    };
    live.child.on('message', onMessage);
    live.child.on('exit', onExit);
    live.child.send(request);
  });
}

/** The process group of the child that serves the items, for the tests that look for what it leaves behind. */
export function itemChildGroup(): number | undefined {
  return shared.started?.pid;
}

/** Stops the child of a pool; the next item starts another. */
export async function stopPool(pool: Pool): Promise<void> {
  const current = pool.worker;
  pool.worker = undefined;
  const live = await current;
  if (live && 'child' in live) killGroup(live.child);
}

/** Stops the child that serves the items; the next item starts another. */
export function stopItemChild(): Promise<void> {
  return stopPool(shared);
}

// A run that ends leaves no child behind.
process.on('exit', () => {
  for (const child of everStarted) killGroup(child);
});

async function execute(item: PointerItem, seed: number, sut: PointerSut): Promise<Outcome> {
  if (sut.isolate === true && !IN_ITEM_CHILD) {
    const limit = limitOf(item);
    const outcome = await isolated<Outcome>({ run: { id: item.id, seed } }, limit, (why) => fail(why));
    if (outcome) return outcome;
  }
  return executeHere(item, seed, sut);
}

/** Runs one item on a seed. A seed-free item runs once per process and system and holds for every seed. */
export function runItem(item: PointerItem, seed: number, sut: PointerSut): Promise<Outcome> {
  if (!item.seedFree) return execute(item, seed, sut);
  const key = `${sut.name}:${item.id}`;
  let known = cache.get(key);
  if (!known) {
    known = execute(item, 1, sut);
    cache.set(key, known);
  }
  return known;
}
