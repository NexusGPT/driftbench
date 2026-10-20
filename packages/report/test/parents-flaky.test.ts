import { blockStatus, type RunResult } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { parentCauses } from '../src/causes';
import { renderRun } from '../src/html';
import { buildScorecard } from '../src/scorecard';
import { dataOf, run } from './support';

/**
 * A parent with mixed results over its repeats is labelled flaky (plan, Phase 5 grouping): a failed root that
 * passed in another repeat of the same line is read apart from one that always fails.
 */

const ids = ['root', 'child', 'leaf', 'independent'];

/** One repeat of a four-block forest: root, child of root, leaf of child, an independent root. */
function repeatOf(repeat: number, rootFails: boolean): RunResult {
  const shape = run({ specId: 'forest', repeat, blocks: [{ pass: !rootFails }, {}, {}, {}] });
  return {
    ...shape,
    blocks: shape.blocks.map((block, index) => ({
      ...block,
      specIndex: index,
      blockId: ids[index],
      ...(index === 1 || index === 2 ? { parent: index === 1 ? 'root' : 'child' } : {}),
      ...(rootFails && (index === 1 || index === 2)
        ? {
            pass: false,
            status: 'blocked' as const,
            verdicts: [],
            blocked: { by: index === 1 ? 'root' : 'child', root: 'root' },
          }
        : {}),
    })),
  };
}

describe('a flaky parent', () => {
  it('labels a failed root that passed in other repeats, with how many of its scored repeats passed', () => {
    const repeats = [repeatOf(0, true), repeatOf(1, false), repeatOf(2, false)];
    expect(repeats.map((entry) => entry.blocks.map(blockStatus).join(' '))).toEqual([
      'fail blocked blocked pass',
      'pass pass pass pass',
      'pass pass pass pass',
    ]);
    expect(parentCauses(repeats[0] as RunResult, repeats)).toEqual([
      { root: 'root', status: 'fail', blocked: ['child', 'leaf'], flaky: { passed: 2, scored: 3 } },
    ]);
    const card = buildScorecard(dataOf(repeats));
    const detail = card.drilldown.find((entry) => entry.repeat === 0);
    expect(detail?.causes?.[0]?.flaky).toEqual({ passed: 2, scored: 3 });
    if (!detail) throw new Error('missing detail');
    expect(renderRun(detail)).toContain(
      'root: fail, flaky: passed 2 of 3 repeats<ul><li>child: blocked</li><li>leaf: blocked</li></ul>',
    );
  });

  it('leaves a root that fails in every repeat unlabelled, and reads only repeats of the same line', () => {
    const always = [repeatOf(0, true), repeatOf(1, true)];
    expect(parentCauses(always[0] as RunResult, always)[0]?.flaky).toBeUndefined();
    // A passing run of another spec is another line: it never makes this root flaky.
    const other = { ...repeatOf(1, false), specId: 'other', runId: 'other-1' };
    const card = buildScorecard(dataOf([repeatOf(0, true), other]));
    const detail = card.drilldown.find((entry) => entry.specId === 'forest');
    expect(detail?.causes?.[0]).toMatchObject({ root: 'root', status: 'fail' });
    expect(detail?.causes?.[0]?.flaky).toBeUndefined();
  });

  it('never labels a root that was not run', () => {
    const unrun = repeatOf(0, true);
    const notRun = {
      ...unrun,
      blocks: unrun.blocks.map((block, index) =>
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
                expected: 'x',
                got: 'y',
              },
            }
          : block,
      ),
    };
    const causes = parentCauses(notRun, [notRun, repeatOf(1, false)]);
    expect(causes[0]).toMatchObject({ root: 'root', status: 'not_run' });
    expect(causes[0]?.flaky).toBeUndefined();
  });
});
