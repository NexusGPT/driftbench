import { Expect, validateSpec } from '@driftbench/core';
import { describe, expect, it } from 'vitest';

describe('similarity, relevancy and knowledge_retention in the spec', () => {
  it('accepts each field and refuses a threshold outside 0 to 1', () => {
    const ok = Expect.safeParse({
      similarity: [{ reference: 'Your order is placed.', min: 0.6 }],
      relevancy: { min: 0.5, terms: ['plan', 'data'] },
      knowledge_retention: [
        { fact: 'email', use: true },
        { fact: 'phone', ask: 'phone number' },
      ],
    });
    expect(ok.success, JSON.stringify(ok.error)).toBe(true);
    expect(Expect.safeParse({ similarity: [{ reference: 'x', min: 1.2 }] }).success).toBe(false);
    expect(Expect.safeParse({ relevancy: { min: -0.1 } }).success).toBe(false);
    expect(Expect.safeParse({ knowledge_retention: [{ fact: '' }] }).success).toBe(false);
  });

  it('counts a fact the block itself sets in given.ledger', () => {
    const loaded = validateSpec({
      id: 'retention-given',
      blocks: [
        {
          user: 'thanks',
          given: { ledger: { email: 'jo@example.com' } },
          expect: { knowledge_retention: [{ fact: 'email' }] },
        },
      ],
    });
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
  });

  it('flags a retention fact that no earlier ledger gives', () => {
    const loaded = validateSpec({
      id: 'retention',
      given: { ledger: { customer: 'existing' } },
      blocks: [
        { user: 'hi', expect: { knowledge_retention: [{ fact: 'email' }] } },
        { user: 'it is jo@example.com', expect: { ledger_add: { email: 'jo@example.com' } } },
        { user: 'thanks', expect: { knowledge_retention: [{ fact: 'email' }, { fact: 'customer' }] } },
      ],
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.errors.map((issue) => `${issue.code} ${issue.path}`)).toEqual([
      'RETENTION_FACT_UNKNOWN blocks.0.expect.knowledge_retention.0.fact',
    ]);
  });
});
