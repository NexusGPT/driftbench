import type { ConversationReader } from './reader';

/** The structural port a repository system-1 JudgeClient supplies. No chat-model client is accepted. */
export type ConditionJudge = {
  readonly id: string;
  readonly cls: string;
  readonly family: string;
  readonly model?: string;
  judge(request: {
    criterion: { name: string; rubric: string; pass: string; fail: string; scope: 'conversation' };
    transcript: Array<{ role: 'user'; text: string }>;
  }): Promise<{
    answer: { outcome: string; score?: number };
    unparsed?: boolean;
  }>;
};

const PASS = 'The text states the same situation as this candidate, as a condition of the instruction or as a plain condition description. Equivalent wording counts. Other independent conditions may also be present.';
const FAIL = 'The candidate is absent or differs in entity, event, actor, polarity, numeric threshold, strictness, timing or stage. A resulting action or a logically implied broader or narrower case does not match.';

/** One binary criterion per candidate through the repository's system-1 judge contract. */
export function createJudgeConditionReader(
  judge: ConditionJudge,
  options: { sourceClauses?: ReadonlySet<string> } = {},
): ConversationReader {
  if (judge.cls !== 'system1') throw new TypeError('condition reader requires a system1 judge');
  return {
    id: 'conditions:' + judge.id,
    family: judge.family,
    ...(judge.model === undefined ? {} : { model: judge.model }),
    async read(clause, questions) {
      if (questions.some((q) => q.kind !== 'yesno')) throw new TypeError('condition reader requires yes/no candidates');
      const rows: Array<[string, { yes: number } | undefined]> = [];
      for (let start = 0; start < questions.length; start += 8) {
        const batch = questions.slice(start, start + 8);
        rows.push(...await Promise.all(batch.map(async (q): Promise<[string, { yes: number } | undefined]> => {
          try {
            const result = await judge.judge({
              criterion: {
                name: q.name,
                rubric: q.text,
                pass: options.sourceClauses !== undefined && !options.sourceClauses.has(clause)
                  ? 'The condition description in DATA means the candidate situation named in the question. Equivalent wording and named instances of the same actor class count. DATA need not be an instruction: compare the two situations themselves.'
                  : PASS,
                fail: FAIL,
                scope: 'conversation',
              },
              transcript: [{ role: 'user', text: clause }],
            });
            const score = result.answer.score;
            const valid = !result.unparsed && typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1;
            return [q.name, valid ? { yes: score } : undefined];
          } catch {
            return [q.name, undefined];
          }
        })));
      }
      return Object.fromEntries(rows);
    },
  };
}
