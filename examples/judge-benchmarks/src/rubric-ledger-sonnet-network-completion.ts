import type { DialectTransport } from '@agent-nexus/driftbench-judges';
import type { LedgerCompletion } from './rubric-ledger-calls';

/** A CLI error banner with zero generated tokens is not a model answer. */
export function nativeNoAnswerError(completion: LedgerCompletion): Error | undefined {
  let raw: any;
  try { raw = JSON.parse(completion.raw); } catch { return; }
  if (!raw.is_error || raw.usage?.output_tokens !== 0 ||
      typeof raw.result !== 'string' || !raw.result.startsWith('API Error:') ||
      raw.result.includes('https://www.anthropic.com/legal/aup')) return;
  const status = Number(raw.result.match(/^API Error:\s*(\d{3})\b/)?.[1]);
  const connection = /network|transport|ECONN|ENOTFOUND|EAI_AGAIN|timed? ?out|timeout|socket|connection|unable to connect/i.test(raw.result);
  if (!connection && status !== 402 && status !== 429 && !(status >= 500 && status <= 599)) return;
  return Object.assign(new Error(`Native CLI no-answer transport: ${raw.result}`), {
    retryable: true, ...(Number.isFinite(status) ? { status } : { code: 'network' }),
    completion: { ...completion, text: '' },
  });
}

export function withNativeNoAnswerClassification(transport: DialectTransport): DialectTransport {
  return { ...transport, async complete(request) {
    const completion = await transport.complete(request);
    const error = nativeNoAnswerError(completion as LedgerCompletion);
    if (error) throw error;
    return completion;
  } };
}
