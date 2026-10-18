/**
 * Contract values the system items share, as the pages document them. One constant per value, so a change to a
 * page is one change here, and a test holds each constant to its page (test/system/stale.test.ts).
 */

/** docs/reference/checks.md, first paragraph: what `defaultChecks()` returns, in the order the runner applies. */
export const DOCUMENTED_CHECKS = [
  'tools',
  'tools_offered',
  'forbidden',
  'must',
  'must_not',
  'regex',
  'exact',
  'injection',
  'length',
  'markup',
  'starts_with',
  'finish_reason',
  'json',
  'tool_f1',
  'refusal',
  'rouge_l',
  'bleu',
  'sql',
  'similarity',
  'relevancy',
  'knowledge_retention',
  'lang',
  'pii',
  'cards',
  'stage',
  'skills',
  'guards',
  'references',
  'subagents',
  'execution',
  'workspace',
  'safety',
  'artifacts',
  'schema_strict',
  'budget',
  'end_state',
  'custom',
] as const;

/** docs/concepts/statistics.md, "Underpowered criteria": fewer goldens than this leaves a criterion out. */
export const MIN_GOLDENS = 30;
