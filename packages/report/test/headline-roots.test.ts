import type { RunResult, Spec } from '@agent-nexus/driftbench-core';
import { hierarchicalBetaBinomial } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { suiteHeadline } from '../src/headline';
import { buildScorecard } from '../src/scorecard';
import { dataOf, run } from './support';

// A hand-written bakery spec with two families: cart > pay > receipt, and refund > credit. Two runs record
// every block. Two reruns record only the leaves: their ancestors were replayed, which adds no block.
const AUTHORED = [
  { id: 'cart' },
  { id: 'pay', parent: 'cart' },
  { id: 'receipt', parent: 'pay' },
  { id: 'refund' },
  { id: 'credit', parent: 'refund' },
] as const;

function bakeryRun(repeat: number, recorded: readonly string[], failing: readonly string[]): RunResult {
  const shape = run({
    specId: 'bakery',
    repeat,
    blocks: recorded.map((id) => (failing.includes(id) ? { pass: false } : {})),
  });
  return {
    ...shape,
    blocks: shape.blocks.map((block, index) => {
      const id = recorded[index] as string;
      const authored = AUTHORED.findIndex((entry) => entry.id === id);
      const parent = (AUTHORED[authored] as { parent?: string }).parent;
      return { ...block, blockId: id, specIndex: authored, ...(parent ? { parent } : {}) };
    }),
  };
}

const runs = [
  bakeryRun(0, ['cart', 'pay', 'receipt', 'refund', 'credit'], []),
  bakeryRun(1, ['cart', 'pay', 'receipt', 'refund', 'credit'], ['pay']),
  bakeryRun(2, ['receipt', 'credit'], []),
  bakeryRun(3, ['receipt', 'credit'], ['receipt']),
];

const bakery: Partial<Spec> = {
  blocks: AUTHORED.map((entry) => ({ when: { user: `about ${entry.id}` }, ...entry })) as Spec['blocks'],
};
const parentsOf = () =>
  new Map(AUTHORED.flatMap((entry) => ('parent' in entry ? [[entry.id, entry.parent]] : [])));

// One cluster per root: cart passes in repeats 0 and 2, refund in all four.
const families = hierarchicalBetaBinomial([
  { n: 4, k: 2 },
  { n: 4, k: 4 },
]);

describe('the suite headline groups a run that did not record its root under that root', () => {
  it('keys each family by its root from the spec links, one cluster per root', () => {
    const headline = suiteHeadline(runs, (entry) => entry.specId, { parentsOf });
    expect(headline).toMatchObject({ trees: 2, n: 8, runs: 4, method: 'hierarchical', unit: 'tree-run' });
    expect(headline?.lower).toBe(families.lower);
    expect(headline?.upper).toBe(families.upper);
  });

  it('does the same in the scorecard, which reads the links from the pinned spec', () => {
    const card = buildScorecard(dataOf(runs, { bakery }));
    const headline = card.modes.find((mode) => mode.mode === 'F')?.headline;
    expect(headline).toMatchObject({ trees: 2, n: 8 });
    expect(headline?.lower).toBe(families.lower);
  });

  it('without the links, keys a leaf whose ancestors are unrecorded by the highest ancestor it names', () => {
    const headline = suiteHeadline(runs, (entry) => entry.specId);
    // credit names refund, so it joins the refund family. receipt names pay, which the rerun did not record:
    // pay is as high as the run alone can tell, so the cart family splits in two.
    expect(headline).toMatchObject({ trees: 3, n: 8 });
  });

  it('keys a rerun that recorded only roots by those roots, never by the golden', () => {
    // A subset run of one root each: refund passes, cart fails. No recorded block names a parent.
    const subsets = [bakeryRun(4, ['refund'], []), bakeryRun(5, ['cart'], ['cart'])];
    const headline = suiteHeadline([...runs, ...subsets], (entry) => entry.specId, { parentsOf });
    const expected = hierarchicalBetaBinomial([
      { n: 5, k: 2 },
      { n: 5, k: 5 },
    ]);
    expect(headline).toMatchObject({ trees: 2, n: 10, runs: 6 });
    expect(headline?.lower).toBe(expected.lower);
    expect(headline?.upper).toBe(expected.upper);
  });

  it('reads empty links as no links: a spec without parents keeps the golden grouping', () => {
    const plain = Array.from({ length: 6 }, (_, repeat) =>
      run({ specId: `plain-${repeat % 3}`, repeat, blocks: [repeat === 1 ? { pass: false } : {}] }),
    );
    const without = suiteHeadline(plain, (entry) => entry.specId);
    expect(without).toMatchObject({ trees: 3, n: 6 });
    expect(suiteHeadline(plain, (entry) => entry.specId, { parentsOf: () => new Map() })).toEqual(without);
  });

  it('still counts a run that failed before it recorded any block', () => {
    // The first step threw: the run failed with no block, so its failure belongs to no one root.
    const dead = { ...bakeryRun(6, [], []), status: 'failed' as const };
    const headline = suiteHeadline([...runs, dead], (entry) => entry.specId, { parentsOf });
    expect(headline).toMatchObject({ runs: 5, n: 9, trees: 3 });
    expect(headline?.pooledRate).toBe(6 / 9);
  });
});
