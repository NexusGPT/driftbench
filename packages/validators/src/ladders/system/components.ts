/**
 * The fixed table from what a system item is about to the one component it points at (docs/validators.md
 * section 1, rule 4).
 */
export const SYSTEM_COMPONENTS = {
  plant: 'packages/validators/src/ladders/system/plant.ts',
  loader: 'packages/core/src/spec/load.ts',
  store: 'packages/store/src/store.ts',
  campaign: 'packages/core/src/runner/campaign.ts',
  runner: 'packages/core/src/runner/run.ts',
  cache: 'packages/core/src/runner/cache.ts',
  wilson: 'packages/stats/src/intervals.ts',
  designEffect: 'packages/stats/src/variance.ts',
  parity: 'packages/stats/src/paired.ts',
} as const;

/** The check file of each check family an operator relies on. */
export const CHECK_COMPONENTS: Readonly<Record<string, string>> = {
  must: 'packages/checks/src/checks/must.ts',
  must_not: 'packages/checks/src/checks/must.ts',
  tools: 'packages/checks/src/checks/tools.ts',
  forbidden: 'packages/checks/src/checks/forbidden.ts',
  stage: 'packages/checks/src/checks/stage.ts',
  lang: 'packages/checks/src/checks/lang.ts',
  guards: 'packages/checks/src/checks/guards.ts',
};
