import { expect, it } from 'vitest';
import { type JudgeRequest, parseJudgeText } from '../src/index';
import cassette from './fixtures/pointwise-atomic.cassette.json';
import plans from './fixtures/pointwise-atomic-plans.json';
import requests from './fixtures/pointwise-atomic-requests.json';
import measured from './fixtures/pointwise-atomic-results.json';

it('retains every real blind atomic plan and reply, including wrong verdicts and abstentions', () => {
  expect(plans.plans).toHaveLength(28);
  expect(cassette.entries).toHaveLength(28);
  for (const row of requests.cases) {
    const note = `${row.case_id} atomic repeat ${row.repeat}`;
    const entry = cassette.entries.find((entry) => entry.note === note);
    const plan = plans.plans.find((p) => p.case_id === row.case_id && p.repeat === row.repeat);
    expect(JSON.parse(plan?.user ?? '{}')).toEqual(row.request.criterion);
    expect(JSON.parse(plan?.raw ?? '{}').requirements).toEqual(row.request.requirements);
    const result = parseJudgeText(entry?.raw ?? '', row.request as JudgeRequest);
    const observation = measured.rows.find((r) => r.id === row.case_id && r.repeat === row.repeat);
    expect(result.answer.outcome).toBe(observation?.replayOutcome);
    expect(result.unparsed === true).toBe(observation?.replayUnparsed);
  }
  expect(measured.live).toMatchObject({ correct: 20, wrong: 3, inconclusive: 5, n: 28 });
  expect(measured.replay).toMatchObject({ correct: 22, wrong: 3, inconclusive: 3, n: 28 });
});
