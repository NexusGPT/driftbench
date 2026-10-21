import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeSeal, finishInvocation, forgetSealedProducts } from '@agent-nexus/driftbench-validators';
import { afterEach, expect, it, vi } from 'vitest';
import { markPath } from '../../validators/src/frame/confine';
import { plantedLadder } from '../../validators/test/support';
import { USAGE_EXIT, type ValidateCommandOptions, validateCommand } from '../src/commands/validate';
import type { Io } from '../src/io';

const afterMeasure = vi.hoisted(() => vi.fn());
vi.mock('../src/commands/stats-sweep-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/stats-sweep-cache')>();
  return {
    ...actual,
    measuredSeeds: async (...args: Parameters<typeof actual.measuredSeeds>) => {
      const report = await actual.measuredSeeds(...args);
      afterMeasure();
      return report;
    },
  };
});

const roots: string[] = [];
afterEach(() => {
  finishInvocation();
  forgetSealedProducts();
  afterMeasure.mockReset();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(component = 'planted') {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-invocation-'));
  roots.push(root);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  const tree = join(root, 'product');
  mkdirSync(tree);
  const module = join(tree, 'index.mjs');
  writeFileSync(module, 'export const get = () => 137;\n');
  const cache = join(root, 'cache');
  describeSeal(module, join(cache, 'seal'));
  const added = join(tree, 'stamp.txt');
  afterMeasure.mockImplementation(() => writeFileSync(added, 'fictional mutation'));
  const output = { out: '', err: '' };
  const io: Io = {
    cwd: root,
    out: (text) => { output.out += text; },
    err: (text) => { output.err += text; },
  };
  const { ladder } = plantedLadder([], component);
  const deps = { root, ladders: () => ({ [component]: ladder }), readHead: () => 'a'.repeat(40) };
  const marked = () => {
    expect(existsSync(markPath(cache, tree))).toBe(true);
    expect(output.err).toContain('stamp.txt (added)');
    // The finally block drains the invocation even when measurement or output throws.
    expect(finishInvocation()).toBeUndefined();
  };
  return { root, io, output, deps, marked };
}

it.each([
  ['normal report', {}],
  ['floor check', { checkFloor: true }],
  ['level slice', { levels: '1..2', json: true }],
  ['brief', { brief: true }],
])('finishes and marks the changed tree after a %s', async (_name, options: ValidateCommandOptions) => {
  const f = fixture();
  mkdirSync(join(f.root, 'validators'));
  writeFileSync(join(f.root, 'validators', 'EXECUTOR.md'), 'Fictional executor instruction.\n');
  const code = await validateCommand('planted', { seed: '1', ...options }, f.io, f.deps);
  expect(code).toBeGreaterThan(0);
  f.marked();
});

it('finishes before returning the missing-brief usage error', async () => {
  const f = fixture();
  expect(await validateCommand('planted', { seed: '1', brief: true }, f.io, f.deps)).toBe(USAGE_EXIT);
  f.marked();
});

it.each(['changed', 'unreadable'])('finishes when the measured statistics bank becomes %s', async (mode) => {
  const f = fixture('stats');
  const bank = join(f.root, 'packages', 'validators', 'src', 'ladders', 'stats');
  mkdirSync(bank, { recursive: true });
  writeFileSync(join(bank, 'index.ts'), 'export const bank = [1];\n');
  const mutate = afterMeasure.getMockImplementation();
  afterMeasure.mockImplementation(() => {
    mutate?.();
    if (mode === 'changed') writeFileSync(join(bank, 'index.ts'), 'export const bank = [2];\n');
    else rmSync(bank, { recursive: true, force: true });
  });
  expect(await validateCommand('stats', { seed: '1', items: true, json: true }, f.io, f.deps)).toBe(USAGE_EXIT);
  expect(f.output.err).toMatch(/statistics bank/);
  f.marked();
});

it('finishes and preserves a measurement exception', async () => {
  const f = fixture();
  const mutate = afterMeasure.getMockImplementation();
  const failure = new Error('fictional measurement failure');
  afterMeasure.mockImplementation(() => { mutate?.(); throw failure; });
  await expect(validateCommand('planted', { seed: '1' }, f.io, f.deps)).rejects.toBe(failure);
  f.marked();
});

it('finishes and preserves a report output exception', async () => {
  const f = fixture();
  const failure = new Error('fictional output failure');
  f.io.out = () => { throw failure; };
  await expect(validateCommand('planted', { seed: '1' }, f.io, f.deps)).rejects.toBe(failure);
  f.marked();
});
