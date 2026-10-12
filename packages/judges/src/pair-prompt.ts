import type { CriterionText, TranscriptEntry } from './contract';
import { COMPARE_SYSTEM_PROMPT } from './pairwise';
import { escapeData, renderRubric, renderTranscript } from './prompt';

/** A candidate tag written inside a candidate is escaped, so a reply can never close or open a data tag. */
function guard(text: string): string {
  return escapeData(text).replace(/<(\/?)(first_data|second_data)>/g, '&lt;$1$2>');
}

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
    '<first_data>',
    guard(renderTranscript(first)),
    '</first_data>',
    '',
    '<second_data>',
    guard(renderTranscript(second)),
    '</second_data>',
  ].join('\n');
  return { system: COMPARE_SYSTEM_PROMPT, user };
}
