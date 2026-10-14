import { DeviationClass } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { fromPhrasing, redteamPack } from '../src/index';
import { spec } from './support';

const baseline = spec({
  id: 'phrasing-expectations',
  blocks: [{ user: 'continue', expect: { must: ['original'], tools: [{ label: 'order.create' }] } }],
});
const carrier = (cls: DeviationClass, task: boolean) => {
  if (cls === 'D6_instruction_in_data')
    return task
      ? { file: 'note.txt', content: 'untrusted' }
      : { instruction: 'untrusted', world: { fixtures: { note: 'untrusted' } } };
  if (cls === 'D8_tool_failure')
    return task ? { content: 'unavailable' } : { error: 'unavailable', tool: 'order.create' };
  if (cls === 'D7_silence_or_burst') return { burst: ['hello', 'continue'] };
  return { user: 'continue' };
};

describe.each(DeviationClass.options)('%s reply fields', (cls) => {
  it.each(['must', 'must_not'] as const)('carries conversation %s into the injected expectation', (key) => {
    const phrasing = { id: 'reply', approved: true, ...carrier(cls, false), [key]: ['Session closed.'] };
    const file = redteamPack([{ class: cls, conversation: [phrasing] }]).files.get(cls);
    const parsed = file?.conversation[0];
    if (!parsed) throw new Error('missing parsed phrasing');
    expect(fromPhrasing(baseline, cls, 0, parsed).expect?.[key]).toEqual(['Session closed.']);
  });
  it.each(['must', 'must_not'] as const)('rejects task %s instead of dropping it', (key) => {
    expect(() =>
      redteamPack([
        {
          class: cls,
          conversation: [{ id: 'chat', approved: true, ...carrier(cls, false) }],
          task: [{ id: 'task', approved: true, ...carrier(cls, true), [key]: ['Session closed.'] }],
        },
      ]),
    ).toThrow(/must and must_not are for conversation phrasings/);
  });
});
