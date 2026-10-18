/**
 * The deterministic block generator (G3): from an approved map, code enumerates the stage graph paths,
 * the t-wise covering array, the boundary values, one probe per deviation class and the metamorphic
 * families, and writes each as a driftbench spec. No model is called.
 */

export {
  NO_THEN_CRITERION,
  PLACEHOLDER_CRITERION,
  placeholderText,
  SEEDERS,
  type Seeder,
} from '../seed/assemble';
export { type BudgetSelection, enumerateCells, selectBudget, slicedLhs } from '../seed/budget';
export { DETOURS, DEVIATION_EXPECTED } from '../seed/deviation';
export { Feasibility } from '../seed/feasible';
export { type Edge, type StageGraph, stageGraph, walkGraph } from '../seed/graph';
export { type PreparedMap, prepareMap, readToolSchemas, type ToolSchema } from '../seed/map';
export { rngFor, streamSeed } from '../seed/random';
export { EMPTY_RELATIONS, type Relations } from '../seed/relations';
export { allowedTuples, type CoveringArray, coveringArray } from '../seed/twise';
export { concreteValue, defaultFor, inputAssertion, toolAnswer } from '../seed/values';
export {
  COMPLETE_DIR,
  DEFAULT_SEED,
  DEFAULT_T,
  type GeneratedFile,
  type GenerateOptions,
  type GenerateReport,
  type GenerateResult,
  generateSuite,
  INCOMPLETE_DIR,
  type MeasuredCoverage,
  REPORT_FILE,
  renderSummary,
  type SeederTotals,
} from './generate';
export { formatJson } from './json';
export { loadApprovedMap, type MapLoad } from './load';
export { type GenerateDiskOptions, type GenerateDiskResult, generateSuiteToDisk } from './stream';
