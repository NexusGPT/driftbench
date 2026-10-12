import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { BankItem, ItemOutcome } from './item';

/**
 * The wall time an item may take before the validator stops it, unless the item sets its own budget. Wall time
 * grows with the load of other processes on the machine, so it is generous: it is there to stop an endless
 * loop, not to judge speed (the scale items judge speed by processor time).
 */
export const DEFAULT_ITEM_BUDGET_MS = 120_000;

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));

type Line = { start?: number; done?: number; id: string; pass?: boolean; detail?: string; ms?: number };

/**
 * Runs every item of the bank on one seed in a child process and returns each item's outcome by id. An item
 * past its budget fails as "did not finish"; the child is killed and a new one resumes at the next item. A child
 * that dies on its own fails the item it was running with its error output.
 */
export async function runIsolated(
  items: readonly BankItem[],
  seed: number,
  root: string,
  budget: (item: BankItem) => number = (item) => item.budgetMs ?? DEFAULT_ITEM_BUDGET_MS,
  shards = DEFAULT_SHARDS,
): Promise<Map<string, ItemOutcome & { ms?: number }>> {
  const results = new Map<string, ItemOutcome & { ms?: number }>();
  const count = Math.max(1, Math.min(shards, items.length));
  // Round robin, so the heavy items of one level spread over the children.
  const lists = Array.from({ length: count }, (_, k) => items.filter((_, i) => i % count === k));
  await Promise.all(
    lists.map(async (list) => {
      let next = 0;
      while (next < list.length) next = await runFrom(next, list, seed, root, budget, results);
    }),
  );
  return results;
}

/** The time a child process may take to load the bank before it runs its first item. */
export const STARTUP_MS = 120_000;

/** Child processes run side by side for one seed: the cores less one, at most 4. */
export const DEFAULT_SHARDS = Math.max(1, Math.min(4, availableParallelism() - 1));

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
    child.stdin.end(JSON.stringify(items.map((item) => item.id)));
    let buffer = '';
    let errors = '';
    let current = start;
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (resume: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(resume);
    };
    const arm = (index: number) => {
      if (timer) clearTimeout(timer);
      const item = items[index];
      if (!item) return;
      const limit = budget(item);
      timer = setTimeout(() => {
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
        if (line.start !== undefined) {
          current = line.start;
          arm(current);
        } else if (line.done !== undefined) {
          results.set(line.id, { pass: line.pass === true, detail: line.detail ?? '', ms: line.ms });
          current = line.done + 1;
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      errors += chunk;
    });
    child.on('exit', (code) => {
      if (settled) return;
      if (code === 0 || current >= items.length) {
        finish(items.length);
        return;
      }
      const item = items[current];
      if (item && !results.has(item.id)) {
        results.set(item.id, {
          pass: false,
          detail: `the bank's child process died (exit ${code}) while running this item on seed ${seed}: ${errors.trim().split('\n').slice(-3).join(' / ')}`,
        });
      }
      finish(current + 1);
    });
  });
}
