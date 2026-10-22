import { describe, expect, it } from 'vitest';
import { itemRng } from '../../src/ladders/variables/bank/util';
import * as spans from '../../src/ladders/variables/blind/spans';
import { blindBank } from '../../src/ladders/variables/blind/index';
import type { StoreDoc, VariablesImpl } from '../../src/ladders/variables/interface';

/**
 * Round 2, cheat A: the implementation module imports the bank's own table of what each span means and labels spans
 * from it, so the scale items pass without any reader. The table must not be readable from the validator's code: the
 * bank only reports a declaration to a sink that the test side installs.
 */
const table = (spans as unknown as { meaningOf?: (t: string) => { kind: string; subject: string; limit?: number } | undefined }).meaningOf;

const cheat: Partial<VariablesImpl> = {
  buildStore(sources) {
    const variables: StoreDoc['variables'] = [];
    for (const rule of sources.estate?.rules ?? []) {
      for (const c of rule.conditions) {
        const m = table?.(c.text);
        if (m?.kind !== 'numeric' || m.limit === undefined) continue;
        variables.push({
          id: m.subject.replace(/\W+/g, '-'),
          values: [-1, 0, 1].map((d) => ({ id: `v${d + 1}`, sample: (m.limit as number) + d })),
        } as never);
      }
    }
    return { variables, impossible: [], rules: [], refused: [] } as StoreDoc;
  },
};

describe('the bank keeps its table of span meanings out of reach of the implementation', () => {
  it('has no function that returns the meaning of a span', () => {
    expect(table).toBeUndefined();
  });

  it('a reader built on that table passes none of the condition reader items', async () => {
    const items = blindBank().filter((i) => i.id.startsWith('blind.boundaries.reader.roles.'));
    expect(items.length).toBeGreaterThan(5);
    let passed = 0;
    for (const item of items) {
      const r = await item.check({ seed: 1, impl: cheat, root: '/nonexistent', id: item.id, rng: itemRng(1, item.id) });
      if (r.pass) passed += 1;
    }
    expect(passed).toBe(0);
  });
});
