import { describe, expect, it } from 'vitest';
import { anchorPair, anchorResolve, interleavedDrafts, parseAnchor, parseReading } from '../src/wp-anchor';

describe('holistic writing anchors', () => {
  it('preserves the source in an interleaved layout, including the ending', () => {
    const a = 'A1\n\nA2\n\nA3\n\nA4😀',
      b = 'B1\n\nB2';
    const text = interleavedDrafts(a, b);
    const parts = (letter: string) =>
      [
        ...text.matchAll(
          new RegExp(`<draft_${letter}_part_\\d>\\n([\\s\\S]*?)\\n</draft_${letter}_part_\\d>`, 'g'),
        ),
      ]
        .map((m) => m[1])
        .join('');
    expect(parts('A')).toBe(a);
    expect(parts('B')).toBe(b);
  });
  it('checks holistic scores and resolves a distinctive winner excerpt', () => {
    const text = JSON.stringify({
      A: { level: 3 },
      B: { level: 2 },
      winner: 'B',
      winning_excerpt: 'alpha scene',
      reason: 'specific',
    });
    const parsed = parseAnchor(text, 'alpha scene', 'beta scene');
    expect(parsed?.winner).toBe('B');
    expect(parsed?.rated).toBe('A');
    expect(parsed?.excerpt).toBe('A');
    expect(parsed?.mismatch).toBe(true);
    expect(parseAnchor('{"winner":"wrong"}', 'a', 'b')).toBeUndefined();
    expect(parseAnchor('{"winner":"B","winning_excerpt":"shared"}', 'shared a', 'shared b')?.excerpt).toBe(
      'B',
    );
  });
  it('uses no generated checklist, brevity rule, or answer-size feature', () => {
    const prompt = anchorPair('Write a story', 'alpha', 'beta');
    expect(prompt.system).toContain('3 Creative');
    expect(prompt.system).not.toMatch(/length|word count|token count|brevity|concise|verbosity/i);
    expect(prompt.user).toBe(
      '<request>\nWrite a story\n</request>\n<draft_A>\nalpha\n</draft_A>\n<draft_B>\nbeta\n</draft_B>',
    );
  });
  it('keeps reversed opinion references attached to their source labels', () => {
    const opinion = {
      winner: 'A' as const,
      rated: 'A' as const,
      excerpt: 'A' as const,
      reason: 'A has an enacted scene.',
      mismatch: false,
      confidence: 3,
    };
    const prompt = anchorResolve('Write a story', 'alpha', 'beta', [opinion, { ...opinion, winner: 'B' }]);
    expect(prompt.user).toContain('A means source B; B means source A');
    expect(anchorResolve('Write a story', 'alpha', 'beta', [opinion, opinion], false).user).not.toContain(
      'labels_in_reason',
    );
  });
  it('accepts within-level placement only in its declared anchor interval', () => {
    expect(parseReading('{"level":2,"placement":2}')?.placement).toBe(2);
    expect(parseReading('{"level":2,"placement":8}')?.placement).toBeUndefined();
    expect(parseReading('{"level":4,"placement":1}')).toBeUndefined();
    expect(parseReading('{"level":"2","placement":1}')).toBeUndefined();
  });
});
