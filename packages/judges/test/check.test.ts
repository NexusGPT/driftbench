import {
  type CheckContext,
  machineVerdict,
  type Observed,
  type Spec,
  Verdict,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import {
  combineVerdicts,
  createCouncil,
  type FakeAnswer,
  FakeJudge,
  type JudgeRequest,
  judgeCheck,
  renderUser,
} from '../src/index';

const SPEC: Spec = {
  id: 'plan-upgrade',
  kind: 'conversation',
  criteria: [
    {
      name: 'one_question_per_turn',
      rubric: 'The reply asks the customer at most one question.',
      pass: 'One question, or none.',
      fail: 'Two or more questions in the same reply.',
      judge_class: 'system1',
    },
    {
      name: 'no_invented_data',
      rubric: 'Every plan and price in the reply comes from a tool result.',
      gating: true,
      scope: 'conversation',
      judge_class: 'system2',
    },
  ],
  blocks: [{ when: { user: 'What faster plans do you have?' } }],
};

const OBSERVED: Observed = {
  segments: [
    { type: 'tool_call', label: 'catalog.search', input: { category: 'mobile' } },
    { type: 'tool_result', label: 'catalog.search', output: [{ name: 'Acme Mobile M', monthly_usd: 25 }] },
    { type: 'text', text: 'Acme Mobile M is 25 USD a month. Want it?' },
  ],
  text: 'Acme Mobile M is 25 USD a month. Want it?',
  toolCalls: [{ label: 'catalog.search', input: { category: 'mobile' } }],
  cost: {},
  latencyMs: 1,
};

function context(criteria: string[], prefix: CheckContext['given']['prefix'] = []): CheckContext {
  const block = { when: { user: 'What faster plans do you have?' }, expect: { criteria } };
  return {
    spec: SPEC,
    mode: 'T',
    blockIndex: 0,
    block,
    expect: block.expect,
    given: { prefix, ledger: {}, world: {}, vars: {}, target: { adapter: 'function' }, hash: 'h' },
    observed: OBSERVED,
    history: [],
    ledger: { email: 'sam.rivera@example.com' },
  };
}

function council(s1: FakeAnswer, s2: FakeAnswer) {
  const judges = [
    ...['a', 'b', 'c'].map((id) => new FakeJudge(id, [s1], { cls: 'system1', family: 'lab-one' })),
    ...['x', 'y', 'z'].map((id) => new FakeJudge(id, [s2], { cls: 'system2', family: 'lab-two', cost: 10 })),
  ];
  return { judges, council: createCouncil({ mode: 'hybrid', judges, agentFamily: 'none' }) };
}

const PASS: FakeAnswer = { outcome: 'pass', score: 0.9, reasoning: 'one question' };
const FAIL: FakeAnswer = { outcome: 'fail', score: 0.1, reasoning: 'a price nobody returned' };

describe('judgeCheck', () => {
  it('applies only to a block that names criteria', () => {
    const check = judgeCheck(council(PASS, PASS).council);
    expect(check.applies(context([]))).toBe(false);
    expect(check.applies(context(['one_question_per_turn']))).toBe(true);
  });

  it('gives one judge verdict per criterion, with the deciding class and every vote, valid for the run schema', async () => {
    const { council: c } = council(PASS, FAIL);
    const verdicts = await judgeCheck(c).evaluate(
      context(['one_question_per_turn@gating', 'no_invented_data']),
    );
    expect(verdicts).toHaveLength(2);
    for (const verdict of verdicts) expect(Verdict.safeParse(verdict).success).toBe(true);
    const [one, invented] = verdicts;
    expect(one).toMatchObject({
      id: 'judge.one_question_per_turn',
      kind: 'judge',
      gating: true,
      outcome: 'pass',
      judge: { cls: 'system1' },
    });
    expect(one?.judge?.votes).toHaveLength(3);
    expect(one?.reasoning).toBe('one question');
    expect(invented).toMatchObject({ gating: true, outcome: 'fail', judge: { cls: 'system2' } });
    expect(invented?.evidence).toContain('x fail, y fail, z fail');
  });

  it('sends the rubric, the block and the ledger; a block scope keeps two earlier messages as context', async () => {
    const { judges, council: c } = council(PASS, PASS);
    const prefix = [
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: 'second' },
      { role: 'user' as const, content: 'third' },
    ];
    await judgeCheck(c).evaluate(context(['one_question_per_turn', 'no_invented_data'], prefix));
    const block = judges[0]?.requests[0] as JudgeRequest;
    expect(block.transcript.map((entry) => entry.text).slice(0, 3)).toEqual([
      'second',
      'third',
      'What faster plans do you have?',
    ]);
    expect(block.transcript.map((entry) => entry.role)).toContain('tool_result');
    expect(block.given?.ledger).toEqual({ email: 'sam.rivera@example.com' });
    const conversation = judges[3]?.requests[0] as JudgeRequest;
    expect(conversation.transcript[0]?.text).toBe('first');
    expect(renderUser(conversation)).toContain('SCOPE: the whole conversation');
  });

  it('passes artifact text through when a reader gives it', async () => {
    const { judges, council: c } = council(PASS, PASS);
    await judgeCheck(c, { artifactText: () => 'Mobile\nAcme Mobile S,15' }).evaluate(
      context(['one_question_per_turn']),
    );
    expect(judges[0]?.requests[0]?.artifact).toBe('Mobile\nAcme Mobile S,15');
  });

  it('judges a criterion calibration left unassigned, and never lets it gate', async () => {
    const judges = [
      ...['a', 'b', 'c'].map((id) => new FakeJudge(id, [FAIL], { cls: 'system1', family: 'lab-one' })),
      ...['x', 'y', 'z'].map((id) => new FakeJudge(id, [FAIL], { cls: 'system2', family: 'lab-two' })),
    ];
    const c = createCouncil({
      mode: 'hybrid',
      judges,
      agentFamily: 'none',
      unassigned: [{ criterion: 'no_invented_data', reason: 'no class has 3 judges at the bar' }],
    });
    const [one, invented] = await judgeCheck(c).evaluate(
      context(['one_question_per_turn@gating', 'no_invented_data@gating']),
    );
    expect(one).toMatchObject({ gating: true, outcome: 'fail' });
    expect(invented).toMatchObject({ gating: false, outcome: 'fail' });
    expect(invented?.evidence).toMatch(/^unassigned by calibration, not gating: no class has 3 judges/);
    expect(Verdict.safeParse(invented).success).toBe(true);
  });

  it('gives an inconclusive verdict, not a pass, for a criterion the spec does not define', async () => {
    const [verdict] = await judgeCheck(council(PASS, PASS).council).evaluate(context(['made_up@gating']));
    expect(verdict).toMatchObject({ id: 'judge.made_up', outcome: 'inconclusive', gating: true });
  });
});

describe('a judge never overrides a machine fail', () => {
  const machineFail = machineVerdict('tools', 'catalog.search', 'fail', 'catalog.search not called');
  const machinePass = machineVerdict('must', '0', 'pass', 'matched');

  it('keeps the block failing when the machine fails and every judge passes', async () => {
    const judged = await judgeCheck(council(PASS, PASS).council).evaluate(
      context(['one_question_per_turn@gating']),
    );
    expect(judged[0]?.outcome).toBe('pass');
    const combined = combineVerdicts([machineFail, machinePass], judged);
    expect(combined.pass).toBe(false);
    expect(combined.verdicts[0]).toEqual(machineFail);
  });

  it('passes when the machine and the gating judges pass, and fails on a gating judge fail', () => {
    const judgePass = {
      id: 'judge.k',
      kind: 'judge' as const,
      name: 'k',
      gating: true,
      outcome: 'pass' as const,
      evidence: 'e',
    };
    expect(combineVerdicts([machinePass], [judgePass]).pass).toBe(true);
    expect(combineVerdicts([machinePass], [{ ...judgePass, outcome: 'fail' }]).pass).toBe(false);
    expect(combineVerdicts([machinePass], [{ ...judgePass, outcome: 'inconclusive' }]).pass).toBe(false);
  });

  it('refuses a judge verdict that reuses a machine id or claims to be a machine verdict', () => {
    const forged = { ...machineFail, kind: 'judge' as const, outcome: 'pass' as const };
    expect(() => combineVerdicts([machineFail], [forged])).toThrow('reuses a machine verdict id');
    expect(() => combineVerdicts([machineFail], [{ ...machinePass, id: 'x' }])).toThrow(
      'not a judge verdict',
    );
  });
});

describe('a block with no verdict at all', () => {
  it('does not pass', () => {
    expect(combineVerdicts([], []).pass).toBe(false);
  });
});

describe('two judge verdicts with one id', () => {
  const judge = (id: string) =>
    ({ id, kind: 'judge', outcome: 'pass', gating: true, evidence: '', detail: '' }) as never;

  it('are refused, as a judge verdict reusing a machine id is', () => {
    expect(() => combineVerdicts([], [judge('judge.a'), judge('judge.a')])).toThrow(/judge\.a/);
    expect(combineVerdicts([], [judge('judge.a'), judge('judge.b')]).pass).toBe(true);
  });
});

describe('two criterion names that map to one safe id', () => {
  it('gives each verdict its own id, the first keeping the plain one', async () => {
    const spec: Spec = {
      ...SPEC,
      criteria: ['a b', 'a_b'].map((name) => ({ name, rubric: 'r', judge_class: 'system1' as const })),
    };
    const ctx = { ...context(['a b', 'a_b']), spec };
    const verdicts = await judgeCheck(council(PASS, PASS).council).evaluate(ctx);
    const ids = verdicts.map((verdict) => verdict.id);
    expect(ids[0]).toBe('judge.a_b');
    expect(new Set(ids).size).toBe(2);
    expect(verdicts.map((verdict) => verdict.name)).toEqual(['a b', 'a_b']);
  });
});
