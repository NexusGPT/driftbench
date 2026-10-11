/**
 * The variance pilot: per cell of the approved map, conversations x approved wordings x repeats, run on
 * the real runner, and the analysis of where the spread of results comes from. Owned by the pilot lane.
 */
export {
  analysePilot,
  type BlockFlip,
  blockFlips,
  type CellAnalysis,
  type LevelSummary,
  PILOT_ANALYSIS_DEFAULTS,
  type PilotAnalysis,
  type PilotAnalysisOptions,
  type PlantedCheck,
  type Range,
  type Resample,
  type WordingSensitivity,
} from './analyse';
export { PILOT_CONTROL_MARKER, pilotControlCheck } from './control';
export {
  cellName,
  designPilot,
  designVariants,
  type PhrasedBlock,
  PILOT_DEFAULTS,
  type PilotCell,
  type PilotConversation,
  type PilotDesign,
  type PilotFactors,
  type PilotMap,
  type PilotOptions,
  type PilotPhrase,
  type PilotVariant,
  pilotFactors,
  stimulusText as pilotStimulusText,
} from './design';
export { formatPilotPlan, formatPilotReport, type PilotReport, pilotReport } from './report';
export {
  observationOf,
  type PilotObservation,
  type PilotPlan,
  type PilotPlanLine,
  type PilotRunOptions,
  pilotObservations,
  planPilot,
  runPilot,
} from './run';
