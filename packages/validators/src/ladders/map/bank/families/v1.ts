import { passes } from '../../../../ladder';
import { mapLadderV1 as firstVersion } from '../../first';
import { BANK_COMPONENTS } from '../common';
import { runItem } from '../run';
import { type BankItem, levelOf, type Tier } from '../types';
import { roleItems } from './styles';

/**
 * The seven levels of the first map ladder (docs/validators.md section 2) as the first items of the bank, each
 * in the family and level it belongs to. Each runs the first-version level on the seed and passes when that
 * level meets its threshold.
 */

const FIRST: ReadonlyArray<{
  index: number;
  family: string;
  level: Parameters<typeof levelOf>[0];
  tier: Tier;
  component: string;
  cause: string;
  /** Other first-version levels the item also requires. */
  alsoLevels?: number[];
  /**
   * The first ladder names its persona dimensions with fixed ids, so roles read off the sorted ids can meet
   * its roles level on some seeds. These items also require the bank's markdown roles items, which run both
   * sort orders of the ids on every seed.
   */
  alsoRoles?: boolean;
}> = [
  {
    index: 0,
    family: 'inventory-forms',
    level: 'structured',
    tier: 1,
    component: BANK_COMPONENTS.inventory,
    cause: 'inventory:v1-structured',
  },
  {
    index: 1,
    family: 'styles',
    level: 'prose',
    tier: 2,
    component: BANK_COMPONENTS.contract,
    cause: 'contract:v1-prose-atoms',
  },
  {
    index: 2,
    family: 'styles',
    level: 'prose',
    tier: 2,
    component: BANK_COMPONENTS.accept,
    cause: 'accept:v1-precision',
  },
  {
    index: 3,
    family: 'constraints',
    level: 'relations',
    tier: 2,
    component: BANK_COMPONENTS.contract,
    cause: 'contract:v1-constraints',
  },
  {
    index: 4,
    family: 'transforms',
    level: 'metamorphic',
    tier: 3,
    component: BANK_COMPONENTS.roles,
    cause: 'contract:dimension-role',
    alsoLevels: [6],
    alsoRoles: true,
  },
  {
    index: 5,
    family: 'composition',
    level: 'composition',
    tier: 3,
    component: BANK_COMPONENTS.extract,
    cause: 'extract:v1-composition',
  },
  {
    index: 6,
    family: 'roles',
    level: 'semantics',
    tier: 3,
    component: BANK_COMPONENTS.roles,
    cause: 'contract:dimension-role',
    alsoRoles: true,
  },
];

export function firstVersionItems(): BankItem[] {
  return FIRST.map((first) => {
    const definition = firstVersion().levels[first.index];
    if (!definition) throw new Error(`no first-version level ${first.index}`);
    return {
      id: `${first.family}.v1-${definition.id}`,
      family: first.family,
      tier: first.tier,
      level: levelOf(first.level),
      component: first.component,
      cause: first.cause,
      title: `the first map ladder's level ${first.index + 1} (${definition.name}): ${definition.metric}, at least ${definition.threshold}${(first.alsoLevels ?? []).map((index) => `, with level ${index + 1} at its threshold too`).join('')}${first.alsoRoles ? ', and the declared roles holding whichever persona id sorts first (roles.markdown.*)' : ''}`,
      generate: () => [],
      check: () => ({ pass: false, detail: 'runs through run()' }),
      run: async (seed, deps) => {
        const ladder = firstVersion(deps.extract ? { extract: deps.extract } : {});
        // The metamorphic level holds only with the declared roles: equal maps from roles read off a fixed
        // order of ids also fail the roles level, so it runs too.
        for (const index of [first.index, ...(first.alsoLevels ?? [])]) {
          const level = ladder.levels[index];
          if (!level) return { pass: false, detail: 'no level' };
          const measure = await level.compute({ seed, hidden: false, root: process.cwd() });
          if (!passes(measure.value, level.threshold, level.direction ?? 'atLeast')) {
            return {
              pass: false,
              detail: `level ${index + 1}: ${measure.value} under ${level.threshold}; ${measure.items
                .slice(0, 2)
                .map((item) => `${item.id}: ${item.detail}`)
                .join(' | ')}`,
            };
          }
        }
        if (first.alsoRoles) {
          for (const roles of roleItems().filter((one) => one.id.startsWith('roles.markdown.'))) {
            const outcome = await runItem(roles, seed, deps);
            if (!outcome.pass) return { pass: false, detail: `${roles.id}: ${outcome.detail}` };
          }
        }
        return { pass: true, detail: 'every level at its threshold' };
      },
    };
  });
}
