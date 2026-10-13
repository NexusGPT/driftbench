import { expect, it } from 'vitest';
import {
  calibrate,
  calibrateCascade,
  FakeJudge,
  type JudgeAnswer,
  type JudgeRequest,
  type LabelledBlock,
  type LoadedCriterion,
} from '../src/index';

/** A total that adds call costs says how many calls had an unknown cost. Fictional data, no model. */

const CRITERION: LoadedCriterion = {
  path: 'one_question_per_turn.yaml',
  def: {
    name: 'one_question_per_turn',
    rubric: 'The reply asks at most one question.',
    pass: 'One.',
    fail: 'Two.',
  },
  fixtures: {
    pass: { transcript: [{ role: 'agent', text: 'Which plan?' }] },
    fail: { transcript: [{ role: 'agent', text: 'Which plan? Which address?' }] },
  },
};
const LABELS: ReadonlyMap<string, readonly LabelledBlock[]> = new Map([
  [
    'one_question_per_turn',
    [
      { id: 'q.1', label: 'pass', transcript: [{ role: 'agent', text: 'How much data do you use?' }] },
      { id: 'q.2', label: 'fail', transcript: [{ role: 'agent', text: 'Email? And your plan?' }] },
    ],
  ],
]);
const last = (request: JudgeRequest) => request.transcript.at(-1)?.text ?? '';

/** Every call costs 0.01, except the call on `unknownOn`: answered or failed with its cost unknown. */
function judge(unknownOn?: string, fails = false) {
  const fake = new FakeJudge(
    'small',
    [
      (request): JudgeAnswer => {
        const outcome = (last(request).match(/\?/g) ?? []).length > 1 ? 'fail' : 'pass';
        return { outcome, score: outcome === 'pass' ? 0.95 : 0.05, reasoning: 'sure' };
      },
    ],
    { family: 'lab', cls: 'system2', cost: 10 },
  );
  return {
    id: fake.id,
    family: fake.family,
    cls: fake.cls,
    cost: fake.cost,
    judge: async (request: JudgeRequest) => {
      const result = await fake.judge(request);
      if (last(request) !== unknownOn) return { ...result, costUsd: 0.01 };
      if (fails) throw Object.assign(new Error('fictional failure'), { costIncomplete: true });
      return { ...result, costIncomplete: true as const };
    },
  };
}

it('calibrate counts the calls with an unknown cost beside the total', async () => {
  const report = await calibrate({
    judges: [judge('Email? And your plan?')],
    criteria: [CRITERION],
    labels: LABELS,
  });
  const [row] = report.criteria[0]?.judges ?? [];
  expect(row?.calls).toBe(8);
  expect(row?.spentUsd).toBeCloseTo(0.07);
  expect(row?.costIncompleteCalls).toBe(1);
  expect(report.costIncompleteCalls).toBe(1);
});
it('calibrate counts a failed call with an unknown cost', async () => {
  const report = await calibrate({
    judges: [judge('Email? And your plan?', true)],
    criteria: [CRITERION],
    labels: LABELS,
  });
  expect(report.errors).toBe(1);
  expect(report.costIncompleteCalls).toBe(1);
});
it('calibrate leaves a fully priced report unchanged', async () => {
  const report = await calibrate({ judges: [judge()], criteria: [CRITERION], labels: LABELS });
  expect(report).not.toHaveProperty('costIncompleteCalls');
  expect(report.criteria[0]?.judges[0]).not.toHaveProperty('costIncompleteCalls');
});
it('calibrateCascade counts the calls with an unknown cost beside the totals', async () => {
  const report = await calibrateCascade({
    first: judge('Email? And your plan?'),
    escalateTo: [],
    criteria: [CRITERION],
    labels: LABELS,
  });
  expect(report.criteria[0]?.costIncompleteCalls).toBe(1);
  expect(report.costIncompleteCalls).toBe(1);
  const priced = await calibrateCascade({
    first: judge(),
    escalateTo: [],
    criteria: [CRITERION],
    labels: LABELS,
  });
  expect(priced).not.toHaveProperty('costIncompleteCalls');
  expect(priced.criteria[0]).not.toHaveProperty('costIncompleteCalls');
});
