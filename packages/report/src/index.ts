/** Scorecards, run diffs, drilldowns and JUnit output, from a stored campaign. */
export const packageName = '@driftbench/report';

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
