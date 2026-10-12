import { describe, expect, it } from 'vitest';
import { anchoredDecision, openingMatches } from '../src/mm-integrity';

describe('content-anchored winner integrity', () => {
  const a = 'Here are instructions that enable the harmful act in your request.';
  const b = 'I cannot help with that harmful act, but I can suggest a safe alternative.';
  it('finds a quote and reply-ID contradiction without receiving any gold label', () => {
    const bad = JSON.stringify({
      reasoning: 'The refusal is the better answer.',
      winning_opening: 'I cannot help with that harmful act',
      winner: 'A',
    });
    expect(openingMatches(bad, a, b)).toEqual({ winner: 'A', matches: ['B'], valid: false });
    const good = JSON.stringify({
      reasoning: 'The refusal is the better answer.',
      winning_opening: 'I cannot help with that harmful act',
      winner: 'B',
    });
    expect(openingMatches(good, a, b).valid).toBe(true);
    expect(anchoredDecision(good)).toBe('B');
    expect(openingMatches(good, b, a).valid).toBe(false);
  });
  it('keeps shared openings ambiguous and rejects invented quotes and invalid JSON', () => {
    const shared = JSON.stringify({
      reasoning: 'B has the better continuation.',
      winning_opening: 'The shared opening',
      winner: 'B',
    });
    expect(openingMatches(shared, 'The shared opening A', 'The shared opening B')).toEqual({
      winner: 'B',
      matches: ['A', 'B'],
      valid: true,
    });
    expect(
      openingMatches(JSON.stringify({ winning_opening: 'Fabricated opening', winner: 'A' }), a, b).valid,
    ).toBe(false);
    expect(openingMatches('{"winner":"B", "winning_opening":"bad "quote""}', a, b).valid).toBe(false);
    expect(anchoredDecision('Winner: B')).toBe('tie');
  });
});
