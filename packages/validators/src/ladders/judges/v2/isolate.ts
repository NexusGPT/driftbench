import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BankItem, ItemResult } from './bank';

/**
 * Runs bank items in child processes with a time limit per item, as the statistics bank does. An item past its
 * limit fails as "timed out"; its child is killed and a new one resumes at the next item. A child that dies on its
 * own fails the item it was running with its error output. Wall time grows with machine load, so the limit stops
 * an endless loop; it does not judge speed (the scale items do). A child that ends with exit code 0 before it has
 * reported every item is not believed: a new child resumes at the first item without a result, and an item a fresh
 * child ends on without reporting anything fails by name. So every item has a result.
 */

export const ITEM_TIME_LIMIT_MS = 120_000;
/** The time a child may take to load the bank before its first item. */
export const STARTUP_MS = 120_000;
/**
 * After a child's exit, how long the parent waits for the rest of its output. The exit can be seen before the
 * last lines are read; the streams close right after, unless a process the item started still holds them.
 */
export const DRAIN_MS = 10_000;
/**
 * Children side by side for one seed. One by default: the scale items time operations, and children running in
 * parallel would slow each other's clocks. DRIFTBENCH_JUDGES_SHARDS raises it, up to the cores less one.
 */
export const DEFAULT_SHARDS = Math.max(
  1,
  Math.min(Number(process.env.DRIFTBENCH_JUDGES_SHARDS ?? 1) || 1, availableParallelism() - 1),
);

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));

/**
 * The Node.js arguments that start the bank's child. From source the child is child.ts, loaded through tsx. A
 * built package has no child.ts beside it, so its child is the package's own entry point, which exports the same
 * routine. Bank items import TypeScript files of the checkout under `root` (the examples, the package under
 * test), so the built child still loads tsx when the checkout has it; without it those items fail by name.
 */
export function childCommand(moduleUrl: string, root: string, rest: readonly string[]): string[] {
  if (moduleUrl.endsWith('.ts')) return ['--import', 'tsx', CHILD, ...rest];
  const entry = new URL('./index.js', moduleUrl).href;
  let loader: string[] = [];
  try {
    loader = ['--import', pathToFileURL(createRequire(join(root, 'package.json')).resolve('tsx')).href];
  } catch {
    // No tsx in this checkout: the child runs on plain Node.js.
  }
  return [
    ...loader,
    '--input-type=module',
    '--eval',
    `import { judgesBankChild } from ${JSON.stringify(entry)}; await judgesBankChild(process.argv.slice(1));`,
    ...rest,
  ];
}

type Line = { start?: number; done?: number; id: string; pass?: boolean; detail?: string };

export async function runIsolated(
  items: readonly BankItem[],
  seed: number,
  root: string,
  limitMs: number = ITEM_TIME_LIMIT_MS,
  shards: number = DEFAULT_SHARDS,
): Promise<Map<string, ItemResult>> {
  const results = new Map<string, ItemResult>();
  const count = Math.max(1, Math.min(shards, items.length));
  const lists = Array.from({ length: count }, (_, k) => items.filter((_, i) => i % count === k));
  await Promise.all(
    lists.map(async (list) => {
      let next = 0;
      while (next < list.length) next = await runFrom(next, list, seed, root, limitMs, results);
    }),
  );
  return results;
}

function runFrom(
  start: number,
  items: readonly BankItem[],
  seed: number,
  root: string,
  limitMs: number,
  results: Map<string, ItemResult>,
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
    child.stdin.end(JSON.stringify(items.map((entry) => entry.id)));
    let buffer = '';
    let errors = '';
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    let reported = 0;
    const finish = (resume: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(resume);
    };
    const stop = (index: number, detail: string) => {
      const entry = items[index];
      if (entry) results.set(entry.id, { pass: false, detail });
      child.kill('SIGKILL');
      finish(index + 1);
    };
    timer = setTimeout(
      () => stop(start, `the bank's child process did not start within ${STARTUP_MS} ms on seed ${seed}`),
      STARTUP_MS,
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const text = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        let line: Line;
        try {
          line = JSON.parse(text) as Line;
        } catch {
          continue;
        }
        if (line.start !== undefined) {
          const index = line.start;
          // A line read after the child was stopped must not start a limit for a process that is gone.
          if (settled) continue;
          if (timer) clearTimeout(timer);
          timer = setTimeout(
            () =>
              stop(
                index,
                `timed out: the item did not finish within ${limitMs} ms on seed ${seed} (an endless loop, or a path far too slow for this input); the validator stopped it and went on`,
              ),
            limitMs,
          );
        } else if (line.done !== undefined) {
          results.set(line.id, { pass: line.pass === true, detail: line.detail ?? '' });
          reported += 1;
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      errors += chunk;
    });
    let drain: NodeJS.Timeout | undefined;
    const conclude = (code: number | null) => {
      if (drain) clearTimeout(drain);
      if (settled) return;
      // The first item from the start that has no result: the one the child was on, or one it never reported.
      let first = start;
      while (first < items.length && results.has((items[first] as BankItem).id)) first += 1;
      if (first >= items.length) {
        finish(items.length);
        return;
      }
      const entry = items[first] as BankItem;
      if (code === 0 && reported > 0) {
        // Exit code 0 with items unreported: run them in a new child, never count them as done.
        finish(first);
        return;
      }
      results.set(entry.id, {
        pass: false,
        detail:
          code === 0
            ? `the bank's child process ended (exit 0) on seed ${seed} without reporting this item or any other: the item ends the process, or its output is lost`
            : `the bank's child process died (exit ${code}) while running this item on seed ${seed}: ${errors.trim().split('\n').slice(-3).join(' / ')}`,
      });
      finish(first + 1);
    };
    // The result is read when the output streams have closed, so no line still on its way is lost.
    child.on('exit', (code) => {
      drain = setTimeout(() => conclude(code), DRAIN_MS);
    });
    child.on('close', (code) => conclude(code));
  });
}
