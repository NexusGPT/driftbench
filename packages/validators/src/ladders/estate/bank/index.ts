import { benchFamily } from './bench';
import { blindFamilies } from './blind/index';
import { comboFamily, generatedFamily } from './combo';
import type { Family } from './frame';
import { decoysFamily, hostileFamily } from './hostile';
import { lintCleanFamily, lintDefectFamily } from './lint';
import { genAsksFamily, genCompleteFamily, impactFamily, mutantFamily } from './loop';
import { planContractFamily, planPairsFamily, planRelevanceFamily } from './plan';
import { scaleFamily } from './scale';
import { gatesFamily, hazardsFamily, pathsFamily } from './scan-code';
import { frontmatterFamily } from './scan-front';
import { catalogueFamily, dispatcherFamily } from './scan-guards';
import { symlinkFamily } from './scan-links';
import { referenceProseFamily } from './scan-refs';
import { registryFamily } from './scan-registry';
import { standingFamily } from './scan-standing';
import { stepsFamily } from './scan-steps';

export { benchFamily } from './bench';
export { blindFamilies } from './blind/index';
export * from './frame';

/** The levels of the estate bank, in order of the cost of diagnosis, each with its families. */
export const BANK_LEVELS = [
  {
    id: 'reader',
    name: 'reader and graph',
    families: () => [
      generatedFamily(),
      frontmatterFamily(),
      symlinkFamily(),
      registryFamily(),
      stepsFamily(),
      catalogueFamily(),
      dispatcherFamily(),
      referenceProseFamily(),
      gatesFamily(),
      hazardsFamily(),
      pathsFamily(),
      comboFamily(),
      hostileFamily(),
      decoysFamily(),
      standingFamily(),
      benchFamily(),
      ...blindFamilies(),
    ],
  },
  { id: 'lint', name: 'lint', families: () => [lintDefectFamily(), lintCleanFamily()] },
  {
    id: 'plan',
    name: 'plan',
    families: () => [planContractFamily(), planPairsFamily(), planRelevanceFamily()],
  },
  { id: 'generation', name: 'generation', families: () => [genCompleteFamily(), genAsksFamily()] },
  { id: 'agent-mutants', name: 'agent mutants', families: () => [mutantFamily()] },
  { id: 'maintenance', name: 'maintenance', families: () => [impactFamily()] },
  { id: 'scale', name: 'scale', families: () => [scaleFamily()] },
] as const satisfies ReadonlyArray<{ id: string; name: string; families: () => Family[] }>;

/** Every family of the bank, level by level. */
export function estateBank(): Family[] {
  return BANK_LEVELS.flatMap((level) => level.families());
}
export { comboFamily, FORMS as COMBINATION_FORMS, generatedFamily } from './combo';
export * from './hardness';
export { decoysFamily, hostileFamily } from './hostile';
export { lintCleanFamily, lintDefectFamily } from './lint';
export {
  GEN_CLASSES,
  genAsksFamily,
  genCompleteFamily,
  impactFamily,
  MUTANT_CLASSES,
  mutantFamily,
  roleOf,
} from './loop';
export { allowedTuples, planContractFamily, planPairsFamily, planRelevanceFamily } from './plan';
export { PlantedEstate, truthPort } from './planted';
export { BUDGET_FLOOR_MS, BUDGET_PER_ATOM, budgetMs, SIZES as SCALE_SIZES, scaleFamily } from './scale';
export { scaleEstate } from './scale-estate';
export { gatesFamily, hazardsFamily, pathsFamily } from './scan-code';
export { FRONTMATTER_FORMS, frontmatterFamily } from './scan-front';
export { catalogueFamily, dispatcherFamily } from './scan-guards';
export { symlinkFamily } from './scan-links';
export { MAX_CHUNK, referenceProseFamily } from './scan-refs';
export { registryFamily } from './scan-registry';
export { standingFamily } from './scan-standing';
export { stepsFamily } from './scan-steps';
