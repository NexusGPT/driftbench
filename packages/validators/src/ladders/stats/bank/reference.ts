import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Case, check, type Row, referenceCases, STATS_FIXTURES } from '../reference';
import { type BankItem, fail, ok } from './item';

/** The fixture groups of level 1 of ladder version 1, one item each: `group.name` as in the fixtures file. */
export const REFERENCE_GROUPS = [
  'special.logGamma',
  'special.incompleteBeta',
  'special.betaQuantile',
  'special.normalQuantile',
  'special.normalCdf',
  'special.chiSquareSf',
  'special.binomialCdf',
  'intervals.wilson',
  'intervals.clopperPearson',
  'intervals.zeroFailureBound',
  'intervals.designEffect',
  'bootstrap.replay',
  'bootstrap.independent',
  'reliability.passK',
  'reliability.passAtK',
  'reliability.unreliability',
  'mcnemar.mcnemar',
  'wilcoxon.wilcoxon',
  'paired.pairedRateDifference',
  'paired.nonInferiority',
  'benjaminiHochberg.benjaminiHochberg',
  'mde.mde',
  'drift.cusum',
  'drift.pageHinkley',
  'drift.ksTest',
  'kappa.kappa',
  'krippendorff.krippendorff',
  'varianceComponents.varianceComponents',
  'neyman.neyman',
  'repeatsForFloor.repeatsForFloor',
  'coverage.coverage',
] as const;

const cache = new Map<string, Row>();
function fixtures(root: string): Row {
  const path = join(root, STATS_FIXTURES);
  let data = cache.get(path);
  if (!data) {
    data = JSON.parse(readFileSync(path, 'utf8')) as Row;
    cache.set(path, data);
  }
  return data;
}

/**
 * Family `reference`: every case of one fixture group matches the scipy and numpy value to 1e-6 (the group's own
 * tolerance for the numpy bootstrap). These were level 1 of ladder version 1.
 */
export function referenceItems(): BankItem[] {
  return REFERENCE_GROUPS.map((group) => ({
    id: `reference.${group}`,
    family: 'reference',
    tier: 1,
    level: 'reference',
    component: 'packages/stats/src',
    check: ({ s, root }) => {
      const cases: Case[] = referenceCases(fixtures(root), s).filter((c) => c.id.startsWith(`${group}[`));
      if (cases.length === 0) return fail(`no fixture case of group ${group} in ${STATS_FIXTURES}`);
      const misses: string[] = [];
      for (const item of cases) {
        const found = check(item);
        if (found.length > 0) misses.push(`${item.id} (${item.component}): ${found.join('; ')}`);
      }
      return misses.length === 0
        ? ok(`${cases.length} cases match`)
        : fail(
            `${misses.length} of ${cases.length} cases differ from the scipy/numpy reference in ${STATS_FIXTURES}; fix the function so each matches: ${misses.slice(0, 3).join(' | ')}`,
          );
    },
  }));
}
