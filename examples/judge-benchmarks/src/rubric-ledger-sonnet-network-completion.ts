import type { DialectTransport } from '@agent-nexus/driftbench-judges';
import type { LedgerCompletion } from './rubric-ledger-calls';

export const nativeSessionLimit = (text: string) => /rate.?limit|usage.?limit|hit your limit|session limit|out of extra usage|limit reached/i.test(text);

/** A CLI error banner with zero generated tokens is not a model answer. */
export function nativeNoAnswerError(completion: LedgerCompletion): Error | undefined {
  let raw: any;
  try { raw = JSON.parse(completion.raw); } catch { return; }
  if (!raw.is_error || raw.usage?.output_tokens !== 0 ||
      typeof raw.result !== 'string' || (!raw.result.startsWith('API Error:') && !nativeSessionLimit(raw.result)) ||
      raw.result.includes('https://www.anthropic.com/legal/aup')) return;
  const status = nativeSessionLimit(raw.result) ? 429 : Number(raw.result.match(/^API Error:\s*(\d{3})\b/)?.[1]);
  const connection = /network|transport|ECONN|ENOTFOUND|EAI_AGAIN|timed? ?out|timeout|socket|connection|unable to connect/i.test(raw.result);
  if (!connection && status !== 402 && status !== 429 && !(status >= 500 && status <= 599)) return;
  return Object.assign(new Error(`Native CLI no-answer transport: ${raw.result}`), {
    retryable: true, ...(Number.isFinite(status) ? { status } : { code: 'network' }),
    completion: { ...completion, text: '' },
  });
}

export function withNativeNoAnswerClassification(transport: DialectTransport): DialectTransport {
  return { ...transport, async complete(request) {
    let completion;
    try { completion = await transport.complete(request); }
    catch (error) {
      // The frozen parser throws this only when both result text and output tokens are absent.
      if (error instanceof Error && error.message.startsWith('claude process error:') && nativeSessionLimit(error.message))
        throw Object.assign(error, { status: 429, retryable: true, retryAfterMs: 600000 });
      throw error;
    }
    const error = nativeNoAnswerError(completion as LedgerCompletion);
    if (error) throw error;
    return completion;
  } };
}
