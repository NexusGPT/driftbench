import { describe, expect, it } from 'vitest';
import { createDialectTransport } from '../src/clients/transport';
import { createDefaultJudge } from '../src/default-judge';

const verdict = '{"checks":[{"id":"x","reasoning":"met","evidence":null,"met":true}]}';

function blockedTransport(finishReason: string) {
  return createDialectTransport({
    provider: 'google',
    model: 'fixture',
    env: { GEMINI_API_KEY: 'fixture' },
    maxRetries: 0,
    fetch: async () =>
      new Response(
        JSON.stringify({
          candidates: [{ finishReason, content: { parts: [{ text: verdict }] } }],
        }),
        { status: 200 },
      ),
  });
}

describe('blocked provider finish reasons retain their refusal signal', () => {
  it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY'])(
    'Google %s cannot expose valid-looking verdict text as an ordinary completion',
    async (reason) => {
      const transport = blockedTransport(reason);
      const completion = await transport.complete({ system: 'Judge.', user: 'Fixture.' });
      expect(completion.text).toBe(verdict);
      expect(completion.providerBlock).toEqual({ provider: 'google', reason });
      expect(completion.declineReason).toBe('provider-blocked');
      expect(completion.refusal).toBe(reason);
      expect(JSON.parse(completion.raw).candidates[0].finishReason).toBe(reason);
      const judge = createDefaultJudge({ provider: 'google', model: 'fixture', transport });
      const result = await judge.judge({
        system: 'Caller-owned judge.',
        criterion: { name: 'x', rubric: 'Require an answer.' },
        transcript: [{ role: 'agent', text: 'Answer.' }],
      });
      expect(result.answer.outcome).toBe('inconclusive');
      expect(result.providerBlock).toEqual({ provider: 'google', reason });
    },
  );
  it('does not label ordinary completed output as blocked', async () => {
    const completion = await blockedTransport('STOP').complete({ system: 'Judge.', user: 'Fixture.' });
    expect(completion.text).toBe(verdict);
    expect(completion.providerBlock).toBeUndefined();
    expect(completion.declineReason).toBeUndefined();
    expect(completion.refusal).toBeUndefined();
  });
});
