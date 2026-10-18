import { expect, it } from 'vitest';
import { type JudgeRequest, parseAnswerText, parseJudgeText } from '../src/index';

const request: JudgeRequest = {
  criterion: { name: 'price', rubric: 'State price.' },
  transcript: [{ role: 'agent', text: 'Price $59.' }],
};
it('rejects contradictory duplicate binary verdict keys before repairing invalid escapes', () => {
  for (const raw of [
    String.raw`{"outcome":"fail","reasoning":"bad \q","outcome":"pass"}`,
    '{"outcome":"fail","reasoning":"bad","outcome":"pass"}',
    String.raw`{"outcome":"fail","reasoning":"bad \q","out\u0063ome":"pass"}`,
  ]) {
    expect(parseAnswerText(raw).unparsed).toBe(true);
    expect(parseAnswerText(raw).answer.outcome).toBe('inconclusive');
  }
});
it('rejects repeated met in one row, while allowing met once in each different row', () => {
  const bad = String.raw`{"checks":[{"id":"price","reasoning":"bad \q","evidence":"$59","met":false,"met":true}]}`;
  expect(parseJudgeText(bad, request).unparsed).toBe(true);
  expect(parseJudgeText(bad, request).answer.outcome).toBe('inconclusive');
  expect(
    parseJudgeText(
      String.raw`{"checks":[{"id":"price","reasoning":"bad \q","evidence":"$59","met":false,"m\u0065t":true}]}`,
      request,
    ).unparsed,
  ).toBe(true);
});
it('preserves quoted key words in reasoning and frozen legacy behavior', () => {
  expect(
    parseAnswerText(String.raw`{"outcome":"fail","reasoning":"bad \q and \"outcome\": \"pass\""}`).answer
      .outcome,
  ).toBe('fail');
  expect(
    parseJudgeText('{"outcome":"fail","reasoning":"old","outcome":"pass"}', {
      ...request,
      answerContract: 'legacy',
    }).answer.outcome,
  ).toBe('pass');
});

it('allows the same key in separate objects and rejects duplicate winner, score and rubric scores', () => {
  const two = {
    ...request,
    requirements: [
      { id: 'price', requirement: 'Give price.' },
      { id: 'allowance', requirement: 'Give allowance.' },
    ],
  };
  expect(
    parseJudgeText(
      '{"checks":[{"id":"price","reasoning":"ok","evidence":"$59","met":true},{"id":"allowance","reasoning":"absent","evidence":null,"met":false}]}',
      two,
    ).answer.outcome,
  ).toBe('fail');
  const pair: JudgeRequest = {
    ...request,
    assessment: { kind: 'pairwise' },
    candidates: { A: 'First.', B: 'Second.' },
  };
  expect(
    parseJudgeText('{"winner":"A","winner":"B","winnerQuote":"Second.","reasoning":"ok"}', pair).unparsed,
  ).toBe(true);
  expect(parseAnswerText('{"outcome":"pass","score":0,"score":1,"reasoning":"ok"}').unparsed).toBe(true);
  const rubric: JudgeRequest = {
    ...request,
    assessment: { kind: 'rubric', items: [{ name: 'price', rubric: 'Give price.' }] },
  };
  expect(
    parseJudgeText('{"items":[{"name":"price","score":0,"score":4,"reasoning":"ok"}]}', rubric).unparsed,
  ).toBe(true);
});
