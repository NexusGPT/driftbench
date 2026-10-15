import {
  type CheckContext,
  CriterionDef,
  canonicalGiven,
  type Observed,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { requestFor } from '../src/index';

/**
 * Blast radius of PR 422 on the judges: PR 422 makes the adapters send a history call with no recorded
 * result as a note, never as null. A judge reads the same canonical prefix (scope `conversation`); it must
 * not tell the judge either that such a call returned null, while a recorded result, even a null one, is
 * shown as recorded.
 */
const parsed = validateSpec({
  id: 'unrecorded-judge',
  version: '1',
  given: { world: { tools: { 'catalog.search': { result: { plans: [] } } } } },
  criteria: [{ name: 'price', rubric: 'The reply names a price.', scope: 'conversation' }],
  blocks: [
    {
      user: 'Is there fiber at 3 Orchard Way?',
      expect: {
        tools: [
          { label: 'coverage.check', input: { address: { regex: '^3 Orchard' } } },
          { label: 'catalog.search', input: { category: 'home' } },
        ],
      },
    },
    { user: 'And the price?', expect: { criteria: ['price'] } },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed));
const spec = parsed.spec;
const OBSERVED: Observed = {
  segments: [{ type: 'text', text: 'It is 30 a month.' }],
  text: 'It is 30 a month.',
  toolCalls: [],
  cost: {},
  latencyMs: 1,
};

function contextWith(prefix: CheckContext['given']['prefix']): CheckContext {
  const block = spec.blocks[1];
  if (!block) throw new Error('no block 1');
  return {
    spec,
    mode: 'T',
    blockIndex: 1,
    block,
    expect: block.expect ?? {},
    given: { prefix, ledger: {}, world: {}, vars: {}, target: { adapter: 'anthropic' }, hash: 'h' },
    observed: OBSERVED,
    history: [],
    ledger: {},
  };
}

const def = CriterionDef.parse(spec.criteria?.[0]);

describe('PR 422 blast radius: a judge reads a canonical call with no recorded result', () => {
  it('shows the call and no result for it, never a null result', () => {
    const prefix = canonicalGiven(spec, 1).prefix;
    const request = requestFor(contextWith(prefix), def, undefined);
    const tools = request.transcript.filter(
      (entry) => entry.role === 'tool_call' || entry.role === 'tool_result',
    );
    expect(tools).toEqual([
      { role: 'tool_call', tool: 'coverage.check', text: '{}' },
      { role: 'tool_call', tool: 'catalog.search', text: '{"category":"home"}' },
      { role: 'tool_result', tool: 'catalog.search', text: '{"plans":[]}' },
    ]);
    expect(request.transcript.some((entry) => entry.text === 'null')).toBe(false);
  });

  it('shows a recorded null output as a result, apart from a call with none', () => {
    const request = requestFor(
      contextWith([
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ label: 'coverage.check', input: {}, output: null }],
        },
      ]),
      def,
      undefined,
    );
    expect(request.transcript).toContainEqual({ role: 'tool_result', tool: 'coverage.check', text: 'null' });
  });
});
