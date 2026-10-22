import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { realReader } from '../../src/ladders/pointer/sut/reader';

// scale.wide-window runs in a child process that loads the reader named by DRIFTBENCH_POINTER_SUT. A reader
// that scans in full and then hands back a ledger other than the planted one must fail the item.
const item = () => {
  const found = pointerBank().find((entry) => entry.id === 'scale.wide-window');
  if (!found) throw new Error('missing scale.wide-window');
  return found;
};

async function withReader(module: string | undefined) {
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  try {
    if (module === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = fileURLToPath(new URL(module, import.meta.url));
    clearSeedFreeCache();
    return await runItem(item(), 1, realReader());
  } finally {
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
    clearSeedFreeCache();
  }
}

it('scale.wide-window passes the real reader', async () => {
  expect(await withReader(undefined)).toMatchObject({ pass: true });
}, 120_000);

// Each mutant is its own module, so the child loads exactly that change: the child's environment carries only the
// reader module, nothing else.
for (const [module, what] of [
  ['./wide-window-empty.ts', 'no ledger entry'],
  ['./wide-window-one-short.ts', 'every entry but the last'],
  ['./wide-window-headings.ts', 'both headings replaced by sentence copies, the count unchanged'],
  ['./wide-window-label.ts', 'one entry under another label'],
] as const) {
  it(`scale.wide-window fails a reader that returns ${what}`, async () => {
    expect((await withReader(module)).pass).toBe(false);
  }, 120_000);
}
