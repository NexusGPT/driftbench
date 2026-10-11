import { fileURLToPath } from 'node:url';
import { knowledgeRetention, relevancy } from '@driftbench/checks';
import type { Check, CheckContext, Observed, Spec } from '@driftbench/core';
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
    expect(criteria.map((criterion) => criterion.def.name)).toEqual(['knowledge_retention', 'relevancy']);
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
