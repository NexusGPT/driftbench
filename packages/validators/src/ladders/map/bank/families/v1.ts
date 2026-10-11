import { passes } from '../../../../ladder';
import { mapLadderV1 as firstVersion } from '../../first';
import { BANK_COMPONENTS } from '../common';
import { type BankItem, levelOf, type Tier } from '../types';

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
}> = [
  { index: 0, family: 'inventory-forms', level: 'structured', tier: 1, component: BANK_COMPONENTS.inventory },
  { index: 1, family: 'styles', level: 'prose', tier: 2, component: BANK_COMPONENTS.contract },
  { index: 2, family: 'styles', level: 'prose', tier: 2, component: BANK_COMPONENTS.accept },
  { index: 3, family: 'constraints', level: 'relations', tier: 2, component: BANK_COMPONENTS.contract },
  { index: 4, family: 'transforms', level: 'metamorphic', tier: 3, component: BANK_COMPONENTS.roles },
  { index: 5, family: 'composition', level: 'composition', tier: 3, component: BANK_COMPONENTS.extract },
  { index: 6, family: 'roles', level: 'semantics', tier: 3, component: BANK_COMPONENTS.roles },
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
      title: `the first map ladder's level ${first.index + 1} (${definition.name}): ${definition.metric}, at least ${definition.threshold}`,
      generate: () => [],
      check: () => ({ pass: false, detail: 'runs through run()' }),
      run: async (seed, deps) => {
        const level = firstVersion(deps.extract ? { extract: deps.extract } : {}).levels[first.index];
        if (!level) return { pass: false, detail: 'no level' };
        const measure = await level.compute({ seed, hidden: false, root: process.cwd() });
        const ok = passes(measure.value, level.threshold, level.direction ?? 'atLeast');
        return {
          pass: ok,
          detail: ok
            ? `${measure.value}`
            : `${measure.value} under ${level.threshold}; ${measure.items
                .slice(0, 2)
                .map((item) => `${item.id}: ${item.detail}`)
                .join(' | ')}`,
        };
      },
    };
  });
}
