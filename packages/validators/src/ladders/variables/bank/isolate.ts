import { execFile, spawn } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { implModulePath } from '../impl';
import { type BankItem, DEFAULT_ITEM_BUDGET_MS, type ItemOutcome, runItem } from './index';
import { replayClock, replayImpl, type Tape } from './tape';

/**
 * Runs the items of one seed in child processes that stop an item past its budget. The child is `child.ts`,
 * loaded through tsx, so this isolation needs a source checkout (a built package runs in-process).
 */

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));

type Line = {
  start?: number;
  done?: number;
  id: string;
  provides?: string[];
  tape?: Tape;
  loadError?: string;
  ms?: number;
};

/**
 * The verdict of an item from the answers its child recorded: the items run here, in the parent, against a replay
 * of those answers, and the parent alone decides pass or fail.
 */
export async function replayVerdict(
  item: BankItem,
  seed: number,
  root: string,
  line: Line,
): Promise<ItemOutcome> {
  if (line.loadError) return { pass: false, detail: line.loadError };
  const { impl, problems } = replayImpl(line.tape ?? [], line.provides ?? []);
  replayClock.active = true;
  replayClock.total = 0;
  try {
    const outcome = await runItem(item, seed, root, impl, implModulePath());
    return problems.length > 0
      ? { pass: false, detail: `${outcome.detail}; ${problems.slice(0, 2).join('; ')}` }
      : outcome;
  } finally {
    replayClock.active = false;
  }
}

/** A line of the child's output is believed only when its signature is the HMAC of the rest with the run's key. */
function signed(text: string, key: string): string | undefined {
  const space = text.indexOf(' ');
  if (space !== 64) return undefined;
  const given = Buffer.from(text.slice(0, 64), 'hex');
  const wanted = createHmac('sha256', key).update(text.slice(65)).digest();
  return given.length === wanted.length && timingSafeEqual(given, wanted) ? text.slice(65) : undefined;
}

/** The time a child process may take to load the bank before it runs its first item. */
export const STARTUP_MS = 300_000;
/** After a child's exit, how long the parent waits for the rest of its output. */
export const DRAIN_MS = 10_000;
/** Child processes run side by side for one seed: the cores less one, at most 4. */
export const DEFAULT_SHARDS = Math.max(1, Math.min(4, availableParallelism() - 1));

/**
 * How long the parent waits, in wall-clock time, for each millisecond of processor time an item may use. A busy
 * machine slows a child without the item being slow, so the budget of an item counts the child's processor time
 * (as the scale items do inside) and the wall clock only catches a child that has stopped using the processor.
 */
export const WALL_PER_CPU = 8;
/** How often the parent reads the processor time of a child. */
export const POLL_MS = 2_000;

/** The processor time a process has used so far, in milliseconds, from `ps`; undefined when it cannot be read. */
export function processorMs(pid: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'cputime=', '-p', String(pid)], (error, out) => {
      if (error) return resolve(undefined);
      const match = /^\s*(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/.exec(out);
      if (!match) return resolve(undefined);
      const [, hours, minutes, seconds] = match;
      resolve((Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000);
    });
  });
}

/** Whether this module runs from source, where the child can be started. */
export const CAN_ISOLATE = import.meta.url.endsWith('.ts');

export async function runIsolated(
  items: readonly BankItem[],
  seed: number,
  root: string,
  budget: (item: BankItem) => number = (item) => item.budgetMs ?? DEFAULT_ITEM_BUDGET_MS,
  shards = DEFAULT_SHARDS,
): Promise<Map<string, ItemOutcome & { ms?: number }>> {
  const results = new Map<string, ItemOutcome & { ms?: number }>();
  const count = Math.max(1, Math.min(shards, items.length));
  // Round robin, so the heavy items spread over the children.
  const lists = Array.from({ length: count }, (_, k) => items.filter((_, i) => i % count === k));
  await Promise.all(
    lists.map(async (list) => {
      let next = 0;
      while (next < list.length) next = await runFrom(next, list, seed, root, budget, results);
    }),
  );
  return results;
}

function runFrom(
  start: number,
  items: readonly BankItem[],
  seed: number,
  root: string,
  budget: (item: BankItem) => number,
  results: Map<string, ItemOutcome & { ms?: number }>,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD, String(seed), root, String(start)], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const key = randomBytes(32).toString('hex');
    child.stdin.end(JSON.stringify({ key, ids: items.map((item) => item.id) }));
    let buffer = '';
    let errors = '';
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    let reported = 0;
    let drain: NodeJS.Timeout | undefined;
    let pending: Promise<void> = Promise.resolve();
    const finish = (resume: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      resolve(resume);
    };
    const arm = (index: number) => {
      if (settled) return;
      if (timer) clearInterval(timer);
      const item = items[index];
      if (!item) return;
      const limit = budget(item);
      const began = Date.now();
      let baseline: number | undefined;
      const stop = (why: string) => {
        results.set(item.id, {
          pass: false,
          detail: `did not finish within ${limit} ms of processor time on seed ${seed}: ${why}; the validator stopped it`,
        });
        child.kill('SIGKILL');
        finish(index + 1);
      };
      timer = setInterval(async () => {
        if (settled) return;
        if (Date.now() - began > limit * WALL_PER_CPU)
          return stop('an endless wait or a path far too slow for this input');
        const used = child.pid === undefined ? undefined : await processorMs(child.pid);
        if (settled || used === undefined) return;
        baseline ??= used;
        if (used - baseline > limit) stop('an endless loop or a path far too slow for this input');
      }, POLL_MS);
    };
    timer = setTimeout(() => {
      const item = items[start];
      if (item) {
        results.set(item.id, {
          pass: false,
          detail: `the bank's child process did not start within ${STARTUP_MS} ms on seed ${seed}`,
        });
      }
      child.kill('SIGKILL');
      finish(start + 1);
    }, STARTUP_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const text = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        const body = signed(text, key);
        if (body === undefined) continue;
        let line: Line;
        try {
          line = JSON.parse(body) as Line;
        } catch {
          continue;
        }
        if (line.start !== undefined) {
          arm(line.start);
        } else if (line.done !== undefined) {
          const item = items[line.done];
          if (!item || item.id !== line.id) continue;
          reported += 1;
          if (timer) clearInterval(timer);
          pending = pending.then(async () => {
            if (results.has(item.id)) return;
            const began = performance.now();
            let outcome: ItemOutcome;
            try {
              outcome = await replayVerdict(item, seed, root, line);
            } catch (cause) {
              outcome = {
                pass: false,
                detail: `the replay of the recorded answers threw ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`,
              };
            }
            results.set(item.id, { ...outcome, ms: (line.ms ?? 0) + Math.round(performance.now() - began) });
          });
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      errors += chunk;
    });
    const conclude = (code: number | null) => {
      if (drain) clearTimeout(drain);
      void pending.then(() => settle(code));
    };
    const settle = (code: number | null) => {
      if (settled) return;
      let first = start;
      while (first < items.length && results.has((items[first] as BankItem).id)) first += 1;
      if (first >= items.length) {
        finish(items.length);
        return;
      }
      const item = items[first] as BankItem;
      if (code === 0 && reported > 0) {
        finish(first);
        return;
      }
      results.set(item.id, {
        pass: false,
        detail:
          code === 0
            ? `the bank's child process ended (exit 0) on seed ${seed} without reporting this item or any other: the item ends the process, or its output is lost`
            : `the bank's child process died (exit ${code}) while running this item on seed ${seed}: ${errors.trim().split('\n').slice(-3).join(' / ')}`,
      });
      finish(first + 1);
    };
    child.on('exit', (code) => {
      drain = setTimeout(() => conclude(code), DRAIN_MS);
    });
    child.on('close', (code) => conclude(code));
  });
}
