import { describe, expect, it, vi } from 'vitest';
import { feedFromConditions } from '../../src/feed/conditions';
import { fixtureStore } from './support';
import { createConditionReader } from '../../src/feed/model-reader';

const questions = [
  { name: 'delay/two', kind: 'yesno' as const, text: 'Does the clause name a delay over two days?', yes: 'yes', no: 'no' },
  { name: 'delay/one', kind: 'yesno' as const, text: 'Does the clause name a delay over one day?', yes: 'yes', no: 'no' },
];

describe('the discriminative condition reader', () => {
  it('reads one complete JSON answer after a model explanation', async () => {
    const reader = createConditionReader({
      family: 'fictional',
      complete: async () => 'The first condition matches.\n{"answers":[true,false]}',
    });
    expect(await reader.read('clause', questions)).toEqual({
      'delay/two': { yes: 1 }, 'delay/one': { yes: 0 },
    });
  });

  it('asks about every candidate together and projects only explicit binary decisions', async () => {
    const complete = vi.fn(async (_request: unknown) => '{"answers":[true,false]}');
    const reader = createConditionReader({ family: 'fictional', model: 'binary-1', complete });
    expect(await reader.read('After two days, alert the clerk.', questions)).toEqual({
      'delay/two': { yes: 1 }, 'delay/one': { yes: 0 },
    });
    expect(reader).toMatchObject({ family: 'fictional', model: 'binary-1' });
    expect(complete.mock.calls).toHaveLength(1);
    const request = complete.mock.calls[0]?.[0] as unknown;
    expect(JSON.stringify(request)).toContain(questions[1]?.text);
  });

  it.each(['{}', '{"answers":[true]}', '{"answers":[true,0]}', '{"answers":[true,false,true]}', 'not JSON'])(
    'refuses an incomplete or nonbinary answer: %s', async (answer) => {
      const reader = createConditionReader({ family: 'fictional', complete: async () => answer });
      await expect(reader.read('Private clause text', questions)).rejects.toThrow('condition reader');
      await expect(reader.read('Private clause text', questions)).rejects.not.toThrow('Private clause text');
    },
  );

  it('makes no call for an empty candidate list and refuses choice questions before calling', async () => {
    const complete = vi.fn(async (_request: unknown) => '{"answers":[]}');
    const reader = createConditionReader({ family: 'fictional', complete });
    expect(await reader.read('clause', [])).toEqual({});
    await expect(reader.read('clause', [{
      name: 'choice', kind: 'choice', text: 'Which?', options: [],
    }])).rejects.toThrow('yes/no');
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not leak provider errors or turn them into no votes', async () => {
    const reader = createConditionReader({
      family: 'fictional', complete: async () => { throw new Error('Private clause text'); },
    });
    await expect(reader.read('Private clause text', questions)).rejects.toThrow('condition reader');
    await expect(reader.read('Private clause text', questions)).rejects.not.toThrow('Private clause text');
  });
});

describe('a binary reader inside the condition feed', () => {
  it('attaches the exact quote and never proposes when a known candidate answers yes', async () => {
    const store = fixtureStore();
    const variable = store.variables[0];
    const value = variable?.values[0];
    const quote = 'When a boat is overdue, alert its keeper.';
    const propose = vi.fn(async () => undefined);
    const result = await feedFromConditions({
      store,
      spans: [{ id: 'planted', path: 'rules.md', quote }],
      texts: new Map([['rules.md', quote]]),
      reader: createConditionReader({
        family: 'fictional',
        complete: async (request) => {
          const input = JSON.parse(request.user) as { questions: string[] };
          return JSON.stringify({ answers: input.questions.map((_, i) => i === 0) });
        },
      }),
      proposer: { id: 'fictional-proposer', propose },
    });
    expect(result.report.outcomes[0]).toMatchObject({
      status: 'matched', values: [`${variable?.id}/${value?.id}`],
    });
    expect(result.store.variables[0]?.values[0]?.provenance).toContainEqual({
      kind: 'quote', path: 'rules.md', quote,
    });
    expect(result.report.proposerCalls).toBe(0);
    expect(propose).not.toHaveBeenCalled();
    expect(store.variables[0]?.values[0]?.provenance ?? []).not.toContainEqual({
      kind: 'quote', path: 'rules.md', quote,
    });
  });
});
