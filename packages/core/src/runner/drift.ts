import { DriftClass } from '../schema/common';
import type { Verdict } from '../schema/run';

/**
 * The drift class of a failing verdict, by its family: the text of its id before the first dot (check
 * names hold no dot; tool labels and paths after it may).
 *
 * - X1_local, a fault the block shows on its own: what the reply says (`must`, `must_not`, `length`, `similarity`,
 *   `relevancy`), what it ran
 *   and produced (`execution`, `workspace`, `artifacts`, `schema_strict`), its budget, the end state, and
 *   the judged criteria (`judge`).
 * - X2_contradiction: the runner's ledger check (`ledger`), tool inputs and reply facts against the ledger.
 * - X3_flow: the stage the runtime reports (`stage`), the runner's step classifier (`flow`), and a known fact
 *   asked for again or dropped (`knowledge_retention`).
 * - X4_format: language, cards and one message per turn, and personal data echoed (`lang`, `cards`, `pii`).
 * - X5_tool: a missing, extra or mis-parametrised call, a forbidden tool, a skill, a guard, a file read
 *   or a helper dispatched, and a destructive operation over its limit (`tools`, `forbidden`, `skills`,
 *   `guards`, `references`, `subagents`, `safety`).
 *
 * A custom check's ids start with `custom`, so a custom check never takes a family's class by its name;
 * neither does an unknown family.
 */
export const DRIFT_BY_FAMILY: Readonly<Record<string, DriftClass>> = {
  must: 'X1_local',
  must_not: 'X1_local',
  regex: 'X1_local',
  length: 'X1_local',
  markup: 'X4_format',
  starts_with: 'X1_local',
  finish_reason: 'X1_local',
  json: 'X1_local',
  refusal: 'X1_local',
  tool_f1: 'X5_tool',
  similarity: 'X1_local',
  relevancy: 'X1_local',
  execution: 'X1_local',
  workspace: 'X1_local',
  artifacts: 'X1_local',
  schema_strict: 'X1_local',
  budget: 'X1_local',
  end_state: 'X1_local',
  judge: 'X1_local',
  ledger: 'X2_contradiction',
  stage: 'X3_flow',
  flow: 'X3_flow',
  knowledge_retention: 'X3_flow',
  lang: 'X4_format',
  cards: 'X4_format',
  pii: 'X4_format',
  tools: 'X5_tool',
  forbidden: 'X5_tool',
  skills: 'X5_tool',
  guards: 'X5_tool',
  references: 'X5_tool',
  subagents: 'X5_tool',
  safety: 'X5_tool',
};

/**
 * The drift classes of a block: one per family among its failing gating verdicts, in the order X1 to X5.
 * A block may carry several; a passing block, or one that fails only on non-gating or inconclusive
 * verdicts, carries none.
 */
export function driftOf(verdicts: readonly Verdict[]): DriftClass[] {
  const found = new Set<DriftClass>();
  for (const verdict of verdicts) {
    if (!verdict.gating || verdict.outcome !== 'fail') continue;
    const drift = DRIFT_BY_FAMILY[verdict.id.split('.', 1)[0] ?? ''];
    if (drift) found.add(drift);
  }
  return DriftClass.options.filter((drift) => found.has(drift));
}
