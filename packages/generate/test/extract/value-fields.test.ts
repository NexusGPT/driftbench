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
    expect(
      (target.dimensions[0] as unknown as { values: Array<{ polarity?: string }> }).values[0]?.polarity,
    ).toBe('must_not');
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
    expect(
      (target.dimensions[0] as unknown as { values: Array<{ when?: unknown }> }).values[0]?.when,
    ).toEqual({
      channel: ['sms'],
    });
  });

  it('the answer template shows unless, and the model may state it on a rule', () => {
    expect(SYSTEM_PROMPT).toContain('"unless": {"<dimension id>": ["<value id>"]}');
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
              id: 'R-03',
              title: 'A rule',
              polarity: 'must',
              unless: { channel: ['sms'] },
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
    expect(
      (target.dimensions[0] as unknown as { values: Array<Record<string, unknown>> }).values[0]?.unless,
    ).toEqual({
      channel: ['sms'],
    });
  });

  it('the answer template shows limit, and the model may state it on a rule', () => {
    expect(SYSTEM_PROMPT).toContain('"limit": 3');
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
              id: 'R-03',
              title: 'A rule',
              polarity: 'must',
              limit: 3,
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
    expect(
      (target.dimensions[0] as unknown as { values: Array<Record<string, unknown>> }).values[0]?.limit,
    ).toEqual(3);
  });

  it('the answer template shows within, and the model may state it on a rule', () => {
    expect(SYSTEM_PROMPT).toContain('"within": {"minutes": 5}');
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
              id: 'R-03',
              title: 'A rule',
              polarity: 'must',
              within: { minutes: 5 },
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
    expect(
      (target.dimensions[0] as unknown as { values: Array<Record<string, unknown>> }).values[0]?.within,
    ).toEqual({
      minutes: 5,
    });
  });

  it('the answer template shows priority, and the model may state it on a rule', () => {
    expect(SYSTEM_PROMPT).toContain('"priority": "first"');
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
              id: 'R-03',
              title: 'A rule',
              polarity: 'must',
              priority: 'first',
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
    expect(
      (target.dimensions[0] as unknown as { values: Array<Record<string, unknown>> }).values[0]?.priority,
    ).toEqual('first');
  });

  it('the answer template shows weight, and the model may state it on a rule', () => {
    expect(SYSTEM_PROMPT).toContain('"weight": <share of users between 0 and 1>');
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
              id: 'R-03',
              title: 'A rule',
              polarity: 'must',
              weight: 0.4,
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
    expect(
      (target.dimensions[0] as unknown as { values: Array<Record<string, unknown>> }).values[0]?.weight,
    ).toEqual(0.4);
  });

  it('the answer template shows required, and the model may state it on a rule', () => {
    expect(SYSTEM_PROMPT).toContain('"required": <true when a test plan must include the value>');
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
              id: 'R-03',
              title: 'A rule',
              polarity: 'must',
              required: true,
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
    expect(
      (target.dimensions[0] as unknown as { values: Array<Record<string, unknown>> }).values[0]?.required,
    ).toEqual(true);
  });

  it('keeps the role a source declares for a dimension, and shows the key in the template', () => {
    expect(SYSTEM_PROMPT).toContain('"kind": "<kind>", "role": "<axis or detail');
    const target = { dimensions: [], constraints: [], phrases: [], relations: [] };
    const answer = {
      section: 'personas',
      dimensions: [
        {
          id: 'tone',
          title: 'Tone',
          kind: 'persona',
          role: 'axis',
          values: [
            { id: 'calm', title: 'Calm', source: 'prompt.md', quote: 'Never promise a delivery date.' },
          ],
        },
      ],
      constraints: [],
      phrases: [],
      relations: [],
    };
    const result = acceptAnswer('personas', answer as never, target as never, quotes);
    expect(result.refusals).toEqual([]);
    expect((target.dimensions[0] as unknown as { role: string }).role).toBe('axis');
  });
});
