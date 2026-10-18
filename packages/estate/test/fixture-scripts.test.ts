import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { estate, FIXTURE } from './support';

/** The reconcile script of the fixture estate's invoice-reconcile skill. */
const SCRIPT = join(FIXTURE, '.claude/skills/invoice-reconcile/scripts/reconcile.py');

function reconcile(root: string, invoice: string, order: string, script = SCRIPT) {
  const run = spawnSync('python3', [script, invoice, order], { cwd: root, encoding: 'utf8' });
  return { code: run.status, out: run.stdout, err: run.stderr };
}

/** The files of one workspace seed of the fixture's phrase bank. */
async function seed(id: string): Promise<Record<string, string>> {
  const bank = parse(await readFile(join(FIXTURE, 'phrases.yaml'), 'utf8')) as {
    workspaces: Array<{ id: string; files: Record<string, string> }>;
  };
  const found = bank.workspaces.find((workspace) => workspace.id === id);
  if (!found) throw new Error(`phrases.yaml holds no workspace ${id}`);
  return found.files;
}

describe('the fixture reconcile script', () => {
  it('reads the JSON invoices of the estate and applies the per-unit rounding rule to them', async () => {
    const root = await estate(await seed('northwind-rounding'));
    const run = reconcile(root, 'invoices/INV-1004.json', 'orders/PO-2004.json');
    expect(run).toEqual({
      code: 0,
      out: 'FK-BOWL-16: matched 0.00 EUR\nFK-PLATE-27: matched 0.00 EUR\n',
      err: '',
    });
  });

  it('counts a price difference of 0.05 EUR per unit or more as a difference, from the line totals', async () => {
    const root = await estate({
      'invoice.json': JSON.stringify({
        lines: [
          { article: 'A', quantity: 24, unit_price: '6.55' },
          { article: 'B', quantity: 10, unit_price: 2.0 },
        ],
      }),
      'order.json': JSON.stringify({
        lines: [
          { article: 'A', quantity: 24, unit_price: '6.50' },
          { article: 'B', quantity: 10, unit_price: '2.10' },
        ],
      }),
    });
    expect(reconcile(root, 'invoice.json', 'order.json')).toEqual({
      code: 1,
      out: 'A: over 1.20 EUR\nB: short -1.00 EUR\n',
      err: '',
    });
  });

  it('applies the per-unit rule to CSV files, and a quantity difference is never rounding', async () => {
    const root = await estate({
      'invoice.csv': 'article,quantity,unit_price\nA,24,6.53\nB,5,1.00\nC,3,4.00\n',
      'order.csv': 'article,quantity,unit_price\nA,24,6.50\nB,4,1.01\nD,1,9.99\n',
    });
    expect(reconcile(root, 'invoice.csv', 'order.csv')).toEqual({
      code: 1,
      out: 'A: matched 0.00 EUR\nB: over 0.96 EUR\nC: over 12.00 EUR\nD: short -9.99 EUR\n',
      err: '',
    });
  });

  it('keeps its usage error and its empty-file answer, the two fixtures its unit test records', async () => {
    const root = await estate({ invoice: '', order: '' });
    expect(reconcile(root, 'invoice', 'order')).toEqual({ code: 0, out: '', err: '' });
    const none = spawnSync('python3', [SCRIPT], { cwd: root, encoding: 'utf8' });
    expect(none.status).toBe(2);
    expect(none.stdout).toBe('');
    expect(none.stderr).toMatch(/^Usage: python3 reconcile\.py /);
  });
});

describe.each(['fixture', 'fixture-v2'])('%s rejects unreadable JSON inputs', (fixture) => {
  const script = join(FIXTURE, '..', fixture, '.claude/skills/invoice-reconcile/scripts/reconcile.py');

  it.each([
    ['missing', {}],
    ['null', { lines: null }],
    ['object', { lines: {} }],
    ['string', { lines: 'not a list' }],
    ['root array', []],
  ])('refuses a %s lines list on either side with one diagnostic', async (_label, invalid) => {
    for (const path of ['invoice.json', 'order.json']) {
      const files = { 'invoice.json': '{"lines":[]}', 'order.json': '{"lines":[]}' };
      files[path as keyof typeof files] = JSON.stringify(invalid);
      const root = await estate(files);
      expect(reconcile(root, 'invoice.json', 'order.json', script)).toEqual({
        code: 2,
        out: '',
        err: `${path}: missing or invalid 'lines'; expected a JSON object with a 'lines' list of {article, quantity, unit_price} records\n`,
      });
    }
  });

  it('accepts an explicitly empty lines list', async () => {
    const root = await estate({ 'invoice.json': '{"lines":[]}', 'order.json': '{"lines":[]}' });
    expect(reconcile(root, 'invoice.json', 'order.json', script)).toEqual({ code: 0, out: '', err: '' });
  });
});
