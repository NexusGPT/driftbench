import { referenceConsensus } from './answer-extraction';
import type { JudgeClient } from './client';

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
  return {
    ...client,
    async judge(request) {
      if (request.reference !== undefined) return client.judge(request);
      const question = request.transcript
        .filter((entry) => entry.role === 'user')
        .map((entry) => entry.text)
        .join('\n');
      if (!question.trim()) return client.judge(request);
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
      const consensus = referenceConsensus(answers, options);
      const result = await client.judge(
        consensus.reference === undefined ? request : { ...request, reference: consensus.reference },
      );
      return {
        ...result,
        ...(cost > 0 ? { costUsd: cost + (result.costUsd ?? 0) } : {}),
        referenceAgreement: {
          attempts: consensus.attempts,
          agreement: consensus.agreement,
          used: consensus.reference !== undefined,
        },
      };
    },
  };
}
