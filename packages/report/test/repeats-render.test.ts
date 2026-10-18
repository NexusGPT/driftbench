import { parseRepeatReducer } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { repeatsSection } from '../src/html';
import { criterionRepeats } from '../src/repeats';
import { criterionRepeatsText } from '../src/text';
import { run } from './support';

const judged = (name: string, outcome: 'pass' | 'fail' | 'inconclusive') => ({
  id: `judge.${name}`,
  kind: 'judge' as const,
  name,
  outcome,
});

/** Three repeats of one spec: tone passes twice and fails once, facts is undecided in one repeat. */
const runs = [
  run({ repeat: 0, blocks: [{ verdicts: [judged('tone', 'pass'), judged('facts', 'inconclusive')] }] }),
  run({ repeat: 1, blocks: [{ verdicts: [judged('tone', 'fail'), judged('facts', 'pass')] }] }),
  run({ repeat: 2, blocks: [{ verdicts: [judged('tone', 'pass'), judged('facts', 'pass')] }] }),
];

const lines = criterionRepeats(
  runs,
  new Map([
    [
      'h1',
      new Map([
        ['tone', parseRepeatReducer('mode')],
        ['facts', parseRepeatReducer('at_least:2')],
      ]),
    ],
  ]),
);

describe('repeat reduction in the report', () => {
  it('renders one section row per reduced criterion, with each repeat and the verdict', async () => {
    await expect(repeatsSection(lines)).toMatchFileSnapshot('./__snapshots__/criterion-repeats.html');
  });

  it('renders one command line per reduced criterion', async () => {
    await expect(criterionRepeatsText(lines).join('\n')).toMatchFileSnapshot(
      './__snapshots__/criterion-repeats.txt',
    );
  });

  it('renders nothing when no criterion names a reducer, so existing reports are unchanged', () => {
    expect(repeatsSection([])).toBe('');
    expect(criterionRepeatsText([])).toEqual([]);
  });
});
