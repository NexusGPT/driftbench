import { describe, expect, it } from 'vitest';
import { renderRun } from '../src/html';
import { runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

/** A run whose first block failed and whose helper ran a command; every name is invented for the test. */
function withHelper() {
  const result = run({ blocks: [{ pass: false, toolCalls: ['Agent'] }] });
  const first = result.blocks[0];
  if (!first) throw new Error('no block');
  first.observed.helperCalls = [
    {
      id: 'h-1',
      label: 'Bash',
      input: { command: 'rm -rf scratch/old' },
      output: 'removed',
      actor: 'helper',
      parentCallId: 'agent-1',
    },
  ];
  return result;
}

describe('the helper calls of a block in the report', () => {
  it('are in the run detail, apart from the agent calls, with the Agent call they belong to', () => {
    const result = withHelper();
    const detail = runDetailOf(dataOf([result]), result);
    const first = detail.blocks[0];
    expect(first?.toolCalls.map((call) => call.label)).toEqual(['Agent']);
    expect(first?.helperCalls).toEqual([
      expect.objectContaining({ label: 'Bash', actor: 'helper', parentCallId: 'agent-1' }),
    ]);
  });

  it('are listed in the run page under their own heading', () => {
    const result = withHelper();
    const page = renderRun(runDetailOf(dataOf([result]), result));
    expect(page).toContain('Helper calls');
    expect(page).toContain('rm -rf scratch/old');
    expect(page).not.toContain('[object Object]');
  });

  it('change nothing for a block with no helper', () => {
    const plain = run({ blocks: [{ pass: false, toolCalls: ['Agent'] }] });
    const detail = runDetailOf(dataOf([plain]), plain);
    expect(detail.blocks[0]?.helperCalls).toBeUndefined();
    expect(renderRun(detail)).not.toContain('Helper calls');
  });
});
