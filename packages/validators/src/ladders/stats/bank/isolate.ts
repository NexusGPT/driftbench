import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { traceLine } from '../../../frame/trace';
import type { BankItem, ItemOutcome } from './item';

/**
 * The wall time an item may take before the validator stops it, unless the item sets its own budget. Wall time
 * grows with the load of other processes on the machine, so it is generous: it is there to stop an endless
 * loop, not to judge speed (the scale items judge speed by processor time).
 */
export const DEFAULT_ITEM_BUDGET_MS = 120_000;

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));

/**
 * The Node.js arguments that start the bank's child. From source the child is child.ts, loaded through tsx. A
 * built package uses a separately bundled child entry: the public index statically imports the target before
 * a trap could run. Bank items import TypeScript files of the checkout under `root` (the examples, the package under
 * test), so the built child still loads tsx when the checkout has it; without it those items fail by name.
 */
export function childCommand(moduleUrl: string, root: string, rest: readonly string[]): string[] {
  if (moduleUrl.endsWith('.ts')) return ['--import', 'tsx', CHILD, ...rest];
  const entry = fileURLToPath(new URL('./stats-bank/child.js', moduleUrl));
  let loader: string[] = [];
  try {
    loader = ['--import', pathToFileURL(createRequire(join(root, 'package.json')).resolve('tsx')).href];
  } catch {
    // No tsx in this checkout: the child runs on plain Node.js.
  }
  return [...loader, entry, ...rest];
}

type Line = {
  closed?: boolean;
  start?: number;
  done?: number;
  id?: string;
  pass?: boolean;
  detail?: string;
  ms?: number;
  taint?: string;
};

/**
 * Runs every item of the bank on one seed in a child process and returns each item's outcome by id. An item
 * past its budget fails as "did not finish"; the child is killed and a new one resumes at the next item. A child
 * that dies on its own fails the item it was running with its error output. A child that ends with exit code 0
 * before it has reported every item is not believed: a new child resumes at the first item without an outcome,
 * and an item a fresh child ends on without reporting anything fails by name. So every item has an outcome.
 */
export async function runIsolated(
  items: readonly BankItem[],
  seed: number,
  root: string,
  budget: (item: BankItem) => number = (item) => item.budgetMs ?? DEFAULT_ITEM_BUDGET_MS,
  shards = DEFAULT_SHARDS,
): Promise<Map<string, ItemOutcome & { ms?: number }>> {
  const results = new Map<string, ItemOutcome & { ms?: number }>();
  // A sampled call that a user's own process answered otherwise taints the seed: the product answers by how it is run.
  const taints: string[] = [];
  const count = Math.max(1, Math.min(shards, items.length));
  // Round robin, so the heavy items of one level spread over the children.
  const lists = Array.from({ length: count }, (_, k) => items.filter((_, i) => i % count === k));
  await Promise.all(
    lists.map(async (list) => {
      let next = 0;
      while (next < list.length) next = await runFrom(next, list, seed, root, budget, results, taints);
    }),
  );
  if (taints[0] !== undefined)
    for (const item of items)
      results.set(item.id, {
        pass: false,
        detail: `the product's answer depends on how it is run, so no item of seed ${seed} counts: ${taints[0]}`,
      });
  return results;
}

/**
 * The time a child process may take to close its frame after its last item (the frame makes every call again in one
 * unconfined process; its own limit is 1,800,000 ms): a hang backstop, not a budget.
 */
export const CLOSE_MS = 2_100_000;

/** The time a child process may take to load the bank before it runs its first item. */
export const STARTUP_MS = 120_000;

/**
 * After a child's exit, how long the parent waits for the rest of its output. The exit can be seen before the
 * last lines are read; the streams close right after, unless a process the item started still holds them.
 */
export const DRAIN_MS = 10_000;

/** Child processes run side by side for one seed: the cores less one, at most 4. */
export const DEFAULT_SHARDS = Math.max(1, Math.min(4, availableParallelism() - 1));

function runFrom(
  start: number,
  items: readonly BankItem[],
  seed: number,
  root: string,
  budget: (item: BankItem) => number,
  results: Map<string, ItemOutcome & { ms?: number }>,
  taints: string[],
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      childCommand(import.meta.url, root, [String(seed), root, String(start)]),
      {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const where = `bank-parent:${seed}:${start}`;
    traceLine(where, `spawned child pid ${child.pid}`);
    child.stdin.end(JSON.stringify(items.map((item) => item.id)));
    let buffer = '';
    let errors = '';
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (resume: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(resume);
    };
    const arm = (index: number) => {
      // A line read after the child was stopped must not start a budget for a process that is gone.
      if (settled) return;
      if (timer) clearTimeout(timer);
      const item = items[index];
      if (!item) return;
      const limit = budget(item);
      timer = setTimeout(() => {
        traceLine(where, `item ${index} ${item.id} timer fired after ${limit} ms`);
        // An item that already reported keeps its verdict: this timer only stops an item that is still running.
        if (results.has(item.id)) return;
        results.set(item.id, {
          pass: false,
          detail: `did not finish within ${limit} ms on seed ${seed}: an endless loop or a path far too slow for this input; the validator stopped it`,
        });
        child.kill('SIGKILL');
        finish(index + 1);
      }, limit);
    };
    // The item budget starts when the child says it starts the item; loading the bank has its own limit.
    timer = setTimeout(() => {
      traceLine(where, `startup timer fired after ${STARTUP_MS} ms`);
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
        if (text.trim() === '') continue;
        let line: Line;
        try {
          line = JSON.parse(text) as Line;
        } catch {
          continue;
        }
        if (line.taint !== undefined) {
          taints.push(line.taint);
        } else if (line.closed === true && reported + start >= items.length) {
          // The child closed its frame after its last item: every outcome and the taint are read. A child that then
          // does not end within DRAIN_MS is stopped; it holds nothing more (CI runs of PR 986: a child that wrote
          // "frame closed" never ended, and the parent waited CLOSE_MS, past the test's own limit).
          traceLine(where, 'child says its frame is closed');
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            traceLine(where, `child did not end within ${DRAIN_MS} ms after it closed its frame: stopped`);
            // Every stop is logged, so a child that does not end stays visible: one JSON line on stderr.
            process.stderr.write(
              `${JSON.stringify({ event: 'stats-bank-child-stopped', reason: 'no exit after its frame closed', seed, start, pid: child.pid, afterMs: DRAIN_MS })}\n`,
            );
            child.kill('SIGKILL');
            finish(items.length);
          }, DRAIN_MS);
        } else if (line.start !== undefined) {
          traceLine(where, `child says item ${line.start} starts`);
          arm(line.start);
        } else if (line.done !== undefined) {
          // The item is over: its budget is over with it. What the child does next (the frame closes and makes every
          // call again in an unconfined process) is not the item's time. The last item has no next start to replace
          // this timer, so before this line an honest last item that passed was failed "did not finish" while the
          // frame closed (CI runs of PR 986, 120 s).
          if (timer) clearTimeout(timer);
          timer = undefined;
          results.set(line.id as string, {
            pass: line.pass === true,
            detail: line.detail ?? '',
            ms: line.ms,
          });
          reported += 1;
          // After the last item the child closes its frame; a child that does not end is a hang, not a slow item.
          if (reported + start >= items.length) {
            timer = setTimeout(() => {
              taints.push(
                `the bank's child process did not end within ${CLOSE_MS} ms after its last item on seed ${seed}: the frame did not close`,
              );
              child.kill('SIGKILL');
              finish(items.length);
            }, CLOSE_MS);
          }
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      errors += chunk;
    });
    let reported = 0;
    let drain: NodeJS.Timeout | undefined;
    const conclude = (code: number | null) => {
      if (drain) clearTimeout(drain);
      if (settled) return;
      // The first item from the start that has no outcome: the one the child was on, or one it never reported.
      let first = start;
      while (first < items.length && results.has((items[first] as BankItem).id)) first += 1;
      if (first >= items.length) {
        finish(items.length);
        return;
      }
      const item = items[first] as BankItem;
      if (code === 0 && reported > 0) {
        // Exit code 0 with items unreported: run them in a new child, never count them as done.
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
    // The outcome is read when the output streams have closed, so no line still on its way is lost.
    child.on('exit', (code) => {
      traceLine(where, `child exited ${code}`);
      drain = setTimeout(() => conclude(code), DRAIN_MS);
    });
    child.on('close', (code) => conclude(code));
  });
}
