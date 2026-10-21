import {
  type ConditionJudge,
  type ConditionSpan,
  createJudgeConditionReader,
  createScopedConditionProposer,
  type ModelPort,
} from '../../../packages/generate/src';
import { round2Options } from './round2';

/** Calibrated on DEV only; frozen before the single frozen4 measurement. */
export const ROUND3_THRESHOLD = 0.7;

const SOURCE_PASS =
  'At least one explicit trigger, guard or standalone condition description states this candidate value. A named instance of a role, a synonym, or a concrete instance of the same categorical state counts. Numeric guard boundaries must be identical after exact unit conversion. Independent conditions may coexist.';
const DESCRIPTION_PASS =
  'The description denotes the same candidate value. A named role instance, a synonym or a concrete instance of the same categorical state counts. Numeric guard boundaries must be identical after exact unit conversion. The description need not itself be an instruction.';
const FAIL =
  'The text only names a related topic, a different categorical state, an action or example, or an unstated prerequisite. A changed threshold, comparison strictness, unit or currency without an exact conversion, timing stage, or polarity is no. Implication and overlapping numeric ranges are insufficient. An unconditional action is not an explicit triggering condition.';
const EXPLICIT_TRIGGER =
  'Propose only an explicitly stated trigger, guard, or standalone condition description. An ordinary unconditional instruction about a subject is not a condition. Do not invent an existence prerequisite merely because an action refers to an entity. Preserve all qualifying facts of the stated condition.';

export const round3Options = {
  ...round2Options,
  decide: { yesAt: ROUND3_THRESHOLD, noAt: ROUND3_THRESHOLD },
  questionText: (variable: { title: string }, value: { title: string }) =>
    'Does a condition expressed by this text correspond to this SAME candidate value? Variable: "' +
    variable.title + '". Candidate value: "' + value.title +
    '". Match categorical state and role instances. For a numeric guard, require the same cutoff, unit or currency after exact conversion, and comparison strictness; implication or overlap is not identity. Match timing stage and polarity. Ignore mentions only in actions and examples.',
};

export function round3Systems(judge: ConditionJudge, port: ModelPort, spans: readonly ConditionSpan[]) {
  const sourceClauses = new Set(spans.map((s) => s.quote));
  const reader = createJudgeConditionReader({
    id: 'identity:' + judge.id,
    cls: judge.cls,
    family: judge.family,
    ...(judge.model === undefined ? {} : { model: judge.model }),
    judge: (request) => judge.judge({
      ...request,
      criterion: {
        ...request.criterion,
        pass: sourceClauses.has(request.transcript[0]?.text ?? '') ? SOURCE_PASS : DESCRIPTION_PASS,
        fail: FAIL,
      },
    }),
  }, { sourceClauses });
  const proposer = createScopedConditionProposer({
    family: port.family,
    ...(port.model === undefined ? {} : { model: port.model }),
    complete: (request) => port.complete({ ...request, system: request.system + '\n' + EXPLICIT_TRIGGER }),
  });
  return { reader, proposer: { ...proposer, id: 'explicit:' + proposer.id } };
}
