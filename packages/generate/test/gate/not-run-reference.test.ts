/** Repros of the independent re-review of the not_run verdict: no unsent block reads as a failure. */
import { expect, it } from 'vitest';
import { gate, makeSpec, orderBlock, shopAdapter, shopFault } from './support';

it('unsupported reference is excluded from difficulty', async () => {
  const spec = makeSpec({
    id: 'unsupported-reference',
    stages: ['start', 'ordered'],
    given: { world: { tools: { lookup: { result: { ok: true } } } } },
    blocks: [orderBlock()],
  });
  const base = shopAdapter();
  const reference = { ...base, capabilities: () => ({ ...base.capabilities(), toolStubs: false }) };
  const result = await gate([spec], {
    options: { k: 1 },
    references: new Map([['function:shop', reference]]),
    faults: [shopFault('louder', 'drift', 'X1_local', ['tools'], { reply: (s: string) => s + '!' })],
  });

  expect(result.blocks[0]?.passProbability).toBe(1 / 4);
});
