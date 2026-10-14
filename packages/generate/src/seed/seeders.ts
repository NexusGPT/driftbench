/**
 * The five seeders. Each one is deterministic code over the approved map: the stage graph walk, the
 * t-wise covering array, the boundary values of every data dimension, one probe per deviation class and
 * the metamorphic families of phrasings. A seeder returns drafts; `renderDraft` writes them as specs.
 *
 * When the map holds approved paths (relations), each seeder builds its specs as scenarios on them
 * (`buildScenario`): a t-wise row walks a path of a flow its behaviour belongs to, a boundary value walks a
 * path that needs it, a probe is injected on a path whose flow has a recovery for the class, a metamorphic
 * variant forces one phrasing on the same walk. Every block then carries a machine Then derived from the
 * map. A cell no path fits goes to incomplete/ with the reason.
 */

export { type BoundarySummary, boundarySeeder } from './boundary-seeder';
export { type DeviationSummary, deviationSeeder } from './deviation-seeder';
export { type GraphSummary, graphSeeder } from './graph-seeder';
export { type MetamorphicSummary, metamorphicSeeder } from './metamorphic-seeder';
export {
  coverDraft,
  flowsOfBehaviour,
  hasPaths,
  MAX_PATH_LENGTH,
  type SeedContext,
  worldFor,
} from './seed-drafts';
export {
  type BudgetSummary,
  budgetSeeder,
  reachableFeasibility,
  rowDrafts,
  type TwiseSummary,
  twiseDimensions,
  twiseSeeder,
} from './twise-seeder';
