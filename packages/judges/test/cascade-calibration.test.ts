import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  calibrateCascade,
  FakeJudge,
  type JudgeAnswer,
  type JudgeRequest,
  type LabelledBlock,
  type LoadedCriterion,
  loadCassette,
  loadCriteria,
  loadLabels,
  playerClient,
} from '../src/index';

/**
 * Cascade calibration: the first judge answers every fixture and labelled block; the others answer only
 * the items where it is unsure or disagrees with the truth (the fixture side or the human label). An
 * escalated item takes the majority of all three. Fictional data, fake judges, no model.
 */

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
      { id: 'q.3', label: 'pass', transcript: [{ role: 'agent', text: 'Have a good day.' }] },
    ],
  ],
]);

const last = (request: JudgeRequest) => request.transcript.at(-1)?.text ?? '';
const truthOf = (text: string): 'pass' | 'fail' => ((text.match(/\?/g) ?? []).length > 1 ? 'fail' : 'pass');

/** The first judge: right and sure, except unsure on q.1 and wrong on q.2. Each call costs 0.001. */
function first(): FakeJudge {
  return new FakeJudge(
    'small',
    [
      (request): JudgeAnswer => {
        const text = last(request);
        if (text.startsWith('How much')) return { outcome: 'pass', score: 0.55, reasoning: 'unsure' };
        if (text.startsWith('Email?')) return { outcome: 'pass', score: 0.9, reasoning: 'wrong and sure' };
        const outcome = truthOf(text);
        return { outcome, score: outcome === 'pass' ? 0.95 : 0.05, reasoning: 'sure' };
      },
    ],
    { family: 'lab', cls: 'system2', cost: 10 },
  );
}

function costly(id: string): FakeJudge {
  return new FakeJudge(
    id,
    [(request): JudgeAnswer => ({ outcome: truthOf(last(request)), reasoning: 'right' })],
    {
      family: 'lab',
      cls: 'system2',
      cost: 30,
    },
  );
}

function withCost(judge: FakeJudge, usd: number) {
  return {
    id: judge.id,
    family: judge.family,
    cls: judge.cls,
    cost: judge.cost,
    requests: judge.requests,
    judge: async (request: JudgeRequest) => ({ ...(await judge.judge(request)), costUsd: usd }),
  };
}

describe('calibrateCascade', () => {
  it('asks the others only where the first judge is unsure or wrong, and takes their majority there', async () => {
    const small = first();
    const mid = costly('mid');
    const big = costly('big');
    const report = await calibrateCascade({
      first: withCost(small, 0.001),
      escalateTo: [withCost(mid, 0.01), withCost(big, 0.02)],
      criteria: [CRITERION],
      labels: LABELS,
    });
    const [row] = report.criteria;
    expect(small.requests).toHaveLength(9);
    // q.1 (unsure) and q.2 (disagrees with its label) go up; nothing else does.
    expect(mid.requests.map(last)).toEqual(['How much data do you use?', 'Email? And your plan?']);
    expect(row?.escalated).toEqual([
      { item: 'q.1', why: 'unsure' },
      { item: 'q.2', why: 'disagrees' },
    ]);
    expect(row?.separation).toMatchObject({ separated: 3, repeats: 3 });
    expect(row?.labels).toMatchObject({ n: 3, agree: 3, kappa: 1 });
    expect(row?.spentUsd).toBeCloseTo(9 * 0.001 + 2 * 0.01 + 2 * 0.02, 10);
    // Without the label, only the unsure item goes up: the confident wrong answer stays.
    expect(row?.unsureOnly.labels).toMatchObject({ agree: 2 });
    expect(row?.unsureOnly.spentUsd).toBeCloseTo(9 * 0.001 + 0.01 + 0.02, 10);
  });

  it('leaves an escalated item inconclusive when the three do not agree on two votes', async () => {
    const split = new FakeJudge('mid', [{ outcome: 'inconclusive', reasoning: 'cannot tell' }], {
      family: 'lab',
      cls: 'system2',
    });
    const report = await calibrateCascade({
      first: first(),
      escalateTo: [
        split,
        new FakeJudge('big', [{ outcome: 'fail', reasoning: 'no' }], { family: 'lab', cls: 'system2' }),
      ],
      criteria: [CRITERION],
      labels: LABELS,
    });
    const blocks = report.criteria[0]?.labels.blocks ?? [];
    // q.1: small pass (unsure), mid inconclusive, big fail: no two agree.
    expect(blocks.find((b) => b.id === 'q.1')?.judged).toBe('inconclusive');
    // q.2: small pass, mid inconclusive, big fail: no two agree either.
    expect(blocks.find((b) => b.id === 'q.2')?.judged).toBe('inconclusive');
  });
});

describe('the recorded cascade on the 5 criteria the council run did not reach (2026-10-12)', () => {
  it('escalates nothing: haiku is sure and right on every item, so sonnet and opus are never asked', async () => {
    const root = new URL('../../../examples/acme/', import.meta.url);
    const { criteria } = await loadCriteria(fileURLToPath(new URL('criteria', root)));
    const { labels } = await loadLabels(fileURLToPath(new URL('labels', root)));
    const haiku = await loadCassette(
      fileURLToPath(new URL('criteria/calibration/claude-haiku.cassette.json', root)),
    );
    const council = await loadCassette(
      fileURLToPath(new URL('criteria/calibration/claude-council.cassette.json', root)),
    );
    const names = [
      'no_invented_data',
      'one_question_per_turn',
      'plain_language',
      'resumes_pending_step',
      'sheet_matches_catalog',
    ];
    // The costly judges replay from the council recording, which holds no answer for these criteria:
    // any escalation would be a cassette miss, counted as an error.
    const report = await calibrateCascade({
      first: playerClient(haiku, 'claude-haiku', { answerContract: 'legacy' }),
      escalateTo: [
        playerClient(council, 'claude-sonnet', { answerContract: 'legacy' }),
        playerClient(council, 'claude-opus', { answerContract: 'legacy' }),
      ],
      criteria: criteria.filter((c) => names.includes(c.def.name)),
      labels,
    });
    expect(report.criteria.map((c) => c.criterion)).toEqual(names);
    for (const c of report.criteria) {
      expect(c, c.criterion).toMatchObject({ escalated: [], errors: 0, separation: { separated: 3 } });
      expect(c.labels.kappa, c.criterion).toBe(1);
    }
    expect(report.spentUsd).toBeCloseTo(0.0094, 4);
  });
});

describe('calibrateCascade and the family of the agent under test', () => {
  it('refuses a judge of the agent family, first or escalated, before any call', async () => {
    const small = first();
    const other = new FakeJudge('other', [{ outcome: 'pass', reasoning: 'ok' }], {
      family: 'anthropic',
      cls: 'system2',
    });
    await expect(
      calibrateCascade({
        first: small,
        escalateTo: [costly('mid'), other],
        criteria: [CRITERION],
        labels: LABELS,
        agentFamily: 'claude-sonnet-5-5',
      }),
    ).rejects.toThrow(
      /judge other is from the anthropic family, the family of the agent under test: refused/,
    );
    expect(small.requests).toHaveLength(0);
  });

  it('runs when no judge shares the agent family', async () => {
    const report = await calibrateCascade({
      first: first(),
      escalateTo: [costly('mid'), costly('big')],
      criteria: [CRITERION],
      labels: LABELS,
      agentFamily: 'anthropic',
    });
    expect(report.criteria).toHaveLength(1);
  });
});
