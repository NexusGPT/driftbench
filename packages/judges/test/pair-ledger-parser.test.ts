import { expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import { pairLedgerRequest } from '../src/pair-ledger';

const request = pairLedgerRequest({ name: 'c', rubric: 'Check the reply.' }, [], 'alpha \\( J \\)', 'beta');
const json = JSON.stringify({
  items: [{ name: 'c', first: 4, second: 0, reasoning: 'checked', evidence: null }],
});
it('reads the last object after scratchpad, not the first apparent answer', () => {
  const result = parseJudgeText(`{"winner":"FIRST"}\nThink again.\n${json}`, request);
  expect(result.pairLedger?.items[0]?.first).toBe(4);
  expect(result.parseSteps?.[0]?.ruleId).toBe('ledger.strict');
});
it('records bounded escape, fence and closing-brace repairs', () => {
  const badEscape = json.replace('checked', 'checked \\( J \\)');
  expect(parseJudgeText(badEscape, request)).toMatchObject({ repaired: true });
  expect(
    parseJudgeText(badEscape, request).parseSteps?.some(
      (s) => s.ruleId === 'ledger.invalid-escape' && s.success,
    ),
  ).toBe(true);
  expect(
    parseJudgeText(`\`\`\`json\n${json}\n\`\`\``, request).parseSteps?.some(
      (s) => s.ruleId === 'ledger.fence-strip' && s.success,
    ),
  ).toBe(true);
  expect(
    parseJudgeText(json.slice(0, -2), request).parseSteps?.some(
      (s) => s.ruleId === 'ledger.brace-close' && s.success,
    ),
  ).toBe(true);
});
it('does not rescue an earlier answer when the last object is invalid', () => {
  expect(parseJudgeText(`${json}\n{"items":`, request).unparsed).toBe(true);
  expect(parseJudgeText(json.replace('"first":4', '"first":4,"first":0'), request).unparsed).toBe(true);
  expect(parseJudgeText(json.slice(0, json.indexOf('checked') + 3), request).unparsed).toBe(true);
});
