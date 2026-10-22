import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('a product that carries a stamp from run C to a later frame', () => {
  it('fails every frame, and the validator leaves the stamped source as the product wrote it', () => {
    const file = plant('stamp');
    for (const seed of [1, 2, 3, 4]) {
      let pass = true;
      try {
        pass = framed('stamp', seed).pass;
      } catch {
        // a tree an unconfined run changed starts no frame
        pass = false;
      }
      expect(pass, `seed ${seed}`).toBe(false);
    }
    // The validator never writes, restores or deletes in the user's tree: the stamp is still there.
    expect(readFileSync(file, 'utf8')).toMatch(/const STAMP = [1-9]\d+;/);
  });
});

/**
 * The second review of PR 969 (codex-review-stats and codex-review-validators): run C created a new file in a granted
 * folder that a later frame read; a static import of an ungranted file of expected values was bundled into the
 * product; and a correct product reading its data through import.meta.url failed once sealed.
 */
describe('the second review of PR 969', () => {
  // A tree an unconfined run changed is marked and starts no frame, so each test has a tree of its own.
  let area = '';
  let sources = '';
  let oracles = '';
  beforeEach(() => {
    area = realpathSync(mkdtempSync(join(work, 'second-')));
    sources = join(area, 'product');
    oracles = join(area, 'oracle');
    mkdirSync(sources);
    mkdirSync(oracles);
  });

  function run(module: string, seed: number, reads: string[] = []) {
    let frame: Frame<{ value: () => number }> | undefined;
    let value: number | null = null;
    let error: string | null = null;
    try {
      frame = isolate({ module, seed, reads });
      try {
        value = frame.product.value();
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      return { value, error, divergence: frame.divergence() ?? null };
    } catch (cause) {
      return { value, error: cause instanceof Error ? cause.message : String(cause), divergence: null };
    } finally {
      frame?.close();
    }
  }

  it('accepts a normal pure product as the positive control', () => {
    const module = join(sources, 'good.mjs');
    writeFileSync(module, 'export function value() { return 137; }\n');
    expect(run(module, 71)).toMatchObject({ value: 137, error: null, divergence: null });
  });

  it('refuses to bundle an import of a file outside the product tree', () => {
    writeFileSync(join(oracles, 'expected.mjs'), 'export const expected = 137;\n');
    const module = join(sources, 'static.mjs');
    writeFileSync(
      module,
      'import { expected } from "../oracle/expected.mjs";\nexport function value() { return expected; }\n',
    );
    const result = run(module, 72);
    expect(result.value).not.toBe(137);
    expect(result.error).toMatch(/outside its source tree/);
  });

  it('refuses to bundle a data file that is not granted', () => {
    writeFileSync(join(sources, 'data.json'), '{"expected":137}\n');
    const module = join(sources, 'datajson.mjs');
    writeFileSync(
      module,
      'import data from "./data.json" with { type: "json" };\nexport function value() { return data.expected; }\n',
    );
    expect(run(module, 74).error).toMatch(/data file/);
  });

  it('does not carry oracle bytes through a new file in a granted folder, on any later frame', () => {
    const cache = join(area, 'data');
    mkdirSync(cache);
    const copied = join(cache, 'new.json');
    const oracle = join(oracles, 'expected.json');
    writeFileSync(oracle, '{"expected":137}\n');
    const module = join(sources, 'cache.mjs');
    writeFileSync(
      module,
      `import fs from 'node:fs';
const cache = ${JSON.stringify(copied)};
const oracle = ${JSON.stringify(oracle)};
export function value() {
  let value = 0;
  try { value = JSON.parse(fs.readFileSync(cache, 'utf8')).expected; } catch {}
  try { fs.writeFileSync(cache, fs.readFileSync(oracle, 'utf8')); } catch {}
  return value;
}
`,
    );
    const rows = [1, 2, 3, 4].map((seed) => {
      const result = run(module, seed, [cache]);
      return result.value === 137 && result.error === null && result.divergence === null;
    });
    expect(rows).toEqual([false, false, false, false]);
    // The validator does not delete what the product wrote: the file is left for the user to see.
    expect(existsSync(copied)).toBe(true);
  });

  describe.each(['shadow', 'shadow-up'])(
    'the probe %s of the reviews of PR 969 (opus-review-b, verbatim)',
    (name) => {
      // The product imports zzstampdep, installed in this file's own work folder (never in the project's node_modules,
      // which other test files read at the same time) with STAMP = 0. Run C writes, once, a
      // nearer copy (beside the product, or one folder above it) with a fresh STAMP; a later frame must not take it.
      beforeAll(() => {
        const installed = join(work, 'node_modules', 'zzstampdep');
        mkdirSync(installed, { recursive: true });
        writeFileSync(
          join(installed, 'package.json'),
          '{"name":"zzstampdep","version":"1.0.0","type":"module","main":"index.mjs"}',
        );
        writeFileSync(join(installed, 'index.mjs'), 'export const STAMP = 0;\n');
      });

      it('fails every frame', () => {
        const oracle = join(oracles, 'shadow-expected.json');
        writeFileSync(oracle, '{"expected":137}\n');
        const module = join(sources, `${name}.mjs`);
        writeFileSync(
          module,
          readFileSync(new URL(`${name}.mjs`, FIXTURES), 'utf8').replace(/__ORACLE__/g, oracle),
        );
        const rows = [1, 2, 3, 4].map((seed) => {
          let frame: Frame<Cheat> | undefined;
          try {
            frame = isolate<Cheat>({ module, seed });
            return item(frame.product.sumOdd, seed) && frame.divergence() === undefined;
          } catch {
            return false;
          } finally {
            frame?.close();
          }
        });
        expect(rows).toEqual([false, false, false, false]);
      });
    },
  );

  it.each([
    ['one folder above the product tree', 1],
    ['two folders above the product tree', 2],
  ])('does not let run C plant a package %s for a later frame to bundle', (_name, up) => {
    // The probe of the third review of PR 969: Node.js resolves a package from every ancestor's node_modules.
    const tree = join(sources, 'inner');
    mkdirSync(tree);
    const above = up === 1 ? sources : area;
    mkdirSync(join(above, 'node_modules'), { recursive: true });
    const installed = join(work, 'node_modules', 'zzabovedep');
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, 'index.mjs'), 'export const STAMP = 0;\n');
    const planted = join(above, 'node_modules', 'zzabovedep');
    const oracle = join(oracles, 'above-expected.json');
    writeFileSync(oracle, '137');
    const module = join(tree, 'up.mjs');
    writeFileSync(
      module,
      `import fs from 'node:fs';
try {
  fs.readFileSync(${JSON.stringify(oracle)}, 'utf8');
  if (!fs.existsSync(${JSON.stringify(join(planted, 'index.mjs'))})) {
    fs.mkdirSync(${JSON.stringify(planted)}, { recursive: true });
    fs.writeFileSync(${JSON.stringify(join(planted, 'index.mjs'))}, 'export const STAMP = ' + Date.now() + ';\\n');
  }
} catch {}
const { STAMP } = await import('zzabovedep');
export const get = () => (Date.now() - STAMP < 3600000 ? 137 : 0);
`,
    );
    const rows = [1, 2, 3, 4].map((seed) => {
      let frame: Frame<{ get: () => number }> | undefined;
      try {
        frame = isolate({ module, seed });
        return frame.product.get() === 137 && frame.divergence() === undefined;
      } catch {
        return false;
      } finally {
        frame?.close();
      }
    });
    expect(rows).toEqual([false, false, false, false]);
  });

  it('never writes, restores or deletes anything in a tree of more than 20,000 files', () => {
    // A guard against data loss, not a bypass: it may be green on a validator that never deleted anything.
    const big = join(sources, 'big');
    mkdirSync(big);
    for (let i = 0; i < 25_000; i += 1) writeFileSync(join(big, `f${i}.txt`), `file ${i}\n`);
    const module = join(sources, 'bigtree.mjs');
    writeFileSync(module, 'export function value() { return 137; }\n');
    const inventory = () => {
      const hash = createHash('sha256');
      const names = readdirSync(big).sort();
      for (const name of names) {
        hash.update(name);
        hash.update(readFileSync(join(big, name)));
      }
      return `${names.length} ${hash.digest('hex')}`;
    };
    const before = inventory();
    expect(run(module, 75, [big])).toMatchObject({ value: 137, error: null, divergence: null });
    expect(inventory()).toBe(before);
  });

  it('lets a correct product read data granted in reads through import.meta.url', () => {
    const data = join(sources, 'granted.json');
    writeFileSync(data, '{"expected":137}\n');
    const module = join(sources, 'granted.mjs');
    writeFileSync(
      module,
      'import fs from "node:fs";\nexport function value() { return JSON.parse(fs.readFileSync(new URL("./granted.json", import.meta.url), "utf8")).expected; }\n',
    );
    expect(run(module, 73, [data])).toMatchObject({ value: 137, error: null, divergence: null });
  });
});
