import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildPrompt,
  createDialectTransport,
  type JudgeRequest,
  MAX_TOKENS,
  outputRoom,
  parseJudgeText,
  requestKey,
} from '@agent-nexus/driftbench-judges';
import { afterEach, expect, it, vi } from 'vitest';
import { withJudgeDialect } from '../../packages/judges/src/clients/dialects';

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  mkdtempSync: vi.fn(() => {
    throw new Error('Forbidden temporary workspace');
  }),
}));

import { makeRecordingClient, SpendBudget, type SpendRow } from '../record';

vi.mock('@agent-nexus/driftbench-judges', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent-nexus/driftbench-judges')>()),
  createClaudeCliJudge: () => {
    throw new Error('Forbidden native CLI in Messages API recorder');
  },
}));

// The recorder's wire allowance is the default judge's output room: answer budget plus thinking room.
const ROOM = { normal: outputRoom('normal', undefined), large: outputRoom('large', undefined) } as const;

const request: JudgeRequest = {
  criterion: { name: 'c', rubric: 'Reply politely.' },
  transcript: [{ role: 'agent', text: 'Hello.' }],
};
const text = '{"checks":[{"id":"c","met":true,"reasoning":"Polite.","evidence":"Hello."}]}';
const usage = {
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_input_tokens: 500,
  cache_creation_input_tokens: 100,
  cache_creation: { ephemeral_1h_input_tokens: 40, ephemeral_5m_input_tokens: 60 },
};
const cost = (1000 * 0.1 + 200 * 0.5 + 500 * 0.01 + 40 * 0.2 + 60 * 0.125) / 1e6;
function receipt(stop = 'end_turn', billed = usage, status = 200) {
  return new Response(
    JSON.stringify({
      model: 'claude-haiku-5-5',
      usage: billed,
      stop_reason: stop,
      content: [{ type: 'text', text }],
    }),
    { status },
  );
}
afterEach(() => vi.restoreAllMocks());

it('constructs the exact frozen Messages API identity without credentials, but cannot send', async () => {
  const fetch = vi.fn();
  const client = makeRecordingClient('haiku', new SpendBudget(1), {}, () => {}, { fetch });
  const transports = Object.fromEntries(
    Object.entries(ROOM).map(([budget, maxTokens]) => [
      budget,
      createDialectTransport({
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        env: { ANTHROPIC_API_KEY: 'offline' },
        maxRetries: 0,
        timeoutMs: 300000,
        maxTokens,
      }),
    ]),
  );
  expect(client.settings).toBe(
    JSON.stringify({
      client: 'criterion-messages-api-v1',
      model: 'claude-haiku-5-5',
      anthropicVersion: '2023-06-01',
      temperature: 'omitted',
      maxTokens: ROOM,
      schema: 'none',
      transportFingerprints: Object.fromEntries(
        Object.entries(transports).map(([key, transport]) => [key, transport.fingerprint]),
      ),
    }),
  );
  await expect(client.judge(request)).rejects.toThrow('ANTHROPIC_API_KEY');
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['normal', 'large'] as const)(
  'sends the frozen %s payload and parses it without a CLI workspace',
  async (budgetName) => {
    const temporary = vi.mocked(mkdtempSync);
    const budget = new SpendBudget(1),
      rows: SpendRow[] = [];
    const fetch = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
      const body = JSON.parse(String(init?.body));
      const prompt = buildPrompt(withJudgeDialect({ ...request, budget: budgetName }, 'scratchpad-json'));
      expect(body).toEqual({
        model: 'claude-haiku-5-5',
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        max_tokens: ROOM[budgetName],
      });
      expect(new Headers(init?.headers).get('anthropic-version')).toBe('2023-06-01');
      return receipt();
    });
    const client = makeRecordingClient(
      'haiku',
      budget,
      { ANTHROPIC_API_KEY: 'fictional' },
      (row) => rows.push(row),
      { fetch },
    );
    const result = await client.judge({ ...request, budget: budgetName });
    expect(result).toEqual({
      ...parseJudgeText(text, { ...request, budget: budgetName }),
      costUsd: cost,
      requestCount: 1,
    });
    expect(budget.spent).toBeCloseTo(cost, 12);
    expect(rows[0]).toMatchObject({
      accounting: 'tokens',
      inputTokens: 1600,
      outputTokens: 200,
      chargedUsd: cost,
    });
    expect(temporary).not.toHaveBeenCalled();
  },
);

it.each(['refusal', 'max_tokens'])('preserves frozen %s handling with metered usage', async (stop) => {
  const client = makeRecordingClient(
    'haiku',
    new SpendBudget(1),
    { ANTHROPIC_API_KEY: 'fictional' },
    () => {},
    { fetch: async () => receipt(stop) },
  );
  const result = await client.judge(request);
  expect(result.answer.outcome).toBe('inconclusive');
  expect(result.answer.reasoning).toBe(stop === 'refusal' ? 'Provider declined' : 'Answer truncated');
  expect(result.costUsd).toBeCloseTo(cost, 12);
  if (stop === 'refusal') expect(result.declineReason).toBe('provider-blocked');
  else expect(result.unparsed).toBe(true);
});

it.each([429, 503])(
  'reserves every unknown HTTP %i attempt, then charges the successful receipt',
  async (status) => {
    const budget = new SpendBudget(1),
      rows: SpendRow[] = [];
    const reserve = vi.spyOn(budget, 'reserve');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('Temporary failure', { status }))
      .mockResolvedValueOnce(receipt());
    const sleep = vi.fn(async () => {});
    const client = makeRecordingClient(
      'haiku',
      budget,
      { ANTHROPIC_API_KEY: 'fictional' },
      (row) => rows.push(row),
      { fetch, sleep },
    );
    const result = await client.judge(request);
    expect(result).toMatchObject({ costIncomplete: true, requestCount: 2 });
    expect(result.costUsd).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(budget.spent).toBeCloseTo((reserve.mock.calls[0]?.[0] ?? 0) + cost, 12);
    expect(rows[0]).toMatchObject({
      accounting: 'reserved-on-error',
      costUsd: cost,
      chargedUsd: budget.spent,
    });
  },
);

it('charges known error usage separately and uses long-context pricing', async () => {
  const budget = new SpendBudget(1),
    rows: SpendRow[] = [];
  const large = {
    input_tokens: 100001,
    output_tokens: 1,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  };
  const largeCost = (5 * (100001 * 0.1 + 0.5)) / 1e6;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(receipt('end_turn', usage, 503))
    .mockResolvedValueOnce(receipt('end_turn', large));
  const client = makeRecordingClient(
    'haiku',
    budget,
    { ANTHROPIC_API_KEY: 'fictional' },
    (row) => rows.push(row),
    { fetch, sleep: async () => {} },
  );
  // The input allowance must cover the simulated long context.
  const result = await client.judge({
    ...request,
    transcript: [{ role: 'agent', text: 'x'.repeat(110000) }],
  });
  expect(result).toMatchObject({ costUsd: cost + largeCost, requestCount: 2 });
  expect(result.costIncomplete).toBeUndefined();
  expect(budget.spent).toBeCloseTo(cost + largeCost, 12);
  expect(rows[0]).toMatchObject({ accounting: 'tokens', costUsd: cost + largeCost });
});

it('stops before a retry when its allowance cannot fit and retains the failed attempt', async () => {
  // One reservation for the output room fits; a second one does not.
  const budget = new SpendBudget(0.06),
    rows: SpendRow[] = [];
  const fetch = vi.fn(async () => new Response('Temporary failure', { status: 503 }));
  const client = makeRecordingClient(
    'haiku',
    budget,
    { ANTHROPIC_API_KEY: 'fictional' },
    (row) => rows.push(row),
    { fetch, sleep: async () => {} },
  );
  await expect(client.judge(request)).rejects.toThrow('spend cap');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(rows[0]).toMatchObject({
    accounting: 'reserved-on-error',
    status: 'error',
    chargedUsd: budget.spent,
  });
});

it.each(['missing', 'invalid', 'network'])(
  'retains the allowance and does not retry %s usage',
  async (mode) => {
    const budget = new SpendBudget(1),
      rows: SpendRow[] = [];
    const fetch = vi.fn(async () => {
      if (mode === 'network') throw new Error('Fictional failure');
      return new Response(
        JSON.stringify({
          usage: mode === 'missing' ? undefined : { input_tokens: -1, output_tokens: 3 },
          content: [],
        }),
      );
    });
    const client = makeRecordingClient(
      'haiku',
      budget,
      { ANTHROPIC_API_KEY: 'fictional' },
      (row) => rows.push(row),
      { fetch, sleep: async () => {} },
    );
    await expect(client.judge(request)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({
      accounting: 'reserved-on-error',
      status: 'error',
      chargedUsd: budget.spent,
    });
    expect(budget.spent).toBeGreaterThan(0);
  },
);

it.each(['ANTHROPIC_BASE_URL', 'ANTHROPIC_JUDGE_MODEL'])(
  'rejects the ambient identity override %s',
  (key) => {
    expect(() => makeRecordingClient('haiku', new SpendBudget(1), { [key]: 'other' }, () => {})).toThrow(
      'override',
    );
  },
);

it.each([429, 503])('bounds Haiku HTTP %i to four separately reserved attempts', async (status) => {
  const budget = new SpendBudget(1),
    rows: SpendRow[] = [];
  const reserve = vi.spyOn(budget, 'reserve');
  const fetch = vi.fn(async () => new Response('Temporary failure', { status }));
  const sleep = vi.fn(async () => {});
  const client = makeRecordingClient(
    'haiku',
    budget,
    { ANTHROPIC_API_KEY: 'fictional' },
    (row) => rows.push(row),
    { fetch, sleep },
  );
  await expect(client.judge(request)).rejects.toThrow(`answered ${status}`);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(reserve).toHaveBeenCalledTimes(4);
  expect(sleep).toHaveBeenCalledTimes(3);
  expect(budget.spent).toBeCloseTo(
    reserve.mock.calls.reduce((sum, [amount]) => sum + amount, 0),
    12,
  );
  expect(rows[0]).toMatchObject({
    status: 'error',
    accounting: 'reserved-on-error',
    chargedUsd: budget.spent,
  });
});

it('keeps the recorder inside the unchanged benchmark public API boundary', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  expect(
    execFileSync(process.execPath, ['tools/bench-lint.mjs', root], { cwd: root, encoding: 'utf8' }),
  ).toContain('Benchmark harness uses the public API only.');
});

it.each(['normal', 'large'] as const)(
  'preserves every frozen %s wire body, settings digest and request key',
  async (budgetName) => {
    for (const variant of [
      { ...request, criterionPromptVersion: 1, criterionDecoderVersion: 1 },
      { ...request, criterionPromptVersion: 2, criterionDecoderVersion: 2 },
      { ...request, criterionPromptVersion: 2, criterionDecoderVersion: 3 },
      { ...request, answerContract: 'legacy' },
      {
        ...request,
        answerContract: 'ledger',
        assessment: { kind: 'pairwise' },
        candidates: { A: 'Hello.', B: 'Go away.' },
        dialect: 'openai-json-schema',
      },
    ] as JudgeRequest[]) {
      const given = { ...variant, budget: budgetName };
      let oracleBody: string | undefined;
      const oracle = createDialectTransport({
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        env: { ANTHROPIC_API_KEY: 'fictional' },
        maxTokens: ROOM[budgetName],
        maxRetries: 0,
        timeoutMs: 300_000,
        fetch: async (_url, init) => {
          oracleBody = String(init.body);
          return receipt();
        },
      });
      const prepared = withJudgeDialect(given, oracle.dialect);
      const expected = await oracle.complete(buildPrompt(prepared));
      let actualBody: string | undefined;
      const client = makeRecordingClient(
        'haiku',
        new SpendBudget(1),
        { ANTHROPIC_API_KEY: 'fictional' },
        () => {},
        {
          fetch: async (_url, init) => {
            actualBody = String(init?.body);
            return receipt();
          },
        },
      );
      const actual = await client.judge(given);
      expect(actualBody).toBe(oracleBody);
      expect(actual).toEqual({ ...parseJudgeText(expected.text, prepared), costUsd: cost, requestCount: 1 });
      const transports = Object.fromEntries(
        Object.entries(ROOM).map(([name, maxTokens]) => [
          name,
          createDialectTransport({
            provider: 'anthropic',
            model: 'claude-haiku-5-5',
            env: { ANTHROPIC_API_KEY: 'offline' },
            maxTokens,
            maxRetries: 0,
            timeoutMs: 300_000,
          }),
        ]),
      );
      const settings = JSON.stringify({
        client: 'criterion-messages-api-v1',
        model: 'claude-haiku-5-5',
        anthropicVersion: '2023-06-01',
        temperature: 'omitted',
        maxTokens: ROOM,
        schema: 'none',
        transportFingerprints: Object.fromEntries(
          Object.entries(transports).map(([name, t]) => [name, t.fingerprint]),
        ),
      });
      expect(client.settings).toBe(settings);
      expect(
        createHash('sha256')
          .update(client.settings ?? '')
          .digest('hex'),
      ).toBe(createHash('sha256').update(settings).digest('hex'));
      expect(requestKey(given, client)).toBe(
        requestKey(given, { ...client, settings, dialect: oracle.dialect }),
      );
    }
  },
);

it.each(['refusal', 'max_tokens'] as const)('preserves full frozen %s result metadata', async (stop) => {
  const oracle = createDialectTransport({
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    env: { ANTHROPIC_API_KEY: 'fictional' },
    maxTokens: ROOM.normal,
    maxRetries: 0,
    timeoutMs: 300_000,
    fetch: async () => receipt(stop),
  });
  const reply = await oracle.complete(buildPrompt(request));
  const client = makeRecordingClient(
    'haiku',
    new SpendBudget(1),
    { ANTHROPIC_API_KEY: 'fictional' },
    () => {},
    { fetch: async () => receipt(stop) },
  );
  const expected =
    stop === 'refusal'
      ? { ...reply, answer: { outcome: 'inconclusive', reasoning: 'Provider declined' } }
      : {
          raw: reply.text,
          answer: { outcome: 'inconclusive', reasoning: 'Answer truncated' },
          unparsed: true,
        };
  expect(await client.judge(request)).toEqual({ ...expected, costUsd: cost, requestCount: 1 });
});

it('preserves Retry-After milliseconds and seconds without changing retry accounting', async () => {
  const sleep = vi.fn(async () => {});
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('Temporary failure', { status: 429, headers: { 'retry-after-ms': '125001' } }),
    )
    .mockResolvedValueOnce(
      new Response('Temporary failure', { status: 503, headers: { 'retry-after': '240' } }),
    )
    .mockResolvedValueOnce(receipt());
  const client = makeRecordingClient(
    'haiku',
    new SpendBudget(1),
    { ANTHROPIC_API_KEY: 'fictional' },
    () => {},
    { fetch, sleep },
  );
  expect(await client.judge(request)).toMatchObject({ costIncomplete: true, requestCount: 3 });
  expect(sleep.mock.calls).toEqual([[125001], [240000]]);
});

it('gives a long-thinking answer the default output room instead of cutting it', async () => {
  // A model that thinks by default spends its thinking from max_tokens; 3,000 thinking tokens plus a short answer
  // do not fit in the answer budget alone.
  const needed = 3000 + 200;
  expect(MAX_TOKENS.normal).toBeLessThan(needed);
  const sent: number[] = [];
  const client = makeRecordingClient(
    'haiku',
    new SpendBudget(1),
    { ANTHROPIC_API_KEY: 'fictional' },
    () => {},
    {
      fetch: async (_url, init) => {
        const limit = JSON.parse(String(init?.body)).max_tokens as number;
        sent.push(limit);
        return receipt(limit < needed ? 'max_tokens' : 'end_turn');
      },
    },
  );
  const result = await client.judge(request);
  expect(sent).toEqual([ROOM.normal]);
  expect(result.unparsed).toBeUndefined();
  expect(result.answer.outcome).toBe('pass');
});
