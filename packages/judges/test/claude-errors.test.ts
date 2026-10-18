import { expect, it } from 'vitest';
import { withClaudeErrorRetries } from '../src/clients/claude-errors';
import { ClaudeTransportError, createDialectTransport } from '../src/clients/transport';

const prompt = { system: 'Fictional private system text', user: 'Fictional private candidate text' };
function transport(payload: unknown, exit = 1, thenAnswer = false) {
  const script = `const f=require('node:fs');const n=f.existsSync('attempts')?Number(f.readFileSync('attempts','utf8')):0;f.writeFileSync('attempts',String(n+1));let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const p=${JSON.stringify(payload)};if(${thenAnswer}&&n===2){process.stdout.write(JSON.stringify({type:'result',subtype:'success',result:'a returned answer',total_cost_usd:.01}));}else{process.stdout.write(JSON.stringify(p));process.exitCode=${exit};}});`;
  return createDialectTransport({
    provider: 'claude-cli',
    model: 'fictional',
    env: { ANTHROPIC_API_KEY: 'fictional-secret-key' },
    command: process.execPath,
    commandArgs: ['--eval', script, '--'],
    sleep: async () => {},
  });
}
it('keeps sanitized body and exit status, with overload classification', async () => {
  const payload = {
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: `API Error: 529 overloaded_error key=fictional-secret-key ${prompt.user}`,
    request: { system: prompt.system },
    total_cost_usd: 0.02,
  };
  try {
    await transport(payload, 7).complete(prompt);
    throw Error('expected failure');
  } catch (e) {
    if (!(e instanceof ClaudeTransportError)) throw e;
    expect(e).toMatchObject({
      category: 'overload',
      status: 529,
      retryable: true,
      exitCode: 7,
      requestCount: 3,
      costUsd: 0.06,
    });
    expect(e.raw).toContain('overloaded_error');
    expect(e.raw).not.toContain('fictional-secret-key');
    expect(e.raw).not.toContain(prompt.user);
    expect(e.raw).not.toContain(prompt.system);
  }
});
it.each([
  ['rate-limit', { is_error: true, result: 'API Error: 429 rate_limit_error' }, true, 3],
  [
    'output-limit',
    {
      is_error: true,
      api_error: 'max_output_tokens',
      result: "API Error: Claude's response exceeded the 16384 output token maximum.",
    },
    false,
    // One low-effort thinking recovery is submitted before the output-limit error is terminal.
    2,
  ],
  ['auth', { is_error: true, result: 'API Error: 401 authentication_error' }, false, 1],
  ['other', { is_error: true, result: 'unrecognized failure' }, false, 1],
] as const)('classifies %s and bounds submissions', async (category, body, retryable, count) => {
  const error = await transport({ type: 'result', subtype: 'success', ...body })
    .complete(prompt)
    .then(
      () => undefined,
      (e: unknown) => e as { requestCount: number; retryReceipts: unknown[]; thinkingRecovery?: unknown },
    );
  expect(error).toMatchObject({ category, retryable, requestCount: count });
  if (category === 'output-limit') {
    // Both submissions belong to the thinking recovery: the retry layer made zero retries.
    expect(error?.thinkingRecovery).toMatchObject({ requestCount: 2 });
    expect(error?.retryReceipts).toEqual([]);
  }
});
it('recovers transient no-answer calls under the existing policy', async () => {
  const r = await transport(
    {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      result: 'API Error: 529 overloaded_error',
      total_cost_usd: 0.02,
    },
    1,
    true,
  ).complete(prompt);
  expect(r.text).toBe('a returned answer');
  expect(r.requestCount).toBe(3);
  expect(r.costUsd).toBeCloseTo(0.05);
});
it.each(['success', 'error_during_execution'])(
  'never re-asks a returned answer with subtype %s and overload metadata',
  async (subtype) => {
    await expect(
      transport(
        {
          type: 'result',
          subtype,
          is_error: true,
          result: 'A returned candidate assessment.',
          errors: ['overloaded_error'],
        },
        1,
      ).complete(prompt),
    ).rejects.toMatchObject({ returnedAnswer: true, retryable: false, requestCount: 1 });
  },
);
it('preserves successful request fingerprints and has no retry metadata on success', async () => {
  const t = transport({ type: 'result', subtype: 'success', result: 'A returned answer.' }, 0);
  const first = await t.complete(prompt),
    second = await t.complete(prompt);
  expect(first.fingerprint).toBe(second.fingerprint);
  expect(first.text).toBe('A returned answer.');
  expect(first.retryReceipts).toBeUndefined();
});
it('keeps the exact CLI arguments and stdin unchanged on success', async () => {
  const script = `let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({type:'result',subtype:'success',result:JSON.stringify({argv:process.argv.slice(1),input})})));`;
  const t = createDialectTransport({
    provider: 'claude-cli',
    model: 'fictional',
    env: {},
    command: process.execPath,
    commandArgs: ['--eval', script, '--'],
  });
  const r = await t.complete(prompt);
  expect(JSON.parse(r.text)).toEqual({
    argv: [
      '-p',
      '--output-format',
      'json',
      '--model',
      'fictional',
      '--system-prompt',
      prompt.system,
      '--tools',
      '',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--max-turns',
      '1',
    ],
    input: prompt.user,
  });
  expect(r.requestCount).toBeUndefined();
});
it('honors an explicit one-submission policy', async () => {
  let count = 0;
  await expect(
    withClaudeErrorRetries(
      async () => {
        count++;
        return {
          stdout: JSON.stringify({
            type: 'result',
            is_error: true,
            result: 'API Error: 429 rate_limit_error',
          }),
          code: 1,
        };
      },
      { ...prompt, env: {} },
      { maxRetries: 0 },
    ),
  ).rejects.toMatchObject({ requestCount: 1 });
  expect(count).toBe(1);
});
it('retains prior receipts without hiding a later process failure', async () => {
  let count = 0;
  const failure = new Error('fictional process failure');
  await expect(
    withClaudeErrorRetries(
      async () => {
        if (count++ > 0) throw failure;
        return {
          stdout: JSON.stringify({
            type: 'result',
            is_error: true,
            result: 'API Error: 529 overloaded_error',
            total_cost_usd: 0.01,
          }),
          code: 1,
        };
      },
      { ...prompt, env: {} },
      { sleep: async () => {} },
    ),
  ).rejects.toBe(failure);
  expect(failure).toMatchObject({
    requestCount: 2,
    retryReceipts: [{ costUsd: 0.01, category: 'overload' }],
  });
});
it('preserves sanitized stderr even when stdout is a JSON envelope', () => {
  const error = new ClaudeTransportError(
    'http',
    'failed',
    { stdout: '{}', stderr: `API Error: 401 Bearer fictional-secret-key ${prompt.user}`, code: 7 },
    { type: 'result', is_error: true },
    { ...prompt, env: { API_KEY: 'fictional-secret-key' } },
  );
  expect(error).toMatchObject({ category: 'auth', status: 401, exitCode: 7 });
  expect(error.stderr).toContain('API Error: 401');
  expect(JSON.stringify(error)).not.toContain('fictional-secret-key');
  expect(JSON.stringify(error)).not.toContain(prompt.user);
});
