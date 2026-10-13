import { referenceConsensus } from './answer-extraction';
import type { JudgeClient } from './client';
import type { JudgeRequest, JudgeResult } from './contract';

export type ReferenceSolve = { readonly answer?: string; readonly costUsd?: number };
export type ReferenceOptions = {
  /** Blind solve port: receives the user question only, never a candidate answer or benchmark label. */
  readonly solve: (question: string, attempt: number) => Promise<ReferenceSolve>;
  readonly samples?: number;
  readonly minAgreement?: number;
  readonly normalize?: (answer: string) => string;
};

/** Optional reference generation. Agreement is evidence of consistency, not proof that a solve is correct. */
export function withReferenceConsensus(client: JudgeClient, options: ReferenceOptions): JudgeClient {
  const samples = options.samples ?? 5;
  if (!Number.isInteger(samples) || samples < 2 || samples > 20)
    throw new RangeError('reference samples must be an integer from 2 to 20');
  referenceConsensus([], options);
  const solve = async (question: string) => {
    const answers: (string | undefined)[] = [];
    let cost = 0;
    for (let i = 0; i < samples; i += 1) {
      try {
        const result = await options.solve(question, i);
        if (result.costUsd !== undefined) {
          if (!Number.isFinite(result.costUsd) || result.costUsd < 0)
            throw new RangeError('solve cost must be finite and nonnegative');
          cost += result.costUsd;
        }
        answers.push(result.answer);
      } catch {
        answers.push(undefined);
      }
    }
    return { ...referenceConsensus(answers, options), cost };
  };
  const run = async (
    requests: readonly JudgeRequest[],
    judge: (prepared: readonly JudgeRequest[]) => Promise<JudgeResult>,
  ): Promise<JudgeResult> => {
    // Only the blind question is shared, and only inside this one comparison.
    const solves = new Map<string, Awaited<ReturnType<typeof solve>>>();
    const prepared: JudgeRequest[] = [];
    for (const request of requests) {
      const question = request.transcript
        .filter((entry) => entry.role === 'user')
        .map((entry) => entry.text)
        .join('\n');
      if (request.reference !== undefined || !question.trim()) {
        prepared.push(request);
        continue;
      }
      const consensus = solves.get(question) ?? (await solve(question));
      solves.set(question, consensus);
      prepared.push({
        ...request,
        ...(consensus.reference === undefined
          ? { referenceDisagreement: true }
          : { reference: consensus.reference }),
      });
    }
    const result = await judge(prepared);
    if (solves.size === 0) return result;
    const rows = [...solves.values()];
    const cost = rows.reduce((sum, row) => sum + row.cost, 0);
    const attempts = rows.reduce((sum, row) => sum + row.attempts, 0);
    return {
      ...result,
      ...(cost > 0 ? { costUsd: cost + (result.costUsd ?? 0) } : {}),
      referenceAgreement: {
        attempts,
        agreement: rows.reduce((sum, row) => sum + row.agreement * row.attempts, 0) / attempts,
        used: rows.every((row) => row.reference !== undefined),
      },
    };
  };
  const compare = client.judgeComparison?.bind(client);
  return {
    ...client,
    judge: (request) => run([request], async ([prepared]) => client.judge(prepared as JudgeRequest)),
    ...(compare
      ? {
          judgeComparison: (ordered: JudgeRequest, swapped: JudgeRequest) =>
            run([ordered, swapped], async ([a, b]) => compare(a as JudgeRequest, b as JudgeRequest)),
        }
      : {}),
  };
}
