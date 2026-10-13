import type { CheckContext, Observed, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { FakeJudge, type JudgeClient, noJudgeCheck, singleJudgeCheck } from '../src/index';

const SPEC: Spec = {
  id: 'estate.obligation.x',
  kind: 'task',
  criteria: [
    { name: 'rule.holiday', rubric: 'Does the reply avoid public holidays?', gating: true, scope: 'block' },
    { name: 'rule.tone', rubric: 'Is the reply polite?', scope: 'block' },
  ],
  blocks: [{ when: { user: 'Plan the delivery routes for tomorrow.' } }],
} as Spec;

const OBSERVED: Observed = {
  segments: [{ type: 'text', text: 'Tomorrow is a public holiday, so I plan the routes for Thursday.' }],
  text: 'Tomorrow is a public holiday, so I plan the routes for Thursday.',
  toolCalls: [],
  cost: {},
  latencyMs: 1,
};

function context(criteria: string[]): CheckContext {
  const block = { when: { user: 'Plan the delivery routes for tomorrow.' }, expect: { criteria } };
  return {
    spec: SPEC,
    mode: 'F',
    blockIndex: 0,
    block,
    expect: block.expect,
    given: { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'claude-code' }, hash: 'h' },
    observed: OBSERVED,
    history: [],
    ledger: {},
  };
}

function costly(answer: string, usd: number): JudgeClient {
  const fake = new FakeJudge('claude-haiku', [answer], { family: 'anthropic', cls: 'system2' });
  return {
    id: fake.id,
    family: fake.family,
    cls: fake.cls,
    model: 'haiku',
    cost: 10,
    async judge(request) {
      return { ...(await fake.judge(request)), costUsd: usd };
    },
  };
}

describe('one judge for the judged criteria of a run', () => {
  it('asks the judge once per criterion, gates as the criterion says, and reports the cost', async () => {
    let spent = 0;
    const check = singleJudgeCheck(
      costly('{"outcome":"pass","reasoning":"It moves the plan off the holiday."}', 0.002),
      {
        onCost: (usd) => {
          spent += usd;
        },
      },
    );
    expect(check.applies(context(['rule.holiday']))).toBe(true);
    const verdicts = await check.evaluate(context(['rule.holiday', 'rule.tone@gating']));
    expect(verdicts.map((v) => [v.id, v.kind, v.outcome, v.gating])).toEqual([
      ['judge.rule.holiday', 'judge', 'pass', true],
      ['judge.rule.tone', 'judge', 'pass', true],
    ]);
    expect(verdicts[0]?.reasoning).toBe('It moves the plan off the holiday.');
    expect(verdicts[0]?.evidence).toContain('single judge claude-haiku');
    expect(verdicts[0]?.judge?.votes).toEqual([
      { judge: 'claude-haiku', outcome: 'pass', reasoning: 'It moves the plan off the holiday.' },
    ]);
    expect(spent).toBeCloseTo(0.004);
  });

  it('gives the judge the rubric and the block the agent answered', async () => {
    const fake = new FakeJudge('j', ['{"outcome":"fail","reasoning":"no"}'], { cls: 'system2' });
    const [verdict] = await singleJudgeCheck(fake).evaluate(context(['rule.holiday']));
    expect(verdict?.outcome).toBe('fail');
    expect(fake.requests[0]?.criterion.rubric).toBe('Does the reply avoid public holidays?');
    expect(JSON.stringify(fake.requests[0]?.transcript)).toContain('Thursday');
  });

  it('is inconclusive, never a pass, on a judge error, an unparsed answer or an undefined criterion', async () => {
    const broken = await singleJudgeCheck(new FakeJudge('j', [new Error('claude exited 1')])).evaluate(
      context(['rule.holiday']),
    );
    expect(broken[0]).toMatchObject({ outcome: 'inconclusive', gating: true });
    expect(broken[0]?.evidence).toContain('claude exited 1');
    const garbled = await singleJudgeCheck(new FakeJudge('j', ['I think it is fine'])).evaluate(
      context(['rule.holiday']),
    );
    expect(garbled[0]?.outcome).toBe('inconclusive');
    const missing = await singleJudgeCheck(
      new FakeJudge('j', ['{"outcome":"pass","reasoning":"x"}']),
    ).evaluate(context(['rule.unknown']));
    expect(missing[0]?.outcome).toBe('inconclusive');
  });
});

describe('no judge configured', () => {
  it('gives each named criterion an inconclusive verdict that gates as the criterion does, never a pass', async () => {
    const verdicts = await noJudgeCheck().evaluate(context(['rule.holiday', 'rule.tone']));
    expect(verdicts.map((v) => [v.id, v.outcome, v.gating])).toEqual([
      ['judge.rule.holiday', 'inconclusive', true],
      ['judge.rule.tone', 'inconclusive', false],
    ]);
    expect(verdicts[0]?.evidence).toContain('no judge is configured');
  });
});

describe('missing criterion-ledger coverage', () => {
  for (const repaired of [false, true]) {
    it(`re-asks once and ${repaired ? 'uses complete coverage' : 'abstains on repeated omission'}`, async () => {
      const { parseJudgeText } = await import('../src/assessment');
      let calls = 0;
      let cost = 0;
      const budgets: unknown[] = [];
      const client: JudgeClient = {
        id: 'coverage',
        family: 'test',
        cls: 'system2',
        cost: 1,
        async judge(request) {
          calls++;
          budgets.push(request.budget);
          const checks =
            repaired && calls === 2
              ? [
                  {
                    id: 'rule.holiday',
                    reasoning: 'The plan avoids the holiday.',
                    evidence: 'Thursday',
                    met: true,
                  },
                ]
              : [];
          return { ...parseJudgeText(JSON.stringify({ checks }), request), costUsd: 0.001 };
        },
      };
      const [verdict] = await singleJudgeCheck(client, {
        onCost: (usd) => {
          cost += usd;
        },
      }).evaluate(context(['rule.holiday']));
      expect(calls).toBe(2);
      expect(budgets[1]).toBe('large');
      expect(cost).toBeCloseTo(0.002);
      expect(verdict?.outcome).toBe(repaired ? 'pass' : 'inconclusive');
    });
  }
});
