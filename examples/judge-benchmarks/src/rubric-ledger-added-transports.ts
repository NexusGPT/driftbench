import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDialectRequest, type DialectTransport } from '@agent-nexus/driftbench-judges';
import { CLAUDE_JUDGE_FLAGS, runClaudeCommand } from '../../../packages/judges/src/clients/claude-cli';
import { JUDGE_DIALECTS } from '../../../packages/judges/src/clients/dialects';
import { sha } from './rubric-ledger-live';
import type { LedgerCompletion } from './rubric-ledger-calls';

export const ADDED_MODELS = ['claude-sonnet-5-5', 'gpt-6.1-sol'] as const;
export type AddedModel = typeof ADDED_MODELS[number];
export const ADDED_LIMITS = { maxOutputTokens: 8192, timeoutMs: 300000, reserveUsd: .25, capUsd: 25 } as const;
export const OPENAI_PRICE = { input: 2, cachedInput: .10, cacheWrite: 2.50, output: 10,
  longInput: 4, longCachedInput: .20, longCacheWrite: 5, longOutput: 15,
  source: 'https://developers.openai.com/api/docs/pricing', readUtc: '2026-10-13', serviceTier: 'default' } as const;

export function responsesBody(request: { system: string; user: string; schema?: Readonly<Record<string, unknown>> }) {
  return { model: 'gpt-6.1-sol', service_tier: 'default', store: false,
    input: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
    reasoning: { effort: 'medium' }, max_output_tokens: ADDED_LIMITS.maxOutputTokens,
    ...(request.schema ? { text: { format: { type: 'json_schema', name: 'judge_answer', strict: true, schema: request.schema } } } : {}) };
}

export function responsesCompletion(value: any): Omit<LedgerCompletion, 'fingerprint'> {
  const content = (value.output ?? []).flatMap((part: any) => part.type === 'message' ? part.content ?? [] : []);
  const text = content.filter((part: any) => part.type === 'output_text').map((part: any) => part.text ?? '').join('');
  const refusal = content.find((part: any) => part.type === 'refusal')?.refusal;
  const reason = value.incomplete_details?.reason ?? value.status;
  return { text, raw: JSON.stringify(value), usage: { input: value.usage?.input_tokens, output: value.usage?.output_tokens },
    finishReason: reason, ...(reason === 'max_output_tokens' ? { truncated: true } : {}),
    ...(refusal ? { refusal } : reason === 'content_filter' ? { refusal: reason } : {}) };
}

export function responsesPrice(completion: LedgerCompletion): number | undefined {
  const { input, output } = completion.usage ?? {};
  if (input === undefined || output === undefined) return undefined;
  const details = JSON.parse(completion.raw).usage?.input_tokens_details ?? {};
  const cached = Math.min(input, details.cached_tokens ?? 0);
  const writes = Math.min(input - cached, details.cache_write_tokens ?? details.cache_creation_tokens ?? 0);
  const long = input > 272000;
  return ((input - cached - writes) * (long ? OPENAI_PRICE.longInput : OPENAI_PRICE.input) +
    cached * (long ? OPENAI_PRICE.longCachedInput : OPENAI_PRICE.cachedInput) +
    writes * (long ? OPENAI_PRICE.longCacheWrite : OPENAI_PRICE.cacheWrite) +
    output * (long ? OPENAI_PRICE.longOutput : OPENAI_PRICE.output)) / 1e6;
}

export function responsesTransport(apiKey: string, fetcher: typeof fetch = fetch): DialectTransport {
  const dialect = JUDGE_DIALECTS.openai.id;
  const fingerprint = sha(JSON.stringify({ endpoint: 'https://api.openai.com/v1/responses', model: 'gpt-6.1-sol',
    dialect, reasoning: 'medium', limits: ADDED_LIMITS, serviceTier: 'default', temperature: 'omitted' }));
  return { dialect, reasoning: 'medium', fingerprint, async complete(request) {
    const body = responsesBody(request);
    let response: Response;
    try { response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(ADDED_LIMITS.timeoutMs) });
    } catch (error) { throw Object.assign(new Error(`Responses transport: ${error instanceof Error ? error.message : String(error)}`), { retryable: true }); }
    let raw: string;
    try { raw = await response.text(); }
    catch (error) { throw Object.assign(new Error(`Responses body transport: ${error instanceof Error ? error.message : String(error)}`), { retryable: true }); }
    if (!response.ok) throw Object.assign(new Error(`Responses answered ${response.status}: ${raw}`), {
      status: response.status, retryable: response.status === 429 || response.status >= 500,
      ...(response.headers.get('retry-after') && Number.isFinite(Number(response.headers.get('retry-after')))
        ? { retryAfterMs: Number(response.headers.get('retry-after')) * 1000 } : {}) });
    // An HTTP-success response is consumed once even if its envelope is malformed.
    let completion: Omit<LedgerCompletion, 'fingerprint'>;
    try { completion = responsesCompletion(JSON.parse(raw)); }
    catch { completion = { text: '', raw, finishReason: 'invalid-response-envelope' }; }
    return { ...completion, dialect, fingerprint: sha(JSON.stringify({ transport: fingerprint, body })) };
  } };
}

export function sonnetEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY',
    'OPENAI_BASE_URL', 'GOOGLE_BASE_URL', 'ANTHROPIC_BASE_URL', 'CLAUDECODE', 'MAX_THINKING_TOKENS',
    'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING', 'CLAUDE_CODE_RETRY_WATCHDOG']) delete env[key];
  return { ...env, CLAUDE_JUDGE_MODEL: 'sonnet', CLAUDE_CODE_EFFORT_LEVEL: 'medium',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(ADDED_LIMITS.maxOutputTokens), CLAUDE_CODE_MAX_RETRIES: '0',
    CLAUDE_CODE_NONSTREAMING_TIMEOUT_RETRIES: '0' };
}

export function sonnetCompletion(value: any): Omit<LedgerCompletion, 'fingerprint'> {
  if (value?.type !== 'result') throw Object.assign(new Error('claude returned no JSON result'), { retryable: true });
  const text = typeof value.result === 'string' ? value.result : '';
  const usage = value.usage ?? {};
  const output = usage.output_tokens ?? Object.values(value.modelUsage ?? {}).reduce((s: number, row: any) => s + (row.outputTokens ?? 0), 0);
  const stopped = /max_turns|max_budget|max_tokens/.test(value.subtype ?? '');
  // A returned generation is a judge result even if the CLI labels it an error.
  if (value.is_error && !text && !output && !stopped)
    throw Object.assign(new Error(`claude process error: ${JSON.stringify(value.errors ?? value.subtype)}`), { retryable: true });
  return { text, raw: JSON.stringify(value), costUsd: value.total_cost_usd,
    usage: { input: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), output },
    finishReason: value.subtype, ...(value.subtype !== 'success' ? { truncated: true } : {}) };
}

export function sonnetTransport(env = sonnetEnvironment(process.env)): DialectTransport {
  const dialect = JUDGE_DIALECTS['claude-cli'].id;
  const fingerprint = sha(JSON.stringify({ model: 'claude-sonnet-5-5', alias: 'sonnet', dialect,
    flags: CLAUDE_JUDGE_FLAGS, limits: ADDED_LIMITS, effort: 'medium', innerRetries: 0 }));
  const folder = mkdtempSync(join(tmpdir(), 'driftbench-sonnet-lean-'));
  return { dialect, fingerprint, async complete(request) {
    const built = buildDialectRequest('claude-cli', request);
    const ran = await runClaudeCommand('claude', ['-p', '--output-format', 'json', '--model', 'sonnet',
      '--system-prompt', request.system, ...CLAUDE_JUDGE_FLAGS, '--max-budget-usd', String(ADDED_LIMITS.reserveUsd)],
      built.payload.user as string, { cwd: folder, env, timeoutMs: ADDED_LIMITS.timeoutMs });
    let value: unknown;
    try { value = JSON.parse(ran.stdout); }
    catch { throw Object.assign(new Error(`claude exited ${ran.code} without a JSON result: ${ran.stderr}`), { retryable: true }); }
    return { ...sonnetCompletion(value), dialect, fingerprint: sha(JSON.stringify({ transport: fingerprint, request: built.fingerprint })) };
  } };
}
