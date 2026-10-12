import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FAULTS = join(ROOT, 'examples/acme/faults');
const HAND = join(ROOT, 'examples/acme/specs/conversations');
const GENERATED = join(ROOT, 'examples/acme/generated/specs/deviation');
const INCOMPLETE = join(ROOT, 'examples/acme/generated/incomplete/twise');
const SLOW = 120_000;

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-gate-test-'));
  made.push(dir);
  return dir;
}

/** A candidates folder holding copies of the named files. */
async function folder(files: string[]): Promise<string> {
  const dir = await temp();
  await mkdir(join(dir, 'specs'));
  for (const file of files) await copyFile(file, join(dir, 'specs', file.split('/').at(-1) as string));
  return join(dir, 'specs');
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

const BASE = ['--reference', 'function:acme-sales', '--faults', FAULTS, '--k', '2', '--date', '2026-10-11'];

describe('driftbench gate', () => {
  it(
    'gates hand-written and generated candidates, prints the funnel and writes the suite and the report',
    async () => {
      const specs = await folder([
        join(HAND, 'order-loose-confirmation.yaml'),
        join(HAND, 'tool-failure.yaml'),
        join(GENERATED, 'gen-deviation-004.yaml'),
      ]);
      const out = join(await temp(), 'gated');
      const result = await run(['gate', specs, ...BASE, '--holdout', '0', '--out', out]);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      expect(result.out).toContain('1. observed');
      expect(result.out).toContain('5. red_first');
      expect(result.out).toContain('Mutation score per fault class (gated suite):');
      expect(result.out).toContain('wrap a target that is not a --reference; they do not run');
      const files = await tree(out);
      expect(files).toEqual(
        expect.arrayContaining([
          'gate-report.json',
          'holdout/seal.json',
          'label-audit.yaml',
          'review.yaml',
          'specs/order-loose-confirmation.yaml',
          'specs/tool-failure.yaml',
        ]),
      );
      // The generated probe walks an approved path: its loose yes at the recap passes the reference and
      // goes red on the fault that orders on a loose yes.
      expect(files).toContain('specs/gen-deviation-004.yaml');
      const report = JSON.parse(await readFile(join(out, 'gate-report.json'), 'utf8'));
      expect(report.summary.specs).toBe(3);
      expect(report.funnel.map((row: { stage: string }) => row.stage)).toEqual([
        'observed',
        'leakage',
        'shortcut',
        'contrast',
        'red_first',
        'stability',
        'difficulty',
        'label_audit',
        'freshness',
      ]);
      const probe = report.blocks.find(
        (block: { key: string }) => block.key === 'gen-deviation-004#b5-D4_loose_confirmation',
      );
      expect(probe).toMatchObject({ status: 'accepted' });
      expect(probe.faults['d4-order-on-loose-yes']).toMatchObject({ outcome: 'fail' });
      const control = report.mutation.by_fault.find(
        (fault: { id: string }) => fault.id === 'control-sales-identity',
      );
      expect(control).toMatchObject({ equivalent: true, suite: { red: 0 } });
    },
    SLOW,
  );

  it(
    'refuses to overwrite an earlier output without --force, and replaces it with --force',
    async () => {
      const specs = await folder([join(HAND, 'tool-failure.yaml')]);
      const out = join(await temp(), 'gated');
      expect((await run(['gate', specs, ...BASE, '--out', out])).code).toBe(0);
      const again = await run(['gate', specs, ...BASE, '--out', out]);
      expect(again.code).toBe(2);
      expect(again.err).toContain('already exists');
      const forced = await run(['gate', specs, ...BASE, '--out', out, '--force', '--json']);
      expect(forced.code).toBe(0);
      expect(JSON.parse(forced.out).gate).toBe('driftbench gate');
    },
    SLOW,
  );

  it(
    'exits 1 when no candidate block passes',
    async () => {
      // Two specs no path could build: their blocks hold judged criteria only, so stage 1 rejects them.
      const specs = await folder([
        join(INCOMPLETE, 'gen-twise-089.yaml'),
        join(INCOMPLETE, '../boundary/gen-boundary-062.yaml'),
      ]);
      const out = join(await temp(), 'gated');
      const result = await run(['gate', specs, ...BASE, '--out', out]);
      expect(result.code).toBe(1);
      expect(result.out).toContain('Accepted 0 of 2 blocks.');
      expect(result.out).toContain('no-machine-then 2');
      expect(await tree(out)).toEqual([
        'gate-report.json',
        'holdout/seal.json',
        'label-audit.yaml',
        'review.yaml',
      ]);
    },
    SLOW,
  );

  it('exits 2 on usage and input errors, and writes nothing', async () => {
    const specs = await folder([join(HAND, 'tool-failure.yaml')]);
    const out = join(await temp(), 'gated');
    const cases: [string[], string][] = [
      [['--reference', 'function', '--faults', FAULTS], '--reference takes adapter:agent'],
      [
        ['--reference', 'function:acme-sales', '--faults', join(ROOT, 'examples/acme/no-such-faults')],
        'Cannot load the fault set',
      ],
      [
        ['--reference', 'function:acme-sales', '--faults', FAULTS, '--k', '0'],
        '--k must be a whole number of at least 1',
      ],
      [
        ['--reference', 'function:acme-sales', '--faults', FAULTS, '--holdout', '2'],
        '--holdout must be a number from 0 to 1',
      ],
      [
        ['--reference', 'function:acme-sales', '--faults', FAULTS, '--route', 'flow:x=process:acme-ops'],
        'process:acme-ops is not a --reference',
      ],
      [['--reference', 'process:acme-ops', '--faults', FAULTS], 'name a target that is not a --reference'],
      [['--reference', 'function:nobody', '--faults', FAULTS], 'name a target that is not a --reference'],
    ];
    for (const [flags, message] of cases) {
      const result = await run(['gate', specs, ...flags, '--out', out]);
      expect({ flags, code: result.code }).toEqual({ flags, code: 2 });
      expect(result.err).toContain(message);
    }
    await expect(readdir(out)).rejects.toThrow();
  });
});
