import type { Atom } from '../schema';

/**
 * A numeric condition of an atom, read from a field and nowhere else. No word of a situation or a quote is
 * matched: "more than two days" in prose makes no condition. Two fields give one:
 *
 * - `fields.condition`, in the shape of a store boundary: `{ limit, comparison, unit? }`, where the comparison
 *   is `lt`, `le`, `gt` or `ge` and says how the quantity is compared with the limit for the condition to hold.
 *   A reader that finds a number (a structured file, or the labels of the pointer reader) writes it there;
 * - the limits an estate check measures, listed in `STRUCTURED_LIMITS`: the invariant `standing_size` carries
 *   the `ceiling` of the standing instructions, in characters, and the check fails above it.
 */

export type Comparison = 'lt' | 'le' | 'gt' | 'ge';
export type Condition = { limit: number; comparison: Comparison; unit?: string };

const COMPARISONS: ReadonlySet<string> = new Set(['lt', 'le', 'gt', 'ge']);

/** The limits the estate itself measures: the kind and the check of the atom, the field that holds the limit. */
const STRUCTURED_LIMITS: ReadonlyArray<{
  kind: Atom['kind'];
  check: string;
  limit: string;
  comparison: Comparison;
  unit: string;
}> = [{ kind: 'invariant', check: 'standing_size', limit: 'ceiling', comparison: 'le', unit: 'characters' }];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The condition `fields.condition` holds, or undefined when it is not exactly `{ limit, comparison, unit? }`. */
function declared(value: unknown): Condition | undefined {
  if (!isRecord(value)) return undefined;
  const extra = Object.keys(value).filter((key) => !['limit', 'comparison', 'unit'].includes(key));
  const { limit, comparison, unit } = value;
  if (extra.length > 0 || typeof limit !== 'number' || !Number.isFinite(limit)) return undefined;
  if (typeof comparison !== 'string' || !COMPARISONS.has(comparison)) return undefined;
  if (unit !== undefined && (typeof unit !== 'string' || unit === '')) return undefined;
  return { limit, comparison: comparison as Comparison, ...(unit === undefined ? {} : { unit }) };
}

/** The condition of an atom, with a base for its variable id, or undefined when its fields hold none. */
export function conditionOf(atom: Atom): (Condition & { base: string }) | undefined {
  const fields = atom.fields ?? {};
  const own = declared(fields.condition);
  if (own !== undefined) return { ...own, base: atom.id };
  for (const rule of STRUCTURED_LIMITS) {
    const limit = fields[rule.limit];
    if (
      atom.kind === rule.kind &&
      fields.check === rule.check &&
      typeof limit === 'number' &&
      Number.isFinite(limit)
    ) {
      return { limit, comparison: rule.comparison, unit: rule.unit, base: rule.check };
    }
  }
  return undefined;
}
