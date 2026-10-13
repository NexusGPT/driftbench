import { describe, expect, it } from 'vitest';
import { buildPairPrompt } from '../src/pair-prompt';

const criterion = { name: 'resolves', rubric: 'Which reply resolves the request better?' };

describe('buildPairPrompt: each candidate in its own data tag', () => {
  it('puts the first candidate in first_data and the second in second_data, in that order', () => {
    const { user } = buildPairPrompt({
      criterion,
      first: [{ role: 'agent', text: 'Acme Care can help you.' }],
      second: [{ role: 'agent', text: 'I refunded the charge.' }],
    });
    const a = user.indexOf('<first_data>');
    const b = user.indexOf('<second_data>');
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    expect(user.slice(a, b)).toContain('Acme Care can help you.');
    expect(user.slice(b)).toContain('I refunded the charge.');
  });
});
