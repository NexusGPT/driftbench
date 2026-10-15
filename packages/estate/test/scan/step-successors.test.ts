import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

describe('ordered step successors', () => {
  it.each([
    ['implicit order', ['start', 'check', 'finish']],
    [
      'string next',
      [
        { id: 'start', next: 'check' },
        { id: 'check', next: 'finish' },
        { id: 'finish', next: '' },
      ],
    ],
    [
      'then alias',
      JSON.parse(
        '[{"id":"start","then":["check"]},{"id":"check","then":"finish"},{"id":"finish","then":[]}]',
      ),
    ],
  ])('reads %s', async (_name, steps) => {
    const root = await estate({ '.claude/steps.json': JSON.stringify({ steps }, null, 2) });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.steps.map(({ id, next }) => ({ id, next }))).toEqual([
      { id: 'start', next: ['check'] },
      { id: 'check', next: ['finish'] },
      { id: 'finish', next: [] },
    ]);
  });

  it('preserves explicit terminal steps and does not infer across a declared graph', async () => {
    const root = await estate({
      '.claude/steps.json': JSON.stringify({ steps: [{ id: 'stop', next: [] }, { id: 'other' }] }, null, 2),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.steps.map((step) => step.next)).toEqual([[], []]);
  });

  it('skips anytime stages when inferring the ordered path', async () => {
    const root = await estate({
      '.claude/steps.json': JSON.stringify(
        { steps: [{ id: 'start' }, { id: 'note', anytime: true }, { id: 'finish' }] },
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.steps.map((step) => step.next)).toEqual([['finish'], [], []]);
  });
});
