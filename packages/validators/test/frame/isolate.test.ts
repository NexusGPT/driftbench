import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decode,
  type Frame,
  FrameError,
  isolate,
  isolateCommand,
  neutralName,
  replay,
} from '../../src/frame';
import * as cheats from './fixtures/cheats';
import type * as probe from './fixtures/probe';

/**
 * The frame (docs/validators.md, "The frame: the product runs apart, the parent decides"). Each planted cheat of
 * fixtures/cheats.ts passes an item when the product runs in the validator's own process, the way the ladders ran
 * it when the cheater audits found these cheats, and fails it under the frame: the product runs in two child
 * processes that differ in every signal the cheats read, and the parent decides from the recorded answers.
 */

// Run C starts a process per call, so a test of three seeds takes some seconds.
vi.setConfig({ testTimeout: 300_000 });

const CHEATS = fileURLToPath(new URL('./fixtures/cheats.ts', import.meta.url));
const PROBE = fileURLToPath(new URL('./fixtures/probe.ts', import.meta.url));
const COMMAND = fileURLToPath(new URL('./fixtures/cheat-command.mjs', import.meta.url));
type Cheats = typeof cheats;
type SumOdd = (xs: readonly number[]) => number;

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

/** An item: the sum of the odd numbers of every list of the seed, against the reference computed here. */
function item(sumOdd: SumOdd, seed: number): boolean {
  return lists(seed).every((xs) => sumOdd(xs) === reference(xs));
}

const open: Frame<unknown>[] = [];
function frameOf(seed: number, options: Partial<Parameters<typeof isolate>[0]> = {}): Frame<Cheats> {
  const frame = isolate<Cheats>({ module: CHEATS, seed, ...options });
  open.push(frame as Frame<unknown>);
  return frame;
}
afterEach(() => {
  for (const frame of open.splice(0)) frame.close();
});

/** The item under the frame: its own check on the answers, and the same answers from both runs. */
function framed(name: keyof Cheats, seed: number): { pass: boolean; divergence?: string } {
  const frame = frameOf(seed);
  // A product the confinement stops from reading a file throws where an unconfined run answers: the item fails.
  let pass = false;
  try {
    pass = item(frame.product[name] as SumOdd, seed);
  } catch {
    pass = false;
  }
  const divergence = frame.divergence();
  return { pass: pass && divergence === undefined, divergence };
}

const CLASSES = ['argv', 'runner', 'cwd', 'env', 'stack', 'uptime'] as const;
const IN_PROCESS: Record<(typeof CLASSES)[number], SumOdd> = {
  argv: cheats.argv,
  runner: cheats.runner,
  cwd: cheats.cwd,
  env: cheats.env,
  stack: cheats.stack,
  uptime: cheats.uptime,
};

describe('the frame', () => {
  it('passes an honest product on every seed', () => {
    for (const seed of [1, 2, 3])
      expect(framed('honest', seed)).toEqual({ pass: true, divergence: undefined });
  });

  it('passes an honest product that writes a cache file when it can', () => {
    for (const seed of [1, 2, 3])
      expect(framed('cacheWriter', seed)).toEqual({ pass: true, divergence: undefined });
  });

  describe('the relay channel, the fallback where there are no named pipes', () => {
    it('passes an honest product and answers as the pipes do', () => {
      for (const seed of [1, 2]) {
        const frame = frameOf(seed, { channel: 'relay' });
        expect(item(frame.product.honest as SumOdd, seed)).toBe(true);
        expect(frame.divergence()).toBeUndefined();
        expect(frame.tape.every((entry) => entry.twin !== undefined && entry.wrapped !== undefined)).toBe(
          true,
        );
      }
    });
    it.each(['argv', 'env', 'cwd', 'stack'] as const)('fails the %s cheat', (name) => {
      const frame = frameOf(1, { channel: 'relay' });
      const pass = item(frame.product[name] as SumOdd, 1);
      expect(pass && frame.divergence() === undefined).toBe(false);
    });
  });

  describe.each(CLASSES)('the %s cheat', (name) => {
    it('passes the item in the validator process: the hole the audits found', () => {
      expect(item(IN_PROCESS[name], 1)).toBe(true);
    });
    it('fails the item under the frame, on every seed', () => {
      for (const seed of [1, 2, 3]) expect(framed(name, seed).pass).toBe(false);
    });
  });

  describe.each(['nestedFrame', 'entrySource', 'childShape', 'uptimePatched'] as const)(
    'the bypass %s of the review of PR 892',
    (name) => {
      it('fails the item under the frame, on every seed', () => {
        for (const seed of [1, 2, 3]) expect(framed(name, seed).pass).toBe(false);
      });
    },
  );

  describe.each(['pathBin', 'home'] as const)('the %s cheat of the second review of PR 892', (name) => {
    it('fails the item under the frame, on every seed', () => {
      for (const seed of [1, 2, 3]) expect(framed(name, seed).pass).toBe(false);
    });
  });

  it('fails the userLike cheat of the third review of PR 892 on every seed', () => {
    for (const seed of [1, 2, 3]) expect(framed('userLike', seed).pass).toBe(false);
  });

  describe.each(['shallowStack', 'bareArgv'] as const)('the %s cheat, right in run A only', (name) => {
    it('is caught as a divergence, so the difference of run B it keys on is pinned', () => {
      for (const seed of [1, 2, 3]) {
        const result = framed(name, seed);
        expect(result.pass).toBe(false);
        expect(result.divergence).toMatch(/run B/);
      }
    });
  });

  it('names the call whose answers differ between the two runs', () => {
    const { divergence } = framed('env', 1);
    expect(divergence).toMatch(/^env\(/);
  });

  it('records a tape that the parent replays with no product', () => {
    const frame = frameOf(2);
    const answers = lists(2).map((xs) => frame.product.honest(xs));
    const replayed = replay<Cheats>(frame.tape);
    expect(lists(2).map((xs) => replayed.honest(xs))).toEqual(answers);
    expect(frame.tape.map((entry) => entry.call)).toEqual(lists(2).map(() => 'honest'));
  });

  it('refuses a replay that asks for another call than the tape holds', () => {
    const frame = frameOf(3);
    frame.product.honest([1, 2, 3]);
    const replayed = replay<Cheats>(frame.tape);
    expect(() => replayed.honest([4, 5])).toThrow(FrameError);
  });

  it('carries a thrown error back as an error, the same in both runs', () => {
    const frame = frameOf(1);
    expect(() => (frame.product.honest as unknown as (x: unknown) => number)(null)).toThrow(/null/);
    expect(frame.divergence()).toBeUndefined();
    expect(frame.tape[0]?.throws).toBeDefined();
  });

  it('refuses a function argument: it cannot cross the process boundary', () => {
    const frame = frameOf(1);
    expect(() => frame.product.withCallback([1, 2], (x) => x > 1)).toThrow(FrameError);
  });

  it('compares only what the caller keeps: a dropped timestamp is no divergence', () => {
    const frame = frameOf(1, { keep: { stamped: (value) => (value as { sum: number }).sum } });
    expect(frame.product.stamped([1, 2, 3])).toMatchObject({ sum: 4 });
    expect(frame.divergence()).toBeUndefined();
    const strict = frameOf(1);
    strict.product.stamped([1, 2, 3]);
    // Two runs a few milliseconds apart: the timestamps may or may not match, so only the kept form is asserted.
    expect(strict.tape[0]?.call).toBe('stamped');
  });
});

describe('the frame for a command', () => {
  const input = { 'input.txt': '1 2 3 4 5 6 7\n' };
  it('passes an honest command, with its files and output recorded', () => {
    const run = isolateCommand({
      command: [COMMAND, '--honest'],
      seed: 1,
      files: input,
      collect: ['out.txt'],
    });
    expect(run).toMatchObject({ status: 0, stdout: 'sum 16\n', files: { 'out.txt': '16\n' } });
    expect(run.divergence).toBeUndefined();
  });
  it('catches a command that reads the environment: the two runs differ', () => {
    const run = isolateCommand({ command: [COMMAND], seed: 1, files: input, collect: ['out.txt'] });
    expect(run.divergence).toMatch(/stdout|out\.txt/);
  });
});

describe('neutral names', () => {
  it('draw no fixed prefix, length or alphabet, and pass the id pattern of the schema', () => {
    const names = Array.from({ length: 300 }, (_, i) => neutralName(i % 7, `tag${i}`));
    expect(new Set(names.map((name) => name.length)).size).toBeGreaterThanOrEqual(12);
    expect(new Set(names.map((name) => name.slice(0, 2))).size).toBeGreaterThan(150);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
    expect(names.some((name) => /[A-Z]/.test(name))).toBe(true);
    expect(names.some((name) => /[._-]/.test(name))).toBe(true);
    expect(neutralName(5, 'a')).toBe(neutralName(5, 'a'));
  });
  it('take the gain away from a cheat keyed on a fixture prefix', () => {
    const fixed = lists(1).map((xs, i) => cheats.idShape(xs, `blk_${i}`) === reference(xs));
    const drawn = lists(1).map((xs, i) => cheats.idShape(xs, neutralName(1, `list${i}`)) === reference(xs));
    expect(fixed.every(Boolean)).toBe(true);
    expect(drawn.every(Boolean)).toBe(false);
  });
});

/**
 * The rule of the frame, for every environment trait it controls (third review of PR 892): at least two runs differ
 * in the trait, and run C is user-shaped in it. A new trait is one row.
 */
describe('the traits of the three runs', () => {
  const withoutBin = (path: string) =>
    path.split(/[:;]/).every((dir) => !dir.replace(/\\/g, '/').endsWith('node_modules/.bin'));
  const testKey = (key: string) =>
    key === 'VITEST' || key.startsWith('npm_') || key === 'PNPM_SCRIPT_SRC_DIR';
  const rows: Array<{ trait: string; userShaped: (value: unknown) => boolean }> = [
    { trait: 'path', userShaped: (value) => withoutBin(value as string) && (value as string).length > 0 },
    { trait: 'home', userShaped: (value) => value === userInfo().homedir },
    { trait: 'cwd', userShaped: (value) => value === process.cwd() },
    { trait: 'envKeys', userShaped: (value) => !(value as string[]).some(testKey) },
    { trait: 'argvTail', userShaped: (value) => (value as string[]).length === 0 },
    { trait: 'stdin', userShaped: (value) => value !== 'pipe' && value !== 'socket' },
    { trait: 'nested', userShaped: (value) => value === 0 },
    { trait: 'entryReadsStdin', userShaped: (value) => value === false },
  ];
  const runs = (seed: number) => {
    const frame = isolate<typeof probe>({ module: PROBE, seed });
    open.push(frame as Frame<unknown>);
    frame.product.traits();
    const entry = frame.tape[0];
    const of = (outcome: unknown) =>
      decode((outcome as { ret?: unknown } | undefined)?.ret) as Record<string, unknown>;
    return { a: of(entry), b: of(entry?.twin), c: of(entry?.plain) };
  };
  it.each(rows)('$trait: at least two runs differ, and run C is user-shaped', ({ trait, userShaped }) => {
    for (const seed of [1, 2]) {
      const { a, b, c } = runs(seed);
      const values = new Set([a, b, c].map((each) => JSON.stringify(each?.[trait])));
      expect(values.size, `${trait} is the same in all three runs`).toBeGreaterThanOrEqual(2);
      expect(userShaped(c[trait]), `run C's ${trait} is ${JSON.stringify(c[trait])}`).toBe(true);
    }
  });
});
