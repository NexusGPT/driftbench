import { expect, it } from 'vitest';
import { type JudgeRequest, parseJudgeText } from '../src/index';
import fixtures from './fixtures/ambiguous-winner-quotes.json';

for (const row of fixtures) {
  it(`${row.itemId} ${row.order} uses only distinguishing text actually supplied by the model`, () => {
    const recovered = ['3638 AB', '3664 BA', '2026 BA'].includes(`${row.itemId} ${row.order}`);
    const result = parseJudgeText(row.rawText, row.request as JudgeRequest);
    if (recovered) {
      expect(result.unparsed).toBeUndefined();
      expect(result.winner).toBe(row.rawWinner);
    } else {
      expect(result.unparsed).toBe(true);
      expect(result.answer.reasoning).toContain('your quote matches both replies');
    }
  });
}
