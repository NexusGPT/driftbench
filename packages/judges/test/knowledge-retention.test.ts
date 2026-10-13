import { fileURLToPath } from 'node:url';
import { knowledgeRetention } from '@agent-nexus/driftbench-checks';
import type { CheckContext, Spec, Verdict } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { combineVerdicts } from '../src/check';
import { fixtureRequest, loadCriteria } from '../src/criteria';
import { KNOWLEDGE_RETENTION_CRITERION } from '../src/index';
import { buildPrompt } from '../src/prompt';

const DIR = fileURLToPath(new URL('../../../examples/criteria', import.meta.url));

async function retained() {
  const { criteria, issues } = await loadCriteria(DIR);
  expect(issues).toEqual([]);
  const criterion = criteria.find((entry) => entry.def.name === 'knowledge_retention');
  if (!criterion) throw new Error('missing knowledge_retention criterion');
  return criterion;
}

describe('knowledge retention criterion boundaries', () => {
  it('ships the same criterion through the package export and the YAML catalogue', async () => {
    const request = fixtureRequest(await retained(), 'pass');
    expect(request.criterion).toEqual(KNOWLEDGE_RETENTION_CRITERION);
    expect(buildPrompt({ ...request, criterion: KNOWLEDGE_RETENTION_CRITERION })).toEqual(
      buildPrompt(request),
    );
  });
  // These test the shipped instructions, not a model simulation. Real semantic outcomes
  // are measured separately using the frozen tuning and held-out benchmark requests.
  it('judges the immediate reply and does not require every known fact to be repeated', async () => {
    const { user } = buildPrompt(fixtureRequest(await retained(), 'pass'));
    expect(user).toContain('A single user message followed by a reply is sufficient');
    expect(user).toContain('Unmentioned facts need not be repeated');
  });

  it('keeps new information and different owners outside the re-ask rule', async () => {
    const { user } = buildPrompt(fixtureRequest(await retained(), 'pass'));
    expect(user).toContain('New information may be requested');
    expect(user).toContain('same owner and attribute');
    expect(user).toContain('Do not invent an alternate owner or purpose');
  });

  it('defines current facts, exact units and negation without adding a grounding criterion', async () => {
    const { user } = buildPrompt(fixtureRequest(await retained(), 'fail'));
    expect(user).toContain('Explicit corrections replace earlier values');
    expect(user).toContain('quantities, units, currencies, negation and contact restrictions');
    expect(user).toContain('Do not require independent source proof');
  });
});

describe('semantic retention and the literal machine check', () => {
  async function machine(text: string, use: boolean) {
    const expect = { knowledge_retention: [{ fact: 'email', use }], criteria: ['knowledge_retention'] };
    const block = { when: { user: 'Continue.' }, expect };
    const ctx: CheckContext = {
      spec: { id: 'retention-co-use', kind: 'conversation', blocks: [block] } as Spec,
      mode: 'F',
      blockIndex: 0,
      block,
      expect,
      given: { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'function' }, hash: 'h' },
      ledger: { email: 'jo.okafor@example.com' },
      history: [],
      observed: { text, segments: [{ type: 'text', text }], toolCalls: [], cost: {}, latencyMs: 0 },
    };
    return knowledgeRetention.evaluate(ctx);
  }

  // Supplied judge verdicts exercise combination only; they do not simulate model reasoning.
  const judged = (outcome: 'pass' | 'fail'): Verdict => ({
    id: 'judge.knowledge_retention',
    kind: 'judge',
    name: 'knowledge_retention',
    gating: true,
    outcome,
    evidence: 'Supplied semantic verdict for the combination test.',
  });

  it('a semantic pass cannot waive an explicit literal-use failure', async () => {
    const checks = await machine('I have your email already. What delivery day works?', true);
    expect(checks.find((v) => v.id.endsWith('.used'))).toMatchObject({ outcome: 'fail', gating: true });
    expect(combineVerdicts(checks, [judged('pass')]).pass).toBe(false);
  });

  it('without a use requirement, retaining an unmentioned fact permits a semantic pass', async () => {
    const checks = await machine('What delivery day works?', false);
    expect(checks.every((v) => v.outcome === 'pass')).toBe(true);
    expect(combineVerdicts(checks, [judged('pass')]).pass).toBe(true);
  });

  it('an advisory machine re-ask cannot erase a semantic failure', async () => {
    const checks = await machine('What is your email address?', false);
    expect(checks.find((v) => v.id.endsWith('.asked'))).toMatchObject({ outcome: 'fail', gating: false });
    expect(combineVerdicts(checks, [judged('fail')]).pass).toBe(false);
  });

  it('mere value presence cannot override a semantic contradiction', async () => {
    const checks = await machine('jo.okafor@example.com is your colleague, not you.', true);
    expect(checks.every((v) => v.outcome === 'pass')).toBe(true);
    expect(combineVerdicts(checks, [judged('fail')]).pass).toBe(false);
  });
});
