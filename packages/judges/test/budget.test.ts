import { describe, expect, it } from 'vitest';
import { buildPrompt, fitPrompt, type JudgeRequest, type TranscriptEntry } from '../src/index';

const turn = (n: number): TranscriptEntry[] => [
  { role: 'user', text: `question ${n} ${'x'.repeat(40)}` },
  { role: 'agent', text: `answer ${n} ${'y'.repeat(40)}` },
];
const request = (turns: number, extra: Partial<JudgeRequest> = {}): JudgeRequest => ({
  criterion: { name: 'c', rubric: 'The reply names Acme Care.' },
  transcript: Array.from({ length: turns }, (_, i) => turn(i)).flat(),
  ...extra,
});
const size = (q: JudgeRequest) => buildPrompt(q).user.length;

describe('fitPrompt', () => {
  it('returns a request that fits as it is, also at exactly the budget', () => {
    const q = request(4);
    expect(fitPrompt(q, size(q))).toBe(q);
    expect(fitPrompt(q, size(q) + 50)).toBe(q);
  });

  it('drops the fewest oldest entries behind one context marker, and the result fits', () => {
    const q = request(8);
    const max = size(q) - 150;
    const got = fitPrompt(q, max);
    expect(size(got)).toBeLessThanOrEqual(max);
    expect(got.transcript[0]).toEqual({
      role: 'context',
      text: expect.stringMatching(/^\[\d+ earlier entries omitted\]$/),
    });
    const dropped = Number(/\[(\d+)/.exec(got.transcript[0]?.text ?? '')?.[1]);
    expect(got.transcript.slice(1)).toEqual(q.transcript.slice(dropped));
    // one fewer drop would not fit
    const fewer = {
      ...q,
      transcript: [got.transcript[0] as TranscriptEntry, ...q.transcript.slice(dropped - 1)],
    };
    expect(size(fewer)).toBeGreaterThan(max);
    expect(fitPrompt(got, max)).toEqual(got);
  });

  it('says "entry" for one dropped entry, keeps the artifact and the Given, and never orphans a tool result', () => {
    const one: JudgeRequest = {
      ...request(3),
      transcript: [{ role: 'agent', text: 'z'.repeat(150) }, ...request(3).transcript],
    };
    expect(fitPrompt(one, size(one) - 5).transcript[0]?.text).toBe('[1 earlier entry omitted]');
    const kept = request(6, { artifact: 'File a.txt\nhello', given: { stage: 'offer' } });
    const got = fitPrompt(kept, size(kept) - 150);
    expect(got.artifact).toBe(kept.artifact);
    expect(got.given).toEqual(kept.given);
    const tools: JudgeRequest = {
      criterion: kept.criterion,
      transcript: [
        { role: 'user', text: 'hello' },
        { role: 'tool_call', tool: 't', text: '{}' },
        { role: 'tool_result', tool: 't', text: 'r'.repeat(30) },
        { role: 'agent', text: 'ok' },
        ...turn(1),
      ],
    };
    const cut = fitPrompt(tools, size(tools) - 12);
    expect(cut.transcript[1]?.role).not.toBe('tool_result');
  });

  it('refuses a budget that is not a whole number above 0, and one the last block overflows', () => {
    const q = request(3);
    for (const max of [0, -5, 1000.5, Number.NaN]) expect(() => fitPrompt(q, max)).toThrow(RangeError);
    expect(() => fitPrompt(q, size({ ...q, transcript: q.transcript.slice(-2) }) - 10)).toThrow(RangeError);
    expect(() => fitPrompt(request(1), size(request(1)) - 1)).toThrow(RangeError);
  });
});
