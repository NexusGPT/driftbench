import {
  type AgentAdapter,
  type DriverStep,
  injectingDriver,
  type RunResult,
  runSpec,
  type Spec,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import { createCouncil, FakeJudge, judgeCheck } from '../src/index';

/**
 * A judge scores a reply against the user turn the agent received. A driver may send something other than
 * the block's authored `when` (a simulated user, a red-team attacker): the judge must read what was sent.
 */

const AUTHORED = 'What faster plans do you have?';
const REWRITTEN = 'hey, got anything quicker than my current plan?';
const PERTURBATION = 'Actually, before that: can you cancel my contract?';

const SPEC: Spec = {
  id: 'realized-stimulus',
  kind: 'conversation',
  criteria: [
    { name: 'answers_the_ask', rubric: 'The reply answers what the customer asked.', judge_class: 'system1' },
  ],
  blocks: [
    { when: { user: AUTHORED }, expect: { criteria: ['answers_the_ask'] } },
    { when: { user: 'And the price?' }, expect: { criteria: ['answers_the_ask'] } },
  ],
  perturbations: [
    {
      id: 'p',
      class: 'D2_goal_shift',
      inject_at: 1,
      user: PERTURBATION,
      expect: { criteria: ['answers_the_ask'] },
      recovery: { within_blocks: 1 },
    },
  ],
};

/** An agent that records each user turn it received and answers "ok". */
function recordingAgent(): AgentAdapter & { received: string[] } {
  const received: string[] = [];
  return {
    id: 'recording',
    version: '1',
    received,
    capabilities: () => ({
      variants: false,
      seedPrefix: true,
      toolStubs: false,
      trace: false,
      sandbox: false,
      endState: false,
      deterministic: true,
    }),
    async open(given) {
      return {
        id: `s-${received.length}`,
        adapter: 'recording',
        target: given.target,
        given,
        history: structuredClone(given.prefix),
      };
    },
    async send(_session, turn) {
      const stimulus = turn.stimulus;
      received.push(
        'user' in stimulus
          ? stimulus.user
          : 'burst' in stimulus
            ? stimulus.burst.join('\n')
            : stimulus.injection.user,
      );
      return {
        segments: [{ type: 'text', text: 'ok' }],
        text: 'ok',
        toolCalls: [],
        cost: { usd: 0 },
        latencyMs: 0,
      };
    },
    async close() {},
  };
}

/** A driver that rewrites block 0 the way a simulated user does, and replays the spec otherwise. */
function rewritingDriver(): UserDriver {
  const scripted = createScriptedDriver();
  return {
    id: 'rewriting',
    seeds: {},
    async next(ctx): Promise<DriverStep> {
      const step = await scripted.next(ctx);
      if (step.kind === 'block' && step.blockIndex === 0) return { ...step, stimulus: { user: REWRITTEN } };
      return step;
    },
  };
}

/** The user turn each judge request carries last, in order: the turn the judge scores the reply against. */
async function judgedTurns(
  driver: UserDriver,
  mode: 'F' | 'P',
): Promise<{ sent: string[]; judged: string[]; run: RunResult }> {
  const answer = { outcome: 'pass' as const, score: 1, reasoning: 'fine' };
  const judges = [
    ...['a', 'b', 'c'].map((id) => new FakeJudge(id, [answer], { cls: 'system1', family: 'lab-one' })),
    ...['x', 'y', 'z'].map((id) => new FakeJudge(id, [answer], { cls: 'system2', family: 'lab-two' })),
  ];
  const council = createCouncil({ mode: 'hybrid', judges, agentFamily: 'none' });
  const judge = judges[0] as FakeJudge;
  const adapter = recordingAgent();
  const run = await runSpec(SPEC, { adapter, driver, checks: [judgeCheck(council)], mode, repeat: 0 });
  const judged = judge.requests.map(
    (request) => request.transcript.filter((entry) => entry.role === 'user').at(-1)?.text ?? '',
  );
  return { sent: adapter.received, judged, run };
}

describe('the judge reads the stimulus the agent received', () => {
  it('F mode, a driver that rewrites the stimulus: the judge sees the rewritten turn', async () => {
    const { sent, judged, run } = await judgedTurns(rewritingDriver(), 'F');
    expect(run.status, run.error).toBe('completed');
    expect(sent).toEqual([REWRITTEN, 'And the price?']);
    expect(judged).toEqual(sent);
  });

  it('P mode over a rewriting base driver: every judged turn is the turn sent', async () => {
    const { sent, judged, run } = await judgedTurns(injectingDriver(rewritingDriver(), 'p'), 'P');
    expect(run.status, run.error).toBe('completed');
    expect(sent).toEqual([REWRITTEN, PERTURBATION, 'And the price?']);
    expect(judged).toEqual(sent);
  });

  it('P mode over the scripted driver: the injected turn was already the one sent', async () => {
    const { sent, judged } = await judgedTurns(injectingDriver(createScriptedDriver(), 'p'), 'P');
    expect(sent).toEqual([AUTHORED, PERTURBATION, 'And the price?']);
    expect(judged).toEqual(sent);
  });

  it('the authored block stays on the check context beside the stimulus sent', async () => {
    const seen: Array<{ authored: unknown; sent: unknown }> = [];
    await runSpec(SPEC, {
      adapter: recordingAgent(),
      driver: rewritingDriver(),
      checks: [
        {
          name: 'spy',
          applies: () => true,
          evaluate: (ctx) => {
            seen.push({ authored: ctx.block.when, sent: ctx.stimulus });
            return [];
          },
        },
      ],
      mode: 'F',
      repeat: 0,
    });
    expect(seen[0]).toEqual({ authored: { user: AUTHORED }, sent: { user: REWRITTEN } });
    expect(seen[1]).toEqual({ authored: { user: 'And the price?' }, sent: { user: 'And the price?' } });
  });
});
