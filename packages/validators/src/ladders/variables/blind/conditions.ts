import { check } from '../../../failure';
import type { ItemContext } from '../bank/item';
import type { StoreDoc, StoreValue, StoreVariable } from '../interface';
import { callBuild, must, show } from './kit';
import type { Cmp } from './spans';

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
  const file = texts.map((t) => `Escalate when ${t}.`).join('\n');
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
  const rule = 'a numeric condition gives three samples, below, at and above its limit, with the roles its comparison names';
  const input = () => ({ file: r.text });
  const sampleList = () => r.samples.map((s) => s.sample).sort((a, b) => a - b);
  check(r.samples.length === 3, () => ({ rule, input: input(), got: { samples: sampleList() }, expected: { count: 3 } }));
  const nums = r.samples.map((s) => s.sample).sort((a, b) => a - b);
  check(new Set(nums).size === 3, () => ({ rule, input: input(), got: { samples: nums }, expected: 'three distinct samples' }));
  check((nums[0] as number) < limit && (nums[1] as number) === limit && (nums[2] as number) > limit, () => ({
    rule,
    input: input(),
    got: { samples: nums },
    expected: { limit },
  }));
  if (integer)
    check(nums.every(Number.isInteger), () => ({ rule, input: input(), got: { samples: nums }, expected: 'whole samples' }));
  const b = r.variable.boundaries?.find((x) => x.limit === limit && x.comparison === c);
  check(!!b, () => ({ rule, input: input(), got: { boundaries: r.variable.boundaries }, expected: { limit, comparison: c } }));
  const bound = b as NonNullable<typeof b>;
  const sampleOf = (id: string): number | undefined =>
    r.variable.values.find((x) => x.id === id)?.sample as number | undefined;
  const hs = sampleOf(bound.holds) as number;
  const fs = sampleOf(bound.fails) as number;
  const es = sampleOf(bound.edge) as number;
  const got = () => ({ holds: hs, fails: fs, edge: es });
  check(new Set([bound.holds, bound.fails, bound.edge]).size === 3, () => ({
    rule,
    input: input(),
    got: { boundary: bound },
    expected: 'three values',
  }));
  check(es === limit, () => ({ rule, input: input(), got: got(), expected: { edge: limit } }));
  const upward = c === 'gt' || c === 'ge';
  check(upward ? hs > limit && fs < limit : hs < limit && fs > limit, () => ({
    rule,
    input: input(),
    got: got(),
    expected: { comparison: c, limit },
  }));
}
