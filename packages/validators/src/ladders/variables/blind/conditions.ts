import type { ItemContext } from '../bank/item';
import type { StoreDoc, StoreValue, StoreVariable } from '../interface';
import { callBuild, must, show } from './kit';
import { type DrawOptions, drawCondition, type Form, policyFile } from './draws';
import { type Cmp, numeric } from './spans';

/** Reading condition spans from one file, and the checks every numeric condition must pass. */

export type { Cmp } from './spans';

export const PATH = 'policy/rules.md';

export type Read = {
  store: StoreDoc;
  variable: StoreVariable;
  samples: Array<{ value: StoreValue; sample: number }>;
  text: string;
};

/** Reads one or more condition spans written into one file and returns the variable that carries numeric samples. */
export function readSpans(ctx: ItemContext, texts: string[]): Read {
  const file = policyFile(ctx.rng, texts);
  const store = callBuild(ctx, {
    estate: {
      files: { [PATH]: file },
      rules: texts.map((t, i) => ({ id: `rule.${i}`, source: PATH, conditions: [{ text: t }], tools: [] })),
    },
  });
  const variable = store.variables.find((v) => v.values.some((x) => typeof x.sample === 'number'));
  must(
    !!variable,
    () =>
      `no variable of the store has numeric samples for ${show(texts)}; variables: ${show(
        store.variables.map((v) => v.values.map((x) => x.sample)),
        200,
      )}; refused: ${show(store.refused, 200)}`,
  );
  const v = variable as StoreVariable;
  const samples = v.values
    .filter((x) => typeof x.sample === 'number')
    .map((x) => ({ value: x, sample: x.sample as number }));
  return { store, variable: v, samples, text: file };
}

/** The three samples of one condition and the roles of the boundary against its comparison. */
export function checkCondition(r: Read, limit: number, c: Cmp, integer: boolean): void {
  must(
    r.samples.length === 3,
    () =>
      `${r.samples.length} samples ${show(r.samples.map((s) => s.sample))}; a condition has three: below, at and above its limit`,
  );
  const nums = r.samples.map((s) => s.sample).sort((a, b) => a - b);
  must(new Set(nums).size === 3, () => `samples ${show(nums)} are not distinct`);
  must(
    (nums[0] as number) < limit && (nums[1] as number) === limit && (nums[2] as number) > limit,
    () => `samples ${show(nums)} are not below, at and above ${limit}`,
  );
  if (integer)
    must(
      nums.every(Number.isInteger),
      () => `samples ${show(nums)} are not whole numbers for the whole limit ${limit}`,
    );
  const b = r.variable.boundaries?.find((x) => x.limit === limit && x.comparison === c);
  must(!!b, () => `no boundary with limit ${limit} and comparison ${c}: ${show(r.variable.boundaries)}`);
  const bound = b as NonNullable<typeof b>;
  const sampleOf = (id: string): number | undefined =>
    r.variable.values.find((x) => x.id === id)?.sample as number | undefined;
  const hs = sampleOf(bound.holds) as number;
  const fs = sampleOf(bound.fails) as number;
  const es = sampleOf(bound.edge) as number;
  must(
    new Set([bound.holds, bound.fails, bound.edge]).size === 3,
    () => `holds, fails and edge are not three values: ${show(bound)}`,
  );
  must(es === limit, () => `the edge value has sample ${es}, not the limit ${limit}`);
  if (c === 'gt' || c === 'ge')
    must(
      hs > limit && fs < limit,
      () => `for ${c}, holds has sample ${hs} and fails ${fs} against the limit ${limit}`,
    );
  else
    must(
      hs < limit && fs > limit,
      () => `for ${c}, holds has sample ${hs} and fails ${fs} against the limit ${limit}`,
    );
}

/** An item that draws one numeric condition of a comparison and a form, reads it, and checks the three samples. */
export const drawnCase =
  (cmp: Cmp, form: Form, options: DrawOptions = {}) =>
  (ctx: ItemContext): void => {
    const d = drawCondition(ctx.rng, cmp, form, options);
    checkCondition(readSpans(ctx, [numeric(d.text, d.subject, d.limit, d.cmp)]), d.limit, d.cmp, d.integer);
  };
