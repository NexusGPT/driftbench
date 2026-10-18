import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSpecFiles, loadSpecs } from '@agent-nexus/driftbench-core';
import { faultAdapter, importFaultSet } from '@agent-nexus/driftbench-generate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { afterAll, describe, expect, it } from 'vitest';
import { acmeAdapter } from '../../core/test/runner/support';
import {
  defaultHoldoutDeps,
  type HoldoutDeps,
  holdoutScoreCommand,
  holdoutSealCommand,
} from '../src/commands/holdout';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GATED = join(ROOT, 'examples/acme/gated');
const HAND = join(ROOT, 'examples/acme/specs/conversations');
const FAULTS = join(ROOT, 'examples/acme/faults/index.ts');
const SLOW = 60_000;
const FIXED_DAY = () => new Date('2026-10-11T12:00:00Z');

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-holdout-test-'));
  made.push(dir);
  return dir;
}

function capture() {
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
  return { io, output };
}

async function run(argv: string[]) {
  const { io, output } = capture();
  const code = await main(argv, io);
  return { code, ...output };
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

type Bundle = {
  split: string;
  seed: number;
  share: number;
  specs: Array<{ id: string; hash: string; spec: { title: string } }>;
};
type BudgetFile = {
  total: number;
  used: number;
  scores: Array<{
    query: number;
    state: string;
    conversations?: number;
    passed?: number;
    not_run?: string[];
  }>;
};

/** The control suite of the gate: five dev specs and two sealed ones, run on the Acme sales agent. */
async function sealedControl(): Promise<string> {
  const out = join(await temp(), 'sealed');
  const result = await run(['holdout', 'seal', '--specs', join(GATED, 'control-handwritten'), '--out', out]);
  expect(result.err).toBe('');
  expect(result.code).toBe(0);
  return out;
}

describe('driftbench holdout seal', () => {
  it(
    "takes the gate's sealed split as it is, and writes a bundle no spec loader reads",
    async () => {
      const out = join(await temp(), 'sealed');
      const result = await run([
        'holdout',
        'seal',
        '--specs',
        GATED,
        '--share',
        '0.5',
        '--seed',
        '7',
        '--out',
        out,
      ]);
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      expect(result.out).toContain('the gate sealed its split at seed 1, share 0.2; that split is kept');
      expect(result.out).toContain("Sealed 58 of 258 gated specs: the gate's split (seed 1, share 0.2)");

      const bundle = await json<Bundle>(join(out, 'sealed.json'));
      expect(bundle).toMatchObject({ split: 'gate', seed: 1, share: 0.2 });
      const seal = await json<{ specs: Array<{ id: string; hash: string }> }>(
        join(GATED, 'holdout/seal.json'),
      );
      const hand = await json<{ specs: Array<{ id: string; hash: string }> }>(
        join(GATED, 'control-handwritten/holdout/seal.json'),
      );
      const expected = [...seal.specs, ...hand.specs].map(({ id, hash }) => `${id}@${hash}`).sort();
      expect(bundle.specs.map(({ id, hash }) => `${id}@${hash}`).sort()).toEqual(expected);

      expect(await findSpecFiles([out])).toEqual([]);
      expect(await loadSpecs([out])).toEqual([]);
    },
    SLOW,
  );

  it('draws a share of a plain folder with the gate rule: the same seed seals the same specs', async () => {
    const dir = await temp();
    const specs = join(dir, 'specs');
    await cp(HAND, specs, { recursive: true });
    const draw = async (seed: string, out: string) => {
      const result = await run([
        'holdout',
        'seal',
        '--specs',
        specs,
        '--share',
        '0.5',
        '--seed',
        seed,
        '--out',
        out,
      ]);
      expect(result.code).toBe(0);
      return (await json<Bundle>(join(out, 'sealed.json'))).specs.map((entry) => entry.id);
    };
    const first = await draw('3', join(dir, 'a'));
    const again = await draw('3', join(dir, 'b'));
    expect(first).toEqual(again);
    expect(first.length).toBeGreaterThan(0);
    expect((await json<Bundle>(join(dir, 'a', 'sealed.json'))).split).toBe('draw');
    const seeds = await Promise.all(['1', '2', '4', '5'].map((seed) => draw(seed, join(dir, `s${seed}`))));
    expect(seeds.some((ids) => ids.join() !== first.join())).toBe(true);
  });

  it('refuses to seal again over a seal, and never over one that was scored', async () => {
    const out = await sealedControl();
    const again = await run(['holdout', 'seal', '--specs', join(GATED, 'control-handwritten'), '--out', out]);
    expect(again.code).toBe(2);
    expect(again.err).toContain('already exists');
    const forced = await run([
      'holdout',
      'seal',
      '--specs',
      join(GATED, 'control-handwritten'),
      '--out',
      out,
      '--force',
    ]);
    expect(forced.code).toBe(0);
    await writeFile(join(out, 'budget.json'), JSON.stringify({ total: 1, used: 1, scores: [] }));
    const scored = await run([
      'holdout',
      'seal',
      '--specs',
      join(GATED, 'control-handwritten'),
      '--out',
      out,
      '--force',
    ]);
    expect(scored.code).toBe(2);
    expect(scored.err).toContain('a scored holdout is never sealed again');
  });

  it('rejects a share outside (0, 1) and a folder of specs that does not exist', async () => {
    const out = join(await temp(), 'sealed');
    for (const share of ['0', '1', 'half']) {
      const result = await run(['holdout', 'seal', '--specs', HAND, '--share', share, '--out', out]);
      expect(result.code).toBe(2);
      expect(result.err).toContain('--share must be a number above 0 and below 1');
    }
    const missing = await run(['holdout', 'seal', '--specs', join(out, 'none'), '--out', out]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('Cannot find');
  });

  it('names the gate output folder when --specs is the specs folder inside it', async () => {
    const out = join(await temp(), 'sealed');
    const result = await run(['holdout', 'seal', '--specs', join(GATED, 'specs'), '--out', out]);
    expect(result.code).toBe(2);
    expect(result.err).toBe(
      "--specs examples/acme/gated/specs is the specs folder inside a gate output. The specs the gate sealed are beside it, in examples/acme/gated/holdout. Pass the gate's output folder: --specs examples/acme/gated\n",
    );
    // The folder the message names seals as it is.
    const fixed = await run(['holdout', 'seal', '--specs', GATED, '--out', out]);
    expect(fixed.err).toBe('');
    expect(fixed.code).toBe(0);
  });
});

describe('driftbench holdout score', () => {
  it(
    'needs a budget the first time, scores once through the runner, then spends the budget and refuses',
    async () => {
      const sealed = await sealedControl();
      const noBudget = await run(['holdout', 'score', '--sealed', sealed, '--target', 'function:acme-sales']);
      expect(noBudget.code).toBe(2);
      expect(noBudget.err).toContain('pass --budget <queries>');

      const first = await run([
        'holdout',
        'score',
        '--sealed',
        sealed,
        '--target',
        'function:acme-sales',
        '--budget',
        '2',
      ]);
      expect(first.err).toBe('');
      expect(first.code).toBe(0);
      expect(first.out).toContain('query 1 of 2, on function:acme-sales: 2 sealed conversations');
      // The price-sheet task names the ops agent: it is listed and left out of the rate.
      expect(first.out).toContain('Not run, not counted: acme-price-sheet (names process:acme-ops).');
      expect(first.out).toMatch(
        /conversations\s+passed\s+pass rate\s+95% Wilson interval\n\s+1\s+1\s+100\.0%\s+20\.7% to 100\.0%/,
      );
      expect(first.out).toContain('Budget: 1 of 2 queries used, 1 left.');
      expect(first.out).not.toContain('acme-off-topic-return');

      const changed = await run([
        'holdout',
        'score',
        '--sealed',
        sealed,
        '--target',
        'function:acme-sales',
        '--budget',
        '5',
      ]);
      expect(changed.code).toBe(2);
      expect(changed.err).toContain('fixed at 2 queries');

      const second = await run(['holdout', 'score', '--sealed', sealed, '--target', 'function:acme-sales']);
      expect(second.code).toBe(0);
      expect(second.out).toContain('Budget: 2 of 2 queries used, 0 left.');

      const third = await run(['holdout', 'score', '--sealed', sealed, '--target', 'function:acme-sales']);
      expect(third.code).toBe(1);
      expect(third.err).toContain('The query budget is spent: 2 of 2 queries used.');
      expect(third.out).toBe('');

      const budget = await json<BudgetFile>(join(sealed, 'budget.json'));
      expect(budget.total).toBe(2);
      expect(budget.used).toBe(2);
      expect(
        budget.scores.map((entry) => [entry.query, entry.state, entry.conversations, entry.passed]),
      ).toEqual([
        [1, 'scored', 1, 1],
        [2, 'scored', 1, 1],
      ]);
    },
    SLOW,
  );

  it(
    'fails the conversations a planted fault breaks: the score reads real runs',
    async () => {
      const sealed = join(await temp(), 'sealed');
      const { io } = capture();
      expect(await holdoutSealCommand({ specs: GATED, out: sealed }, io, defaultHoldoutDeps)).toBe(0);
      const { faults } = await importFaultSet(FAULTS);
      const wrongLanguage = faults.find((fault) => fault.id === 'x4-wrong-language');
      if (!wrongLanguage) throw new Error('the Acme fault set has no x4-wrong-language');
      const deps: HoldoutDeps = {
        ...defaultHoldoutDeps,
        adapterFor: async () => faultAdapter(wrongLanguage, () => localProvider()),
        now: FIXED_DAY,
      };
      const scored = capture();
      const code = await holdoutScoreCommand(
        { sealed, target: 'function:acme-sales', budget: '1' },
        scored.io,
        deps,
      );
      expect(scored.output.err).toBe('');
      expect(code).toBe(0);
      // Every gated block reads the reply language, so the fault that answers in French fails all 35.
      expect(scored.output.out).toMatch(/\n\s+47\s+0\s+0\.0%\s+0\.0% to 7\.6%/);
    },
    SLOW,
  );

  it(
    'leaves a conversation with a block not run out of the rate, and lists it as not run',
    async () => {
      const sealed = join(await temp(), 'sealed');
      const { io } = capture();
      expect(await holdoutSealCommand({ specs: GATED, out: sealed }, io, defaultHoldoutDeps)).toBe(0);
      const deps: HoldoutDeps = {
        ...defaultHoldoutDeps,
        // The Acme agent on an adapter that cannot force a tool result: a spec that forces one is not run.
        adapterFor: async () => acmeAdapter({ capabilities: { toolStubs: false } }),
        now: FIXED_DAY,
      };
      const scored = capture();
      const code = await holdoutScoreCommand(
        { sealed, target: 'function:acme-sales', budget: '1', json: true },
        scored.io,
        deps,
      );
      expect(scored.output.err).toBe('');
      expect(code).toBe(0);
      const result = JSON.parse(scored.output.out) as {
        conversations: number;
        passed: number;
        not_run: string[];
      };
      const notRun = result.not_run.filter((entry) => entry.endsWith('(a block not run)'));
      expect(notRun.length).toBeGreaterThan(0);
      // The 47 sealed conversations the fault test scores: those not run are out of the rate, not failures.
      expect(result.conversations + notRun.length).toBe(47);
    },
    SLOW,
  );

  it('refuses a bundle that was changed, and spends no query', async () => {
    const sealed = await sealedControl();
    const path = join(sealed, 'sealed.json');
    const bundle = await json<Bundle>(path);
    const first = bundle.specs[0];
    if (!first) throw new Error('empty bundle');
    first.spec.title = 'Edited after the seal';
    await writeFile(path, JSON.stringify(bundle));
    const result = await run([
      'holdout',
      'score',
      '--sealed',
      sealed,
      '--target',
      'function:acme-sales',
      '--budget',
      '1',
    ]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('the content hash changed since it was sealed');
    expect(result.err).toContain('The sealed bundle was changed: it is not scored.');
    await expect(readFile(join(sealed, 'budget.json'), 'utf8')).rejects.toThrow();
  });

  it('spends no query when the target has no adapter or is malformed', async () => {
    const sealed = await sealedControl();
    const unknown = await run([
      'holdout',
      'score',
      '--sealed',
      sealed,
      '--target',
      'http:nobody',
      '--budget',
      '1',
    ]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('No adapter is set up for http:nobody: nothing ran, no query was spent.');
    const bare = await run(['holdout', 'score', '--sealed', sealed, '--target', 'function', '--budget', '1']);
    expect(bare.code).toBe(2);
    expect(bare.err).toContain('--target takes adapter:agent');
    const missing = await run([
      'holdout',
      'score',
      '--sealed',
      join(sealed, 'none'),
      '--target',
      'function:acme-sales',
      '--budget',
      '1',
    ]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('run driftbench holdout seal first');
    await expect(readFile(join(sealed, 'budget.json'), 'utf8')).rejects.toThrow();
  });
});
