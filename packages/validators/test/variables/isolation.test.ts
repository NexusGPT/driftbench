import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { variablesBank } from '../../src/ladders/variables/bank/index';
import { runIsolated } from '../../src/ladders/variables/bank/isolate';
import {
  decode,
  encode,
  recordImpl,
  replayClock,
  replayImpl,
  type Tape,
} from '../../src/ladders/variables/bank/tape';
import { IMPL_ENV } from '../../src/ladders/variables/impl';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

/** The bank's child runs the implementation named by the environment variable; the parent decides every verdict. */
async function run(module: string, prefixes: string[], seed = 1) {
  process.env[IMPL_ENV] = module;
  const items = variablesBank().filter((item) => prefixes.some((p) => item.id.startsWith(p)));
  return { items, results: await runIsolated(items, seed, ROOT) };
}

afterEach(() => {
  delete process.env[IMPL_ENV];
});

describe('the implementation under test runs in a child that only records its answers', () => {
  it('cannot print a verdict of its own: forged lines, signed or not, change nothing', async () => {
    const { items, results } = await run(here('forger-impl.ts'), [
      'quotes.accept.exact',
      'budget.prefix-of-full-plan',
      'seeds.empty-list',
    ]);
    expect(items.length).toBeGreaterThan(10);
    for (const item of items) expect(results.get(item.id)?.pass, item.id).toBe(false);
  }, 120_000);

  it('cannot end the bank early with a clean exit: the items it stopped fail', async () => {
    const { items, results } = await run(here('exiting-impl.ts'), [
      'budget.prefix-of-full-plan',
      'seeds.empty-list',
    ]);
    for (const item of items) expect(results.get(item.id)?.pass, item.id).toBe(false);
  }, 120_000);

  it('passes an item that an implementation answers right, so a failure above is the implementation', async () => {
    const { items, results } = await run(here('positive-reference.ts'), [
      'quotes.accept.exact',
      'budget.weight-reported',
    ]);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items)
      expect(results.get(item.id)?.pass, `${item.id}: ${results.get(item.id)?.detail}`).toBe(true);
  }, 120_000);

  it('judges the same input the same way in process and through the record and replay', async () => {
    const { items, results } = await run(here('positive-reference.ts'), [
      'budget.weight-reported',
      'seeds.lead-the-plan',
      'strength.report-matches-counter',
    ]);
    const { runInProcess } = await import('../../src/ladders/variables/bank/index');
    const { variablesImpl } = await import('./positive-reference');
    const direct = await runInProcess(items, 1, ROOT, variablesImpl, here('positive-reference.ts'));
    for (const item of items) expect(results.get(item.id)?.pass, item.id).toBe(direct.get(item.id)?.pass);
  }, 180_000);
});

describe('the budget of an item counts processor time', () => {
  it('stops an endless loop by the processor time it uses, and names the unit', async () => {
    process.env[IMPL_ENV] = here('spinning-impl.ts');
    const items = variablesBank().filter((item) => item.id.startsWith('budget.prefix-of-full-plan.one-row'));
    const results = await runIsolated(items, 1, ROOT, () => 3_000);
    const item = items[0];
    expect(item).toBeDefined();
    const outcome = results.get((item as (typeof items)[number]).id);
    expect(outcome?.pass).toBe(false);
    expect(outcome?.detail).toMatch(/did not finish within 3000 ms of processor time/);
  }, 120_000);

  it('reads the processor time of a process from ps', async () => {
    const { processorMs } = await import('../../src/ladders/variables/bank/isolate');
    const used = await processorMs(process.pid);
    expect(used).toBeGreaterThan(0);
    expect(await processorMs(2 ** 22 + 12345)).toBeUndefined();
  });
});

describe('the tape', () => {
  it('keeps what JSON loses: bigint, non-finite numbers, minus zero, undefined, errors', () => {
    const value = {
      big: 123456789012345678901234567890n,
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      zero: -0,
      none: undefined,
      list: [1, { $dollar: 2 }],
    };
    const back = decode(JSON.parse(JSON.stringify(encode(value)))) as typeof value;
    expect(back.big).toBe(value.big);
    expect(Number.isNaN(back.nan)).toBe(true);
    expect(back.inf).toBe(Number.POSITIVE_INFINITY);
    expect(Object.is(back.zero, -0)).toBe(true);
    expect('none' in back && back.none === undefined).toBe(true);
    expect(back.list).toEqual(value.list);
    const error = decode(encode(new RangeError('budget'))) as Error;
    expect(error).toBeInstanceOf(RangeError);
    expect(error.message).toBe('budget');
  });

  it('replays what the implementation answered, threw, changed in its arguments and shared with them', () => {
    const tape: Tape = [];
    const shared = { id: 'a' };
    const real = {
      echo: (x: { id: string }) => ({ same: x, other: { n: 1 } }),
      edit: (rows: number[]) => {
        rows.push(9);
        return rows.length;
      },
      boom: () => {
        throw new RangeError('budget must be whole');
      },
      slow: () => {
        const end = Date.now() + 5;
        while (Date.now() < end) {
          // wait
        }
        return 1;
      },
    };
    const recorded = recordImpl(real, tape);
    recorded.echo(shared);
    const rows = [1];
    recorded.edit(rows);
    expect(() => recorded.boom()).toThrow(RangeError);
    recorded.slow();
    const wire = JSON.parse(JSON.stringify(tape)) as Tape;
    const { impl, problems } = replayImpl(wire, ['echo', 'edit', 'boom', 'slow']);
    const mine = { id: 'a' };
    const answer = (impl.echo as (x: unknown) => { same: unknown; other: { n: number } })(mine);
    expect(answer.same).toBe(mine);
    expect(answer.other).toEqual({ n: 1 });
    const list = [1];
    expect((impl.edit as (r: number[]) => number)(list)).toBe(2);
    expect(list).toEqual([1, 9]);
    expect(() => (impl.boom as () => never)()).toThrow(RangeError);
    replayClock.active = true;
    replayClock.total = 0;
    (impl.slow as () => number)();
    expect(replayClock.total).toBeGreaterThan(0);
    replayClock.active = false;
    expect(problems).toEqual([]);
  });

  it('reports a call the item did not make, and answers only the functions the implementation provides', () => {
    const tape: Tape = [{ call: 'plan', args: encode([1]), ret: encode('x') }];
    const { impl, problems } = replayImpl(tape, ['plan']);
    expect(Object.keys(impl)).toEqual(['plan']);
    (impl.plan as (n: number) => unknown)(2);
    expect(problems.length).toBe(1);
  });
});
