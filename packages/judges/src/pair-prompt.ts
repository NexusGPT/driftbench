import type { CriterionText, TranscriptEntry } from './contract';
import { COMPARE_SYSTEM_PROMPT } from './pairwise';
import { dataTag, renderRubric, renderTranscript } from './prompt';

/**
 * The prompt of a pair judge: each candidate reply sits in its own data tag, `<first_data>` and `<second_data>`,
 * so the judge reads the two as data, in order.
 */
export function buildPairPrompt({
  criterion,
  first,
  second,
}: {
  criterion: CriterionText;
  first: readonly TranscriptEntry[];
  second: readonly TranscriptEntry[];
}): { system: string; user: string } {
  const user = [
    renderRubric(criterion),
    '',
    dataTag('first_data', renderTranscript(first)),
    '',
    dataTag('second_data', renderTranscript(second)),
  ].join('\n');
  return { system: COMPARE_SYSTEM_PROMPT, user };
}
