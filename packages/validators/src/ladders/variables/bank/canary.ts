import { check } from '../../../failure';
import { fictionalStore } from './files';
import { type BankItem, callValidate, outcomeOf } from './item';
import { hashString, makeRng } from './util';

/**
 * The canary pair (validators/variables/audit.md, cheat 1 of the r4 audit; docs/validators.md 12.9).
 *
 * The validator runs the bank in a child process, but the implementation loads in that same process: an empty
 * implementation plus a hook on the child's standard output can rewrite the verdict line of every item to a pass (0 of
 * 1,111 items became 1,111 of 1,111, on every seed). The frame of 12.9 closes that class. Until the ladder adopts it, two
 * items ask `validate` about one store, one wanting it accepted and one wanting it refused. A deterministic
 * implementation passes at most one of them. When both report a pass, the run is void: the verdicts were rewritten, or the
 * answers depend on how many times the store was seen.
 *
 * The canary items are not in `variablesBank()`: one of them fails on every honest product, so no level may count them.
 * The ladder runs them beside the bank and reads them once the run is done.
 */

export const CANARY_PAIR = ['canary.store-accepted', 'canary.store-refused'] as const;

/** The one store both items ask about: a valid fictional store drawn from the seed alone. */
function storeOf(seed: number) {
  return fictionalStore(makeRng((Math.imul(seed >>> 0, 0x9e3779b1) ^ hashString('canary')) >>> 0), 0).store;
}

function canary(id: (typeof CANARY_PAIR)[number], wantAccepted: boolean): BankItem {
  return {
    id,
    stem: 'canary',
    family: 'sources',
    tier: 1,
    level: 'store-core',
    component: 'store/validate',
    cause: 'validate answers one store the same way each time it is asked',
    check: (ctx) =>
      outcomeOf(() => {
        const result = callValidate(ctx, structuredClone(storeOf(ctx.seed)));
        check(result.ok === wantAccepted, () => ({
          rule: 'validate answers the store of the canary pair',
          got: { ok: result.ok },
          expected: { ok: wantAccepted },
        }));
        return undefined;
      }),
  };
}

/** The two items of the pair, in the order they run. */
export function canaryItems(): BankItem[] {
  return [canary(CANARY_PAIR[0], true), canary(CANARY_PAIR[1], false)];
}

/** Why a seed's run is void, or undefined when it is not: both items of the pair report a pass. */
export function voidReason(run: ReadonlyMap<string, { pass: boolean }>, seed: number): string | undefined {
  if (!CANARY_PAIR.every((id) => run.get(id)?.pass === true)) return undefined;
  return `void: the canary pair (${CANARY_PAIR.join(' and ')}) both passed on seed ${seed}, and no implementation that answers the same store the same way can pass both; the verdicts of this seed were rewritten, or the answers depend on how many times a store was seen, so every item counts as failing`;
}
