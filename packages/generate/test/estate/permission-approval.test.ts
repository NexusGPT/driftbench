import { expect, it } from 'vitest';
import { stageModel, thenOf } from '../../src/estate/then';

it('compiles ask permission to the registered approval check, retaining the full command rule', () => {
  const then = thenOf(
    [
      {
        id: 'tool.ask',
        kind: 'tool',
        title: 'Ask before committing',
        approved: true,
        evidence: [
          { type: 'custom', name: 'permission', options: { effect: 'ask', rule: 'Bash(git commit:*)' } },
        ],
      },
    ],
    'positive',
    { stages: stageModel([]), skills: new Set(), customChecks: new Set(['permission']) },
  );
  expect(then.gaps).toEqual([]);
  expect(then.custom.permission).toEqual({
    rules: [{ effect: 'ask', rule: 'Bash(git commit:*)' }],
    block: 0,
  });
});
