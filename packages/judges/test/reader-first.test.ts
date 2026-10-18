import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeClient } from '../src/client';
import type { JudgeRequest } from '../src/contract';
import {
  createReaderFirstJudge,
  READER_FIRST_CRITERIA,
  readerBallot,
  readerFirstRequest,
  resolveReaderFirst,
} from '../src/reader-first';
import { readerFeatures } from '../src/reader-first-features';
import fixture from './fixtures/reader-first.json';

const long = fixture.padding.repeat(80);
const short = fixture.short;
function answer(request: JudgeRequest, scores = true) {
  const a = request.candidates!.A;
  const b = request.candidates!.B;
  const quote = (s: string) => s.split('\n')[0]!;
  const raw = JSON.stringify({
    items: READER_FIRST_CRITERIA.map((name) => ({
      name,
      a: scores && a === long ? 1 : 4,
      b: scores && b === long ? 1 : 4,
      reasoning: 'Quoted language supports the scores.',
      evidence: `A: ${quote(a)} || B: ${quote(b)}`,
    })),
  });
  return parseJudgeText(raw, request);
}
const client: JudgeClient = {
  id: 'fixture',
  cls: 'system2',
  family: 'test',
  cost: 0,
  judge: async (request) => answer(request),
};

describe('reader-first is an explicit opt-in configuration', () => {
  it('overrides a longer padded, indirect, context-dependent fixture with grounded rubric scores', async () => {
    const result = await createReaderFirstJudge(client, { configuration: 'reader-first' }).judgePair(
      fixture.question,
      long,
      short,
    );
    expect(result.length).toBe('A');
    expect(result.choice).toBe('B');
    expect(result.override).toBe(true);
    expect(result.calls).toBe(2);
    expect(result.ordered.valid).toBe(true);
    expect(result.swapped.valid).toBe(true);
    expect(result.failures).toContain('economy');
    expect(result.failures).toContain('directness');
  });
  it('keeps the longer reply when the model identifies no serious failures', async () => {
    const neutral = { ...client, judge: async (r: JudgeRequest) => answer(r, false) };
    const result = await createReaderFirstJudge(neutral, { configuration: 'reader-first' }).judgePair(
      fixture.question,
      long,
      short,
    );
    expect(result.choice).toBe('A');
    expect(result.override).toBe(false);
  });
  it('rejects invented quotes and explicitly falls back to length', () => {
    const req = readerFirstRequest(fixture.question, long, short);
    const good = answer(req);
    const bad = {
      ...good,
      rubric: {
        ...good.rubric!,
        items: good.rubric!.items.map((x) => ({
          ...x,
          evidence: 'A: invented quote || B: another invention',
        })),
      },
    };
    const ballot = readerBallot(bad, long, short);
    expect(ballot.valid).toBe(false);
    const result = resolveReaderFirst(readerFeatures(long), readerFeatures(short), ballot, ballot, {
      configuration: 'reader-first',
    });
    expect(result.choice).toBe('A');
    expect(result.judgeValid).toBe(false);
  });
  it('remaps swapped evidence and scores to candidate identity', async () => {
    const judge = createReaderFirstJudge(client, { configuration: 'reader-first' });
    const ab = await judge.judgePair(fixture.question, long, short);
    const ba = await judge.judgePair(fixture.question, short, long);
    expect(ab.choice).toBe('B');
    expect(ba.choice).toBe('A');
    expect(ab.judgeGap).toBe(ba.judgeGap);
  });
  it('never converts a transport failure into a model-supported decision', async () => {
    const broken = {
      ...client,
      judge: async () => {
        throw new Error('transport failed');
      },
    };
    await expect(
      createReaderFirstJudge(broken, { configuration: 'reader-first' }).judgePair('q', long, short),
    ).rejects.toThrow('transport failed');
  });
  it('rejects invalid thresholds before calling a model', () => {
    expect(() =>
      createReaderFirstJudge(client, { configuration: 'reader-first', judgeMargin: Number.NaN }),
    ).toThrow();
    expect(() => createReaderFirstJudge(client, { configuration: 'reader-first', minFailures: 0 })).toThrow();
  });
  it('keeps equal-length candidates tied without choosing a position', async () => {
    const result = await createReaderFirstJudge(client, { configuration: 'reader-first' }).judgePair(
      'q',
      'One answer.',
      'Two words.',
    );
    expect(result.choice).toBe('tie');
  });
});

it('counts Chinese replies in Han characters even under an English instruction', async () => {
  const neutral = { ...client, judge: async (r: JudgeRequest) => answer(r, false) };
  const result = await createReaderFirstJudge(neutral, { configuration: 'reader-first' }).judgePair(
    'Write a poem in Chinese',
    '春风。',
    '春风吹过山河。',
  );
  expect(result.machine.A.language).toBe('zh');
  expect(result.machine.A.length).toBe(2);
  expect(result.machine.B.length).toBe(6);
  expect(result.choice).toBe('B');
});

it('requires model failures and matching one-sided machine flags', () => {
  const a = readerFeatures('A clear complete answer.');
  const b = readerFeatures('Another answer.');
  const ballot = {
    valid: true,
    problems: [],
    items: READER_FIRST_CRITERIA.map((name) => ({
      name,
      a: 0,
      b: 4,
      quoteA: 'A clear',
      quoteB: 'Another',
      reasoning: 'fixture',
    })),
  };
  const swapped = { ...ballot, items: ballot.items.map((x) => ({ ...x, a: 4, b: 0 })) };
  const result = resolveReaderFirst(a, b, ballot, swapped, { configuration: 'reader-first' });
  expect(result.judgeGap).toBe(20);
  expect(result.failures).toHaveLength(0);
  expect(result.choice).toBe('A');
});
