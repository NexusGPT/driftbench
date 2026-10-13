import { describe, expect, it } from 'vitest';
import {
  Cassette,
  calibrateCascade,
  createEscalation,
  emptyCassette,
  type JudgeClient,
  type JudgeRequest,
  type JudgeResult,
  judgePairwise,
  type LoadedCriterion,
  pairwiseRequest,
  parseJudgeValue,
  playerClient,
  recordingClient,
  requestKey,
} from '../src/index';

const criterion = { name: 'correct', rubric: 'Answer the question correctly.' };
const request: JudgeRequest = { criterion, transcript: [{ role: 'user', text: 'Question?' }] };
function result(outcome: 'pass' | 'fail' | 'inconclusive', extra: Partial<JudgeResult> = {}): JudgeResult {
  const answer = { outcome, reasoning: outcome };
  return { answer, raw: JSON.stringify(answer), ...extra };
}
function seat(id: string, family: string, answer: JudgeResult | ((r: JudgeRequest) => JudgeResult)) {
  const requests: JudgeRequest[] = [];
  const client: JudgeClient = {
    id,
    family,
    cls: 'system2',
    cost: 1,
    async judge(r) {
      requests.push(r);
      const got = typeof answer === 'function' ? answer(r) : answer;
      return r.assessment?.kind === 'pairwise' && !got.winner
        ? {
            ...got,
            winner:
              got.answer.outcome === 'pass' ? 'A' : got.answer.outcome === 'fail' ? 'B' : 'inconclusive',
          }
        : got;
    },
  };
  return Object.assign(client, { requests });
}
const thenSeats = () => [seat('google', 'google', result('fail')), seat('openai', 'openai', result('fail'))];
function make(
  first: JudgeClient,
  then = thenSeats(),
  extra: Partial<Parameters<typeof createEscalation>[0]> = {},
) {
  return createEscalation({
    first,
    then,
    agentFamily: 'meta',
    on: ['order-split', 'inconclusive'],
    decide: 'majority',
    ...extra,
  });
}

describe('label-blind escalation', () => {
  it('judges both first orders once and escalates once on an order split', async () => {
    const first = seat('first', 'anthropic', result('pass', { costUsd: 0.01 }));
    const then = thenSeats();
    const verdict = await judgePairwise(make(first, then), criterion, request.transcript, 'one', 'two');
    expect(first.requests).toHaveLength(2);
    expect(then.map((s) => s.requests.length)).toEqual([1, 1]);
    expect(verdict).toMatchObject({
      choice: 'second',
      consistent: false,
      positionBias: true,
      calls: 4,
      costUsd: 0.02,
      escalation: { triggers: ['order-split'], escalated: true },
    });
  });
  it('keeps consistent orders without asking another seat, normalizing explicit winners', async () => {
    const first = seat('first', 'anthropic', (r) =>
      result('fail', { winner: r.candidates?.A === 'one' ? 'A' : 'B' }),
    );
    const then = thenSeats();
    expect(await judgePairwise(make(first, then), criterion, [], 'one', 'two')).toMatchObject({
      choice: 'first',
      consistent: true,
    });
    expect(then.map((s) => s.requests.length)).toEqual([0, 0]);
  });
  it('validates first, then, aliases, nested families, duplicate ids and a diverse pool at build time', () => {
    const first = seat('first', 'claude-3-5-sonnet', result('pass'));
    expect(() => make(first, thenSeats(), { agentFamily: 'Anthropic' })).toThrow(/family/i);
    expect(() => make(first, thenSeats(), { agentFamily: 'gpt-4o' })).toThrow(/family/i);
    expect(() => make(first, thenSeats(), { agentFamily: '' })).toThrow(/family/i);
    expect(() => make(first, [seat('again', 'Anthropic', result('pass'))])).toThrow(/famil/i);
    expect(() => make(first, [seat('first', 'google', result('pass'))])).toThrow(/named|duplicate/i);
    expect(() => make({ ...first, families: ['llama-3'] })).toThrow(/family/i);
  });
  it('routes a null ledger row even when another row already made the outcome fail', async () => {
    const first = seat(
      'first',
      'anthropic',
      result('fail', {
        checks: [
          { id: 'x', met: false, reasoning: '', evidence: null },
          { id: 'y', met: null, reasoning: '', evidence: null },
        ],
      }),
    );
    const answer = await make(first).judge(request);
    expect(answer.escalation?.triggers).toEqual(['inconclusive']);
  });
  it('uses verdict confidence, treats missing scores as unknown, and handles the exact threshold', async () => {
    for (const [outcome, score, escalates] of [
      ['fail', 0.01, false],
      ['pass', 0.99, false],
      ['fail', 0.6, true],
      ['pass', 0.5, false],
      ['pass', undefined, true],
    ] as const) {
      const first = seat(
        'first',
        'anthropic',
        result(outcome, { answer: { outcome, reasoning: '', ...(score === undefined ? {} : { score }) } }),
      );
      const answer = await make(first, thenSeats(), { on: ['low-confidence'] }).judge(request);
      expect(answer.escalation?.escalated, `${outcome}/${score}`).toBe(escalates);
    }
    expect(() =>
      make(seat('first', 'anthropic', result('pass')), thenSeats(), { confidence: NaN }),
    ).toThrow();
  });
  it('routes explicit reference disagreement and unsuccessful reference consensus', async () => {
    for (const extra of [
      { referenceDisagreement: true },
      { referenceAgreement: { attempts: 3, agreement: 1 / 3, used: false } },
    ]) {
      const answer = await make(seat('first', 'anthropic', result('pass', extra)), thenSeats(), {
        on: ['reference-disagreement'],
      }).judge(request);
      expect(answer.escalation?.triggers).toEqual(['reference-disagreement']);
    }
  });
  it.each([
    ['match', false],
    ['wrong', true],
    ['missing', true],
  ] as const)(
    'routes pointwise reference disagreement only for wrong or missing facts: %s',
    async (status, escalates) => {
      const input: JudgeRequest = { ...request, reference: '42', assessment: { kind: 'fact-ledger' } };
      const first = seat(
        'first',
        'anthropic',
        parseJudgeValue(
          {
            facts: [
              {
                reference: '42',
                reply: status === 'missing' ? '' : status === 'wrong' ? '41' : '42',
                status,
              },
            ],
            unsupported: [],
          },
          input,
        ),
      );
      const then = thenSeats();
      const answer = await make(first, then, { on: ['reference-disagreement'] }).judge(input);
      expect(answer.escalation?.triggers).toEqual(escalates ? ['reference-disagreement'] : []);
      expect(then.map((s) => s.requests.length)).toEqual(escalates ? [1, 1] : [0, 0]);
    },
  );
  it.each([
    ['match', 'match', false],
    ['wrong', 'match', false],
    ['match', 'missing', false],
    ['wrong', 'missing', true],
  ] as const)(
    'keeps pairwise reference disagreement dependent on both candidates: %s/%s',
    async (a, b, escalates) => {
      const input: JudgeRequest = {
        ...pairwiseRequest(criterion, [], 'one', 'two', '42'),
        assessment: { kind: 'fact-ledger' },
      };
      const first = seat(
        'first',
        'anthropic',
        parseJudgeValue(
          {
            facts: [{ fact: 'answer', reference: '42', a, b }],
            unsupported_a: [],
            unsupported_b: [],
          },
          input,
        ),
      );
      const then = thenSeats();
      const answer = await make(first, then, { on: ['reference-disagreement'] }).judge(input);
      expect(answer.escalation?.triggers).toEqual(escalates ? ['reference-disagreement'] : []);
      expect(then.map((s) => s.requests.length)).toEqual(escalates ? [1, 1] : [0, 0]);
    },
  );
  it('uses only then majority, falls back to first only on a second split, and never re-calls then', async () => {
    for (const decide of ['majority', 'first-stands'] as const) {
      const first = seat('first', 'anthropic', result('pass'));
      const then = [seat('yes', 'google', result('pass')), seat('no', 'openai', result('fail'))];
      const answer = await make(first, then, { on: ['low-confidence'], decide }).judge(request);
      expect(answer.answer.outcome).toBe(decide === 'majority' ? 'inconclusive' : 'pass');
      expect(then.map((s) => s.requests.length)).toEqual([1, 1]);
    }
  });
  it('preserves request fields in both supplied orders and costs/audits are request local', async () => {
    const first = seat('first', 'anthropic', (r) =>
      result(r.artifact === 'escalate' ? 'inconclusive' : 'pass', { costUsd: 1 }),
    );
    const then = [seat('next', 'google', result('fail', { costUsd: 2 }))];
    const client = make(first, then);
    const full = {
      ...request,
      artifact: 'escalate',
      reference: 'ref',
      inputs: [{ path: 'x', text: 'source' }],
      given: { ledger: { label: 'opaque input' } },
      requirements: [{ id: 'x', requirement: 'req' }],
    };
    const [a, b] = await Promise.all([client.judge(full), client.judge({ ...full, artifact: 'keep' })]);
    expect(a.costUsd).toBe(3);
    expect(b.costUsd).toBe(1);
    expect(a.escalation?.escalated).toBe(true);
    expect(b.escalation?.escalated).toBe(false);
    expect(then[0]?.requests[0]).toMatchObject(full);
    expect(first.requests[0]).toEqual(full);
  });
  it('records and replays the decorator including comparison metadata without live calls', async () => {
    const first = seat('first', 'anthropic', result('pass'));
    const then = thenSeats();
    const client = make(first, then);
    const cassette = emptyCassette();
    const recorded = await judgePairwise(recordingClient(client, cassette), criterion, [], 'one', 'two');
    const serialized = Cassette.parse(JSON.parse(JSON.stringify(cassette)));
    const played = await judgePairwise(playerClient(serialized, client.id), criterion, [], 'one', 'two');
    expect(played).toEqual(recorded);
    expect(first.requests).toHaveLength(2);
    expect(then.map((s) => s.requests.length)).toEqual([1, 1]);
    const a = pairwiseRequest(criterion, [], 'one', 'two');
    const b = pairwiseRequest(criterion, [], 'two', 'one');
    await expect(
      playerClient(serialized, client.id).judgeComparison?.(a, { ...b, artifact: 'changed' }),
    ).rejects.toThrow(/recording/);
    expect(requestKey(request, client)).not.toBe(requestKey(request, make(first, then, { confidence: 0.6 })));
  });
  it('calibrates the deployable client without routing on the truth label', async () => {
    const first = seat(
      'first',
      'anthropic',
      result('pass', { answer: { outcome: 'pass', score: 1, reasoning: '' }, costUsd: 1 }),
    );
    const then = thenSeats();
    const judge = make(first, then, { on: ['low-confidence'] });
    const criteria: LoadedCriterion[] = [
      { path: 'x', def: criterion, fixtures: { pass: { transcript: [] }, fail: { transcript: [] } } },
    ];
    const report = await calibrateCascade({ judge, criteria, labels: new Map(), repeats: 1 });
    expect(report.criteria[0]?.separation).toMatchObject({ pass: ['pass'], fail: ['pass'], separated: 0 });
    expect(report.criteria[0]?.escalated).toEqual([]);
    expect(then.map((s) => s.requests.length)).toEqual([0, 0]);
    expect(report.spentUsd).toBe(2);
  });
  it('never launders an invalid named winner into a decisive council vote', async () => {
    const first = seat('first', 'anthropic', result('inconclusive'));
    const then = [seat('bad', 'google', result('pass', { winner: 'A', unparsed: true }))];
    const answer = await make(first, then).judge(pairwiseRequest(criterion, [], 'one', 'two'));
    expect(answer.answer.outcome).toBe('inconclusive');
    expect(answer.winner).toBe('inconclusive');
  });
  it('keeps an explicit tie majority as a decision even with first-stands', async () => {
    const first = seat('first', 'anthropic', result('pass'));
    const then = [seat('tie', 'google', result('inconclusive', { winner: 'tie' }))];
    const answer = await make(first, then, { on: ['low-confidence'], decide: 'first-stands' }).judge(
      pairwiseRequest(criterion, [], 'one', 'two'),
    );
    expect(answer.winner).toBe('tie');
    expect(answer.escalation?.decision).toBe('majority');
  });
  it('compares only marked finals with an exact reference and keeps an agreeing candidate', async () => {
    for (const [reference, a, b, escalates] of [
      ['3', 'Final answer: 1', 'Final answer: 2', true],
      ['2', 'Final answer: 1', 'Final answer: 2', false],
      ['2', 'one is probably the answer', 'two is probably correct', false],
    ] as const) {
      const first = seat('first', 'anthropic', result('pass'));
      const answer = await make(first, thenSeats(), { on: ['reference-disagreement'] }).judge(
        pairwiseRequest(criterion, [], a, b, reference),
      );
      expect(answer.escalation?.escalated).toBe(escalates);
    }
  });
  it('retains first-stands per-order outcomes on a split and records no repeated calls', async () => {
    const first = seat('first', 'anthropic', (r) =>
      result(r.candidates?.A === 'one' ? 'pass' : 'inconclusive'),
    );
    const then = [seat('yes', 'google', result('pass')), seat('no', 'openai', result('fail'))];
    const verdict = await judgePairwise(
      make(first, then, { decide: 'first-stands' }),
      criterion,
      [],
      'one',
      'two',
    );
    expect(verdict).toMatchObject({ ordered: 'pass', swapped: 'inconclusive', choice: 'tie', calls: 4 });
  });
  it('records routing metadata when individual seats are recorded and replayed', async () => {
    const first = seat('first', 'anthropic', result('pass', { referenceDisagreement: true }));
    const cassette = emptyCassette();
    const original = await recordingClient(first, cassette).judge(request);
    const replay = await playerClient(Cassette.parse(JSON.parse(JSON.stringify(cassette))), first.id).judge(
      request,
    );
    expect(replay.referenceDisagreement).toBe(original.referenceDisagreement);
  });
  it('records a failed later seat as an abstention and never retries its transport', async () => {
    const first = seat('first', 'anthropic', result('inconclusive'));
    let calls = 0;
    const broken: JudgeClient = {
      id: 'broken',
      family: 'google',
      cls: 'system1',
      cost: 1,
      async judge() {
        calls++;
        throw new Error('transport unavailable');
      },
    };
    const client = createEscalation({
      first,
      // biome-ignore lint/suspicious/noThenProperty: public API accepts a non-callable seat array.
      then: [broken],
      agentFamily: 'meta',
      on: ['inconclusive'],
      decide: 'majority',
    });
    const answer = await client.judge(request);
    expect(calls).toBe(1);
    expect(answer.escalation?.then).toMatchObject([
      {
        judge: 'broken',
        result: { answer: { outcome: 'inconclusive', reasoning: 'no answer: transport unavailable' } },
      },
    ]);
  });
  it('passes every supplied comparison field intact to the first judge and ordered fields to then', async () => {
    const first = seat('first', 'anthropic', result('pass'));
    const then = thenSeats();
    const client = make(first, then);
    const extras = {
      artifact: 'artifact',
      inputs: [{ path: 'x', text: 'input' }],
      given: { stage: 'start', ledger: { record: 1 } },
      requirements: [{ id: 'x', requirement: 'check' }],
      reference: '3',
      budget: 'large' as const,
    };
    const ordered = { ...pairwiseRequest(criterion, [], 'one', 'two'), ...extras };
    const swapped = {
      ...pairwiseRequest(criterion, [], 'two', 'one'),
      ...extras,
      artifact: 'swapped artifact',
    };
    await client.judgeComparison?.(ordered, swapped);
    expect(first.requests).toEqual([ordered, swapped]);
    expect(then[0]?.requests).toEqual([ordered]);
  });
  it('keys all ordered and swapped fields for a system1-first procedure', async () => {
    const first = { ...seat('first', 'jev', result('pass')), cls: 'system1' as const };
    const client = make(first);
    const cassette = emptyCassette();
    const ordered = pairwiseRequest(criterion, [], 'one', 'two');
    const swapped = pairwiseRequest(criterion, [], 'two', 'one');
    const recorded = await recordingClient(client, cassette).judgeComparison?.(ordered, swapped);
    const player = playerClient(Cassette.parse(JSON.parse(JSON.stringify(cassette))), client.id);
    expect(await player.judgeComparison?.(ordered, swapped)).toEqual(recorded);
    await expect(player.judgeComparison?.({ ...ordered, system: 'changed' }, swapped)).rejects.toThrow(
      /recording/,
    );
    await expect(player.judgeComparison?.(ordered, { ...swapped, system: 'changed' })).rejects.toThrow(
      /recording/,
    );
    expect(requestKey({ ...request, system: 'changed' }, client)).not.toBe(requestKey(request, client));
  });
  it('does not treat a consistent explicit tie as an inconclusive answer', async () => {
    const first = seat('first', 'anthropic', result('inconclusive', { winner: 'tie' }));
    const then = thenSeats();
    const verdict = await judgePairwise(make(first, then), criterion, [], 'one', 'two');
    expect(verdict).toMatchObject({ choice: 'tie', consistent: true, escalation: { escalated: false } });
    expect(then.map((s) => s.requests.length)).toEqual([0, 0]);
  });
  it('round-trips a generic comparison client without constituent families', async () => {
    const first = seat('plain', 'jev', result('pass'));
    const client: JudgeClient = {
      ...first,
      cls: 'system1',
      async judgeComparison() {
        return result('pass', {
          comparison: { ordered: 'pass', swapped: 'fail', consistent: true, positionBias: false },
        });
      },
    };
    const cassette = emptyCassette();
    const recorder = recordingClient(client, cassette);
    const ordered = pairwiseRequest(criterion, [], 'one', 'two');
    const swapped = pairwiseRequest(criterion, [], 'two', 'one');
    const one = await recorder.judge(request);
    const comparison = await recorder.judgeComparison?.(ordered, swapped);
    const player = playerClient(Cassette.parse(JSON.parse(JSON.stringify(cassette))), client.id);
    expect(await player.judge(request)).toEqual(one);
    expect(await player.judgeComparison?.(ordered, swapped)).toEqual(comparison);
  });
});
