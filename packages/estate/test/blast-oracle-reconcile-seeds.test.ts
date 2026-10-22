import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { estate, FIXTURE } from './support';

/**
 * Blast radius of the reconcile script fix on what reads it: the live specs of the fixture estate seed a
 * workspace from `phrases.yaml` and ask the agent to run the script on an invoice and its order, and the
 * fixture-v2 estate keeps a copy of the same skill for `estate maintain`. Every invoice of every seed
 * whose order the seed also holds must reconcile without a traceback, and both copies must stay the same.
 */

const SCRIPT = '.claude/skills/invoice-reconcile/scripts/reconcile.py';
const V2 = fileURLToPath(new URL('../../../examples/estates/fixture-v2/', import.meta.url));

/** The execution logs the script would leave in the fixture estates of the checkout. */
const CHECKOUT_LOGS = [FIXTURE, V2].map((root) => join(root, '.claude/northwind/reconcile-executions.jsonl'));

/** How many runs a log holds: 0 when the file is absent. */
function runs(path: string): number {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0;
}

type Seed = { id: string; files: Record<string, string> };

/** Each invoice of a seed with the order it names, when the seed holds that order. */
function pairs(seed: Seed): Array<{ invoice: string; order: string }> {
  const out: Array<{ invoice: string; order: string }> = [];
  for (const [path, text] of Object.entries(seed.files)) {
    if (!/^invoices\/.+\.json$/.test(path)) continue;
    const order = (JSON.parse(text) as { order?: string }).order;
    const orderPath = `orders/${order}.json`;
    if (order !== undefined && orderPath in seed.files) out.push({ invoice: path, order: orderPath });
  }
  return out;
}

async function seeds(): Promise<Seed[]> {
  const bank = parse(await readFile(join(FIXTURE, 'phrases.yaml'), 'utf8')) as { workspaces: Seed[] };
  return bank.workspaces;
}

describe('the reconcile script on the workspace seeds the live specs use', () => {
  it('is the same script in the fixture and fixture-v2 estates', async () => {
    expect(await readFile(join(V2, SCRIPT), 'utf8')).toBe(await readFile(join(FIXTURE, SCRIPT), 'utf8'));
  });

  it('finds the invoice and order pairs of the rounding and the operations seeds', async () => {
    const found = (await seeds()).flatMap((seed) => pairs(seed).map((pair) => `${seed.id} ${pair.invoice}`));
    expect(found).toEqual([
      'northwind-ops invoices/INV-1001.json',
      'northwind-rounding invoices/INV-1004.json',
    ]);
  });

  it('reconciles every invoice of every seed with its order, with no traceback', async () => {
    const before = CHECKOUT_LOGS.map(runs);
    for (const seed of await seeds()) {
      for (const pair of pairs(seed)) {
        const root = await estate(seed.files);
        const run = spawnSync('python3', [join(FIXTURE, SCRIPT), pair.invoice, pair.order], {
          cwd: root,
          encoding: 'utf8',
        });
        expect(run.stderr, `${seed.id} ${pair.invoice}`).not.toContain('Traceback');
        const unreadable = [pair.invoice, pair.order].find(
          (path) => !Array.isArray(JSON.parse(seed.files[path] ?? '{}').lines),
        );
        if (unreadable) {
          expect(run.status).toBe(2);
          expect(run.stdout).toBe('');
          expect(run.stderr).toBe(
            `${unreadable}: missing or invalid 'lines'; expected a JSON object with a 'lines' list of {article, quantity, unit_price} records\n`,
          );
        } else {
          expect(run.stderr).toBe('');
          expect([0, 1], `${seed.id} ${pair.invoice}`).toContain(run.status);
          expect(run.stdout.trim()).not.toBe('');
        }
      }
    }
    // The script logs under the estate root its own path defines: run in place, it would write into the checkout.
    expect(CHECKOUT_LOGS.map(runs)).toEqual(before);
  });
});
