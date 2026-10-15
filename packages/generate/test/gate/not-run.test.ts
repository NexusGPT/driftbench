import { expect, it } from 'vitest';
import { classScores } from '../../src/gate/gate';
import { gate, makeSpec, orderBlock, shopFault } from './support';

it('difficulty and kill counts leave out a fault agent whose adapter did not run the block', async () => {
  const spec = makeSpec({
    id: 'skip-difficulty',
    stages: ['start', 'ordered'],
    given: { world: { tools: { lookup: { result: { ok: true } } } } },
    blocks: [orderBlock()],
  });
  // A fault on an adapter without toolStubs: the spec forces a tool result, so the block is not run for it.
  const unsupported = shopFault('unsupported', 'drift', 'X5_tool', ['tools'], {});
  const base = unsupported.adapter;
  unsupported.adapter = { ...base, capabilities: () => ({ ...base.capabilities(), toolStubs: false }) };
  const result = await gate([spec], {
    options: { k: 1 },
    faults: [
      shopFault('wrong-sku', 'drift', 'X1_local', ['tools'], { sku: (s: string) => `${s}-x` }),
      unsupported,
    ],
  });
  // The reference passes; three trivial agents and wrong-sku fail; the unsupported one measured nothing.
  expect(result.blocks[0]?.passProbability).toBe(1 / 5);
  expect(result.blocks[0]?.notRun).toEqual(['unsupported']);
  expect(result.blocks[0]?.stages.difficulty.detail).toContain('(not run: unsupported)');
  const fault = result.faults.find((entry) => entry.id === 'unsupported');
  expect(fault?.pool.targeting).toBe(0);
  expect(fault?.pool.notRun).toBe(1);
  // Its class scores no fault: an unmeasured fault is neither killed nor missed.
  const scores = classScores(result.faults);
  expect(scores.find((entry) => entry.class === 'X5_tool')?.scored).toBe(0);
});
