import { describe, expect, it, vi } from 'vitest';
import { ledgerContradictions } from '../../src/runner/ledger';

describe('ledger contact comparison cost', () => {
  it('keeps regex construction bounded while comparing a long contact history', () => {
    const messages = Array.from({ length: 400 }, (_, index) => ({
      role: 'user' as const,
      content: `old${index}@example.test +1202555${String(100 + (index % 100)).padStart(4, '0')}`,
    }));
    const NativeRegExp = RegExp;
    let constructions = 0;
    class CountedRegExp extends NativeRegExp {
      constructor(pattern: string | RegExp, flags?: string) {
        super(pattern, flags);
        constructions += 1;
      }
    }
    vi.stubGlobal('RegExp', CountedRegExp);
    try {
      const result = ledgerContradictions(
        { email: 'current@example.test', phone: '+12025550188' },
        { text: 'old399@example.test +12025550199', toolCalls: [], segments: [], cost: {}, latencyMs: 0 },
        messages,
      );
      expect(result.checked).toEqual(['email', 'phone']);
      expect(result.contradictions).toEqual([
        {
          fact: 'email',
          source: 'reply',
          ledger: 'current@example.test',
          observed: 'old399@example.test',
          where: 'reply',
        },
        { fact: 'phone', source: 'reply', ledger: '+12025550188', observed: '+12025550199', where: 'reply' },
      ]);
      expect(constructions).toBeLessThanOrEqual(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('ledger history reads', () => {
  it.each([
    { history: [], reply: 'current@example.test', checked: false, stale: undefined },
    { history: ['current@example.test'], reply: 'current@example.test', checked: false, stale: undefined },
    { history: ['old@example.test'], reply: 'unknown@example.test', checked: true, stale: undefined },
    {
      history: ['old@example.test'],
      reply: 'old@example.test CURRENT@example.test',
      checked: true,
      stale: undefined,
    },
    {
      history: ['first@example.test', 'second@example.test'],
      reply: 'second@example.test first@example.test',
      checked: true,
      stale: 'second@example.test',
    },
  ])('preserves contact evidence for $reply with $history', ({ history, reply, checked, stale }) => {
    const result = ledgerContradictions(
      { email: 'current@example.test' },
      { text: reply, toolCalls: [], segments: [], cost: {}, latencyMs: 0 },
      history.map((content) => ({ role: 'user' as const, content })),
    );
    expect(result.checked).toEqual(checked ? ['email'] : []);
    expect(result.contradictions).toEqual(
      stale === undefined
        ? []
        : [
            {
              fact: 'email',
              source: 'reply',
              ledger: 'current@example.test',
              observed: stale,
              where: 'reply',
            },
          ],
    );
  });

  it.each([40, 400])('does not scan %i old messages when the reply has no contact value', (length) => {
    let reads = 0;
    const messages = Array.from({ length }, (_, index) => ({
      role: 'user' as const,
      get content() {
        reads += 1;
        return `old${index}@example.test`;
      },
    }));
    expect(
      ledgerContradictions(
        { email: 'current@example.test' },
        { text: 'Acknowledged.', toolCalls: [], segments: [], cost: {}, latencyMs: 0 },
        messages,
      ),
    ).toEqual({ checked: [], contradictions: [] });
    expect(reads).toBe(0);
  });

  it.each([40, 400])('stops after proving an alternative exists in %i messages', (length) => {
    let reads = 0;
    const messages = Array.from({ length }, (_, index) => ({
      role: 'user' as const,
      get content() {
        reads += 1;
        return `old${index}@example.test`;
      },
    }));
    expect(
      ledgerContradictions(
        { email: 'current@example.test' },
        { text: 'current@example.test', toolCalls: [], segments: [], cost: {}, latencyMs: 0 },
        messages,
      ),
    ).toEqual({ checked: ['email'], contradictions: [] });
    expect(reads).toBeLessThanOrEqual(2);
  });
});
