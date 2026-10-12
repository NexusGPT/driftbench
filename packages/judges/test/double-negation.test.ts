import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import { type JudgeRequest, parseAnswerText } from '../src/contract';

const rows = readFileSync(new URL('./fixtures/double-negation.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map(
    (line) =>
      JSON.parse(line) as {
        case_id: string;
        input: JudgeRequest;
        expected_verdict: 'pass';
        recorded_answer: string;
        label_basis: string;
      },
  );

describe('Inspect double-negation regressions', () => {
  for (const row of rows) {
    it(`${row.case_id} rejects the old false verdict and computes pass from the positive assertions`, () => {
      expect(parseAnswerText(row.recorded_answer).answer.outcome).toBe('fail');
      expect(parseJudgeText(row.recorded_answer, row.input).unparsed).toBe(true);
      const reply = row.input.transcript[0]?.text as string;
      const checks = ['upload limit', 'setup fee', 'booking duration'].map((fact) => ({
        requirement: `State the correct ${fact} for the requested room.`,
        reasoning: row.label_basis,
        evidence: reply,
        met: true,
      }));
      expect(parseJudgeText(JSON.stringify({ checks }), row.input).answer.outcome).toBe(row.expected_verdict);
    });
  }
});
