import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runItem, variablesBank } from '../../src/ladders/variables/bank/index';
import { withLabels } from '../../src/ladders/variables/impl';
import { variablesImpl as writeRestore } from './fixtures/cheats/write-restore';

/**
 * The items that check that a build leaves its inputs alone hand the product frozen inputs. The labelling step of the
 * validator (labels.ts) sits between the item and the product; it must not copy the frozen inputs into plain objects
 * the product can write to (review of PR 1170: a product that writes to its input and restores it passed the four
 * input-not-mutated items).
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const IDS = variablesBank()
  .filter((item) => item.id.startsWith('values.input-not-mutated.'))
  .map((item) => item.id);

describe('frozen inputs reach the product through the labelling step', () => {
  it('there are input-not-mutated items to run', () => {
    expect(IDS.length).toBeGreaterThan(0);
  });

  it.each(IDS)('a product that writes to its input and restores it fails %s', async (id) => {
    const item = variablesBank().find((entry) => entry.id === id);
    if (!item) throw new Error(id);
    const outcome = await runItem(item, 1, ROOT, withLabels(writeRestore));
    expect(outcome.pass).toBe(false);
  });
});
