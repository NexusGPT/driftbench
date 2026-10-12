import { describe, expect, it } from 'vitest';
import { acceptAnswer, QuoteIndex, SYSTEM_PROMPT } from '../../src/extract';

const draft = () => ({ dimensions: [], constraints: [], phrases: [], relations: [] });
const quotes = new QuoteIndex(new Map([['prompt.md', 'Never promise a delivery date.']]));

describe('what a rule states', () => {
  it('the answer template shows polarity on a value', () => {
    expect(SYSTEM_PROMPT).toContain('"polarity"');
  });

  it('keeps the polarity a model gives a rule', () => {
    const target = draft();
    const answer = {
      section: 'rules',
      dimensions: [
        {
          id: 'rule',
          title: 'Rules',
          kind: 'behaviour',
          values: [
            {
              id: 'R-01',
              title: 'No delivery date',
              polarity: 'must_not',
              source: 'prompt.md',
              quote: 'Never promise a delivery date.',
            },
          ],
        },
      ],
      constraints: [],
      phrases: [],
      relations: [],
    };
    const result = acceptAnswer('rules', answer as never, target as never, quotes);
    expect(result.refusals).toEqual([]);
    expect((target.dimensions[0] as { values: Array<{ polarity?: string }> }).values[0]?.polarity).toBe(
      'must_not',
    );
  });

  it('the answer template shows when, and the model may scope a rule to a cell', () => {
    expect(SYSTEM_PROMPT).toContain('"polarity": "<must or must_not, on a rule only>", "when"');
    const target = { dimensions: [], constraints: [], phrases: [], relations: [] };
    const answer = {
      section: 'rules',
      dimensions: [
        {
          id: 'rule',
          title: 'Rules',
          kind: 'behaviour',
          values: [
            {
              id: 'R-02',
              title: 'Be brief on sms',
              polarity: 'must',
              when: { channel: ['sms'] },
              source: 'prompt.md',
              quote: 'Never promise a delivery date.',
            },
          ],
        },
      ],
      constraints: [],
      phrases: [],
      relations: [],
    };
    const result = acceptAnswer('rules', answer as never, target as never, quotes);
    expect(result.refusals).toEqual([]);
    expect((target.dimensions[0] as { values: Array<{ when?: unknown }> }).values[0]?.when).toEqual({
      channel: ['sms'],
    });
  });
});
