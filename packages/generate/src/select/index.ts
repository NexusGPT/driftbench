/**
 * Selection and the holdout (G7): the golden set, the smallest set of gated conversations that covers the
 * declared cells (then the k best), and the sealed holdout scored once per query against a fixed budget.
 */
export { type CoverElement, type CoverInput, type Pick, type Selection, selectGolden } from './cover';
export {
  evidenceFromReport,
  type GateEvidence,
  type GateSeal,
  mergeEvidence,
  sealFromJson,
  specOfKey,
} from './evidence';
export {
  BUDGET_FILE,
  Budget,
  type BudgetDecision,
  inHoldout,
  type OpenedSpec,
  openBundle,
  passRate,
  type ScoreEntry,
  SEALED_FILE,
  SEALED_NOTE,
  SealedBundle,
  spendQuery,
} from './holdout';
export { coverElements, requiredLabel } from './space';
