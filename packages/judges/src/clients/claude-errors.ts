import { retrying, retryPolicy } from '@agent-nexus/driftbench-core';
import { type HttpOptions, isRecord, JudgeError } from '../http';
export type ClaudeFailureCategory = 'overload' | 'rate-limit' | 'output-limit' | 'auth' | 'other';
export type ClaudeProcessResult = { stdout: string; stderr?: string; code: number | null };
export type ClaudeErrorContext = { system: string; user: string; env: Record<string, string | undefined> };
export type ClaudeRetryReceipt = {
  raw: string;
  exitCode: number | null;
  category: ClaudeFailureCategory;
  costUsd?: number;
  usage?: Readonly<Record<string, unknown>>;
};

function redact(value: unknown, context?: ClaudeErrorContext): unknown {
  const secrets = context
    ? Object.entries(context.env)
        .filter(([k]) => /key|token|secret|password|authorization|credential/i.test(k))
        .map(([, v]) => v)
        .filter((v): v is string => !!v)
    : [];
  const prompts = context
    ? [context.system, context.user, ...context.system.split('\n'), ...context.user.split('\n')].filter(
        (v) => v.length >= 4,
      )
    : [];
  const scrub = (s: string) => {
    for (const v of [...secrets, ...prompts].sort((a, b) => b.length - a.length))
      s = s.split(v).join('[redacted]');
    return s
      .replace(/\b(Bearer\s+)[^\s"'<>]+/gi, '$1[redacted]')
      .replace(/\b((?:api[-_ ]?key|authorization|token|password)\s*[:=]\s*)[^\s"'<>]+/gi, '$1[redacted]');
  };
  const visit = (v: unknown): unknown =>
    typeof v === 'string'
      ? scrub(v)
      : Array.isArray(v)
        ? v.map(visit)
        : isRecord(v)
          ? Object.fromEntries(
              Object.entries(v)
                .filter(
                  ([k]) =>
                    !/^(request|prompt|system|user|messages|headers|authorization|api[_-]?key)$/i.test(k),
                )
                .map(([k, x]) => [k, visit(x)]),
            )
          : v;
  return visit(value);
}
function classification(
  payload: unknown,
  text: string,
): { category: ClaudeFailureCategory; status?: number; returnedAnswer: boolean } {
  const p = isRecord(payload) ? payload : {};
  const error = isRecord(p.error) ? p.error : {};
  const statusValue = p.status ?? p.status_code ?? error.status ?? error.status_code;
  const status =
    typeof statusValue === 'number'
      ? statusValue
      : Number(/\b(?:API Error:|HTTP|status)\s*(\d{3})\b/i.exec(text)?.[1]) || undefined;
  const result = typeof p.result === 'string' ? p.result.trim() : '';
  const returnedAnswer =
    (p.structured_output !== undefined && p.structured_output !== null) ||
    (!!result &&
      !/^(?:API Error:|Error:|Request failed|You've hit your limit|Rate limit|Overloaded)/i.test(result));
  const category: ClaudeFailureCategory =
    /max_output_tokens|output token maximum|maximum output tokens/i.test(text)
      ? 'output-limit'
      : status === 401 ||
          status === 403 ||
          /authentication_error|invalid.api.key|not.authenticated|not.logged.in|login.required/i.test(text)
        ? 'auth'
        : status === 429 || /rate_limit_error|rate.limit|quota.exceeded|hit your limit/i.test(text)
          ? 'rate-limit'
          : (status !== undefined && status >= 500) ||
              /overloaded_error|overloaded|overload_error/i.test(text)
            ? 'overload'
            : 'other';
  return { category, ...(status === undefined ? {} : { status }), returnedAnswer };
}
/** Sanitized provider evidence, never the submitted prompt, credentials or request headers. */
export class ClaudeTransportError extends JudgeError {
  readonly raw: string;
  readonly body: unknown;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly category: ClaudeFailureCategory;
  readonly returnedAnswer: boolean;
  readonly usage?: Readonly<Record<string, unknown>>;
  readonly costUsd?: number;
  readonly requestCount: number = 1;
  readonly retryReceipts?: readonly ClaudeRetryReceipt[];
  /** A retryable failure that was not retried: the spend cap could not cover another process. */
  readonly retrySkipped?: 'spend-cap';
  /** A process of the call reported no cost or never returned: costUsd is absent, never a part. */
  readonly costIncomplete?: true;
  constructor(
    code: 'http' | 'bad_response',
    message: string,
    ran: ClaudeProcessResult,
    payload?: unknown,
    context?: ClaudeErrorContext,
  ) {
    const body = redact(payload, context);
    const raw =
      payload === undefined ? String(redact(ran.stdout || ran.stderr || '', context)) : JSON.stringify(body);
    const stderr = String(redact(ran.stderr ?? '', context));
    const info = classification(body, `${JSON.stringify(body ?? '')} ${stderr}`);
    super(code, `${message}: ${raw.slice(0, 500)}`, {
      ...('status' in info ? { status: info.status } : {}),
      retryable: !info.returnedAnswer && (info.category === 'overload' || info.category === 'rate-limit'),
    });
    this.name = 'ClaudeTransportError';
    this.raw = raw;
    this.body = body;
    this.stderr = stderr;
    this.exitCode = ran.code;
    this.category = info.category;
    this.returnedAnswer = info.returnedAnswer;
    if (isRecord(payload)) {
      if (isRecord(body) && isRecord(body.usage)) this.usage = body.usage;
      if (
        typeof payload.total_cost_usd === 'number' &&
        Number.isFinite(payload.total_cost_usd) &&
        payload.total_cost_usd >= 0
      )
        this.costUsd = payload.total_cost_usd;
    }
  }
}
/** Every process one judge call may start: transient retries and the thinking recovery together. */
export const CLAUDE_SUBMISSION_CEILING = 3;
/**
 * No answer: retry transient provider failures only, with a ceiling of three submissions. A run that starts
 * more than one process per attempt passes `submitted`, the count of processes started so far. A run under
 * a spend cap passes `affordable`: false stops the retries and marks the failure `retrySkipped`.
 */
export async function withClaudeErrorRetries<T extends ClaudeProcessResult>(
  run: () => Promise<T>,
  context: ClaudeErrorContext,
  options: HttpOptions,
  budget: { submitted?: () => number; affordable?: () => boolean } = {},
): Promise<{
  ran: T;
  retryReceipts?: readonly ClaudeRetryReceipt[];
  requestCount?: number;
  costUsd?: number;
}> {
  const receipts: ClaudeRetryReceipt[] = [];
  let count = 0;
  const physical = () => budget.submitted?.() ?? count;
  let last: ClaudeTransportError | undefined;
  const aggregate = (cost?: number) =>
    cost !== undefined && receipts.every((r) => r.costUsd !== undefined)
      ? cost + receipts.reduce((n, r) => n + (r.costUsd ?? 0), 0)
      : undefined;
  const configured = retryPolicy(
    options.retry,
    options.maxRetries === undefined ? undefined : { maxAttempts: options.maxRetries + 1 },
  );
  try {
    return await retrying(
      'Claude judge',
      async () => {
        count++;
        let ran: T;
        try {
          ran = await run();
        } catch (error) {
          // A later process failure must not be hidden by the previous provider error.
          last = undefined;
          if (error instanceof Error)
            Object.assign(error, { requestCount: physical(), retryReceipts: [...receipts] });
          throw error;
        }
        let p: unknown;
        try {
          p = JSON.parse(ran.stdout);
        } catch {
          p = undefined;
        }
        if (!isRecord(p) || p.type !== 'result' || p.is_error === true || ran.code !== 0) {
          const error = new ClaudeTransportError(
            !isRecord(p) || p.type !== 'result' ? 'bad_response' : 'http',
            !isRecord(p) || p.type !== 'result'
              ? ran.code !== 0
                ? `claude exited ${ran.code}`
                : 'claude printed not a JSON result'
              : 'claude returned an error result',
            ran,
            p,
            context,
          );
          receipts.push({
            raw: error.raw,
            exitCode: error.exitCode,
            category: error.category,
            ...(error.costUsd === undefined ? {} : { costUsd: error.costUsd }),
            ...(error.usage ? { usage: error.usage } : {}),
          });
          last = error;
          const costs = receipts.every((r) => r.costUsd !== undefined)
            ? receipts.reduce((n, r) => n + (r.costUsd ?? 0), 0)
            : undefined;
          Object.assign(error, {
            requestCount: physical(),
            retryReceipts: [...receipts],
            costUsd: costs,
          });
          throw error;
        }
        const cost = typeof p.total_cost_usd === 'number' ? aggregate(p.total_cost_usd) : undefined;
        return {
          ran,
          ...(count > 1
            ? {
                requestCount: physical(),
                retryReceipts: [...receipts],
                ...(cost === undefined ? {} : { costUsd: cost }),
              }
            : {}),
        };
      },
      {
        policy: { ...configured, maxAttempts: Math.min(CLAUDE_SUBMISSION_CEILING, configured.maxAttempts) },
        ...(options.sleep ? { sleep: options.sleep } : {}),
        decide: (error) => {
          const wanted =
            error instanceof ClaudeTransportError &&
            error.retryable &&
            physical() < CLAUDE_SUBMISSION_CEILING;
          const affordable = !wanted || (budget.affordable?.() ?? true);
          if (!affordable) Object.assign(error, { retrySkipped: 'spend-cap' });
          return {
            retry: wanted && affordable,
            status: error instanceof JudgeError ? error.status : undefined,
            reason: error instanceof Error ? error.message : 'Claude transport error',
          };
        },
      },
    );
  } catch (error) {
    if (last) throw last;
    throw error;
  }
}
