import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAP = join(ROOT, 'examples/acme/map/space.yaml');
const GATED = join(ROOT, 'examples/acme/gated');
const HAND = join(ROOT, 'examples/acme/specs/conversations');
const SLOW = 60_000;

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-select-test-'));
  made.push(dir);
  return dir;
}

async function run(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: ROOT,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

async function tree(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(relative(dir, full));
    }
  };
  await walk(dir);
  return out.sort();
}

type Manifest = {
  golden: Array<{ id: string; path: string; adds_faults: string[] }>;
  cover: string[];
  coverage: { allowed: number; covered: number; pool_covered: number; required: Array<{ covered: boolean }> };
  pool: { specs: number; sealed_left_out: number; faults_red: number };
  uncoverable_required: string[];
};

async function manifest(dir: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(dir, 'golden.json'), 'utf8')) as Manifest;
}

describe('driftbench select', () => {
  it(
    'chooses ten Acme conversations from the gated suite, leaves every sealed spec out and prints the cover table',
    async () => {
      const out = join(await temp(), 'golden');
      const result = await run(['select', '--cover', MAP, '--specs', GATED, '--k', '10', '--out', out]);
      expect(result.err).toBe('');
      // The price-sheet task family writes a dev-split spec with an instruction in data: every required cell
      // has an unsealed spec.
      expect(result.code).toBe(0);
      expect(result.out).toContain('Pool: 200 unsealed specs; 58 sealed specs left out');
      expect(result.out).toContain('k = 10 is smaller than the cover');
      expect(result.out).toContain('Required cells: 10 of 10; the pool covers 10.');
      expect(result.out).not.toContain('✗ flow price-sheet');
      expect(result.out).toMatch(/Cells covered: \d+ of 708 allowed pairs .*; the pool covers 598\./);
      expect(result.out).toContain('Faults turned red: 12 of the 13 the pool turns red');

      const golden = await manifest(out);
      expect(golden.golden).toHaveLength(10);
      expect(golden.coverage.allowed).toBe(708);
      expect(golden.coverage.pool_covered).toBe(598);
      expect(golden.pool).toMatchObject({ specs: 200, sealed_left_out: 58, faults_red: 13 });
      expect(golden.uncoverable_required).toEqual([]);
      const faults = new Set(golden.golden.flatMap((pick) => pick.adds_faults));
      expect(faults.size).toBe(12);

      const seal = JSON.parse(await readFile(join(GATED, 'holdout/seal.json'), 'utf8')) as {
        specs: Array<{ id: string }>;
      };
      const sealed = new Set(seal.specs.map((entry) => entry.id));
      sealed.add('acme-off-topic-return');
      sealed.add('acme-price-sheet');
      for (const pick of golden.golden) expect(sealed.has(pick.id)).toBe(false);

      const files = await tree(out);
      expect(files).toHaveLength(11);
      expect(files).toContain('golden.json');
      for (const pick of golden.golden) expect(files).toContain(pick.path);
      expect(files.every((file) => !file.includes('holdout'))).toBe(true);
    },
    SLOW,
  );

  it(
    'writes the same golden set on every run, and the whole cover without --k',
    async () => {
      const first = join(await temp(), 'golden');
      const second = join(await temp(), 'golden');
      expect(
        (await run(['select', '--cover', MAP, '--specs', GATED, '--k', '10', '--out', first])).code,
      ).toBe(0);
      expect(
        (await run(['select', '--cover', MAP, '--specs', GATED, '--k', '10', '--out', second])).code,
      ).toBe(0);
      expect(await readFile(join(first, 'golden.json'), 'utf8')).toBe(
        await readFile(join(second, 'golden.json'), 'utf8'),
      );

      const whole = join(await temp(), 'golden');
      const result = await run(['select', '--cover', MAP, '--specs', GATED, '--out', whole]);
      expect(result.code).toBe(0);
      const cover = await manifest(whole);
      expect(cover.golden.map((pick) => pick.id)).toEqual(cover.cover);
      expect(cover.coverage.covered).toBe(598);
      expect(result.out).not.toContain('is smaller than the cover');
    },
    SLOW,
  );

  it('selects from a plain folder of specs with no gate output, and exits 0 when every required cell is covered', async () => {
    const dir = await temp();
    const specs = join(dir, 'specs');
    await cp(HAND, specs, { recursive: true });
    const map = join(dir, 'space.yaml');
    const text = await readFile(MAP, 'utf8');
    // Without the inventory the map requires no cell.
    await writeFile(map, text.replace(/^inventory: .*$/m, ''));
    const out = join(dir, 'golden');
    const result = await run(['select', '--cover', map, '--specs', specs, '--out', out]);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain('Required cells: 0 of 0');
    expect(result.out).toContain('Faults turned red: no gate report found');
    const golden = await manifest(out);
    expect(golden.golden.map((pick) => pick.id)).toEqual(golden.cover);
  });

  it(
    'refuses to replace an earlier golden set without --force, and replaces it with --force',
    async () => {
      const out = join(await temp(), 'golden');
      expect((await run(['select', '--cover', MAP, '--specs', GATED, '--k', '3', '--out', out])).code).toBe(
        1,
      );
      const again = await run(['select', '--cover', MAP, '--specs', GATED, '--k', '2', '--out', out]);
      expect(again.code).toBe(2);
      expect(again.err).toContain('already exists');
      const forced = await run([
        'select',
        '--cover',
        MAP,
        '--specs',
        GATED,
        '--k',
        '2',
        '--out',
        out,
        '--force',
      ]);
      expect(forced.code).toBe(1);
      expect(await tree(out)).toHaveLength(3);
    },
    SLOW,
  );

  it('refuses a sealed spec that changed after the gate sealed it', async () => {
    const dir = await temp();
    const gated = join(dir, 'gated');
    await cp(join(GATED, 'control-handwritten'), gated, { recursive: true });
    const path = join(gated, 'holdout/conversations/off-topic-return.yaml');
    await writeFile(
      path,
      (await readFile(path, 'utf8')).replace(/^title: .*$/m, 'title: Edited after the seal'),
    );
    const result = await run(['select', '--cover', MAP, '--specs', gated, '--out', join(dir, 'golden')]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('no longer hashes to a531a8b6fd91');
    expect(result.err).toContain('A sealed spec changed after the gate sealed it');
  });

  it('exits 2 on a usage error and writes nothing', async () => {
    const dir = await temp();
    const out = join(dir, 'golden');
    const cases: Array<[string[], string]> = [
      [['--k', '0'], '--k must be a whole number of at least 1'],
      [['--t', '9'], 'the map has 7 dimensions'],
      [['--t', 'two'], '--t must be a whole number'],
    ];
    for (const [extra, message] of cases) {
      const result = await run(['select', '--cover', MAP, '--specs', GATED, '--out', out, ...extra]);
      expect(result.code).toBe(2);
      expect(result.err).toContain(message);
    }
    const overlap = await run(['select', '--cover', MAP, '--specs', GATED, '--out', join(GATED, 'golden')]);
    expect(overlap.code).toBe(2);
    expect(overlap.err).toContain('--out and --specs overlap');
    const missing = await run(['select', '--cover', MAP, '--specs', join(dir, 'none'), '--out', out]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('Cannot find');
    await mkdir(join(dir, 'empty'));
    const empty = await run(['select', '--cover', MAP, '--specs', join(dir, 'empty'), '--out', out]);
    expect(empty.code).toBe(2);
    expect(empty.err).toContain('No unsealed spec found');
    await expect(readdir(out)).rejects.toThrow();
  });
});
