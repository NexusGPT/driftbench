import {
  type ConditionSpan,
  createJudgeConditionReader,
  createScopedConditionProposer,
  type ModelPort,
} from '../../../packages/generate/src';
import type { ConditionJudge } from '../../../packages/generate/src/feed/judge-reader';

export const ROUND2_MODELS = { reader: 'jev-1.13.0', proposer: 'claude-sonnet-5-5' } as const;

export const round2Question = (variable: { title: string }, value: { title: string }) =>
  'Does this clause itself specify the exact triggering condition "' + value.title + '" (about "' + variable.title +
  '")? A mere mention or an action the agent is told to perform does not count. Numeric limits, strictness, negation, timing and actor must agree. A broader or narrower condition is a different condition.';

export const round2Options = {
  newVariables: false,
  propose: 'all-no' as const,
  decide: { yesAt: 0.5, noAt: 0.5 },
  checkProposals: 'match' as const,
  questionText: round2Question,
};

export function round2Systems(judge: ConditionJudge, port: ModelPort, spans: readonly ConditionSpan[]) {
  return {
    reader: createJudgeConditionReader(judge, { sourceClauses: new Set(spans.map((s) => s.quote)) }),
    proposer: createScopedConditionProposer(port),
  };
}
