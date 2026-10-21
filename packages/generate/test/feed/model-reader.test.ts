import { describe, expect, it, vi } from 'vitest';
import { createConditionReader } from '../../src/feed/model-reader';

const questions = [
  { name: 'delay/two', kind: 'yesno' as const, text: 'Does the clause name a delay over two days?', yes: 'yes', no: 'no' },
  { name: 'delay/one', kind: 'yesno' as const, text: 'Does the clause name a delay over one day?', yes: 'yes', no: 'no' },
];

describe('the discriminative condition reader', () => {
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
