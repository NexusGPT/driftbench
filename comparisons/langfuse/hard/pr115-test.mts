import assert from 'node:assert/strict';
import { parseJudgeValue } from '../../../packages/judges/src/assessment.ts';
import type { JudgeRequest } from '../../../packages/judges/src/contract.ts';

const request: JudgeRequest = {
  criterion: { name: 'reference_correctness', rubric: 'The reply states the fee of 47 dollars.' },
  transcript: [{ role: 'agent', text: 'The fee is 47 dollars.' }],
};
const check = {
  id: 'reference_correctness',
  reasoning: 'The fee matches.',
  evidence: '47 dollars',
  met: true,
};
const score = (checks: unknown[]) => parseJudgeValue({ checks }, request);
assert.equal(score([check]).answer.outcome, 'pass');
assert.equal(score([{ ...check, met: false }]).answer.outcome, 'fail');
assert.equal(score([{ ...check, met: null }]).answer.outcome, 'inconclusive');
assert.equal(score([{ ...check, evidence: '48 dollars' }]).unparsed, true);
assert.equal(score([{ ...check, evidence: null }]).unparsed, true);
assert.equal(score([check, check]).unparsed, true);
assert.equal(score([{ ...check, id: 'invented' }]).unparsed, true);
assert.equal(score([check, { ...check, id: 'invented', met: false }]).answer.outcome, 'pass');
assert.equal(parseJudgeValue({ outcome: 'pass', reasoning: 'legacy' }, request).unparsed, true);
console.log('9 default-contract probes pass.');
