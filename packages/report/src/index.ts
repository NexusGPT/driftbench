/** Scorecards, run diffs, drilldowns and JUnit output, from a stored campaign. */
export const packageName = '@driftbench/report';

export {
  type CompareOptions,
  type CompareResult,
  type CompareVerdict,
  type CriterionComparison,
  compareCampaigns,
  criterionOf,
  DEFAULT_FLAG_FAMILIES,
  type UnitPair,
  type UnitSide,
  unitsOf,
} from './compare';
export {
  blockScore,
  type CampaignData,
  loadCampaign,
  ReportInputError,
  runPassed,
  showTarget,
} from './data';
export { type Estimate, type IntervalMethod, type Rate, rate } from './estimate';
export {
  type AtK,
  type ModeReliability,
  modeReliability,
  type RecoverySummary,
  type ReliabilityLine,
  reliability,
  recoveryOf,
  type SuccessionSummary,
  successionOf,
} from './reliability';
export { compareText, textTable } from './text';
