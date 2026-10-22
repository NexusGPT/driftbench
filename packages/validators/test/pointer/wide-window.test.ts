import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { realReader } from '../../src/ladders/pointer/sut/reader';

// scale.wide-window runs in a child process that loads the reader named by DRIFTBENCH_POINTER_SUT. A reader
// that scans in full and then hands back no ledger entry, or one entry short, must fail the item.
const item = () => {
  const found = pointerBank().find((entry) => entry.id === 'scale.wide-window');
  if (!found) throw new Error('missing scale.wide-window');
  return found;
};

async function withReader(module: string | undefined, drop: string | undefined) {
  const before = { sut: process.env.DRIFTBENCH_POINTER_SUT, drop: process.env.WIDE_WINDOW_DROP };
  try {
    if (module === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL(module, import.meta.url));
    if (drop === undefined) delete process.env.WIDE_WINDOW_DROP;
    else process.env.WIDE_WINDOW_DROP = drop;
    clearSeedFreeCache();
    return await runItem(item(), 1, realReader());
  } finally {
    if (before.sut === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before.sut;
    if (before.drop === undefined) delete process.env.WIDE_WINDOW_DROP;
    else process.env.WIDE_WINDOW_DROP = before.drop;
    clearSeedFreeCache();
  }
}

it('scale.wide-window passes the real reader', async () => {
  expect(await withReader(undefined, undefined)).toMatchObject({ pass: true });
}, 120_000);

it('scale.wide-window fails a reader that scans and then returns no ledger entry', async () => {
  expect(await withReader('./wide-window-drop.ts', 'all')).toMatchObject({ pass: false });
}, 120_000);

it('scale.wide-window fails a reader that returns every entry but one', async () => {
  expect(await withReader('./wide-window-drop.ts', 'one')).toMatchObject({ pass: false });
}, 120_000);
