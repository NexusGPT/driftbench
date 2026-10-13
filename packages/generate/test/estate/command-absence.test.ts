import { someCall } from '@agent-nexus/driftbench-checks';
import type { CheckContext } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { compilePredicate } from '../../src/estate/predicates';
import { stageModel, thenOf } from '../../src/estate/then';

describe('command_absent compiles to an observed call prohibition', () => {
  it('passes normal calls and fails the forbidden command including its arguments', async () => {
    const then = thenOf(
      [
        {
          id: 'instruction.command',
          kind: 'instruction',
          title: 'Never run a forced publication',
          approved: true,
          evidence: [{ type: 'custom', name: 'command_absent', options: { command: 'git push --force' } }],
        },
      ],
      'positive',
      { stages: stageModel([]), skills: new Set(), customChecks: new Set(['some_call']), judge: true },
    );
    expect(then.judged).toEqual([]);
    expect(then.someCalls).toHaveLength(1);
    const evaluate = async (command: string) => {
      const result = await someCall(
        { observed: { toolCalls: [{ id: 'a', label: 'Bash', input: { command } }] } } as CheckContext,
        { calls: then.someCalls },
      );
      return Array.isArray(result) ? result[0]?.outcome : result.outcome;
    };
    expect(await evaluate('git push origin fixture')).toBe('pass');
    expect(await evaluate('git push --force origin fixture')).toBe('fail');
  });
  it('requires a nonempty command, and takes the command literally', () => {
    expect(compilePredicate('command_absent', {})).toBeUndefined();
    expect(compilePredicate('command_absent', { command: '' })).toBeUndefined();
    expect(compilePredicate('command_absent', { command: '  ' })).toBeUndefined();
    expect(compilePredicate('command_absent', { command: 'cleanup[old]' })).toEqual({
      someCalls: [{ label: 'Bash', input: { command: { contains: 'cleanup[old]' } }, count: 0 }],
    });
  });
});
