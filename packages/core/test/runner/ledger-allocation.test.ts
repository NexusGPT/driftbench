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
