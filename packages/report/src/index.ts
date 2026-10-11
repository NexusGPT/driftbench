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
export { renderHtml } from './html';
export { failures, renderJunit } from './junit';
export { PilotReport, readPilotReport } from './pilot';
export {
  type AtK,
  type ModeReliability,
  modeReliability,
  type RecoverySummary,
  type ReliabilityLine,
  recoveryOf,
  reliability,
  type SuccessionSummary,
  successionOf,
} from './reliability';
export {
  type BlockDetail,
  buildScorecard,
  type RunDetail,
  type Scorecard,
  type ScorecardOptions,
  type ToolAccuracy,
  toolAccuracy,
} from './scorecard';
export {
  type CellSpread,
  factorsOf,
  type JudgeFlip,
  judgeFlip,
  type NoiseFloor,
  type Spread,
  type SpreadOptions,
  spread,
} from './spread';
export { compareText, textTable } from './text';
