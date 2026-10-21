import {
  type ConditionJudge,
  type ConditionSpan,
  type ConversationReader,
  createJudgeConditionReader,
  createScopedConditionProposer,
  type ModelPort,
  type ReaderAnswer,
} from '../../../packages/generate/src';
import { round2Options } from './round2';

/** Calibrated on DEV only; frozen before the single frozen4 measurement. */
export const ROUND3_THRESHOLD = 0.5;

const SOURCE_PASS =
  'At least one explicit trigger, guard or standalone condition description states this candidate value. A named instance of a role, a synonym, or a concrete instance of the same categorical state counts. Numeric guard boundaries must be identical after exact unit conversion. Independent conditions may coexist.';
const DESCRIPTION_PASS =
  'The description denotes the same candidate value. A named role instance, a synonym or a concrete instance of the same categorical state counts. Numeric guard boundaries must be identical after exact unit conversion. The description need not itself be an instruction.';
const FAIL =
  'The text only names a related topic, a different actor or entity class, a different categorical state, an action or example, or an unstated prerequisite. A changed threshold, comparison strictness, unit or currency without an exact conversion, timing stage, or polarity is no. Unknown or unverified is not a negative fact. Implication and overlapping numeric ranges are insufficient. An unconditional action is not an explicit triggering condition.';
const EXPLICIT_TRIGGER =
  'Propose only an explicitly stated trigger, guard, or standalone condition description. An ordinary unconditional instruction about a subject is not a condition. Do not invent an existence prerequisite merely because an action refers to an entity. Preserve all qualifying facts of the stated condition. A new property, state or workflow stage of the SAME concrete subject belongs under its existing variable even if the variable title describes a narrower activity; its examples are not an exhaustive domain. A related but distinct entity does not belong to that variable.';

export const round3Options = {
  ...round2Options,
  decide: { yesAt: ROUND3_THRESHOLD, noAt: ROUND3_THRESHOLD },
  questionText: (variable: { title: string }, value: { title: string }) =>
    JSON.stringify({
      question: 'Does a condition expressed by this text correspond to this SAME candidate value?',
      variable: variable.title,
      candidate: value.title,
      rules:
        'Match categorical state and role instances. For a numeric guard, require the same cutoff, unit or currency after exact conversion, and comparison strictness; implication or overlap is not identity. Match timing stage and polarity. Ignore mentions only in actions and examples.',
    }),
};

export function round3Systems(judge: ConditionJudge, port: ModelPort, spans: readonly ConditionSpan[]) {
  const sourceClauses = new Set(spans.map((s) => s.quote));
  const primary = createJudgeConditionReader(
    {
      id: 'identity:' + judge.id,
      cls: judge.cls,
      family: judge.family,
      ...(judge.model === undefined ? {} : { model: judge.model }),
      judge: (request) =>
        judge.judge({
          ...request,
          criterion: {
            ...request.criterion,
            pass: sourceClauses.has(request.transcript[0]?.text ?? '') ? SOURCE_PASS : DESCRIPTION_PASS,
            fail: FAIL,
          },
        }),
    },
    { sourceClauses },
  );
  const reader: ConversationReader = {
    ...primary,
    id: 'material-guard:' + primary.id,
    async read(text, questions) {
      const answers: Record<string, ReaderAnswer | undefined> = { ...(await primary.read(text, questions)) };
      const positive = questions.filter((q) => {
        const answer = answers[q.name];
        return answer !== undefined && 'yes' in answer && answer.yes >= ROUND3_THRESHOLD;
      });
      for (let start = 0; start < positive.length; start += 8) {
        await Promise.all(
          positive.slice(start, start + 8).map(async (q) => {
            let candidate = q.text;
            try {
              const structured = JSON.parse(q.text) as { candidate?: unknown } | null;
              if (typeof structured?.candidate === 'string') candidate = structured.candidate;
            } catch {
              // A caller's plain question still remains model data.
            }
            try {
              const veto = await judge.judge({
                criterion: {
                  name: 'condition_mismatch:' + q.name,
                  rubric:
                    'Compare the written condition predicates, not their logical consequences. Is there a material difference between the candidate predicate and its corresponding source predicate?',
                  pass: 'Their actor/entity class, event, property, categorical state, timing stage, polarity, or epistemic status differs. Unknown or unverified differs from established absence. For numeric predicates compare the actual cutoff after exact unit conversion and strictness: different cutoffs are different even when one range implies or overlaps the other.',
                  fail: 'The source explicitly states this same predicate, including a synonym, named instance of the same role, or concrete instance of the same categorical state. Numeric parameters are identical after exact unit conversion. Ignore a different predicate in another independent condition or in an action/example; compare only the corresponding condition.',
                  scope: 'conversation',
                },
                transcript: [{ role: 'user', text: JSON.stringify({ candidate, source: text }) }],
              });
              const probability = veto.answer.score;
              if (
                veto.unparsed ||
                typeof probability !== 'number' ||
                !Number.isFinite(probability) ||
                probability < 0 ||
                probability > 1
              )
                answers[q.name] = undefined;
              else if (probability >= ROUND3_THRESHOLD) answers[q.name] = { yes: 0 };
            } catch {
              answers[q.name] = undefined;
            }
          }),
        );
      }
      return answers;
    },
  };
  const proposer = createScopedConditionProposer({
    family: port.family,
    ...(port.model === undefined ? {} : { model: port.model }),
    complete: (request) => port.complete({ ...request, system: request.system + '\n' + EXPLICIT_TRIGGER }),
  });
  return { reader, proposer: { ...proposer, id: 'explicit:' + proposer.id } };
}
