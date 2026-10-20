import { bankMeasure, defineLadder, type Ladder } from '../../../ladder';
import { advancedLabellerBank } from './advanced-bank';
import { LABELLER_TIER_BARS, type LabellerBankItem, type LabellerFactory, labellerBank } from './bank';

export * from './advanced-bank';
export * from './bank';
export * from './fixtures';

export type JudgesV3Options = { bank?: LabellerBankItem[]; labellerFactory?: LabellerFactory };

/** Base classification plus independently specified advanced analysis capabilities. */
export function judgesV3Bank(): LabellerBankItem[] {
  return [...labellerBank(), ...advancedLabellerBank()];
}

/** Additive opt-in version: the default version-2 judge bank is unchanged. */
export function judgesLadderV3(options: JudgesV3Options = {}): Ladder {
  const bank = options.bank ?? judgesV3Bank();
  return defineLadder({
    component: 'judges',
    version: 3,
    levels: ([1, 2, 3, 4, 5] as const).map((tier) => {
      const own = bank.filter((item) => item.tier === tier);
      const bars = LABELLER_TIER_BARS[tier];
      return {
        id: `labellers-tier-${tier}`,
        name: `labeller tier ${tier}: agreement, robustness, recording integrity and analysis`,
        metric: `items passing raw agreement >= ${bars.agreement}, Cohen kappa >= ${bars.kappa}, pair relations and applicable analysis checks / ${own.length} items`,
        threshold: 1,
        async compute({ seed }) {
          const results = [];
          for (const item of own) {
            const result = await item.run(seed, options.labellerFactory);
            results.push({
              id: item.id,
              family: item.family,
              tier,
              component: item.component,
              cause: item.cause,
              pass: result.pass,
              detail: result.detail,
            });
          }
          return bankMeasure(results, 'packages/judges/src/labeller.ts');
        },
      };
    }),
  });
}
