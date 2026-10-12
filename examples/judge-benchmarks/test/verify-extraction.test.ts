import { describe, expect, it } from 'vitest';
import { extractLocalFinal, parseQuotedExtraction, quotedExtractionPrompt } from '../src/verify-extraction';

describe('literal local final answer extraction', () => {
  it('reads balanced nested LaTex boxes, including escaped literal braces', () => {
    expect(
      extractLocalFinal(
        'Compute x.',
        String.raw`Draft: \boxed{0}. Final answer: $\boxed{\frac{1}{2+\sqrt{3}}}$`,
      ),
    ).toBe(String.raw`\frac{1}{2+\sqrt{3}}`);
    expect(extractLocalFinal('Find the set.', String.raw`\boxed{\{1,2\}}`)).toBe(String.raw`\{1,2\}`);
    expect(extractLocalFinal('Compute x.', String.raw`\boxed{\frac{1}{2}`)).toBeUndefined();
    expect(extractLocalFinal('Compute x.', 'Final answer: \\boxed{\n\\frac{1}{2}\n}')).toBe(
      String.raw`\frac{1}{2}`,
    );
    expect(extractLocalFinal('Compute x.', 'Final answer: \\boxed{12')).toBeUndefined();
    expect(extractLocalFinal('Compute x.', String.raw`First \boxed{0}, then \boxed{2}.`)).toBe('2');
    expect(extractLocalFinal('Compute x.', String.raw`Thus -\boxed{2} cm`)).toBe(String.raw`-\boxed{2} cm`);
  });

  it('takes the last committed marker and preserves signs, units and qualifications', () => {
    expect(
      extractLocalFinal(
        'Find the distance.',
        'Final answer: 12 m\n\nRechecking changes it.\nFinal answer: -12 cm, for x > 0.',
      ),
    ).toBe('-12 cm, for x > 0.');
    expect(extractLocalFinal('Find the distance.', String.raw`Final answer: \boxed{12} cm`)).toBe(
      String.raw`\boxed{12} cm`,
    );
    expect(extractLocalFinal('Find x.', '**Final answer:** -2')).toBe('-2');
    expect(extractLocalFinal('Find x.', 'Therefore, x = 7.')).toBe('x = 7.');
  });

  it('keeps explicit final truth and option labels despite contradictory reasoning', () => {
    expect(extractLocalFinal('Is X proved, disproved or unknown?', 'X is false. **Proved.**')).toBe('Proved');
    expect(
      extractLocalFinal(
        'Is it true?',
        'Final answer: False\nThe explanation proves it true. Therefore True.',
      ),
    ).toBe('False');
    expect(
      extractLocalFinal(
        'Which option?',
        String.raw`Final answer: (B)\nExplanation: option A is right: \boxed{A}`,
      ),
    ).toBe(String.raw`(B)\nExplanation: option A is right: \boxed{A}`);
    expect(extractLocalFinal('Which option?', 'Final answer: (B)\nExplanation: option A is right.')).toBe(
      '(B)',
    );
    expect(extractLocalFinal('Which option?', 'Final answer: (B)\nExplanation: the answer is A.')).toBe(
      '(B)',
    );
  });

  it('defers independent multipart requests instead of dropping a requested part', () => {
    expect(
      extractLocalFinal('Find both answers to the two parts.', 'Part one: 3\nFinal answer: 4'),
    ).toBeUndefined();
    expect(extractLocalFinal('What is x? What is y?', String.raw`x=3. \boxed{4}`)).toBeUndefined();
    expect(extractLocalFinal('Find x and calculate y.', 'Final answer: y=4')).toBeUndefined();
    expect(extractLocalFinal('(a) Find x.\n(b) Find y.', 'Final answer: y=4')).toBeUndefined();
    expect(extractLocalFinal('Compute both x and y.', 'Final answer: y=4')).toBeUndefined();
    expect(extractLocalFinal('Find x and y.', 'Final answer: y=4')).toBeUndefined();
  });

  it('allows a terminal output in a variable chain and a single multiple-choice answer', () => {
    expect(extractLocalFinal('Compute x. Then using x, find y.', 'x=3\nFinal answer: y=9')).toBe('y=9');
    expect(
      extractLocalFinal('Using the previous results, what is the terminal value?', 'Final answer: 9'),
    ).toBe('9');
    expect(extractLocalFinal('Which option is right?\n(A) 1\n(B) 2', 'Final answer: (B)')).toBe('(B)');
  });

  it('defers literal curly-brace completion tasks', () => {
    expect(
      extractLocalFinal('Complete the sequence: { [ (', String.raw`Final answer: \boxed{)]}}`),
    ).toBeUndefined();
  });

  it('excludes abandoned thinking and rejects unfinished thinking answers', () => {
    expect(extractLocalFinal('Find x.', '<think>Final answer: 2</think>Final answer: 3')).toBe('3');
    expect(extractLocalFinal('Find x.', '<think>Final answer: 2</think>No final answer.')).toBeUndefined();
    expect(extractLocalFinal('Find x.', '<think>Final answer: 2')).toBeUndefined();
    expect(
      extractLocalFinal('Find x.', '<think>2</think><think>Final answer: 3</think>Final answer: 4'),
    ).toBe('4');
  });

  it('retains a multiline displayed answer as a literal response substring', () => {
    const response = 'Final answer:\n\\[\n\\begin{pmatrix}1 & 2\\\\3 & 4\\end{pmatrix}\n\\]';
    const extracted = extractLocalFinal('Find the matrix.', response);
    expect(extracted).toBe('\\[\n\\begin{pmatrix}1 & 2\\\\3 & 4\\end{pmatrix}\n\\]');
    expect(response.includes(extracted ?? '')).toBe(true);
    expect(extractLocalFinal('Find x.', 'Final answer:\n\\[x=2\\] for x > 0')).toBe('\\[x=2\\] for x > 0');
  });
});

describe('quote-validated fallback', () => {
  it('asks for literal answers and sees only the tail after thinking', () => {
    const response = `<think>SECRET ABANDONED ANSWER</think>${'x'.repeat(20000)}Final answer: 3`;
    const prompt = quotedExtractionPrompt('Find x and y.', response);
    expect(prompt.user).not.toContain('SECRET ABANDONED ANSWER');
    expect(prompt.user).not.toContain('x'.repeat(5000));
    expect(prompt.user).toContain('x'.repeat(Math.ceil(response.length * 0.2) - 'Final answer: 3'.length));
    expect(prompt.user).toContain('independent requested parts require every answer');
    expect(prompt.user).toContain('final_answer must equal that complete quote');
    expect(prompt.system).toContain('Do not solve');
    expect(quotedExtractionPrompt('Find x.', 'Final answer: 3').user).toContain('Final answer: 3');
  });

  it('accepts literal quotations, including the complete multipart answer', () => {
    const response = 'Reasoning.\nAnswers: x=3; y=-4 cm.';
    expect(
      parseQuotedExtraction(
        JSON.stringify({ final_answer: 'x=3; y=-4 cm.', quote: 'Answers: x=3; y=-4 cm.' }),
        response,
      ),
    ).toBe('x=3; y=-4 cm.');
    expect(parseQuotedExtraction('```json\n{"final_answer":"3", "quote":"x=3"}\n```', response)).toBe('3');
    const both = 'x=3\nReasoning for part two\ny=-4 cm';
    expect(parseQuotedExtraction(JSON.stringify({ final_answer: both, quote: both }), both)).toBe(both);
  });

  it('rejects invented quotations, signs, units, option letters and whitespace repairs', () => {
    const response = 'Final answer: 12';
    for (const output of [
      { final_answer: '-12', quote: 'Final answer: 12' },
      { final_answer: '12 cm', quote: 'Final answer: 12' },
      { final_answer: '(A) 12', quote: 'Final answer: 12' },
      { final_answer: '12', quote: 'The answer is 12' },
      { final_answer: ' 12 ', quote: 'Final answer: 12' },
    ])
      expect(parseQuotedExtraction(JSON.stringify(output), response)).toBeUndefined();
  });

  it('rejects malformed types, missing answers and extra prose', () => {
    for (const output of [
      '{"final_answer":12,"quote":"12"}',
      '{"final_answer":"12","quote":12}',
      '{"final_answer":"12"}',
      '{"final_answer":"","quote":""}',
      '[{"final_answer":"12","quote":"12"}]',
      'null',
      'Here is JSON: {"final_answer":"12","quote":"12"}',
      '{bad JSON}',
    ])
      expect(parseQuotedExtraction(output, '12')).toBeUndefined();
  });

  it('rejects a literal quote drawn only from abandoned thinking', () => {
    const response = '<think>Final answer: 2</think>Final answer: 3';
    expect(parseQuotedExtraction('{"final_answer":"2","quote":"Final answer: 2"}', response)).toBeUndefined();
    expect(parseQuotedExtraction('{"final_answer":"3","quote":"Final answer: 3"}', response)).toBe('3');
  });
});
