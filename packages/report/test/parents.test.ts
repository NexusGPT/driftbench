import { blockStatus } from '@agent-nexus/driftbench-core';
import { hierarchicalBetaBinomial } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { parentCauses } from '../src/causes';
import { suiteHeadline } from '../src/headline';
import { renderHtml, renderRun } from '../src/html';
import { buildScorecard } from '../src/scorecard';
import { dataOf, run } from './support';

const base = run({ specId: 'forest', blocks: [{ pass: false }, {}, {}, {}] });
const forest = {
  ...base,
  blocks: base.blocks.map((block, index) => ({
    ...block,
    specIndex: index,
    blockId: ['root', 'child', 'leaf', 'independent'][index],
    ...(index === 1 || index === 2
      ? {
          parent: index === 1 ? 'root' : 'child',
          pass: false,
          status: 'blocked' as const,
          verdicts: [],
          blocked: { by: index === 1 ? 'root' : 'child', root: 'root' },
        }
      : {}),
  })),
};

describe('parent reports', () => {
  it('counts a shared cause once and lists its blocked descendants under it', () => {
    expect(forest.blocks.map(blockStatus)).toEqual(['fail', 'blocked', 'blocked', 'pass']);
    expect(parentCauses(forest)).toEqual([{ root: 'root', status: 'fail', blocked: ['child', 'leaf'] }]);
    const card = buildScorecard(dataOf([forest]));
    expect(card.drilldown[0]?.causes).toEqual(parentCauses(forest));
    const detail = card.drilldown[0];
    if (!detail) throw new Error('missing detail');
    const html = renderRun(detail);
    expect(html).toContain('Causes: 1 failed, 0 not run');
    expect(html).toContain('root: fail<ul><li>child: blocked</li><li>leaf: blocked</li></ul>');
    expect(renderHtml(card)).toContain('root: fail<ul><li>child: blocked</li><li>leaf: blocked</li></ul>');
  });
  it('the hierarchical interval reads the actual parent forest, clustering repeats by root', () => {
    const headline = suiteHeadline([forest, { ...forest, repeat: 1 }], (run) => run.specId);
    const interval = hierarchicalBetaBinomial([
      { n: 2, k: 0 },
      { n: 2, k: 2 },
    ]);
    expect(headline).toMatchObject({
      trees: 2,
      runs: 4,
      method: 'hierarchical',
      unit: 'tree-run',
      pooledRate: 0.5,
    });
    expect(headline?.estimate).toBe(interval.estimate);
    expect(headline?.lower).toBe(interval.lower);
    expect(headline?.upper).toBe(interval.upper);
  });
  it('retains an independently measured tree when another root was not run', () => {
    const unrun = {
      ...forest,
      blocks: forest.blocks.map((block, index) =>
        index === 0
          ? {
              ...block,
              pass: false,
              status: 'not_run' as const,
              verdicts: [],
              notRun: {
                kind: 'unsupported' as const,
                layer: '5 world',
                check: 'capability',
                expected: 'snapshot',
                got: 'unavailable',
              },
            }
          : block,
      ),
    };
    const headline = suiteHeadline([unrun], (run) => run.specId);
    expect(headline).toMatchObject({ trees: 1, runs: 1, estimate: 1, shares: { notRun: 1 } });
  });
});
