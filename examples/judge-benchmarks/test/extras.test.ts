import { describe, expect, it } from 'vitest';
import {
  agreementSolve,
  consensusSolve,
  pythonOutput,
  pythonRun,
  unanimousSolve,
  validateDivergence,
} from '../src/extras';

describe('strict reference consensus', () => {
  it('rejects fabricated, empty or swapped disagreement quotes', () => {
    const claim = { first_quote: 'x = 2', second_quote: 'x = 3', subquestion: 'What is x?' };
    expect(validateDivergence(claim, 'Thus x = 2.', 'Thus x = 3.')).toBe(JSON.stringify(claim));
    expect(validateDivergence(claim, 'Thus x = 3.', 'Thus x = 2.')).toBeUndefined();
    expect(validateDivergence({ ...claim, first_quote: 'x = 4' }, 'x = 2', 'x = 3')).toBeUndefined();
    expect(validateDivergence({ ...claim, first_quote: '' }, 'x = 2', 'x = 3')).toBeUndefined();
    expect(validateDivergence({ ...claim, subquestion: '' }, 'x = 2', 'x = 3')).toBeUndefined();
  });
  it('treats repeated option letters and annotations as the same answer', () => {
    const solves = [
      'Final answer: B (BBBBB)',
      'Final answer: **BBBBB**',
      'Final answer: B',
      'Final answer: A',
      'Final answer: AAAAA',
    ];
    expect(consensusSolve(solves)).toBe(solves[0]);
  });
  it('omits a reference with a plurality but no strict majority', () => {
    expect(
      consensusSolve([
        'Final answer: A',
        'Final answer: A',
        'Final answer: B',
        'Final answer: C',
        'Final answer: D',
      ]),
    ).toBeUndefined();
  });
  it('does not collapse decimal answers into integers', () => {
    expect(consensusSolve(['Final answer: 2.5', 'Final answer: 25', 'Final answer: 25'])).toBe(
      'Final answer: 25',
    );
    expect(consensusSolve(['Final answer: 2.5', 'Final answer: 25'])).toBeUndefined();
  });
  it('does not turn unparsed solves into votes or fall back to the first solve', () => {
    expect(consensusSolve(['No final answer', 'Final answer: A', 'Still unsure'])).toBeUndefined();
    expect(consensusSolve([])).toBeUndefined();
  });
  it('rejects a final line whose repeated option contradicts its stated letter', () => {
    expect(consensusSolve(['Final answer: B (AAAAA)', 'Final answer: B', 'Final answer: A'])).toBeUndefined();
  });
  it('requires every knowledge solve to agree before using a unanimous reference', () => {
    expect(unanimousSolve(['Final answer: B', 'Final answer: BBBBB', 'Final answer: B (BBBBB)'])).toBe(
      'Final answer: B',
    );
    expect(unanimousSolve(['Final answer: B', 'Final answer: B', 'Final answer: A'])).toBeUndefined();
    expect(unanimousSolve(['Final answer: B', 'Final answer: B', 'unsure'])).toBeUndefined();
  });
  it('runs pure arithmetic and rejects filesystem and network operations', async () => {
    expect(
      await pythonOutput('from fractions import Fraction\nprint(Fraction(529, 2))', 'python3', true),
    ).toBe('529/2');
    expect(await pythonOutput('open("forbidden", "w").write("bad")', 'python3', true)).toBeUndefined();
    expect(await pythonOutput('import socket\nprint(1)', 'python3', true)).toBeUndefined();
    expect(await pythonOutput('print(eval("40+2"))', 'python3', true)).toBeUndefined();
    expect(await pythonOutput('import random\nprint(random._os.name)', 'python3', true)).toBeUndefined();
    expect(await pythonOutput('import re\nprint(re.enum.sys.modules)', 'python3', true)).toBeUndefined();
  });
  it('replays random pure checks deterministically', async () => {
    const program = 'import random\nprint(random.random())';
    expect(await pythonOutput(program, 'python3', true)).toBe(await pythonOutput(program, 'python3', true));
  });
  it('uses four of five solves at the 80 percent gate but rejects three of five', () => {
    expect(
      agreementSolve(
        ['Final answer: A', 'Final answer: A', 'Final answer: A', 'Final answer: A', 'Final answer: B'],
        0.8,
      ),
    ).toBe('Final answer: A');
    expect(
      agreementSolve(
        ['Final answer: A', 'Final answer: A', 'Final answer: A', 'Final answer: B', 'Final answer: B'],
        0.8,
      ),
    ).toBeUndefined();
  });
  it('preserves the real execution error for program repair', async () => {
    const ran = await pythonRun('print(1/0)', 'python3', true);
    expect(ran.output).toBeUndefined();
    expect(ran.error).toContain('ZeroDivisionError');
    expect(ran.error).not.toContain('/Users/');
  });
});
