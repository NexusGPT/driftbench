import { fileURLToPath } from 'node:url';
import { knowledgeRetention, relevancy } from '@agent-nexus/driftbench-checks';
import type { Check, CheckContext, Observed, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { type CriterionFixture, loadCriteria } from '../src/criteria';

const DIR = fileURLToPath(new URL('../../../examples/criteria', import.meta.url));

/** The last agent reply of a fixture, as an Observed, and the user turn before it as the block's ask. */
function blockOf(fixture: CriterionFixture, expect: CheckContext['expect']): CheckContext {
  const agent = fixture.transcript.filter((entry) => entry.role === 'agent').at(-1)?.text ?? '';
  const user = fixture.transcript.filter((entry) => entry.role === 'user').at(-1)?.text ?? '';
  const observed: Observed = {
    segments: [{ type: 'text', text: agent }],
    text: agent,
    toolCalls: [],
    cost: {},
    latencyMs: 0,
  };
  const block = { when: { user }, expect };
  const spec = { id: 'catalogue', kind: 'conversation', blocks: [block] } as Spec;
  return {
    spec,
    mode: 'F',
    blockIndex: 0,
    block,
    expect,
    given: { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'function' }, hash: 'h' },
    observed,
    history: [],
    ledger: fixture.given?.ledger ?? {},
  };
}

async function outcomes(check: Check, ctx: CheckContext): Promise<string[]> {
  return (await check.evaluate(ctx)).map((verdict) => verdict.outcome);
}

describe('the shared criteria catalogue: relevancy and knowledge_retention', () => {
  it('loads both criteria with no issue', async () => {
    const { criteria, issues } = await loadCriteria(DIR);
    expect(issues).toEqual([]);
    expect(criteria.map((criterion) => criterion.def.name)).toEqual([
      'conversation_completeness',
      'knowledge_retention',
      'relevancy',
      'role',
      'task_completion',
    ]);
  });

  it('has fixture pairs that the machine floor of each check already separates', async () => {
    const { criteria } = await loadCriteria(DIR);
    const byName = Object.fromEntries(criteria.map((criterion) => [criterion.def.name, criterion]));
    const relevant = byName.relevancy?.fixtures;
    const retained = byName.knowledge_retention?.fixtures;
    if (!relevant || !retained) throw new Error('a catalogue criterion is missing');
    expect(await outcomes(relevancy, blockOf(relevant.pass, { relevancy: {} }))).toEqual(['pass']);
    expect(await outcomes(relevancy, blockOf(relevant.fail, { relevancy: {} }))).toEqual(['fail']);
    const keep = { knowledge_retention: [{ fact: 'email', use: true }] };
    expect(await outcomes(knowledgeRetention, blockOf(retained.pass, keep))).toEqual(['pass', 'pass']);
    expect(await outcomes(knowledgeRetention, blockOf(retained.fail, keep))).toEqual(['fail', 'fail']);
  });
});

describe('the relevancy criterion judges a reply in other words', () => {
  it('reads a paraphrased answer as relevant, and still reads another question as not', async () => {
    const { criteria } = await loadCriteria(DIR);
    const relevant = criteria.find((criterion) => criterion.def.name === 'relevancy');
    if (!relevant) throw new Error('the relevancy criterion is missing');
    expect(relevant.def.rubric).toContain('in any words');
    expect(relevant.def.pass).toContain('even when it does not repeat the question words');
    expect(relevant.def.fail).toContain('answers a different question');
    expect(relevant.def.rubric).toContain('asks them to confirm it answers an order request');
  });
});

describe('the shared criteria catalogue: conversation_completeness', () => {
  it('has a passing and a failing transcript, and the failing one leaves a question unanswered', async () => {
    const { criteria } = await loadCriteria(DIR);
    const completeness = criteria.find((criterion) => criterion.def.name === 'conversation_completeness');
    if (!completeness) throw new Error('the conversation_completeness criterion is missing');
    expect(completeness.def.scope).toBe('conversation');
    expect(completeness.fixtures?.pass?.transcript.length).toBeGreaterThan(0);
    expect(completeness.fixtures?.fail?.transcript.length).toBeGreaterThan(0);
    expect(completeness.def.fail).toContain('no answer or result');
  });
});

describe('the shared criteria catalogue: role', () => {
  it('keeps a plain factual statement in role, and fails a promise outside it', async () => {
    const { criteria } = await loadCriteria(DIR);
    const role = criteria.find((criterion) => criterion.def.name === 'role');
    if (!role) throw new Error('the role criterion is missing');
    expect(role.def.rubric).toContain('even when it asks no question');
    expect(role.def.fail).toContain('promises something outside the role');
    expect(role.fixtures?.pass?.transcript.length).toBeGreaterThan(0);
    expect(role.fixtures?.fail?.transcript.length).toBeGreaterThan(0);
  });
});

describe('the shared criteria catalogue: task_completion', () => {
  it('has a passing and a failing transcript, and the failing one leaves the task undone', async () => {
    const { criteria } = await loadCriteria(DIR);
    const task = criteria.find((criterion) => criterion.def.name === 'task_completion');
    if (!task) throw new Error('the task_completion criterion is missing');
    expect(task.def.scope).toBe('conversation');
    expect(task.def.fail).toContain('no result by the end');
    expect(task.fixtures?.pass?.transcript.length).toBeGreaterThan(0);
    expect(task.fixtures?.fail?.transcript.length).toBeGreaterThan(0);
  });
});
