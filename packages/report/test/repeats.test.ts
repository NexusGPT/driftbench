import { parseRepeatReducer } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { criterionRepeats } from '../src/repeats';
import { run } from './support';

const judged = (name: string, outcome: 'pass' | 'fail' | 'inconclusive') => ({
  id: `judge.${name}`,
  kind: 'judge' as const,
  name,
  outcome,
});

const reducers = new Map([['tone', parseRepeatReducer('mode')]]);

describe('criterionRepeats', () => {
  it('folds the criterion across the blocks of one run: any fail is a fail, all pass is a pass', () => {
    const runs = [
      run({
        repeat: 0,
        blocks: [{ verdicts: [judged('tone', 'pass')] }, { verdicts: [judged('tone', 'fail')] }],
      }),
    ];
    const [line] = criterionRepeats(runs, new Map([['h1', reducers]]));
    expect(line?.outcomes).toEqual([0]);
    expect(line?.verdict).toBe(0);
  });

  it('a run with an inconclusive verdict and no fail is undecided for that repeat', () => {
    const runs = [
      run({
        repeat: 0,
        blocks: [{ verdicts: [judged('tone', 'pass')] }, { verdicts: [judged('tone', 'inconclusive')] }],
      }),
      run({ repeat: 1, blocks: [{ verdicts: [judged('tone', 'pass')] }] }),
      run({ repeat: 2, blocks: [{ verdicts: [judged('tone', 'pass')] }] }),
    ];
    const [line] = criterionRepeats(runs, new Map([['h1', reducers]]));
    expect(line?.outcomes).toEqual([undefined, 1, 1]);
    expect(line?.verdict).toBe(1);
  });

  it('a run that never judged the criterion is undecided, not a pass', () => {
    const runs = [run({ repeat: 0, blocks: [{}] }), run({ repeat: 1, blocks: [{}] })];
    const [line] = criterionRepeats(runs, new Map([['h1', reducers]]));
    expect(line?.outcomes).toEqual([undefined, undefined]);
    expect(line?.verdict).toBeUndefined();
  });

  it('applies each criterion its own reducer, and skips criteria without one', () => {
    const runs = [
      run({
        repeat: 0,
        blocks: [{ verdicts: [judged('tone', 'fail'), judged('facts', 'pass'), judged('other', 'fail')] }],
      }),
      run({
        repeat: 1,
        blocks: [{ verdicts: [judged('tone', 'pass'), judged('facts', 'pass'), judged('other', 'fail')] }],
      }),
      run({
        repeat: 2,
        blocks: [{ verdicts: [judged('tone', 'pass'), judged('facts', 'pass'), judged('other', 'fail')] }],
      }),
    ];
    const lines = criterionRepeats(
      runs,
      new Map([
        [
          'h1',
          new Map([
            ['tone', parseRepeatReducer('at_least:2')],
            ['facts', parseRepeatReducer('median')],
          ]),
        ],
      ]),
    );
    expect(lines.map((line) => line.criterion).sort()).toEqual(['facts', 'tone']);
    expect(lines.find((line) => line.criterion === 'tone')?.verdict).toBe(1);
    expect(lines.find((line) => line.criterion === 'facts')?.verdict).toBe(1);
  });

  it('keeps each line apart: a different target is a different line', () => {
    const runs = [
      run({
        repeat: 0,
        target: { provider: 'a', model: 'x' } as never,
        blocks: [{ verdicts: [judged('tone', 'fail')] }],
      }),
      run({
        repeat: 0,
        target: { provider: 'b', model: 'x' } as never,
        blocks: [{ verdicts: [judged('tone', 'pass')] }],
      }),
    ];
    const lines = criterionRepeats(runs, new Map([['h1', reducers]]));
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.verdict).sort()).toEqual([0, 1]);
  });
});
