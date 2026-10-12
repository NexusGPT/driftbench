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
    it(`${row.case_id} preserves the old recorded error and rejects its obsolete contract`, () => {
      expect(parseAnswerText(row.recorded_answer).answer.outcome).toBe('fail');
      expect(parseJudgeText(row.recorded_answer, row.input).unparsed).toBe(true);
    });
  }
});
