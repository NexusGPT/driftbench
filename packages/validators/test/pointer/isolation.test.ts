import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runBlind } from '../../src/ladders/pointer/bank/blind';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { decode, encode, FN } from '../../src/ladders/pointer/bank/rpc';
import { clearSeedFreeCache, isolated, runItem, stopItemChild } from '../../src/ladders/pointer/bank/run';
import { pointerBank as blindBank } from '../../src/ladders/pointer/blind/bank/index';
import { resolveSut, sutModule } from '../../src/ladders/pointer/sut/adapter';
import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { referenceSut } from './reference/index';

/**
 * The reader runs in a process of its own, apart from the oracle of the item (`bank/reader-link.ts`). These tests
 * show that the process boundary changes nothing an honest reader can see: the same items give the same outcomes in
 * the process of the item as here, and what crosses the boundary comes back whole.
 */

const REFERENCE_SUT = fileURLToPath(new URL('./reference/index.ts', import.meta.url));
const EXIT_SUT = fileURLToPath(new URL('./hardening-exit-sut.ts', import.meta.url));
const ref = referenceSut();
const apart: PointerSut = { ...ref, name: 'reference-apart', isolate: true };

afterEach(async () => {
  await stopItemChild();
  clearSeedFreeCache();
  delete process.env.DRIFTBENCH_POINTER_SUT;
});

describe('the wire between the oracle and the reader', () => {
  it('turns a function into a handle and back, whatever the depth, and leaves plain data alone', () => {
    const plain = { files: [{ path: 'a.md', text: 'x' }], nested: { list: [1, 2, 3] } };
    expect(encode(plain, () => 0)).toBe(plain);
    const seen: Array<(...args: unknown[]) => unknown> = [];
    const fn = (value: unknown) => value;
    const wire = encode({ labeler: fn, model: { transport: fn, arm: 'haiku' }, list: [fn] }, (made) => {
      seen.push(made);
      return seen.length;
    }) as Record<string, unknown>;
    expect(wire.labeler).toEqual({ [FN]: 1 });
    expect(wire.model).toEqual({ transport: { [FN]: 2 }, arm: 'haiku' });
    expect(wire.list).toEqual([{ [FN]: 3 }]);
    const called: number[] = [];
    const back = decode(wire, (handle) => async () => {
      called.push(handle);
      return handle;
    }) as {
      labeler: () => Promise<number>;
      model: { transport: () => Promise<number> };
      list: Array<() => Promise<number>>;
    };
    return Promise.all([back.labeler(), back.model.transport(), back.list[0]?.()]).then((answers) => {
      expect(answers).toEqual([1, 2, 3]);
      expect(called).toEqual([1, 2, 3]);
    });
  });

  it('keeps a key named __proto__ as a key of its own', () => {
    const data = JSON.parse('{"labels":{"__proto__":{"label":"rule"}},"f":null}') as Record<string, unknown>;
    const fn = () => 1;
    const wire = encode({ ...data, fn }, () => 0) as { labels: Record<string, unknown> };
    expect(Object.keys(wire.labels)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(wire.labels)).toBe(Object.prototype);
  });
});

describe('the pin of the system under test', () => {
  it('reads the variable once, removes it, and answers with the value it read', async () => {
    const before = process.env.DRIFTBENCH_POINTER_SUT;
    process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_SUT;
    // A child process of its own, so that the pin does not outlive this test in the process of the tests.
    const { spawnSync } = await import('node:child_process');
    const repo = fileURLToPath(new URL('../../../../', import.meta.url));
    const script = `
      import { pinSut, resolveSut, sutModule } from ${JSON.stringify(new URL('../../src/ladders/pointer/sut/adapter.ts', import.meta.url).href)};
      const first = pinSut();
      process.env.DRIFTBENCH_POINTER_SUT = '/nowhere/else.ts';
      const sut = await resolveSut();
      console.log(JSON.stringify({ first, later: sutModule(), left: process.env.DRIFTBENCH_POINTER_SUT ?? null, name: sut.name }));
    `;
    const out = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: repo,
      env: { ...process.env },
      encoding: 'utf8',
    });
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
    expect(out.status, out.stderr).toBe(0);
    expect(JSON.parse(out.stdout.trim().split('\n').pop() as string)).toEqual({
      first: REFERENCE_SUT,
      later: REFERENCE_SUT,
      left: '/nowhere/else.ts',
      name: 'reference',
    });
  }, 60_000);

  it('leaves a process that never pinned reading the variable as it stands', async () => {
    process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_SUT;
    expect(sutModule()).toBe(REFERENCE_SUT);
    expect((await resolveSut()).name).toBe('reference');
  });
});

describe('an item gives the same outcome in the process of its own as in this one', () => {
  const families = [
    'adversarial',
    'cutting',
    'grouping',
    'ids',
    'labels',
    'privacy',
    'replay',
    're-anchoring',
  ];
  const picks = families.flatMap((family) =>
    pointerBank()
      .filter(
        (item) => item.family === family && !item.needs.includes('child') && (item.capMs ?? 0) <= 90_000,
      )
      .slice(0, 2),
  );

  it('picks items from several families', () => {
    expect(picks.length).toBeGreaterThan(8);
  });

  it('gives each of them the outcome the reference reader gets here', async () => {
    process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_SUT;
    const rows: Array<{ id: string; here: boolean; apart: boolean }> = [];
    for (const item of picks) {
      const here = await runItem(item, 1, ref);
      const there = await runItem(item, 1, apart);
      rows.push({ id: item.id, here: here.pass, apart: there.pass });
      expect({ id: item.id, apart: there.pass, detail: there.detail }).toEqual({
        id: item.id,
        apart: here.pass,
        detail: there.detail,
      });
    }
    expect(rows.length).toBe(picks.length);
  }, 900_000);

  it('gives a blind item that reads the key and the cassette through the harness the outcome it gets here', async () => {
    process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_SUT;
    const stopped = (why: string) => ({ outcome: { pass: false, detail: why } });
    const withIo = blindBank().filter((item) =>
      item.generate(1).probes.some((probe) => probe.setup !== undefined),
    );
    expect(withIo.length).toBeGreaterThan(0);
    for (const item of withIo.slice(0, 6)) {
      const here = await runBlind(item, 1, async () => ref);
      const there = await isolated({ blind: { id: item.id, seed: 1 } }, 120_000, stopped);
      expect({ id: item.id, pass: there?.outcome.pass }).toEqual({ id: item.id, pass: here.outcome.pass });
    }
  }, 600_000);
});

describe('a reader that stops its own process', () => {
  it('fails the item that called it, and the next item runs on a new process', async () => {
    process.env.DRIFTBENCH_POINTER_SUT = EXIT_SUT;
    const scanning = pointerBank().find((item) => item.id === 'ids.id-unique');
    const cutting = pointerBank().find((item) => item.family === 'cutting');
    if (!scanning || !cutting) throw new Error('the bank has no such item');
    const out = await runItem(scanning, 1, { ...ref, name: 'exiting', isolate: true });
    expect(out.pass).toBe(false);
    expect(out.detail).toMatch(/reader's process/);
    const next = await runItem(cutting, 1, { ...ref, name: 'exiting', isolate: true });
    expect(next.pass, next.detail).toBe(true);
  }, 300_000);
});
