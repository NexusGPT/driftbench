import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runItem, variablesBank } from '../../src/ladders/variables/bank/index';
import { variablesImpl as adapter } from '../../src/ladders/variables/adapter';
import { blindBank } from '../../src/ladders/variables/blind/index';
import type { Sources, VariablesImpl } from '../../src/ladders/variables/interface';

/**
 * Cheat 7 of the r4 audit (validators/variables/audit.md): the time items of the scale level read `process.cpuUsage()`
 * of the validator's own process, so a product that does its work in a process it starts and waits for takes no
 * processor time that an item can see. Measured: 30 scale items lost on a product made slow by 12 seconds of work per
 * heavy call, and all 30 passed again when the same work ran in a child process.
 *
 * The items now count the processor time of the processes the product starts and waits for (on Linux, where the kernel
 * keeps it) and bound the wall-clock time of the call beside it (docs/variables.md R15). A child that sleeps takes no
 * processor time and is caught by the wall clock; a child that works is caught by its processor time.
 *
 * The item is the one with the smallest processor-time limit that the adapter passes without a span recording: reading
 * 10,000 conversations, 2 seconds on the page.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FIRST = 'scale.conversations.ten-thousand';
const BLIND = blindBank().find((i) => i.id === 'blind.scale.readers.conversations-10000');

const burnElsewhere = (ms: number): void => {
  spawnSync(process.execPath, ['-e', `const e=Date.now()+${ms};while(Date.now()<e){}`]);
};
const sleepElsewhere = (ms: number): void => {
  spawnSync(process.execPath, ['-e', `setTimeout(()=>{},${ms})`]);
};
const burnHere = (ms: number): void => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy
  }
};

/** The adapter, made slow on the calls that carry conversations: `slow` runs before the real work. */
const slowed = (slow: (ms: number) => void, ms: number): Partial<VariablesImpl> => ({
  ...adapter,
  buildStore: (sources: Sources) => {
    if (sources.conversations !== undefined) slow(ms);
    return (adapter.buildStore as VariablesImpl['buildStore'])(sources);
  },
});

const first = () => {
  const item = variablesBank().find((i) => i.id === FIRST);
  if (!item) throw new Error(`no item ${FIRST}`);
  return item;
};

describe('a product that does its slow work in a process it starts (cheat 7)', () => {
  it('the honest adapter passes the item, so a failure below is the time', async () => {
    const outcome = await runItem(first(), 1, ROOT, adapter);
    expect(outcome.detail).not.toMatch(/processor time|clock/);
    expect(outcome.pass).toBe(true);
  }, 120_000);

  it('a product that burns processor time in its own process fails the processor-time bound (the bound as it was)', async () => {
    const outcome = await runItem(first(), 1, ROOT, slowed(burnHere, 2600));
    expect(outcome.pass).toBe(false);
    expect(outcome.detail).toMatch(/processor time/);
  }, 120_000);

  it.skipIf(process.platform !== 'linux')(
    'a product that burns the same processor time in a child it waits for fails the processor-time bound',
    async () => {
      const outcome = await runItem(first(), 1, ROOT, slowed(burnElsewhere, 2600));
      expect(outcome.pass).toBe(false);
      expect(outcome.detail).toMatch(/processor time/);
    },
    120_000,
  );

  it('a product that waits in a child for longer than the clock bound fails the wall-clock bound', async () => {
    const outcome = await runItem(first(), 1, ROOT, slowed(sleepElsewhere, 6800));
    expect(outcome.pass).toBe(false);
    expect(outcome.detail).toMatch(/clock/);
  }, 120_000);

  it('the blind bank counts the same: an item on conversations fails a product that waits in a child', async () => {
    expect(BLIND, 'no blind scale item on conversations').toBeDefined();
    const item = BLIND as NonNullable<typeof BLIND>;
    const honest = await runItem(item, 1, ROOT, adapter);
    expect(honest.detail).not.toMatch(/processor time|clock/);
    const outcome = await runItem(item, 1, ROOT, slowed(sleepElsewhere, 6800));
    expect(outcome.pass).toBe(false);
    expect(outcome.detail).toMatch(/clock/);
  }, 120_000);
});
