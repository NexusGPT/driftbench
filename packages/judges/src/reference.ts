import { referenceConsensus } from './answer-extraction';
import type { JudgeClient } from './client';
import type { JudgeRequest, JudgeResult } from './contract';

export type ReferenceSolve = { readonly answer?: string; readonly costUsd?: number };
export type ReferenceOptions = {
  /** Blind solve port: receives the user question only, never a candidate answer or benchmark label. */
  readonly solve: (question: string, attempt: number) => Promise<ReferenceSolve>;
  /** Number of solves, from 1 to 20. Default 5. One solve provides no independent agreement check. */
  readonly samples?: number;
  readonly minAgreement?: number;
  readonly normalize?: (answer: string) => string;
  /** Default: always solve. Auto asks whether the question has one checkable correct answer first. */
  readonly route?: 'auto';
  /** Optional question-only YES/NO port for auto routing. Default: the wrapped client's answer contract. */
  readonly check?: (question: string) => Promise<ReferenceSolve>;
};

const CHECKABILITY =
  'Does the question below have one checkable correct answer, such as a number, a choice among options, ' +
  'a fact, a proof result or the behaviour of code? Creative writing, advice, opinion, style and open-ended ' +
  'requests do not.';

function reportedCost(cost: number | undefined): number {
  if (cost !== undefined && (!Number.isFinite(cost) || cost < 0))
    throw new RangeError('reference cost must be finite and nonnegative');
  return cost ?? 0;
}

/** Optional reference generation. Agreement is evidence of consistency, not proof that a solve is correct. */
export function withReferenceConsensus(client: JudgeClient, options: ReferenceOptions): JudgeClient {
  const samples = options.samples ?? 5;
  if (!Number.isInteger(samples) || samples < 1 || samples > 20)
    throw new RangeError('reference samples must be an integer from 1 to 20');
  if (options.route !== undefined && options.route !== 'auto')
    throw new RangeError('reference route must be auto or omitted');
  if (options.check !== undefined && options.route !== 'auto')
    throw new RangeError('reference check requires route: auto');
  referenceConsensus([], options);
  // Cache pending decisions too: concurrent requests for a question share one routing call.
  const routes = new Map<string, Promise<{ solve: boolean; cost: number }>>();
  async function check(question: string): Promise<{ solve: boolean; cost: number }> {
    try {
      if (options.check) {
        const result = await options.check(question);
        return { solve: result.answer?.trim().toUpperCase() === 'YES', cost: reportedCost(result.costUsd) };
      }
      // Build from scratch. No response, caller rubric, artifact, reference, system or label can leak in.
      const result = await client.judge({
        criterion: {
          name: 'reference-checkability',
          rubric: CHECKABILITY,
          pass: 'YES: the question has one checkable correct answer.',
          fail: 'NO: the question is creative, open-ended, advice, opinion or style.',
        },
        transcript: [{ role: 'user', text: question }],
      });
      return {
        solve: result.unparsed !== true && result.answer.outcome === 'pass',
        cost: reportedCost(result.costUsd),
      };
    } catch {
      // A route failure supplies no evidence that solving is useful. The real judgement still runs.
      return { solve: false, cost: 0 };
    }
  }
  const solve = async (question: string) => {
    const answers: (string | undefined)[] = [];
    let cost = 0;
    let shouldSolve = true;
    if (options.route === 'auto') {
      let pending = routes.get(question);
      const cached = pending !== undefined;
      if (!pending) {
        pending = check(question);
        routes.set(question, pending);
      }
      const route = await pending;
      shouldSolve = route.solve;
      // Charge each actual routing call once, including when concurrent requests await it.
      if (!cached) cost += route.cost;
    }
    for (let i = 0; shouldSolve && i < samples; i += 1) {
      try {
        const result = await options.solve(question, i);
        cost += reportedCost(result.costUsd);
        answers.push(result.answer);
      } catch {
        answers.push(undefined);
      }
    }
    const consensus = referenceConsensus(answers, options);
    // Keep the standalone consensus helper's two-attempt minimum. This explicit opt-in uses one solve.
    const reference = samples === 1 && consensus.agreement === 1 ? answers[0] : consensus.reference;
    return { ...consensus, reference, cost, shouldSolve };
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
      // Procedures need the failed-consensus signal before their inner routing decision. Ordinary
      // clients retain the original request and report failure in referenceAgreement afterwards.
      prepared.push(
        consensus.reference !== undefined
          ? { ...request, reference: consensus.reference }
          : consensus.shouldSolve && (client.judgeComparison || client.families)
            ? { ...request, referenceDisagreement: true }
            : request,
      );
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
        agreement:
          attempts === 0 ? 0 : rows.reduce((sum, row) => sum + row.agreement * row.attempts, 0) / attempts,
        used: rows.every((row) => row.reference !== undefined),
        ...(options.route === 'auto' ? { routed: rows.some((row) => row.shouldSolve) } : {}),
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
