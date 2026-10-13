/**
 * The versions of the default criterion system prompt. Version 2 is the default: version 1 plus three rules.
 * Version 1 stays selectable by name (`criterionPromptVersion: 1`) with its own bytes and fingerprint, so a
 * version 1 recording still replays under version 1 and never under version 2.
 */
export const CRITERION_PROMPT_VERSION = 2;
export type CriterionPromptVersion = 1 | 2;

/** The rules version 2 adds, after the version 1 rules. */
export const CRITERION_PROMPT_V2_RULES = [
  '- Compare each named identifier, number and unit exactly. A similar name, an added suffix or a nearby value is a different thing.',
  '- Facts the criterion states are the expected values: compare the data with them. met null is never for a missing outside source.',
  '- When the QUESTION names which record counts, that record alone decides the requirement, over the SCOPE line and over a reply that contradicts the record.',
] as const;

/** The version 2 system prompt: the added rules follow the last rule line of the version 1 prompt. */
export function criterionSystemPromptV2(v1: string): string {
  const lines = v1.split('\n');
  const last = lines.findLastIndex((line) => line.startsWith('- '));
  if (last < 0) throw new RangeError('the version 1 system prompt holds no rule line');
  return [...lines.slice(0, last + 1), ...CRITERION_PROMPT_V2_RULES, ...lines.slice(last + 1)].join('\n');
}

/** Whether a request names a prompt version this build knows. */
export function checkCriterionPromptVersion(
  version: unknown,
): asserts version is CriterionPromptVersion | undefined {
  if (version !== undefined && version !== 1 && version !== 2)
    throw new RangeError('criterionPromptVersion must be 1 or 2');
}
