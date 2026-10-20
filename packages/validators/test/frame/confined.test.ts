import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Frame, isolate, isolateCommand } from '../../src/frame';
import { findRoot } from '../../src/root';

/**
 * The confinement of the frame (docs/validators.md section 12.9). The cheater audit of the weights family found two
 * ways to make the frame's product tell it is validated, and so answer right only to the validator: it read the
 * file that holds the expected values (through a read handed bound to `Array.map`, which a trap that checks the
 * first frame does not see), and it read how it was called (a destructured error stack, a process object built from
 * pieces). These tests plant those products, copied as fictional code, and pin that none of them gains anything:
 * the product cannot reach the expected values at all, and a call made another way gives another answer that the
 * frame reports.
 */

vi.setConfig({ testTimeout: 300_000 });

const FIXTURES = new URL('./fixtures/cheater/', import.meta.url);
type SumOdd = (xs: readonly number[]) => number;
type Cheat = { sumOdd: SumOdd };

let work = '';
let oracle = '';
const files = new Map<string, string>();

/** A copy of a planted product with the path of the expected values written into it. */
function plant(name: string): string {
  const known = files.get(name);
  if (known) return known;
  const text = readFileSync(new URL(`${name}.mjs`, FIXTURES), 'utf8').replace(/__ORACLE__/g, oracle);
  const file = join(work, 'product', `${name}.mjs`);
  writeFileSync(file, text);
  files.set(name, file);
  return file;
}

beforeAll(() => {
  // Inside the project's cache folder, so run C (a plain script run from the project's root) can load the product.
  const cache = join(findRoot(dirname(fileURLToPath(import.meta.url))), 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  work = realpathSync(mkdtempSync(join(cache, 'frame-confined-')));
  mkdirSync(join(work, 'product'));
  mkdirSync(join(work, 'oracle'));
  oracle = join(work, 'oracle', 'expected.mjs');
  writeFileSync(oracle, readFileSync(new URL('expected.mjs', FIXTURES)));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The lists of one seed: the item's input. */
function lists(seed: number): number[][] {
  let state = seed * 2654435761;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
  return Array.from({ length: 6 }, () => Array.from({ length: 3 + (next() % 6) }, () => (next() % 41) - 20));
}
const reference = (xs: readonly number[]) =>
  xs.filter((x) => Math.abs(x) % 2 === 1).reduce((a, b) => a + b, 0);
const item = (sumOdd: SumOdd, seed: number) => lists(seed).every((xs) => sumOdd(xs) === reference(xs));

const open: Frame<unknown>[] = [];
function framed(name: string, seed: number): { pass: boolean; divergence?: string; frame: Frame<Cheat> } {
  const frame = isolate<Cheat>({ module: plant(name), seed });
  open.push(frame as Frame<unknown>);
  const pass = item(frame.product.sumOdd, seed);
  const divergence = frame.divergence();
  return { pass: pass && divergence === undefined, divergence, frame };
}
afterEach(() => {
  for (const frame of open.splice(0)) frame.close();
});

const SEEDS = [1, 2, 3];

describe.each(['oracle-bound', 'oracle-plain', 'sniff-stack-dodge', 'sniff-argv-dodge'])(
  'the cheat %s of the weights audit',
  (name) => {
    it('passes the item in the validator process: the gain the audit measured', async () => {
      const product = (await import(/* @vite-ignore */ pathToFileURL(plant(name)).href)) as Cheat;
      expect(item(product.sumOdd, 1)).toBe(true);
    });
    it('gains nothing under the frame, on every seed', () => {
      for (const seed of SEEDS) expect(framed(name, seed).pass).toBe(false);
    });
  },
);

describe('the confined runs', () => {
  it('give a product that reads the expected values no way to them', () => {
    const answers = SEEDS.map((seed) => {
      const frame = isolate<{ reached: () => Promise<string[]> }>({ module: plant('reach'), seed });
      open.push(frame as Frame<unknown>);
      frame.product.reached();
      const entry = frame.tape[0];
      const names = (outcome: unknown) =>
        ((outcome as { ret?: unknown[] } | undefined)?.ret ?? []) as string[];
      return {
        confined: names(entry),
        twin: names(entry?.twin),
        wrapped: names(entry?.wrapped),
        plain: names(entry?.plain),
      };
    });
    for (const answer of answers) {
      expect(answer.confined).toEqual([]);
      expect(answer.twin).toEqual([]);
      expect(answer.wrapped).toEqual([]);
      // Run C is not confined: the probe reaches the file there, so the probe is able to.
      expect(answer.plain).toEqual(
        expect.arrayContaining(['read', 'open', 'mapBound', 'reflect', 'spawn', 'promises']),
      );
    }
  });

  it('are told apart from run C when a product answers by whether it is confined', () => {
    for (const seed of SEEDS) {
      const result = framed('permission-sniff', seed);
      expect(result.pass).toBe(false);
      expect(result.divergence).toMatch(/run C/);
    }
  });

  it('call the product a second way, so a product keyed on a direct call is caught as a divergence', () => {
    for (const seed of SEEDS) {
      const result = framed('wrapper-sniff', seed);
      expect(result.pass).toBe(false);
      expect(result.divergence).toMatch(/run D/);
    }
  });

  it('record the answer of the wrapped run on the tape', () => {
    const { frame } = framed('wrapper-sniff', 1);
    expect(frame.tape[0]?.wrapped).toBeDefined();
    expect(frame.tape[0]?.twin).toBeDefined();
  });
});

describe('the confined command', () => {
  it('cannot read the expected values in runs A, B and D, and can in run C: the divergence names it', () => {
    const script = new URL('read-oracle-command.mjs', FIXTURES).pathname;
    const run = isolateCommand({ command: [script, oracle], seed: 1, collect: ['out.txt'] });
    expect(run.stdout).toBe('read no\n');
    expect(run.files['out.txt']).toBe('no\n');
    expect(run.divergence).toMatch(/run C/);
    expect(run.tape[0]?.plain).toBeDefined();
  });
  it('lets the command write its own working folder', () => {
    const script = new URL('read-oracle-command.mjs', FIXTURES).pathname;
    const run = isolateCommand({ command: [script, join(work, 'nothing')], seed: 2, collect: ['out.txt'] });
    expect(run).toMatchObject({ status: 0, files: { 'out.txt': 'no\n' } });
    expect(run.divergence).toBeUndefined();
  });
});

describe('functions across the frame', () => {
  type Fn = {
    counter(start: number): () => number;
    apply(values: number[], statistic: (xs: number[]) => number): number;
    useCounter(next: () => number): number;
    busy(ms: number): boolean;
    LIMIT: number;
  };
  const frameOf = (options: Partial<Parameters<typeof isolate>[0]> = {}) => {
    const frame = isolate<Fn>({
      module: new URL('fixtures/cheater/functions.mjs', import.meta.url).pathname,
      seed: 1,
      plain: false,
      ...options,
    });
    open.push(frame as Frame<unknown>);
    return frame;
  };

  it('keeps a function the product returned as a handle that calls the product, in every run', () => {
    const frame = frameOf();
    const next = frame.product.counter(10);
    expect([next(), next(), next()]).toEqual([11, 12, 13]);
    expect(frame.divergence()).toBeUndefined();
    expect(frame.product.useCounter(next)).toBe(14 + 15);
  });

  it('refuses a function argument unless the frame is told to send its source', () => {
    expect(() => frameOf().product.apply([1, 2, 3], (xs) => xs.length)).toThrow(/cannot cross/);
    const frame = frameOf({ functions: 'source' });
    expect(frame.product.apply([1, 2, 3], (xs) => xs.length + 1)).toBe(4);
    expect(frame.divergence()).toBeUndefined();
  });

  it('shows the exports of the product and nothing else', () => {
    const frame = frameOf();
    expect(frame.product.LIMIT).toBe(7);
    expect('counter' in frame.product).toBe(true);
    expect((frame.product as unknown as Record<string, unknown>).nothing).toBeUndefined();
  });

  it('reports the processor time the product used, measured in its own process', () => {
    const frame = frameOf();
    frame.product.busy(150);
    expect(frame.cpuSince(0)).toBeGreaterThan(100);
    expect(frame.cpuSince(1)).toBe(0);
  });
});
