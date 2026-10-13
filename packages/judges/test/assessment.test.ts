import { describe, expect, it } from 'vitest';
import { parseJudgeText, responseSchema } from '../src/assessment';
import { type JudgeRequest, parseAnswerText } from '../src/contract';
import { pairwiseRequest } from '../src/pairwise';
import { buildPrompt } from '../src/prompt';

const pair = pairwiseRequest({ name: 'correct', rubric: 'Correct answer.' }, [], '2', '4');
const rubric: JudgeRequest = {
  ...pair,
  assessment: {
    kind: 'rubric',
    pairwise: true,
    items: [
      { name: 'correct', rubric: 'Correct answer.', weight: 2 },
      { name: 'format', rubric: 'One number.' },
    ],
  },
};

describe('explicit winner', () => {
  it('maps B to fail even when the explanation says the response passes', () => {
    const result = parseJudgeText(
      '{"winner":"B","winnerQuote":"4","reasoning":"B passes the correctness check."}',
      pair,
    );
    expect(result.answer.outcome).toBe('fail');
    expect(result.winner).toBe('B');
  });
  it('keeps the binary contract strict and refuses ambiguous mixed answers', () => {
    expect(parseAnswerText('{"winner":"A","reasoning":"ok"}').unparsed).toBe(true);
    expect(parseJudgeText('{"winner":"B","outcome":"pass","reasoning":"ok"}', pair).unparsed).toBe(true);
    expect(parseJudgeText('{"outcome":"pass","reasoning":"ok"}', pair).unparsed).toBe(true);
  });
  it('asks providers for the winner schema and guards both reply data tags', () => {
    expect(responseSchema(pair).properties).toHaveProperty('winner');
    const prompt = buildPrompt(pair);
    expect(prompt.system).toContain('"winner"');
    expect(prompt.system).not.toContain('Answer "pass"');
  });
});

describe('itemized rubric aggregation', () => {
  const text = JSON.stringify({
    items: [
      { name: 'format', a: 4, b: 0, reasoning: 'A is one number.' },
      { name: 'correct', a: 0, b: 4, reasoning: 'B is correct.' },
    ],
  });
  it('aggregates by caller weights, independent of output order', () => {
    const result = parseJudgeText(text, rubric);
    expect(result.answer.outcome).toBe('fail');
    expect(result.rubric?.first).toBeCloseTo(1 / 3);
    expect(result.rubric?.second).toBeCloseTo(2 / 3);
    expect(result.rubric?.items.map((i) => i.name)).toEqual(['correct', 'format']);
  });
  it('refuses missing, duplicated or out-of-range requested item scores', () => {
    for (const items of [
      [{ name: 'correct', a: 0, b: 4, reasoning: 'r' }],
      [
        { name: 'correct', a: 0, b: 4, reasoning: 'r' },
        { name: 'correct', a: 0, b: 4, reasoning: 'r' },
      ],
      [
        { name: 'correct', a: 0, b: 5, reasoning: 'r' },
        { name: 'format', a: 4, b: 0, reasoning: 'r' },
      ],
      [
        { name: 'invented', a: 0, b: 4, reasoning: 'r' },
        { name: 'format', a: 4, b: 0, reasoning: 'r' },
      ],
    ])
      expect(parseJudgeText(JSON.stringify({ items }), rubric).unparsed).toBe(true);
  });
  it('keeps an unknown item inconclusive, never zero or a pass', () => {
    const unknown = text.replace('"a":0', '"a":null');
    expect(parseJudgeText(unknown, rubric).answer.outcome).toBe('inconclusive');
  });
  it('uses a specified pointwise threshold and does not let the model set it', () => {
    const point: JudgeRequest = {
      criterion: pair.criterion,
      transcript: [],
      assessment: {
        kind: 'rubric',
        threshold: 0.8,
        items: [{ name: 'correct', rubric: 'Correct.' }],
      },
    };
    expect(
      parseJudgeText('{"items":[{"name":"correct","score":3,"reasoning":"partial"}]}', point).answer.outcome,
    ).toBe('fail');
    expect(buildPrompt(point).user).toContain('correct');
  });
});

describe('winner content integrity', () => {
  it('refuses a quote belonging to the losing candidate', () => {
    const text = '{"reasoning":"B is better","winnerQuote":"2","winner":"B"}';
    expect(parseJudgeText(text, pair).unparsed).toBe(true);
  });
  it('requires a grounded opening for a decisive winner', () => {
    expect(parseJudgeText('{"reasoning":"B","winnerQuote":"4","winner":"B"}', pair).answer.outcome).toBe(
      'fail',
    );
    expect(parseJudgeText('{"reasoning":"B","winner":"B"}', pair).unparsed).toBe(true);
  });
});

describe('hard rubric items', () => {
  it('a hard failure cannot be bought off by soft points', () => {
    const request: JudgeRequest = {
      ...pair,
      assessment: {
        kind: 'rubric',
        pairwise: true,
        items: [
          { name: 'correct', rubric: 'Correct answer.', hard: true },
          { name: 'style', rubric: 'Clear style.', weight: 100 },
        ],
      },
    };
    const result = parseJudgeText(
      JSON.stringify({
        items: [
          { name: 'correct', a: 0, b: 4, reasoning: 'B is correct' },
          { name: 'style', a: 4, b: 0, reasoning: 'A is clearer' },
        ],
      }),
      request,
    );
    expect(result.answer.outcome).toBe('fail');
  });
});

it('rejects whitespace-only and ambiguous opening quotes', () => {
  const request = {
    ...pair,
    candidates: { A: 'Shared opening, wrong answer.', B: 'Shared opening, correct answer.' },
  };
  for (const winnerQuote of [' ', '\t\n', 'Shared opening']) {
    expect(
      parseJudgeText(JSON.stringify({ reasoning: 'B is correct', winner: 'B', winnerQuote }), request)
        .unparsed,
    ).toBe(true);
  }
});

it('accepts a unique passage after a shared opening, using all supplied following words', () => {
  const request = {
    ...pair,
    candidates: {
      A: 'Shared opening. Wrong final result: 3.',
      B: 'Shared opening. Correct final result: 4.',
    },
  };
  for (const winnerQuote of ['Correct final result: 4.', 'Shared opening. Correct final result: 4.']) {
    expect(
      parseJudgeText(JSON.stringify({ winner: 'B', winnerQuote, reasoning: 'B is correct' }), request).winner,
    ).toBe('B');
  }
  const ambiguous = JSON.stringify({
    winner: 'B',
    winnerQuote: 'Shared opening.',
    reasoning: 'B is correct',
    evidence: 'Reply B: "Correct final result: 4."',
  });
  expect(parseJudgeText(ambiguous, request).winner).toBe('B');
  expect(
    parseJudgeText(
      JSON.stringify({
        winner: 'B',
        winnerQuote: 'Shared opening.',
        reasoning: 'B',
        evidence: 'Reply A: "Wrong final result: 3."',
      }),
      request,
    ).unparsed,
  ).toBe(true);
});
