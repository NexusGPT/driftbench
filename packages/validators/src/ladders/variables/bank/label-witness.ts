import type { Sources, StoreDoc, VariablesImpl } from '../interface';
import type { BankItem } from './item';
import { fail } from './item';
import { variablesCiting } from './oracle/estate';
import { clone } from './util';

/**
 * The label witness of the span-reading items (docs/validators.md 12.9, "The span vocabulary"). The labels of the spans
 * are recorded from a reader, and the texts a seed can write are few, so a product that carries a table of the texts
 * can label them itself and never use the label it is given. After a span-reading item passes, the witness builds the
 * store once more from the same sources with the label of one numeric condition changed to a limit the text does not
 * state, and asks that the store follow the label. A product that reads the text builds the old limit and fails the item.
 */

/** The family of the first bank whose items read condition spans of an estate. */
const FAMILIES = new Set(['sources', 'quotes', 'values', 'boundaries']);

const SHIFT = 7;

/** The first numeric condition of the sources the store gives a boundary for: its text, the boundary and the variable. */
function numericCondition(sources: Sources, store: StoreDoc) {
  for (const rule of sources.estate?.rules ?? []) {
    for (const condition of rule.conditions) {
      const variable = variablesCiting(store, condition.text)[0];
      const boundary = variable?.boundaries?.[0];
      if (variable && boundary && typeof boundary.limit === 'number' && boundary.comparison)
        return { text: condition.text, variable, boundary };
    }
  }
  return undefined;
}

export function withLabelWitness(item: BankItem): BankItem {
  if (!FAMILIES.has(item.family)) return item;
  return {
    ...item,
    check: async (ctx) => {
      const build = ctx.impl.buildStore as VariablesImpl['buildStore'] | undefined;
      if (!build) return item.check(ctx);
      let first: Sources | undefined;
      const impl = {
        ...ctx.impl,
        buildStore: (sources: Sources) => {
          first ??= sources;
          return build(sources);
        },
      };
      const outcome = await item.check({ ...ctx, impl });
      if (!outcome.pass || !first?.estate) return outcome;
      try {
        const store = build(clone(first));
        const found = numericCondition(first, store);
        if (!found) return outcome;
        const limit = (found.boundary.limit as number) + SHIFT;
        const probe = clone(first);
        for (const rule of probe.estate?.rules ?? []) {
          for (const condition of rule.conditions) {
            if (condition.text !== found.text) continue;
            (condition as { label?: unknown }).label = {
              kind: 'numeric',
              subject: found.variable.title ?? found.variable.id,
              limit,
              comparison: found.boundary.comparison,
              ...(found.boundary.unit === undefined ? {} : { unit: found.boundary.unit }),
            };
          }
        }
        const again = build(probe);
        const followed = variablesCiting(again, found.text).some((v) =>
          (v.boundaries ?? []).some((b) => b.limit === limit),
        );
        if (!followed)
          return fail(
            `the label given to "${found.text}" says the limit ${limit}, its text says ${found.boundary.limit}: the store did not follow the label, so the product read the text`,
          );
      } catch (cause) {
        return fail(
          `the label witness could not build the store: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      return outcome;
    },
  };
}
