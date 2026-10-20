// The retention facts of a long spec are checked in time linear in its blocks, whether or not the spec links
// blocks, and a parent-linked spec still resolves a fact through the block's ancestors only.
import { validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

// Fictional data only.
const chain = (blocks: number, linked: boolean) => ({
  id: `retention-${blocks}${linked ? '-linked' : ''}`,
  blocks: Array.from({ length: blocks }, (_, at) => ({
    ...(linked && at === blocks - 1 ? { id: 'last', parent: 'first' } : {}),
    ...(linked && at === 0 ? { id: 'first' } : {}),
    user: `turn ${at}`,
    given: { ledger: { [`fact${at}`]: 'x' } },
    expect: { knowledge_retention: [{ fact: `fact${at}` }] },
  })),
});

/** CPU time of one validation, in milliseconds. */
function cpu(blocks: number, linked: boolean): number {
  const spec = chain(blocks, linked);
  const before = process.cpuUsage();
  const loaded = validateSpec(spec);
  const used = process.cpuUsage(before);
  expect(loaded.ok).toBe(true);
  return (used.user + used.system) / 1000;
}

/**
 * The growth from `small` to `large` blocks: the best of several samples at each size, so load cannot decide it.
 * Both sizes run once before they are timed, and each sample times one run of each size.
 */
function growth(linked: boolean, small: number, large: number, samples = 5): number {
  cpu(200, linked);
  cpu(small, linked);
  cpu(large, linked);
  let least = Number.POSITIVE_INFINITY;
  let most = Number.POSITIVE_INFINITY;
  for (let again = 0; again < samples; again += 1) {
    least = Math.min(least, cpu(small, linked));
    most = Math.min(most, cpu(large, linked));
  }
  return most / Math.max(least, 1);
}

describe('retention facts in a long spec', () => {
  it('are checked in time linear in the blocks of a spec without parents', { timeout: 120_000 }, () => {
    // Linear growth is ten times; a scan of every block for every block is a hundred. The small size takes long
    // enough (tens of milliseconds) that the clock and one disturbed run cannot move the ratio by a third. The
    // runs of the large size need more than the default time limit of a test on a loaded machine.
    expect(growth(false, 5000, 50000)).toBeLessThan(30);
  });

  it('are resolved through the ancestors of a parent-linked block, and through nothing else', () => {
    // `last` has parent `first`: it sees its own Given and `first`'s, never the blocks between them.
    const spec = (fact: string) => ({
      id: 'retention-parents',
      blocks: [
        { id: 'first', user: 'a', given: { ledger: { alpha: 'x' } } },
        { id: 'middle', user: 'b', given: { ledger: { beta: 'x' } } },
        {
          id: 'last',
          parent: 'first',
          user: 'c',
          given: { ledger: { gamma: 'x' } },
          expect: { knowledge_retention: [{ fact }] },
        },
      ],
    });
    for (const fact of ['alpha', 'gamma']) expect(validateSpec(spec(fact)).ok, fact).toBe(true);
    const refused = validateSpec(spec('beta'));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors.map((issue) => issue.code)).toContain('RETENTION_FACT_UNKNOWN');
  });

  it('still resolves an earlier ledger_add of a spec without parents, and refuses a later one', () => {
    const spec = (fact: string) => ({
      id: 'retention-plain',
      blocks: [
        { user: 'a', expect: { ledger_add: { early: 'x' } } },
        { user: 'b', expect: { knowledge_retention: [{ fact }], ledger_add: { late: 'x' } } },
      ],
    });
    expect(validateSpec(spec('early')).ok).toBe(true);
    const refused = validateSpec(spec('late'));
    expect(refused.ok).toBe(false);
  });
});
