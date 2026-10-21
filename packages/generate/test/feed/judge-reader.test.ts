import { describe, expect, it, vi } from 'vitest';
import { createJudgeConditionReader } from '../../src/feed/judge-reader';

const questions = [
  { name: 'delay/one', kind: 'yesno' as const, text: 'Does this specify a shipment over one day late?', yes: 'yes', no: 'no' },
  { name: 'delay/two', kind: 'yesno' as const, text: 'Does this specify a shipment over two days late?', yes: 'yes', no: 'no' },
];

describe('condition candidates through the repository system-1 judge port', () => {
  it('uses one independent binary criterion per candidate and retains the probability', async () => {
    const judge = vi.fn(async (request: { criterion: { name: string } }) => ({
      answer: { outcome: 'pass' as const, score: request.criterion.name === 'delay/one' ? 0.9 : 0.1 },
    }));
    const reader = createJudgeConditionReader({ id: 'jev', cls: 'system1', family: 'jev', model: 'jev-1.13.0', judge });
    expect(await reader.read('When a shipment is over one day late, notify its keeper.', questions)).toEqual({
      'delay/one': { yes: 0.9 }, 'delay/two': { yes: 0.1 },
    });
    expect(judge).toHaveBeenCalledTimes(2);
    expect(judge.mock.calls[0]?.[0]).toMatchObject({
      criterion: { name: 'delay/one', rubric: questions[0]?.text, pass: expect.any(String), fail: expect.any(String) },
      transcript: [{ role: 'user', text: 'When a shipment is over one day late, notify its keeper.' }],
    });
    expect(reader).toMatchObject({ family: 'jev', model: 'jev-1.13.0' });
  });

  it('never turns a malformed or failed vote into no, so the proposer cannot run over it', async () => {
    const judge = vi.fn(async () => ({ answer: { outcome: 'inconclusive' as const }, unparsed: true }));
    const reader = createJudgeConditionReader({ id: 'jev', cls: 'system1', family: 'jev', judge });
    expect(await reader.read('clause', questions)).toEqual({ 'delay/one': undefined, 'delay/two': undefined });
  });

  it('refuses a free-form system-2 client and choice questions before any call', async () => {
    const judge = vi.fn(async () => ({ answer: { outcome: 'pass' as const, score: 1 } }));
    expect(() => createJudgeConditionReader({ id: 'chat', cls: 'system2', family: 'fictional', judge })).toThrow('system1');
    const reader = createJudgeConditionReader({ id: 'jev', cls: 'system1', family: 'jev', judge });
    await expect(reader.read('clause', [{ name: 'x', kind: 'choice', text: 'Which?', options: [] }])).rejects.toThrow('yes/no');
    expect(await reader.read('clause', [])).toEqual({});
    expect(judge).not.toHaveBeenCalled();
  });
});
