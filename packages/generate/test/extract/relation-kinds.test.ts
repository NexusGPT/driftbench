import { describe, expect, it } from 'vitest';
import { acceptAnswer, QuoteIndex, SYSTEM_PROMPT, sectionRequest } from '../../src/extract';

const quotes = new QuoteIndex(
  new Map([['prompt.md', 'Call account.find before order.place. Send billing questions to billing-desk.']]),
);
const target = () => ({
  dimensions: [
    {
      id: 'rule',
      title: 'Rules',
      kind: 'behaviour',
      role: 'axis',
      produced_by: 'model',
      approved: false,
      values: [
        {
          id: 'R-01',
          title: 'r',
          evidence: { source: 'prompt.md', quote: 'Call account.find' },
          produced_by: 'model',
        },
      ],
    },
  ],
  constraints: [],
  phrases: [],
  relations: [],
});
const answer = (relation: Record<string, unknown>) => ({
  section: 'relations',
  dimensions: [],
  constraints: [],
  phrases: [],
  relations: [{ ...relation, source: 'prompt.md', quote: 'Call account.find before order.place.' }],
});

describe('relation kinds a rule can state', () => {
  it('lists tool_order in the template and keeps the relation', () => {
    expect(SYSTEM_PROMPT).toContain('tool_order');
    expect(sectionRequest('relations', [], { dimensions: [], constraints: [] }).user).toContain(
      '- "tool_order"',
    );
    const t = target();
    const result = acceptAnswer(
      'relations',
      answer({ kind: 'tool_order', before: 'account.find', after: 'order.place' }) as never,
      t as never,
      quotes,
    );
    expect(result.refusals).toEqual([]);
    expect(t.relations).toHaveLength(1);
  });

  it('lists route and keeps the relation', () => {
    expect(sectionRequest('relations', [], { dimensions: [], constraints: [] }).user).toContain('- "route"');
    const t = target();
    const result = acceptAnswer(
      'relations',
      answer({ kind: 'route', subject: { dimension: 'rule', value: 'R-01' }, to: 'billing-desk' }) as never,
      t as never,
      quotes,
    );
    expect(result.refusals).toEqual([]);
    expect(t.relations).toHaveLength(1);
  });

  it('lists reply_text and keeps the relation', () => {
    expect(sectionRequest('relations', [], { dimensions: [], constraints: [] }).user).toContain(
      '- "reply_text"',
    );
    const t = target();
    const result = acceptAnswer(
      'relations',
      answer({
        kind: 'reply_text',
        subject: { dimension: 'rule', value: 'R-01' },
        text: 'Your order is in.',
      }) as never,
      t as never,
      quotes,
    );
    expect(result.refusals).toEqual([]);
    expect(t.relations).toHaveLength(1);
  });
});
