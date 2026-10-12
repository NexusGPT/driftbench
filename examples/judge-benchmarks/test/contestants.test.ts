import { describe, expect, it } from 'vitest';
import { CONTESTANTS, contestantById, jsonObjects } from '../src/contestants';

const input = { question: 'What is 2+2?', a: 'It is 4.', b: 'It is 5.', criterion: 'The answer is correct.' };

describe('the contestants', () => {
  it('are driftbench and five competitors, each with a pairwise or a pointwise form', () => {
    expect(CONTESTANTS.map((c) => c.id)).toEqual([
      'driftbench',
      'deepeval',
      'promptfoo',
      'inspect',
      'scenario',
      'langfuse',
    ]);
    for (const c of CONTESTANTS) expect(Boolean(c.pair) || Boolean(c.point), c.id).toBe(true);
    expect(() => contestantById('nobody')).toThrow(/no contestant nobody/);
  });

  it('give every contestant the same criterion, and the question and responses', () => {
    for (const c of CONTESTANTS) {
      const p = c.point?.({ question: input.question, response: input.a, criterion: input.criterion });
      // DeepEval reads the criterion once, in its setup call that writes the evaluation steps.
      const setup = c.setup?.point?.(input.criterion);
      const withCriterion = setup ? `${setup.system}\n${setup.user}` : p ? `${p.system}\n${p.user}` : '';
      if (p) expect(withCriterion, c.id).toContain(input.criterion);
      if (p) expect(`${p.system}\n${p.user}`, c.id).toContain('It is 4.');
      const q = c.pair?.({ ...input });
      if (q) expect(`${q.system}\n${q.user}`, c.id).toContain('It is 5.');
    }
  });

  it('driftbench: reads the answer contract; pass is position A', () => {
    const d = contestantById('driftbench');
    expect(d.parsePair?.('{"outcome":"pass","reasoning":"A is right"}')).toBe('A');
    expect(d.parsePair?.('{"outcome":"fail","reasoning":"B is right"}')).toBe('B');
    expect(d.parsePair?.('no json')).toBe('tie');
    expect(d.parsePoint?.('{"outcome":"fail","score":0.1,"reasoning":"x"}')).toEqual({
      pass: false,
      score: 0.1,
    });
  });

  it('DeepEval: Alice is position A, Bob is B; GEval normalises 0 to 10 with a 0.5 threshold', () => {
    const d = contestantById('deepeval');
    const prompt = d.pair?.({ ...input, setup: '{"steps":["Check the answer."]}' });
    expect(prompt?.user).toContain('1. Check the answer.');
    expect(prompt?.user.indexOf('Alice')).toBeLessThan(prompt?.user.indexOf('Bob') ?? 0);
    expect(d.parsePair?.('{"winner": "$Bob$", "reason": "x"}')).toBe('B');
    expect(d.parsePair?.('```json\n{"winner": "Alice", "reason": "x"}\n```')).toBe('A');
    expect(d.parsePoint?.('{"reason":"x","score":7}')).toEqual({ score: 0.7, pass: true });
  });

  it('promptfoo: index 0 is A; llm-rubric reads pass and score', () => {
    const p = contestantById('promptfoo');
    expect(p.parsePair?.('1')).toBe('B');
    expect(p.parsePair?.('0')).toBe('A');
    expect(p.parsePair?.('neither')).toBe('tie');
    expect(p.parsePoint?.('{"reason":"r","pass":false,"score":0}')).toEqual({ pass: false, score: 0 });
  });

  it('Inspect: the last GRADE letter; Scenario: the criterion status; Langfuse: the score', () => {
    expect(contestantById('inspect').parsePoint?.('GRADE: I ... GRADE: C')).toEqual({ pass: true, score: 1 });
    expect(
      contestantById('scenario').parsePoint?.(
        'Working \\boxed{4}. {"criteria": {"c": {"requirement": "r", "reasoning": "x", "status": "failed"}}, "reasoning": "y"}',
      ),
    ).toEqual({ pass: false, score: 0 });
    expect(
      contestantById('scenario').parsePoint?.('{"criteria": {"c": {"status": "inconclusive"}}}'),
    ).toEqual({});
    expect(contestantById('langfuse').parsePoint?.('{"score": 0.3, "reasoning": "r"}')).toEqual({
      score: 0.3,
      pass: false,
    });
  });

  it('finds JSON objects among braces that are not JSON, such as LaTeX', () => {
    expect(jsonObjects('\\frac{1}{2} then {"a": {"b": "}"}} and {"c": 1}')).toEqual([
      { a: { b: '}' } },
      { b: '}' },
      { c: 1 },
    ]);
  });
});
