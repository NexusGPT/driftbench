import { expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';
import fixture from './fixtures/conditional-extra-requirement.json';

it('qa-conditional-4 ignores and logs the real invented access requirement', () => {
  // The source audit uses status strings and requirement names. Translate its fields mechanically;
  // no evidence or status is authored here, and the original response remains in the fixture.
  const caller = [
    'States the upload limit for Room 75 at Luma Annex as 352 megabits per second.',
    'States the setup fee for Room 75 at Luma Annex as 28 USD.',
    'States the booking duration for Room 75 at Luma Annex as 10 hours.',
    'Contains no current contradiction of the three requested facts.',
    'Does not limit the requested facts by an added condition.',
  ];
  const source = JSON.parse(fixture.text) as {
    checks: { requirement: string; status: string; evidence: string; reasoning: string }[];
  };
  const checks = source.checks.map((row) => ({
    id: row.requirement,
    reasoning: row.reasoning,
    evidence: row.evidence || null,
    met: row.status === 'satisfied' ? true : row.status === 'unknown' ? null : false,
  }));
  const request: JudgeRequest = {
    criterion: fixture.case.criterion,
    transcript: [{ role: 'agent', text: fixture.case.submission }],
    requirements: caller.map((id) => ({ id, requirement: id })),
  };
  const result = parseJudgeText(JSON.stringify({ checks }), request);
  expect(result.answer.outcome).toBe('pass');
  expect(result.checks).toHaveLength(5);
  expect(result.ignoredRequirementIds).toEqual([source.checks[5]?.requirement]);
});
