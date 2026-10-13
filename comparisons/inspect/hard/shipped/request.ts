import type { JudgeRequest } from '../../../../packages/judges/src/contract';
import type { Case, Row } from '../generate.mts';

export type Config = 'default' | 'audit';

/**
 * What the shipped judge is asked, per comparison row. Both sides receive the same task, the same submission
 * and the same criterion, or on the fact row the same expert answer and the question of the Inspect fact
 * template. No id, family or label enters a request.
 *
 * `audit` is the opt-in answer audit. `default` is the judge a caller gets with no option set, wired as the
 * earlier comparison wired it: the criterion and the submission as one agent entry.
 */
export function requestFor(c: Case, row: Row, config: Config): JudgeRequest {
  if (config === 'audit')
    return {
      criterion:
        row === 'fact'
          ? {
              name: 'expert_content',
              rubric: 'Does the submission contain the content in the expert answer?',
            }
          : c.criterion,
      ...(row === 'fact' ? { reference: c.expert } : {}),
      transcript: [
        { role: 'user', text: c.question },
        { role: 'agent', text: c.submission },
      ],
      assessment: { kind: 'answer-audit' },
    };
  return { criterion: c.criterion, transcript: [{ role: 'agent', text: c.submission }] };
}
