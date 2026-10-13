import { extractMap } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { inventoryItems } from '../../src/ladders/map/bank/families/inventory';
import { runItem } from '../../src/ladders/map/bank/run';
import { hiddenSeed } from '../../src/seeds';
import { ROOT } from './support';

const item = inventoryItems().find((entry) => entry.id === 'inventory-forms.no-channel-list');
if (!item) throw new Error('missing no-channel-list item');
const noChannels = item;

describe('omitting the top-level channel list retains behaviour-by-flow constraints', () => {
  for (let seed = 1; seed <= 20; seed++) {
    it(`holds on public seed ${seed}`, async () => {
      expect(await runItem(noChannels, seed)).toMatchObject({ pass: true });
    });
  }
  it('holds on the current commit hidden seed', async () => {
    expect(await runItem(noChannels, hiddenSeed(ROOT).seed)).toMatchObject({ pass: true });
  });

  it('still rejects an extractor dropping every constraint', async () => {
    let removed = 0;
    const result = await runItem(noChannels, 1, {
      extract: async (input) => {
        const result = await extractMap(input); // runItem supplies the code-only perfect model
        if (result.ok) {
          removed = result.proposal.constraints.length;
          result.proposal.constraints = [];
        }
        return result;
      },
    });
    expect(removed).toBeGreaterThan(0);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('lost');
  });

  it('still rejects a valid proposal that forbids a behaviour in its own flow', async () => {
    let changed = false;
    const result = await runItem(noChannels, 1, {
      extract: async (input) => {
        const result = await extractMap(input);
        if (result.ok) {
          const constraint = result.proposal.constraints.find((entry) => entry.forbid.flow);
          if (!constraint) throw new Error('no behaviour-by-flow constraint to mutate');
          // B-002 belongs to both planted flows. Keep the evidence and schema valid,
          // while replacing a real exclusion with a false one.
          constraint.forbid.behaviour = 'B-002';
          changed = true;
        }
        return result;
      },
    });
    expect(changed).toBe(true);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('lost');
    expect(result.detail).toContain('gained');
  });
});
