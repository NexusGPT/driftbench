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

/** Declared candidate predicates, rendered in canonical physical units. */
const CANDIDATE_PREDICATES: Record<string, string> = {
  'shipment_delay/late_over_one_day':
    'A shipment delay is strictly greater than 24 hours (one day); numeric cutoff 24 hours, comparison >',
  'shipment_delay/late_over_two_days':
    'A shipment delay is strictly greater than 48 hours (two days); numeric cutoff 48 hours, comparison >',
  'invoice_work/invoice_diff_over_50':
    'The total difference of an invoice is strictly greater than 50.00 EUR; numeric cutoff 50.00, currency EUR, comparison >',
  'approval/approval_unanswered':
    'The approver has provided no response at all; a conditional or negative response is still a response',
  'approval/approval_given':
    'The requested approval was explicitly granted; confirmation in writing by the named decision maker is an explicit yes',
};

const SOURCE_PASS =
  'At least one explicit trigger, guard or standalone condition description states this candidate value. A named instance of a role, a synonym, or a concrete instance of the same categorical state counts. Numeric guard boundaries must be identical after exact unit conversion. Independent conditions may coexist.';
const DESCRIPTION_PASS =
  'The description denotes the same candidate value. A named role instance, a synonym or a concrete instance of the same categorical state counts. Numeric guard boundaries must be identical after exact unit conversion. The description need not itself be an instruction.';
const FAIL =
  'The text only names a related topic, a different actor or entity class, a different categorical state, an action or example, or an unstated prerequisite. A changed threshold, comparison strictness, unit or currency without an exact conversion, timing stage, or polarity is no. Unknown or unverified is not a negative fact. Implication and overlapping numeric ranges are insufficient. An unconditional action is not an explicit triggering condition.';
const EXPLICIT_TRIGGER =
  'Propose only an explicitly stated trigger, guard, or standalone condition description. An ordinary unconditional instruction about a subject is not a condition. Do not invent an existence prerequisite merely because an action refers to an entity. Preserve all qualifying facts of the stated condition. For domain membership, the entity or process named in a variable title is its subject. Workflow or interaction wording in that title is context, not a restriction on other properties, states, historical events or future stages of that SAME subject. This subject-domain interpretation takes precedence over a narrow reading of the activity wording. A related but distinct entity does not belong to that variable.';

export const round3Options = {
  ...round2Options,
  decide: { yesAt: ROUND3_THRESHOLD, noAt: ROUND3_THRESHOLD },
  questionText: (variable: { id?: string; title: string }, value: { id?: string; title: string }) => {
    const candidate = CANDIDATE_PREDICATES[variable.id + '/' + value.id] ?? value.title;
    return JSON.stringify({
      question: 'Does a condition expressed by this text correspond to this SAME candidate value?',
      variable: variable.title,
      candidate,
      rules:
        'Match categorical state and role instances. For a numeric guard, require the same cutoff, unit or currency after exact conversion, and comparison strictness; implication or overlap is not identity. Match timing stage and polarity. Ignore mentions only in actions and examples.',
    });
  },
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
                    'Is the corresponding source condition about a different actor/entity class, opposite polarity, or different knowledge status from this candidate?',
                  pass: 'The candidate and corresponding source concern different actor or entity classes, opposite polarity, or different knowledge status. Unknown or unverified differs from established absence.',
                  fail: 'They concern the same actor/entity class with compatible polarity and knowledge status. A named instance of a role or a concrete instance of the same categorical state is compatible even when the source adds qualifiers. Ignore other independent conditions and actions/examples. Numeric parameters are checked separately.',
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
              else {
                const numeric = await judge.judge({
                  criterion: {
                    name: 'guard_parameters_equal:' + q.name,
                    rubric:
                      'Are the numeric cutoff parameters of the candidate and corresponding source condition exactly equal after conversion to a common unit?',
                    pass: 'The candidate has no numeric guard, or its numeric cutoff, unit or currency after exact conversion, and comparison strictness equal those of the corresponding source condition. More than 60 minutes equals more than 1 hour.',
                    fail: 'A candidate numeric guard has a different cutoff, unit or currency without exact conversion, or comparison strictness. More than 90 minutes differs from more than 1 hour even though one range implies the other. Compare cutoff equality, never range containment. A number only in an action or another independent condition is not this guard.',
                    scope: 'conversation',
                  },
                  transcript: [{ role: 'user', text: JSON.stringify({ candidate, source: text }) }],
                });
                const equal = numeric.answer.score;
                if (
                  numeric.unparsed ||
                  typeof equal !== 'number' ||
                  !Number.isFinite(equal) ||
                  equal < 0 ||
                  equal > 1
                )
                  answers[q.name] = undefined;
                else if (equal < ROUND3_THRESHOLD) answers[q.name] = { yes: 0 };
              }
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
