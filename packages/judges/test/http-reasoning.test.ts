import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { requestKey } from '../src/cassette';
import type { ClientOptions } from '../src/client';
import { createHttpJudge } from '../src/clients/http-json';
import type { JudgeRequest } from '../src/contract';

const criterion = { name: 'correct', rubric: 'Correct answer.' };
const plain: JudgeRequest = {
  criterion,
  transcript: [{ role: 'user', text: 'What is two plus two?' }],
};
const ledger: JudgeRequest = {
  ...plain,
  answerContract: 'ledger',
  assessment: { kind: 'pairwise', items: [criterion] },
  candidates: { A: 'Four.', B: 'Five.' },
};

function capture(reasoning?: ClientOptions['reasoning'], cls?: 'system1' | 'system2') {
  const bodies: string[] = [];
  const client = createHttpJudge({
    url: 'https://judge.example.test',
    family: 'custom',
    maxRetries: 0,
    reasoning,
    cls,
    fetch: async (_url, init) => {
      bodies.push(String(init.body));
      return new Response('{}', { status: 200 });
    },
  });
  return { client, bodies };
}

describe('HTTP reasoning follows the request capability', () => {
  it('sends the constructor default and identifies it in settings and the cache key', async () => {
    const { client, bodies } = capture('medium');
    await client.judge(ledger);
    expect(JSON.parse(bodies[0] as string).request.reasoning).toBe('medium');
    expect(JSON.parse(client.settings as string)).toEqual({ reasoning: 'medium' });
    expect(requestKey(ledger, client)).not.toBe(requestKey(ledger, capture().client));
    expect(requestKey(ledger, client)).not.toBe(requestKey(ledger, capture('high').client));
  });

  it('sends a request override and gives that effective value its own key', async () => {
    const { client, bodies } = capture('medium');
    const request = { ...ledger, reasoning: 'high' as const };
    await client.judge(request);
    expect(JSON.parse(bodies[0] as string).request.reasoning).toBe('high');
    expect(client.reasoning).toBe('medium');
    expect(JSON.parse(client.settings as string)).toEqual({ reasoning: 'medium' });
    expect(requestKey(request, client)).not.toBe(requestKey(ledger, client));
  });

  // Captured from the merged client before adding HTTP reasoning settings or rejection paths.
  for (const [request, digest, key] of [
    // Prompt 2 includes whole-reply context and neutral data instructions; default decoder 3 has its own request identity.
    [plain, '54d5f33a3d499417f87ed00c20426e705807a7d2f487d85b2b34a2f1e5fa8888', 'be5769c4e98e'],
    [ledger, 'c9f70fc218bca25ee29988129ad474203e88b8ebf993ea99cdee3952e523623b', '8ef5c47147a3'],
  ] as const) {
    it(`preserves unset ${request.answerContract ?? 'plain'} request bytes and key`, async () => {
      const { client, bodies } = capture();
      await client.judge(request);
      expect(
        createHash('sha256')
          .update(bodies[0] as string)
          .digest('hex'),
      ).toBe(digest);
      expect(client.settings).toBeUndefined();
      expect(requestKey(request, client)).toBe(key);
    });
  }

  it('separates explicit decoder 2 from the default under the revised prompt', () => {
    const { client } = capture();
    expect(requestKey({ ...plain, criterionDecoderVersion: 2 }, client)).toBe('74f760c36924');
    expect(requestKey({ ...plain, criterionDecoderVersion: 3 }, client)).toBe('be5769c4e98e');
  });

  it('rejects defaults and overrides on non-ledger requests before transport', async () => {
    for (const reasoning of [undefined, 'medium'] as const) {
      const { client, bodies } = capture(reasoning);
      await expect(client.judge({ ...plain, reasoning: 'high' })).rejects.toThrow(
        'reasoning is supported only by HTTP pair-ledger requests',
      );
      if (reasoning !== undefined)
        await expect(client.judge(plain)).rejects.toThrow(
          'reasoning is supported only by HTTP pair-ledger requests',
        );
      expect(bodies).toEqual([]);
    }
  });

  it('rejects reasoning on the system1 path before transport', async () => {
    expect(() => capture('medium', 'system1')).toThrow(
      'reasoning is not supported by the HTTP system1 client',
    );
    const { client, bodies } = capture(undefined, 'system1');
    await expect(client.judge({ ...ledger, reasoning: 'high' })).rejects.toThrow(
      'reasoning is supported only by HTTP pair-ledger requests',
    );
    expect(bodies).toEqual([]);
  });
});
