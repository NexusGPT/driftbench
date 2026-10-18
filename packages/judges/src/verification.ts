import type { JudgeClient } from './client';
import { inconclusive, type JudgeRequest, type JudgeResult } from './contract';

/** Provider-neutral sandbox port. Implementations must isolate any general-purpose code they run. */
export interface JudgeSandbox {
  verify(request: JudgeRequest, signal: AbortSignal): Promise<readonly ArithmeticCheck[]>;
}
export type ArithmeticCheck = {
  readonly expression: string;
  readonly claimed: number;
  readonly actual: number;
  readonly matches: boolean;
};
export type VerificationOptions = {
  readonly enabled?: boolean;
  readonly sandbox: JudgeSandbox;
  readonly timeoutMs?: number;
};

/** Disabled by default. A failed verification never silently turns into an unverified pass. */
export function withVerification(client: JudgeClient, options: VerificationOptions): JudgeClient {
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError('verification timeout must be positive and finite');
  const prepare = async (
    request: JudgeRequest,
  ): Promise<{ request: JudgeRequest } | { failure: JudgeResult }> => {
    if (options.enabled !== true) return { request };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const evidence = await Promise.race([
        options.sandbox.verify(request, controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('verification timeout'));
          }, timeoutMs);
        }),
      ]);
      return {
        request:
          evidence.length === 0
            ? request
            : {
                ...request,
                transcript: [
                  ...request.transcript,
                  { role: 'tool_result', tool: 'judge.arithmetic', text: JSON.stringify(evidence) },
                ],
              },
      };
    } catch (cause) {
      return {
        failure: {
          raw: '',
          answer: inconclusive(
            `verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
        },
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const compare = client.judgeComparison?.bind(client);
  return {
    ...client,
    async judge(request) {
      const prepared = await prepare(request);
      return 'failure' in prepared ? prepared.failure : client.judge(prepared.request);
    },
    ...(compare
      ? {
          async judgeComparison(ordered: JudgeRequest, swapped: JudgeRequest) {
            const failedComparison = (failure: JudgeResult): JudgeResult => ({
              ...failure,
              comparison: {
                ordered: 'inconclusive',
                swapped: 'inconclusive',
                consistent: true,
                positionBias: false,
              },
            });
            const a = await prepare(ordered);
            if ('failure' in a) return failedComparison(a.failure);
            const b = await prepare(swapped);
            if ('failure' in b) return failedComparison(b.failure);
            // Both orders must be verified before any judge can run.
            return compare(a.request, b.request);
          },
        }
      : {}),
  };
}

/**
 * A bounded arithmetic language, with no eval, imports, filesystem, process or network capabilities.
 * It checks explicit numeric equations only. It cannot prove a natural-language or symbolic solution.
 */
export function arithmeticSandbox(): JudgeSandbox {
  return {
    async verify(request, signal) {
      const results: ArithmeticCheck[] = [];
      const texts = request.transcript
        .filter(
          (entry) => entry.role === 'agent' || (entry.role === 'context' && /^Reply [AB]:/.test(entry.text)),
        )
        .map((entry) => entry.text);
      if (request.artifact !== undefined) texts.push(request.artifact);
      const pattern = /(?<![\w.*])([\d.()+\-*/\s]{1,160})=\s*(-?\d+(?:\.\d+)?)(?!\d)/g;
      for (const text of texts) {
        // A bounded scan: no regex or evaluation consumes unbounded model output.
        for (const match of text.slice(0, 200_000).matchAll(pattern)) {
          if (signal.aborted) throw new Error('verification aborted');
          if (results.length >= 100) return results;
          const expression = match[1]?.trim() ?? '';
          if (!/[+*/-]/.test(expression) || expression.includes('**')) continue;
          const actual = evaluateArithmetic(expression);
          if (actual === undefined) continue;
          const claimed = Number(match[2]);
          results.push({
            expression,
            claimed,
            actual,
            matches: Math.abs(actual - claimed) <= 1e-9 * Math.max(1, Math.abs(actual), Math.abs(claimed)),
          });
        }
      }
      return results;
    },
  };
}

/** Recursive descent over numeric tokens only. No source text ever reaches a JavaScript evaluator. */
function evaluateArithmetic(expression: string): number | undefined {
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  if (tokens.length > 80 || tokens.join('') !== expression.replace(/\s/g, '')) return undefined;
  let at = 0;
  const atom = (): number => {
    const token = tokens[at++];
    if (token === '+' || token === '-') return (token === '-' ? -1 : 1) * atom();
    if (token === '(') {
      const n = sum();
      if (tokens[at++] !== ')') throw new Error('parenthesis');
      return n;
    }
    if (token === undefined || !/^\d/.test(token)) throw new Error('number');
    return Number(token);
  };
  const product = (): number => {
    let n = atom();
    while (tokens[at] === '*' || tokens[at] === '/') {
      const op = tokens[at++];
      const right = atom();
      n = op === '*' ? n * right : n / right;
    }
    return n;
  };
  const sum = (): number => {
    let n = product();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const op = tokens[at++];
      const right = product();
      n = op === '+' ? n + right : n - right;
    }
    return n;
  };
  try {
    const value = sum();
    return at === tokens.length && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
