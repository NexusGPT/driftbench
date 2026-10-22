import type { ItemContext } from '../../bank/item';
import type { Row, Sources, StoreDoc } from '../../interface';
import {
  callBuild,
  callCoverage,
  callPlan,
  callQuotes,
  cpu,
  jsonEqual,
  makeStore,
  must,
  names,
  newRows,
  rowCap,
  type Stem,
  show,
  subsetsOf,
  valueIds,
} from '../kit';
import { discover, type ToolSpec } from '../scene';
import { numeric } from '../spans';

/** Family scale: R14 (row cap) and R15 (processor time) at the sizes of the table in docs/variables.md. */

const idsOf = (n: number): string[] => Array.from({ length: n }, (_, i) => `q${i}`);
const valIndex = (value: string | undefined): number => Number(String(value).slice(1));

function withinTime(label: string, ms: number, limit: number): void {
  if (process.env.BLIND_BANK_TIMES) process.stderr.write(`${label}: ${Math.round(ms)} ms of ${limit} ms\n`);
  must(
    ms <= limit,
    () => `${label} took ${Math.round(ms)} ms of processor time; the page allows ${limit} ms`,
  );
}

/** Every pair of the variables holds every combination of values in some row; names the first missing one. */
function missingPair(
  rows: readonly Row[],
  ids: readonly string[],
  arities: readonly number[],
): string | undefined {
  const offsets: number[] = [];
  let total = 0;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      offsets.push(total);
      total += (arities[i] as number) * (arities[j] as number);
    }
  }
  const seen = new Uint8Array(total);
  for (const r of rows) {
    let p = 0;
    for (let i = 0; i < ids.length; i += 1) {
      const xi = valIndex(r[ids[i] as string]);
      for (let j = i + 1; j < ids.length; j += 1) {
        seen[(offsets[p] as number) + xi * (arities[j] as number) + valIndex(r[ids[j] as string])] = 1;
        p += 1;
      }
    }
  }
  let p = 0;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const base = offsets[p] as number;
      for (let k = 0; k < (arities[i] as number) * (arities[j] as number); k += 1) {
        if (!seen[base + k]) {
          const x = Math.floor(k / (arities[j] as number));
          return `${ids[i]}=v${x} with ${ids[j]}=v${k - x * (arities[j] as number)}`;
        }
      }
      p += 1;
    }
  }
  return undefined;
}

function missingTriple(rows: readonly Row[], rule: readonly string[]): string | undefined {
  for (const t of subsetsOf(rule, 3)) {
    const seen = new Set<number>();
    for (const r of rows)
      seen.add(
        valIndex(r[t[0] as string]) * 4 + valIndex(r[t[1] as string]) * 2 + valIndex(r[t[2] as string]),
      );
    if (seen.size < 8) return `${t.join(', ')}: ${seen.size} of 8 combinations`;
  }
  return undefined;
}

function allAssigned(rows: readonly Row[], ids: readonly string[], dom: (id: string) => string[]): void {
  for (const r of rows) {
    for (const id of ids) {
      must(
        r[id] !== undefined && dom(id).includes(r[id] as string),
        () => `a new row gives ${id} the value ${show(r[id])}`,
      );
    }
  }
}

/** Plans axes of the given arities, then checks timing, the row cap and the coverage of every pair. */
function axesWorkload(ctx: ItemContext, arities: number[], limitMs: number, seedsCount = 0): void {
  const ids = idsOf(arities.length);
  const store = makeStore({
    vars: ids.map((id, i) => ({ id, values: valueIds(arities[i] as number), shared: true })),
  });
  const seeds: Row[] = Array.from({ length: seedsCount }, () =>
    Object.fromEntries(ids.map((id, i) => [id, `v${ctx.rng.int(0, (arities[i] as number) - 1)}`])),
  );
  const { value: plan, ms } = cpu(() => callPlan(ctx, store, { seed: ctx.seed, seeds }));
  withinTime(`planning ${ids.length} axes`, ms, limitMs);
  const fresh = newRows(plan);
  if (seedsCount > 0) {
    must(
      plan.rows.slice(0, seedsCount).every((r) => r.kind === 'seed'),
      () => 'the seeds do not lead the plan',
    );
    must(plan.rows.length >= seedsCount, () => `${plan.rows.length} rows for ${seedsCount} seeds`);
  }
  allAssigned(
    fresh.map((r) => r.values),
    ids,
    () => valueIds(Math.max(...arities)),
  );
  const all = plan.rows.map((r) => r.values);
  const gap = missingPair(all, ids, arities);
  must(gap === undefined, () => `no row holds ${gap}`);
  // R14: the new rows stay under ceil(1.25 G) + 1, with G from the pairs the seeds miss.
  const widest =
    (arities.slice().sort((a, b) => b - a)[0] as number) *
    (arities.length > 1 ? (arities.slice().sort((a, b) => b - a)[1] as number) : 1);
  let missing = 0;
  for (let i = 0; i < ids.length; i += 1)
    for (let j = i + 1; j < ids.length; j += 1) missing += (arities[i] as number) * (arities[j] as number);
  if (seedsCount === 0) {
    const cap = rowCap(missing, widest);
    must(
      fresh.length <= cap,
      () => `${fresh.length} new rows for ${ids.length} axes; the page allows ${cap}`,
    );
  } else {
    must(
      fresh.length === 0,
      () =>
        `${fresh.length} new rows although ${seedsCount} random seeds over ${ids.length} axes hold every pair`,
    );
  }
}

/** Disjoint or sliding rules of six binary variables. */
function rulesWorkload(ctx: ItemContext, rules: number, stride: number, limitMs: number): void {
  const total = stride * (rules - 1) + 6;
  const ids = idsOf(total);
  const ruleVars: string[][] = Array.from({ length: rules }, (_, k) => ids.slice(k * stride, k * stride + 6));
  const store = makeStore({
    vars: ids.map((id) => ({ id, values: valueIds(2), shared: false })),
    rules: ruleVars.map((variables, k) => ({ id: `rule.${k}`, variables })),
  });
  const { value: plan, ms } = cpu(() => callPlan(ctx, store, { seed: ctx.seed }));
  withinTime(`planning ${rules} rules of six binary variables`, ms, limitMs);
  const rows = newRows(plan).map((r) => r.values);
  for (const rule of ruleVars) {
    const gap = missingTriple(rows, rule);
    must(gap === undefined, () => `rule ${rule[0]}...: ${gap}`);
  }
  const distinct = new Set<string>();
  for (const rule of ruleVars) for (const t of subsetsOf(rule, 3)) distinct.add([...t].sort().join('|'));
  const cap = rowCap(distinct.size * 8, 8);
  must(rows.length <= cap, () => `${rows.length} new rows for ${rules} rules; the page allows ${cap}`);
}

/** The estate of `count` condition spans spread over 20 files, one quantity per span. */
function lettersOf(i: number): string {
  let n = i;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  } while (n > 0);
  return out;
}

/** How an English condition compares a quantity with a limit: every wording of the four ordered comparisons the blind bank uses. */
const SPAN_WORDINGS: ReadonlyArray<readonly [phrase: string, cmp: 'gt' | 'ge' | 'lt' | 'le']> = [
  ['is more than', 'gt'],
  ['is over', 'gt'],
  ['exceeds', 'gt'],
  ['is greater than', 'gt'],
  ['is at least', 'ge'],
  ['is no less than', 'ge'],
  ['is under', 'lt'],
  ['is below', 'lt'],
  ['is fewer than', 'lt'],
  ['is at most', 'le'],
  ['is no more than', 'le'],
];

/** The spans of the blind vocabulary: the text of span `index` is a function of `index` alone (docs/validators.md 12.9). */
const BLIND_VOCABULARY = 10_000;
function blindSpan(index: number): { text: string; subject: string; limit: number; cmp: 'gt' | 'ge' | 'lt' | 'le' } {
  const [phrase, cmp] = SPAN_WORDINGS[(index * 5 + Math.floor(index / SPAN_WORDINGS.length)) % SPAN_WORDINGS.length] as (typeof SPAN_WORDINGS)[number];
  const limit = (index % 90) + 5;
  const subject = `the quantity ${lettersOf(index)}`;
  return { text: `${subject} ${phrase} ${limit} days`, subject, limit, cmp };
}

function spansWorkload(ctx: ItemContext, count: number, limitMs: number): void {
  const files: Record<string, string[]> = {};
  const rules: NonNullable<Sources['estate']>['rules'] = [];
  // The seed picks which spans of the vocabulary, their order and their files, never the text of a span.
  const picked = ctx.rng.sample(
    Array.from({ length: BLIND_VOCABULARY }, (_, i) => i),
    count,
  );
  picked.forEach((index, i) => {
    const path = `docs/file${i % 20}.md`;
    const span = blindSpan(index);
    const text = numeric(span.text, span.subject, span.limit, span.cmp);
    const lines = files[path] ?? [];
    files[path] = lines;
    lines.push(`Escalate when ${text}.`);
    rules.push({ id: `rule.${i}`, source: path, conditions: [{ text }], tools: [] });
  });
  const estate = {
    files: Object.fromEntries(Object.entries(files).map(([p, lines]) => [p, lines.join('\n')])),
    rules,
  };
  const { value: store, ms } = cpu(() => callBuild(ctx, { estate }));
  withinTime(`reading ${count} condition spans`, ms, limitMs);
  must(
    store.variables.length === count,
    () => `${store.variables.length} variables for ${count} spans of different quantities`,
  );
  must(
    store.refused.length === 0,
    () => `${store.refused.length} refusals for spans that sit in their files`,
  );
  const thin = store.variables.find((v) => v.values.length < 3);
  must(
    !thin,
    () => `the variable ${thin?.id} has ${thin?.values.length} values; a condition has three samples`,
  );
}

function ownerValuesWorkload(ctx: ItemContext, count: number, limitMs: number): void {
  const tool: ToolSpec = { tool: 'ledger_tool', field: 'mode', values: ['alpha', 'beta'] };
  const d = discover(ctx, [tool]);
  const id = d.ids[0] as string;
  const owner = {
    values: Array.from({ length: count }, (_, i) => ({
      variable: id,
      value: `owned_${i}`,
      words: `The owner adds value number ${i}.`,
      date: '2026-10-17',
    })),
  };
  const { value: store, ms } = cpu(() => d.build({ owner }));
  withinTime(`adding ${count} owner values`, ms, limitMs);
  const variable = store.variables.find((v) => v.id === id);
  must(
    variable?.values.length === count + 2,
    () => `${variable?.values.length} values in the variable; expected ${count + 2}`,
  );
}

function conversationsWorkload(ctx: ItemContext, sessions: number, limitMs: number): void {
  const base = ['one', 'two', 'three', 'four', 'five'];
  const labelsOf = (v: number): string[] => base.map((b) => `${b}_${v}`);
  const tools: ToolSpec[] = names(ctx.rng, 8).map((w, i) => ({
    tool: `${w}_tool`,
    field: `field_${i}`,
    values: labelsOf(i),
  }));
  const d = discover(ctx, tools);
  const counts = d.ids.map(() => ({ seen: 0, by: [0, 0, 0, 0, 0] }));
  const rows: Array<{ id: string; values: Row }> = [];
  for (let s = 0; s < sessions; s += 1) {
    const values: Row = {};
    for (let v = 0; v < d.ids.length; v += 1) {
      if (ctx.rng.chance(0.1)) continue;
      const k = ctx.rng.int(0, 4);
      values[d.ids[v] as string] = labelsOf(v)[k] as string;
      const c = counts[v] as { seen: number; by: number[] };
      c.seen += 1;
      c.by[k] = (c.by[k] as number) + 1;
    }
    rows.push({ id: `session-${s}`, values });
  }
  const { value: store, ms } = cpu(() => d.build({ conversations: rows }));
  withinTime(`counting ${sessions} conversations`, ms, limitMs);
  for (let v = 0; v < d.ids.length; v += 1) {
    const variable = store.variables.find((x) => x.id === d.ids[v]);
    const c = counts[v] as { seen: number; by: number[] };
    for (let k = 0; k < 5; k += 1) {
      const value = variable?.values.find((x) => x.id === labelsOf(v)[k]);
      const entry = value?.provenance?.find((p) => p.kind === 'conversations');
      must(
        entry?.kind === 'conversations' && entry.count === c.by[k] && entry.total === c.seen,
        () => `${d.ids[v]}.${labelsOf(v)[k]}: provenance ${show(entry)}; expected ${c.by[k]} of ${c.seen}`,
      );
    }
  }
}

function quotesWorkload(
  ctx: ItemContext,
  count: number,
  limitMs: number,
  wrongCount = 10,
  exact = false,
): void {
  const fill: string[] = [];
  const quotes: string[] = [];
  let size = 0;
  for (let i = 0; i < count; i += 1)
    quotes.push(`When the signal ${lettersOf(i)} is raised, the agent writes to the ledger.`);
  const per = Math.floor(1_000_000 / count);
  for (let i = 0; i < count; i += 1) {
    const filler = `Background line ${i} describes nothing the agent must do. `.repeat(
      Math.max(1, Math.floor((per - 90) / 52)),
    );
    fill.push(`${filler}\n${quotes[i]}\n`);
    size += fill[i]?.length ?? 0;
  }
  must(size > 900_000, () => 'the bank built a file under 900 kB');
  const wrong = new Set(
    ctx.rng.sample(
      Array.from({ length: count }, (_, i) => i),
      wrongCount,
    ),
  );
  const store = {
    format: 1 as const,
    agent: 'ledger',
    version: '1',
    variables: [
      {
        id: 'signals',
        title: 'Signals',
        kind: 'data' as const,
        role: 'detail' as const,
        approved: true,
        values: quotes.map((q, i) => ({
          id: `s${i}`,
          title: `Signal ${i}`,
          provenance: [
            {
              kind: 'quote' as const,
              path: 'agent/prompt.md',
              quote: wrong.has(i) ? q.replace('ledger', 'archive') : q,
            },
          ],
        })),
      },
    ],
  };
  const { value, ms } = cpu(() => callQuotes(ctx, store, { 'agent/prompt.md': fill.join('') }));
  withinTime(`checking ${count} quotes in a one-megabyte file`, ms, limitMs);
  must(
    value.errors.length === wrong.size,
    () => `${value.errors.length} errors; ${wrong.size} quotes are wrong`,
  );
  if (!exact) return;
  // Each wrong quote is named where it sits: its code and its path, not only a count of errors.
  const want = [...wrong].map(
    (i) => `VARIABLES_QUOTE_NOT_FOUND at variables.0.values.${i}.provenance.0.quote`,
  );
  const got = value.errors.map((e) => `${e.code} at ${e.path}`);
  must(
    jsonEqual([...got].sort(), [...want].sort()),
    () => `quotes reported ${got.slice(0, 3).join('; ')}; the wrong ones are ${want.slice(0, 3).join('; ')}`,
  );
}

function closedForm(n: number, k: number): bigint {
  let c = 1n;
  for (let i = 1; i <= k; i += 1) c = (c * BigInt(n - k + i)) / BigInt(i);
  return c * 2n ** BigInt(k);
}

function closedWorkload(ctx: ItemContext, n: number): void {
  const store = makeStore({ vars: idsOf(n).map((id) => ({ id, values: valueIds(2), shared: true })) });
  const warm = makeStore({ vars: idsOf(12).map((id) => ({ id, values: valueIds(2), shared: true })) });
  callCoverage(ctx, warm, [], [{ variables: idsOf(12), strength: 3 }]);
  const { value, ms } = cpu(() => callCoverage(ctx, store, [], [{ variables: idsOf(n), strength: 3 }]));
  must(
    BigInt(value.allowed) === closedForm(n, 3),
    () => `allowed is ${String(value.allowed)}; the closed form is ${closedForm(n, 3)}`,
  );
  withinTime(`the closed-form count over ${n} binary variables`, ms, 50);
}

/** Distinct (subset, pattern) pairs among rows, counted exactly. */
function coveredByRows(rows: Row[], ids: string[], k: number): number {
  let total = 0;
  const subsets = k === 3 ? tripleIndexes(ids.length) : pairIndexes(ids.length);
  for (const sub of subsets) {
    const seen = new Set<number>();
    for (const r of rows) {
      let code = 0;
      for (const idx of sub) code = code * 2 + valIndex(r[ids[idx] as string]);
      seen.add(code);
    }
    total += seen.size;
  }
  return total;
}

function* pairIndexes(n: number): Generator<number[]> {
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) yield [i, j];
}
function* tripleIndexes(n: number): Generator<number[]> {
  for (let i = 0; i < n; i += 1)
    for (let j = i + 1; j < n; j += 1) for (let l = j + 1; l < n; l += 1) yield [i, j, l];
}

function coverageWorkload(ctx: ItemContext, n: number, k: 2 | 3): void {
  const ids = idsOf(n);
  const store = makeStore({ vars: ids.map((id) => ({ id, values: valueIds(2), shared: true })) });
  const rows: Row[] = Array.from({ length: 30 }, () =>
    Object.fromEntries(ids.map((id) => [id, `v${ctx.rng.int(0, 1)}`])),
  );
  const { value, ms } = cpu(() => callCoverage(ctx, store, rows, [{ variables: ids, strength: k }]));
  withinTime(`the coverage of 30 rows over ${n} binary variables at strength ${k}`, ms, 20_000);
  must(
    BigInt(value.allowed) === closedForm(n, k),
    () => `allowed is ${String(value.allowed)}; expected ${closedForm(n, k)}`,
  );
  const want = coveredByRows(rows, ids, k);
  must(
    BigInt(value.covered) === BigInt(want),
    () => `covered is ${String(value.covered)}; the rows hold ${want} distinct tuples`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Dense impossible pairs: 200 variables of four values, 30 of them axes.

type Dense = {
  ids: string[];
  store: StoreDoc;
  forbidden: Set<string>;
  pairs: Array<[number, number, number, number]>;
  /** For each variable and value, the (variable, value) cells it cannot sit with. */
  byVar: Array<Array<Array<[number, number]>>>;
};

function denseSpace(ctx: ItemContext, forbidCount: number): Dense {
  const n = 200;
  const ids = idsOf(n);
  // Variables sit in four groups (i mod 4). A forbidden pair joins the same value, 2 or 3, of two variables of
  // different groups, so values 0 and 1 stay free and every value can be held: the space is dense and solvable.
  const pool: Array<[number, number, number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (i % 4 === j % 4) continue;
      for (const x of [2, 3]) pool.push([i, x, j, x]);
    }
  }
  const pairs = ctx.rng.sample(pool, forbidCount);
  const forbidden = new Set<string>(pairs.map(([i, x, j, y]) => `${i}.${x}.${j}.${y}`));
  const store = makeStore({
    vars: ids.map((id, i) => ({ id, values: valueIds(4), shared: i < 30 })),
    impossible: pairs.map(
      ([i, x, j, y]) =>
        [ids[i] as string, `v${x}`, ids[j] as string, `v${y}`] as [string, string, string, string],
    ),
  });
  const byVar: Dense['byVar'] = Array.from({ length: n }, () => [[], [], [], []]);
  for (const [i, x, j, y] of pairs) {
    byVar[i]?.[x]?.push([j, y]);
    byVar[j]?.[y]?.push([i, x]);
  }
  return { ids, store, forbidden, pairs, byVar };
}

/** Finds a valid full row that extends the partial one, or undefined when the budget runs out (unknown). */
function complete(
  partial: Map<number, number>,
  dense: Dense,
  nodes = 20_000,
): Map<number, number> | undefined {
  const n = dense.ids.length;
  const byVar = dense.byVar;
  const domain: Array<Set<number>> = Array.from({ length: n }, () => new Set([0, 1, 2, 3]));
  const row = new Map<number, number>();
  let budget = nodes;
  const assign = (v: number, x: number, trail: Array<[number, number]>): boolean => {
    row.set(v, x);
    for (const [j, y] of (byVar[v] as Array<Array<[number, number]>>)[x] as Array<[number, number]>) {
      if (row.get(j) === y) return false;
      if (!row.has(j) && (domain[j] as Set<number>).delete(y)) {
        trail.push([j, y]);
        if ((domain[j] as Set<number>).size === 0) return false;
      }
    }
    return true;
  };
  const undo = (v: number, trail: Array<[number, number]>): void => {
    row.delete(v);
    for (const [j, y] of trail) (domain[j] as Set<number>).add(y);
  };
  for (const [v, x] of partial) {
    if (!(domain[v] as Set<number>).has(x) || !assign(v, x, [])) return undefined;
  }
  const search = (): boolean => {
    if (budget-- <= 0) return false;
    let best = -1;
    let bestSize = 9;
    for (let v = 0; v < n; v += 1) {
      if (row.has(v)) continue;
      const size = (domain[v] as Set<number>).size;
      if (size < bestSize) {
        best = v;
        bestSize = size;
      }
    }
    if (best < 0) return true;
    for (const x of [...(domain[best] as Set<number>)]) {
      const trail: Array<[number, number]> = [];
      if (assign(best, x, trail) && search()) return true;
      undo(best, trail);
    }
    return false;
  };
  return search() ? row : undefined;
}

function denseWorkload(ctx: ItemContext, forbidCount: number): void {
  const dense = denseSpace(ctx, forbidCount);
  const { value: plan, ms } = cpu(() => callPlan(ctx, dense.store, { seed: ctx.seed }));
  withinTime(`planning 200 variables with ${forbidCount} impossible pairs`, ms, 30_000);
  const rows = newRows(plan).map((r) => r.values);
  for (const r of rows) {
    must(
      Object.keys(r).length === dense.ids.length,
      () => 'a new row does not give a value to every variable',
    );
  }
  for (const r of rows) {
    for (const [i, x, j, y] of dense.pairs) {
      must(
        !(r[dense.ids[i] as string] === `v${x}` && r[dense.ids[j] as string] === `v${y}`),
        () => `a new row holds the forbidden pair ${dense.ids[i]}=v${x}, ${dense.ids[j]}=v${y}`,
      );
    }
  }
  // Every value is held by some row (all the other variables can take the free values 0 and 1).
  for (const id of dense.ids) {
    for (let x = 0; x < 4; x += 1)
      must(
        rows.some((r) => r[id] === `v${x}`),
        () => `no row holds ${id}=v${x}, a value that a row with every other variable at 0 or 1 can hold`,
      );
  }
  // R14, factor four: M is at most every pair of the axes plus the values of the details.
  const m = ((30 * 29) / 2) * 16 + 170 * 4;
  const cap = rowCap(m, 16, 4);
  must(
    rows.length <= cap,
    () => `${rows.length} new rows; the page allows ${cap} for dense impossible pairs`,
  );
  // Every pair of axes that no row holds and no constraint forbids must be impossible to extend.
  const held = new Set<string>();
  for (const r of rows) {
    for (let i = 0; i < 30; i += 1) {
      for (let j = i + 1; j < 30; j += 1)
        held.add(`${i}.${valIndex(r[dense.ids[i] as string])}.${j}.${valIndex(r[dense.ids[j] as string])}`);
    }
  }
  for (let i = 0; i < 30; i += 1) {
    for (let j = i + 1; j < 30; j += 1) {
      for (let x = 0; x < 4; x += 1) {
        for (let y = 0; y < 4; y += 1) {
          if (held.has(`${i}.${x}.${j}.${y}`) || dense.forbidden.has(`${i}.${x}.${j}.${y}`)) continue;
          const found = complete(
            new Map([
              [i, x],
              [j, y],
            ]),
            dense,
          );
          if (found)
            throw new Error(
              `the pair ${dense.ids[i]}=v${x}, ${dense.ids[j]}=v${y} is held by no row, yet a valid row holds it`,
            );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------

function independentWorkload(ctx: ItemContext, count: number): void {
  const ids = idsOf(count);
  const store = makeStore({ vars: ids.map((id) => ({ id, values: valueIds(3), shared: false })) });
  const { value: plan, ms } = cpu(() => callPlan(ctx, store, { seed: ctx.seed }));
  withinTime(`planning ${count} independent ternary variables`, ms, 10_000);
  const rows = newRows(plan);
  must(
    rows.length <= 6,
    () => `${rows.length} new rows for ${count} independent ternary variables; six are enough`,
  );
  for (const id of ids)
    for (const x of valueIds(3))
      must(
        rows.some((r) => r.values[id] === x),
        () => `${id}=${x} is in no row`,
      );
}

function wideAxisWorkload(ctx: ItemContext): void {
  const ids = idsOf(4);
  const arities = [200, 2, 2, 2];
  const store = makeStore({
    vars: ids.map((id, i) => ({ id, values: valueIds(arities[i] as number), shared: true })),
  });
  const { value: plan, ms } = cpu(() => callPlan(ctx, store, { seed: ctx.seed }));
  withinTime('planning one arity-200 axis and three binary axes', ms, 10_000);
  const rows = newRows(plan);
  const gap = missingPair(
    rows.map((r) => r.values),
    ids,
    arities,
  );
  must(gap === undefined, () => `no row holds ${gap}`);
  const missing = 200 * 2 * 3 + 3 * 4;
  const cap = rowCap(missing, 400);
  must(
    rows.length >= 400 && rows.length <= cap,
    () => `${rows.length} new rows; at least 400 are needed and the page allows ${cap}`,
  );
}

export const SCALE_STEMS: readonly Stem[] = [
  {
    id: 'scale.axes',
    rules: ['R14', 'R15'],
    family: 'scale',
    component: 'planner/scale',
    heavy: true,
    cause: 'planning many shared axes stays within the row cap of the page and its processor time',
    cases: [
      ['binary-20', 2, (ctx) => axesWorkload(ctx, Array(20).fill(2), 5000)],
      ['binary-50', 2, (ctx) => axesWorkload(ctx, Array(50).fill(2), 5000)],
      ['binary-100', 3, (ctx) => axesWorkload(ctx, Array(100).fill(2), 10_000)],
      ['binary-200', 4, (ctx) => axesWorkload(ctx, Array(200).fill(2), 15_000)],
      ['binary-400', 5, (ctx) => axesWorkload(ctx, Array(400).fill(2), 40_000)],
      ['ternary-30', 3, (ctx) => axesWorkload(ctx, Array(30).fill(3), 10_000)],
      ['ternary-60', 4, (ctx) => axesWorkload(ctx, Array(60).fill(3), 30_000)],
      ['arity-eight-10', 3, (ctx) => axesWorkload(ctx, Array(10).fill(8), 10_000)],
      ['arity-eight-20', 4, (ctx) => axesWorkload(ctx, Array(20).fill(8), 40_000)],
      ['one-arity-200-axis-and-three-binary', 5, wideAxisWorkload],
    ],
  },
  {
    id: 'scale.rules',
    rules: ['R14', 'R15'],
    family: 'scale',
    component: 'planner/scale',
    heavy: true,
    cause: 'planning many rules of six variables stays within the row cap of the page and its processor time',
    cases: [
      ['twenty-rules', 3, (ctx) => rulesWorkload(ctx, 20, 6, 30_000)],
      ['hundred-rules', 4, (ctx) => rulesWorkload(ctx, 100, 6, 30_000)],
      ['overlapping-rules', 5, (ctx) => rulesWorkload(ctx, 60, 2, 30_000)],
    ],
  },
  {
    id: 'scale.details',
    rules: ['R14', 'R15'],
    family: 'scale',
    component: 'planner/scale',
    heavy: true,
    cause: 'independent variables need at most twice their arity in rows and little time',
    cases: [
      ['thousand-ternary', 3, (ctx) => independentWorkload(ctx, 1000)],
      ['five-thousand-ternary', 4, (ctx) => independentWorkload(ctx, 5000)],
    ],
  },
  {
    id: 'scale.dense-pairs',
    rules: ['R14', 'R15'],
    family: 'scale',
    component: 'planner/scale',
    heavy: true,
    cause:
      'dense impossible pairs over hundreds of variables give valid rows, within four times the cap and the processor time',
    cases: [
      ['two-thousand-pairs', 4, (ctx) => denseWorkload(ctx, 2000)],
      ['twenty-thousand-pairs', 5, (ctx) => denseWorkload(ctx, 20_000)],
    ],
  },
  {
    id: 'scale.seeds',
    rules: ['R15'],
    family: 'scale',
    component: 'planner/scale',
    heavy: true,
    cause: 'many seeds over shared axes are kept and credited within the processor time',
    cases: [
      ['five-hundred-seeds', 3, (ctx) => axesWorkload(ctx, Array(20).fill(3), 8000, 500)],
      ['three-thousand-seeds', 4, (ctx) => axesWorkload(ctx, Array(20).fill(3), 8000, 3000)],
    ],
  },
  {
    id: 'scale.readers',
    rules: ['R15'],
    family: 'scale',
    component: 'store/estate',
    heavy: true,
    cause:
      'the readers handle thousands of spans, conversations, quotes and owner values within the processor time',
    cases: [
      ['spans-200', 3, (ctx) => spansWorkload(ctx, 200, 5000)],
      ['spans-2000', 4, (ctx) => spansWorkload(ctx, 2000, 10_000)],
      ['spans-10000', 5, (ctx) => spansWorkload(ctx, 10_000, 30_000)],
      ['conversations-10000', 3, (ctx) => conversationsWorkload(ctx, 10_000, 2000)],
      ['conversations-100000', 5, (ctx) => conversationsWorkload(ctx, 100_000, 5000)],
      ['quotes-2000-in-one-megabyte', 4, (ctx) => quotesWorkload(ctx, 2000, 3000)],
      ['quotes-2000-reports-each-wrong-one', 4, (ctx) => quotesWorkload(ctx, 2000, 3000, 3, true)],
      ['owner-values-2000', 3, (ctx) => ownerValuesWorkload(ctx, 2000, 3000)],
      ['owner-values-10000', 4, (ctx) => ownerValuesWorkload(ctx, 10_000, 3000)],
    ],
  },
  {
    id: 'scale.counter',
    rules: ['R15'],
    family: 'scale',
    component: 'planner/counter',
    heavy: true,
    cause: 'counting is closed-form without rows, and fast with a few rows over hundreds of variables',
    cases: [
      ['closed-form-200-binary', 3, (ctx) => closedWorkload(ctx, 200)],
      ['closed-form-500-binary', 4, (ctx) => closedWorkload(ctx, 500)],
      ['thirty-rows-100-binary-strength-3', 4, (ctx) => coverageWorkload(ctx, 100, 3)],
      ['thirty-rows-200-binary-strength-2', 4, (ctx) => coverageWorkload(ctx, 200, 2)],
    ],
  },
];
