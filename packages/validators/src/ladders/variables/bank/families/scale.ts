import { check, none } from '../../../../failure';
import type { ConversationInput, Plan } from '../../interface';
import { build, callCoverage, type ItemContext, planOf, type StemRun } from '../item';
import {
  nounNumber,
  numericSpan,
  type Quantity,
  ruleSentence,
  VOCABULARY_SIZE,
  vocabularyOf,
} from '../oracle/conditions';
import { estateOf, type RuleSpec, variablesCiting } from '../oracle/estate';
import { greedyBound, shapeProblems } from '../oracle/planCheck';
import { rowsWithForbidden, scanCoverage } from '../oracle/scan';
import {
  counterGroups,
  forbid,
  forbidSet,
  indexRow,
  isForbidden,
  makeSpace,
  type Space,
  type SpaceGroup,
  toStore,
} from '../oracle/space';
import { choose, cpuMs, must, type Rng, show } from '../util';
import { toBig } from './counter';
import { type Base, baseStore, checkCounts, draw } from './sources';

const BOUND = 1.25;

type Run = { plan: Plan; ms: number };

function planTimed(ctx: ItemContext, space: Space, seed = ctx.seed): Run {
  const store = toStore(space);
  const { value: plan, ms } = cpuMs(() => planOf(ctx, store, { seed }));
  return { plan, ms };
}

/** Checks the shape, the impossible pairs, the scan coverage, the bound and the processor time of a scale plan. */
function verify(
  space: Space,
  run: Run,
  groups: readonly SpaceGroup[],
  limits: { budgetMs: number; maxRows?: number; factor?: number },
  label: string,
): void {
  const problems = shapeProblems(space, run.plan, []);
  check(problems.length === 0, () => ({
    rule: 'the plan has a sound shape',
    input: label,
    got: { problems },
    expected: none('observation'),
  }));
  const rows = run.plan.rows.map((r) => indexRow(space, r.values) as number[]);
  const bad = rowsWithForbidden(space, rows);
  check(bad.count === 0, () => ({
    rule: 'no row of the plan holds an impossible pair',
    input: label,
    got: { rowsWithAnImpossiblePair: bad.count, first: bad.first },
    expected: none('observation'),
  }));
  const scan = scanCoverage(space, groups, rows);
  check(scan.missing === 0, () => ({
    rule: 'every required tuple is held by the rows',
    input: label,
    got: { tuplesNotHeld: scan.missing },
    expected: { required: scan.required, notHeld: scan.sample },
  }));
  let maxChance = 1;
  for (const g of groups) {
    const t = Math.min(g.strength, g.vars.length);
    const arities = g.vars.map((i) => space.vars[i]?.values.length ?? 1).sort((a, b) => b - a);
    maxChance = Math.max(
      maxChance,
      arities.slice(0, t).reduce((a, b) => a * b, 1),
    );
  }
  const bound = Math.ceil((limits.factor ?? BOUND) * greedyBound(scan.required, 1 / maxChance)) + 1;
  const cap = Math.min(bound, limits.maxRows ?? bound);
  check(rows.length <= cap, () => ({
    rule: 'a covering array stays within the row bound of the page',
    input: { label, requiredTuples: scan.required },
    got: { rows: rows.length },
    expected: { atMost: cap },
  }));
  check(run.ms <= limits.budgetMs, () => ({
    rule: '{}: planning took {} ms of processor time, over {} ms',
    got: { details: [label, Math.round(run.ms), limits.budgetMs] }, expected: none('observation')
  }));
}

const axesGroup = (space: Space): SpaceGroup => ({
  id: 'axes',
  kind: 'shared',
  vars: space.vars.map((_, i) => i),
  strength: 2,
});

function pairwiseCase(arity: number, n: number): Space {
  return makeSpace(Array(n).fill(arity), { shared: Array.from({ length: n }, (_, i) => i) });
}

const PAIRWISE: Record<string, { arity: number; n: number; budgetMs: number }> = {
  n20: { arity: 2, n: 20, budgetMs: 5000 },
  n50: { arity: 2, n: 50, budgetMs: 5000 },
  n100: { arity: 2, n: 100, budgetMs: 10_000 },
  n200: { arity: 2, n: 200, budgetMs: 15_000 },
  n400: { arity: 2, n: 400, budgetMs: 40_000 },
  'ternary-30': { arity: 3, n: 30, budgetMs: 10_000 },
  'ternary-60': { arity: 3, n: 60, budgetMs: 30_000 },
  'arity-eight-10': { arity: 8, n: 10, budgetMs: 10_000 },
  'arity-eight-20': { arity: 8, n: 20, budgetMs: 40_000 },
};

function randomRules(rng: Rng, pool: number, count: number, size: number): number[][] {
  return Array.from({ length: count }, () =>
    rng.sample(
      Array.from({ length: pool }, (_, i) => i),
      size,
    ),
  );
}

export const SCALE_RUNS: Record<string, StemRun> = {
  'scale.pairwise-binary': (variant, ctx) => {
    const c = PAIRWISE[variant] as { arity: number; n: number; budgetMs: number };
    const space = pairwiseCase(c.arity, c.n);
    const run = planTimed(ctx, space);
    verify(
      space,
      run,
      [axesGroup(space)],
      { budgetMs: c.budgetMs },
      `${c.n} shared axes of arity ${c.arity}`,
    );
  },

  'scale.many-rules': (variant, ctx) => {
    const { rng } = ctx;
    const [pool, count] =
      variant === 'twenty-rules' ? [60, 20] : variant === 'hundred-rules' ? [160, 100] : [20, 100];
    const rules = randomRules(rng, pool, count, 6);
    const space = makeSpace(Array(pool).fill(2), { rules });
    const run = planTimed(ctx, space);
    const groups: SpaceGroup[] = space.rules.map((r) => ({
      id: r.id,
      kind: 'rule',
      vars: [...new Set(r.vars)].sort((a, b) => a - b),
      strength: 3,
    }));
    const others: SpaceGroup[] = space.vars.flatMap((_, i) =>
      space.rules.some((r) => r.vars.includes(i))
        ? []
        : [{ id: `v${i}`, kind: 'other' as const, vars: [i], strength: 1 }],
    );
    verify(
      space,
      run,
      [...groups, ...others],
      { budgetMs: 30_000 },
      `${count} rules of 6 binary variables drawn from ${pool}`,
    );
  },

  'scale.thousand-others': (variant, ctx) => {
    const n = variant === 'one-thousand' ? 1000 : 5000;
    const space = makeSpace(Array(n).fill(3));
    const run = planTimed(ctx, space);
    const groups: SpaceGroup[] = space.vars.map((_, i) => ({
      id: `v${i}`,
      kind: 'other',
      vars: [i],
      strength: 1,
    }));
    verify(
      space,
      run,
      groups,
      { budgetMs: 10_000, maxRows: 6 },
      `${n} variables of arity 3 in no rule and no axis`,
    );
  },

  'scale.many-impossible-pairs': (variant, ctx) => {
    const { rng } = ctx;
    const n = 200;
    const axes = 30;
    const space = makeSpace(Array(n).fill(4), { shared: Array.from({ length: axes }, (_, i) => i) });
    const want = variant === 'two-thousand' ? 2000 : 20000;
    const taken = forbidSet(space);
    for (let tries = 0, added = 0; added < want && tries < want * 20; tries += 1) {
      const a = rng.int(0, n - 2);
      const b = rng.int(a + 1, n - 1);
      const va = rng.int(1, 3);
      const vb = rng.int(1, 3);
      if (isForbidden(taken, a, va, b, vb)) continue;
      forbid(space, a, va, b, vb);
      taken.add(((a * 4096 + va) * 65536 + b) * 4096 + vb);
      added += 1;
    }
    const run = planTimed(ctx, space);
    const groups: SpaceGroup[] = [
      { id: 'axes', kind: 'shared', vars: Array.from({ length: axes }, (_, i) => i), strength: 2 },
      ...space.vars.flatMap((_, i) =>
        i < axes ? [] : [{ id: `v${i}`, kind: 'other' as const, vars: [i], strength: 1 }],
      ),
    ];
    verify(
      space,
      run,
      groups,
      { budgetMs: 30_000, factor: 4 },
      `${n} variables of arity 4 (${axes} axes) with ${space.forbidden.length} impossible pairs`,
    );
  },

  'scale.estate-spans': (variant, ctx) => {
    const { rng } = ctx;
    const spans = variant === 'two-hundred' ? 200 : variant === 'two-thousand' ? 2000 : 10000;
    const filesCount = 20;
    const byFile: string[][] = Array.from({ length: filesCount }, () => []);
    const rules: RuleSpec[] = [];
    const texts: string[] = [];
    // The spans come from the fixed vocabulary (oracle/conditions.ts): the seed picks which ones, their order and their files.
    const picked = rng.sample(
      Array.from({ length: VOCABULARY_SIZE }, (_, i) => i),
      spans,
    );
    picked.forEach((index, i) => {
      const v = vocabularyOf(index);
      const q: Quantity = { noun: nounNumber(index), unit: ' euros', kind: 'money' };
      const span = numericSpan(v.cls, v.wording, q, v.limit);
      const f = i % filesCount;
      (byFile[f] as string[]).push(ruleSentence(span.text, rng));
      rules.push({ id: `R${i + 1}`, source: `docs/part-${f}.md`, conditions: [span.text], tools: [] });
      texts.push(span.text);
    });
    const files: Record<string, string> = {};
    byFile.forEach((sentences, f) => {
      let text = `# Part ${f}\n\n${sentences.join('\n')}\n`;
      let k = 0;
      while (text.length < 100_000) {
        text += `Filler line ${k} keeps the file long enough to be read in earnest.\n`;
        k += 1;
      }
      files[`docs/part-${f}.md`] = text;
    });
    const estate = estateOf(files, rules);
    const { value: store, ms } = cpuMs(() => build(ctx, { estate }));
    check(store.refused.length === 0, () => ({
      rule: '{} refusals for findable spans: {}',
      got: { details: [store.refused.length, show(store.refused.slice(0, 2))] }, expected: none('observation')
    }));
    check(store.variables.length === spans, () => ({
      rule: '{} spans with distinct nouns give {} variables',
      got: { details: [spans, store.variables.length] }, expected: none('observation')
    }));
    check(
      store.variables.every((v) => v.values.length === 3),
      () => ({ rule: 'a variable does not hold three values', expected: none('observation') }),
    );
    for (const k of rng.sample(
      Array.from({ length: spans }, (_, i) => i),
      30,
    )) {
      const hit = variablesCiting(store, texts[k] as string);
      check(hit.length === 1, () => ({
        rule: 'a span is cited by one variable',
        input: { span: texts[k] },
        got: { variables: hit.length },
        expected: { variables: 1 },
      }));
    }
    const budget = spans <= 200 ? 5000 : spans <= 2000 ? 10_000 : 30_000;
    check(ms <= budget, () => ({
      rule: 'reading {} spans in {} files of 100 KB took {} ms of processor time, over {} ms',
      got: { details: [spans, filesCount, Math.round(ms), budget] }, expected: none('observation')
    }));
  },

  'scale.conversations': (variant, ctx) => {
    const { rng } = ctx;
    const base: Base = baseStore(ctx, Array(8).fill(5));
    const n = variant === 'ten-thousand' ? 10_000 : 100_000;
    const skew = [1, 1.2, 1.4, 1.6, 1.8];
    const mixes = base.vars.map(() => skew.map((x) => x / skew.reduce((a, b) => a + b, 0)));
    const { sessions, counts, observed } = draw(rng, base, n, mixes);
    const { value: store, ms } = cpuMs(() =>
      build(ctx, { estate: base.estate, conversations: sessions as ConversationInput[] }),
    );
    checkCounts(store, base, counts, observed);
    const budget = n <= 10_000 ? 2000 : 5000;
    check(ms <= budget, () => ({
      rule: 'counting {} sessions took {} ms of processor time, over {} ms',
      got: { details: [n, Math.round(ms), budget] }, expected: none('observation')
    }));
  },

  'scale.counter-big-plan': (variant, ctx) => {
    const { rng } = ctx;
    const [n, t] = variant === 'hundred-binary-t3' ? [100, 3] : [200, 2];
    const space = makeSpace(Array(n).fill(2));
    const rows = Array.from({ length: 30 }, () => Array.from({ length: n }, () => rng.int(0, 1)));
    const group: SpaceGroup = { id: 'g', kind: 'rule', vars: space.vars.map((_, i) => i), strength: t };
    const scan = scanCoverage(space, [group], rows);
    const want = BigInt(choose(n, t)) * BigInt(2 ** t);
    check(BigInt(scan.required) === want, () => ({ rule: 'the bank scan disagrees with the closed form', expected: none('observation') }));
    const store = toStore(space);
    const asRows = rows.map((r) =>
      Object.fromEntries(r.map((v, i) => [`v${String(i).padStart(3, '0')}`, `x${v}`])),
    );
    const { value: result, ms } = cpuMs(() =>
      callCoverage(ctx, store, asRows, counterGroups(space, [group])),
    );
    check(toBig(result.allowed, 'allowed') === want, () => ({
      rule: 'coverage counts the allowed tuples exactly',
      got: { allowed: show(result.allowed) },
      expected: { allowed: String(want) },
    }));
    const covered = BigInt(scan.required - scan.missing);
    check(toBig(result.covered, 'covered') === covered, () => ({
      rule: "covered {}, the bank's scan of the 30 rows gives {}",
      got: { details: [show(result.covered), covered] }, expected: none('observation')
    }));
    check(ms <= 20_000, () => ({
      rule: 'counting the coverage of 30 rows over {} binary variables at strength {} took {} ms of processor time, over 20000 ms',
      got: { details: [n, t, Math.round(ms)] }, expected: none('observation')
    }));
  },

  'scale.big-arity-axis': (_variant, ctx) => {
    const space = makeSpace([200, 2, 2, 2], { shared: [0, 1, 2, 3] });
    const run = planTimed(ctx, space);
    verify(
      space,
      run,
      [axesGroup(space)],
      { budgetMs: 10_000 },
      'one axis of 200 values beside three binary axes',
    );
  },
};
