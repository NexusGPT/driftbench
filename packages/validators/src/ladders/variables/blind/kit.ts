import type { BankItem, ItemContext } from '../bank/item';
import { outcomeOf } from '../bank/item';
import { FAMILY_LEVEL, type Family, type Tier } from '../bank/manifest/types';
import { attempt, Fail, must, type Rng, show } from '../bank/util';
import type {
  CoverageResult,
  FileStore,
  Group,
  Plan,
  PlanOptions,
  QuotesResult,
  Row,
  Sources,
  StoreDoc,
  ValidateResult,
  VariablesImpl,
} from '../interface';
import { CAUSES } from './causes';
import { beginLexicon } from './lexicon';

/**
 * The tools of the blind variables bank. The bank was written from docs/variables.md ("Programmatic readers and
 * planning"), docs/validators.md and the public interface alone: no item reads the store, the readers or the
 * planner of the product. Every oracle below follows from the page, and the test of the bank runs the items
 * against a reference written from the same page (packages/validators/test/variables-blind/reference.ts).
 */

export { Fail, must, show };

/** The families of the blind bank, the ones the owner's row lists. */
export const BLIND_FAMILIES = [
  'sources',
  'quotes',
  'values',
  'boundaries',
  'impossible-pairs',
  'weights',
  'strength',
  'seed-rows',
  'budget-order',
  'counter',
  'scale',
] as const satisfies readonly Family[];
export type BlindFamily = (typeof BLIND_FAMILIES)[number];

/** A check returns when the item passes (a string is kept as its note) and throws when it does not. */
export type Run = (ctx: ItemContext) => unknown;
/** One item: a key, its tier, its check and, when it points at a cause of its own, that cause. */
export type Case = readonly [key: string, tier: Tier, run: Run, cause?: string];
export type Stem = {
  id: string;
  family: BlindFamily;
  component: string;
  cause: string;
  heavy?: boolean;
  /** The rules of docs/variables.md the stem checks (the row of its family in "Rules by bank family"). */
  rules: readonly string[];
  cases: readonly Case[];
};

export const HEAVY_BUDGET_MS = 300_000;

/** The items of some stems: the item id is `blind.<stem id>.<case key>`. */
export function expand(stems: readonly Stem[]): BankItem[] {
  const items: BankItem[] = [];
  for (const stem of stems) {
    for (const [key, tier, run, cause] of stem.cases) {
      items.push({
        id: `blind.${stem.id}.${key}`,
        stem: `blind.${stem.id}`,
        family: stem.family,
        tier,
        level: FAMILY_LEVEL[stem.family],
        component: stem.component,
        cause: cause ?? CAUSES[stem.id]?.[key] ?? stem.cause,
        ...(stem.heavy ? { budgetMs: HEAVY_BUDGET_MS } : {}),
        check: (ctx) =>
          outcomeOf(async () => {
            beginLexicon(ctx);
            const note = await run(ctx);
            return typeof note === 'string' ? note : undefined;
          }),
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------------------------------------------
// Calls into the implementation. A missing function, a throw or a reply of the wrong kind fails the item.

const MISSING = 'is not provided by the variables implementation';

export function need<K extends keyof VariablesImpl>(ctx: ItemContext, name: K): VariablesImpl[K] {
  const f = ctx.impl[name];
  must(typeof f === 'function', `${name} ${MISSING}`);
  return f as VariablesImpl[K];
}

export function callBuild(ctx: ItemContext, sources: Sources): StoreDoc {
  const f = need(ctx, 'buildStore');
  const got = attempt(() => f(sources));
  must(!got.error, () => `buildStore threw ${got.error?.name}: ${got.error?.message}`);
  const s = got.value as StoreDoc | undefined;
  must(
    !!s &&
      Array.isArray(s.variables) &&
      Array.isArray(s.impossible) &&
      Array.isArray(s.rules) &&
      Array.isArray(s.refused),
    () =>
      `buildStore returned ${show(s, 120)}, not a store with the arrays variables, impossible, rules and refused`,
  );
  return s;
}

export function callPlan(ctx: ItemContext, store: StoreDoc, options: PlanOptions): Plan {
  const f = need(ctx, 'plan');
  const got = attempt(() => f(store, options));
  must(!got.error, () => `plan threw ${got.error?.name}: ${got.error?.message}`);
  const p = got.value as Plan | undefined;
  must(!!p && Array.isArray(p.rows), () => `plan returned ${show(p, 120)}, not an object with a rows array`);
  return p;
}

/** The error a plan call throws, or a failure when it returns. */
export function planError(ctx: ItemContext, store: StoreDoc, options: PlanOptions): Error {
  const f = need(ctx, 'plan');
  const got = attempt(() => f(store, options));
  must(!!got.error, () => `plan returned ${show(got.value, 100)} instead of throwing`);
  return got.error as Error;
}

export function callCoverage(
  ctx: ItemContext,
  store: StoreDoc,
  rows: Row[],
  groups: Group[],
  options?: { uncovered?: number },
): CoverageResult {
  const f = need(ctx, 'coverage');
  const got = attempt(() => f(store, rows, groups, options));
  must(!got.error, () => `coverage threw ${got.error?.name}: ${got.error?.message}`);
  const r = got.value as CoverageResult | undefined;
  must(!!r && r.allowed !== undefined && r.covered !== undefined, () => `coverage returned ${show(r, 120)}`);
  return r;
}

export function coverageError(
  ctx: ItemContext,
  store: StoreDoc,
  rows: Row[],
  groups: Group[],
  options?: { uncovered?: number },
): Error {
  const f = need(ctx, 'coverage');
  const got = attempt(() => f(store, rows, groups, options));
  must(!!got.error, () => `coverage returned ${show(got.value, 100)} instead of throwing`);
  return got.error as Error;
}

export function callInterval(ctx: ItemContext, count: number, total: number): [number, number] {
  const f = need(ctx, 'weightInterval');
  const got = attempt(() => f(count, total));
  must(
    !got.error,
    () => `weightInterval(${count}, ${total}) threw ${got.error?.name}: ${got.error?.message}`,
  );
  const v = got.value as unknown;
  must(
    Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number'),
    () => `weightInterval(${count}, ${total}) returned ${show(v)}, expected [lower, upper]`,
  );
  return v as [number, number];
}

export function callValidate(ctx: ItemContext, value: unknown): ValidateResult {
  const f = need(ctx, 'validate');
  const got = attempt(() => f(value));
  must(!got.error, () => `validate threw ${got.error?.name}: ${got.error?.message}; it returns the errors`);
  const r = got.value as ValidateResult | undefined;
  must(
    !!r &&
      typeof r === 'object' &&
      ((r.ok === true && Array.isArray(r.warnings)) || (r.ok === false && Array.isArray(r.errors))),
    () => `validate returned ${show(r, 160)}, not {ok: true, store, warnings} or {ok: false, errors}`,
  );
  return r;
}

export function callQuotes(ctx: ItemContext, store: FileStore, files: Record<string, string>): QuotesResult {
  const f = need(ctx, 'quotes');
  const got = attempt(() => f(store, files));
  must(!got.error, () => `quotes threw ${got.error?.name}: ${got.error?.message}; it returns the issues`);
  const r = got.value as QuotesResult | undefined;
  must(
    !!r && typeof r === 'object' && Array.isArray(r.errors),
    () => `quotes returned ${show(r, 160)}, not {errors}`,
  );
  return r;
}

export function errorNamed(error: Error, kind: 'RangeError' | 'TypeError', what: string): void {
  must(error.name === kind, () => `threw ${error.name}: ${error.message}; expected a ${kind}`);
  must(error.message.includes(what), () => `the ${kind} says "${error.message}"; it should name ${what}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Fictional data.

/** Syllables the bank strings together into made-up ids, so no id is a word of any language. */
const SYLLABLES = [
  'ba',
  'ko',
  'mi',
  'ru',
  'te',
  'so',
  'la',
  've',
  'ni',
  'do',
  'pa',
  'gu',
  'hi',
  'za',
  'fe',
  'jo',
] as const;

/** `count` distinct made-up ids of one letter shape, in a seeded order. */
export function names(rng: Rng, count: number, prefix = ''): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  while (out.length < count) {
    let word = '';
    for (let i = rng.int(2, 3); i > 0; i -= 1) word += rng.pick(SYLLABLES);
    if (seen.has(word)) {
      if (seen.size < 2000) continue;
      word += String(out.length);
    }
    seen.add(word);
    out.push(`${prefix}${word}`);
  }
  return out;
}

export function valueIds(count: number, prefix = 'v'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Store builders and the oracles every planner family shares.

export type VSpec = {
  id: string;
  /** Value ids, or values with a flag or a weight. */
  values: Array<string | { id: string; weight?: number; approved?: boolean }>;
  shared?: boolean;
  approved?: boolean;
};

export type StoreSpec = {
  vars: VSpec[];
  forbids?: Array<{ forbid: Row; approved?: boolean }>;
  impossible?: Array<[string, string, string, string]>;
  rules?: Array<{ id: string; variables: string[] }>;
};

export function makeStore(spec: StoreSpec): StoreDoc {
  return {
    variables: spec.vars.map((v) => ({
      id: v.id,
      values: v.values.map((x) => (typeof x === 'string' ? { id: x } : { ...x })),
      ...(v.shared ? { shared: true } : {}),
      ...(v.approved === undefined ? {} : { approved: v.approved }),
    })),
    impossible: (spec.impossible ?? []).map(([va, xa, vb, xb]) => ({
      a: { variable: va, value: xa },
      b: { variable: vb, value: xb },
      provenance: [{ kind: 'owner', words: 'these two never occur together', date: '2026-10-01' }],
    })),
    rules: (spec.rules ?? []).map((r) => ({ id: r.id, variables: [...r.variables] })),
    refused: [],
    ...(spec.forbids ? { forbids: spec.forbids.map((f) => ({ ...f, forbid: { ...f.forbid } })) } : {}),
  };
}

export type Space = {
  vars: string[];
  dom: Record<string, string[]>;
  shared: string[];
  rules: string[][];
  forbids: Row[];
  /** The weight of each approved value (absent weights are equal). */
  weight: Record<string, Record<string, number | undefined>>;
};

/** The space a planner works on: the approved variables, their approved values, and the constraints that count. */
export function spaceOf(store: StoreDoc): Space {
  const vars: string[] = [];
  const dom: Record<string, string[]> = {};
  const shared: string[] = [];
  const weight: Space['weight'] = {};
  for (const v of store.variables) {
    if (v.approved === false) continue;
    const vals = v.values.filter((x) => x.approved !== false);
    if (vals.length === 0) continue;
    vars.push(v.id);
    dom[v.id] = vals.map((x) => x.id);
    weight[v.id] = Object.fromEntries(vals.map((x) => [x.id, x.weight]));
    if (v.shared) shared.push(v.id);
  }
  const inPlan = (variable: string, value: string): boolean => !!dom[variable]?.includes(value);
  const forbids: Row[] = [];
  for (const f of store.forbids ?? []) {
    if (f.approved === false) continue;
    const entries = Object.entries(f.forbid);
    if (entries.length > 0 && entries.every(([k, x]) => inPlan(k, x))) forbids.push({ ...f.forbid });
  }
  for (const p of store.impossible) {
    if (p.a.variable === p.b.variable) continue;
    if (inPlan(p.a.variable, p.a.value) && inPlan(p.b.variable, p.b.value)) {
      forbids.push({ [p.a.variable]: p.a.value, [p.b.variable]: p.b.value });
    }
  }
  const rules: string[][] = [];
  for (const r of store.rules) {
    const own = [...new Set(r.variables)].filter((id) => dom[id]);
    if (own.length > 0) rules.push(own);
  }
  return { vars, dom, shared, rules, forbids, weight };
}

export function subsetsOf<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, chosen: T[]): void => {
    if (chosen.length === k) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      chosen.push(items[i] as T);
      pick(i + 1, chosen);
      chosen.pop();
    }
  };
  pick(0, []);
  return out;
}

/** The variable sets the plan must cross fully: rules at strength 3, shared pairs, the singles left over. */
export function requiredGroups(space: Space): string[][] {
  const out: string[][] = [];
  const named = new Set<string>();
  const seen = new Set<string>();
  const add = (group: string[]): void => {
    const key = [...group].sort().join('\u0000');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(group);
    for (const v of group) named.add(v);
  };
  for (const rule of space.rules) {
    for (const g of subsetsOf(rule, Math.min(3, rule.length))) add(g);
  }
  // A pair of axes that a rule holds already is not a group of its own (docs/variables.md, Planning rows).
  for (const g of subsetsOf(space.shared, 2)) {
    if (!space.rules.some((r) => g.every((v) => r.includes(v)))) add(g);
  }
  for (const v of space.vars) if (!named.has(v)) add([v]);
  return out;
}

export function tupleKey(row: Row, vars: readonly string[]): string {
  return [...vars]
    .sort()
    .map((v) => `${v}=${row[v]}`)
    .join('\u0001');
}

export function violates(row: Row, forbids: readonly Row[]): boolean {
  return forbids.some((f) => Object.entries(f).every(([k, x]) => row[k] === x));
}

/** Every full valid assignment of a small space (the brute force the differential items compare against). */
export function allRows(space: Space, limit = 400_000): Row[] {
  let size = 1;
  for (const v of space.vars) size *= (space.dom[v] as string[]).length;
  must(size <= limit, () => `the item's own space is too large to enumerate: ${size} rows`);
  const out: Row[] = [];
  const cur: Row = {};
  const walk = (i: number): void => {
    if (i === space.vars.length) {
      out.push({ ...cur });
      return;
    }
    const v = space.vars[i] as string;
    for (const x of space.dom[v] as string[]) {
      cur[v] = x;
      // A forbidden combination whose variables are all assigned already cuts the branch early.
      const cut = space.forbids.some((f) => {
        for (const [k, xv] of Object.entries(f)) {
          if (cur[k] !== xv) return false;
        }
        return true;
      });
      if (!cut) walk(i + 1);
    }
    delete cur[v];
  };
  walk(0);
  return out;
}

/** Distinct allowed tuples of the groups: the projections of valid full rows. */
export function allowedTuples(
  _space: Space,
  groups: readonly (readonly string[])[],
  rows: Row[],
): Set<string> {
  const out = new Set<string>();
  for (const g of groups) {
    for (const row of rows) out.add(tupleKey(row, g));
  }
  return out;
}

/** Allowed tuples that the given (possibly partial) rows hold, and the allowed ones they miss. */
export function coveredTuples(
  groups: readonly (readonly string[])[],
  allowed: Set<string>,
  held: readonly Row[],
  space: Space,
): { covered: Set<string>; missing: string[] } {
  const covered = new Set<string>();
  for (const g of groups) {
    for (const row of held) {
      if (g.every((v) => row[v] !== undefined && space.dom[v]?.includes(row[v] as string))) {
        const k = tupleKey(row, g);
        if (allowed.has(k)) covered.add(k);
      }
    }
  }
  return { covered, missing: [...allowed].filter((k) => !covered.has(k)) };
}

/** The row cap of the page (R14): ceil(factor * G) + 1 with G from the missing count and the widest tuple. */
export function rowCap(missing: number, widest: number, factor = 1.25): number {
  if (missing === 0) return 0;
  const p = 1 / widest;
  const g = p === 1 ? 1 : Math.ceil(Math.log(missing) / -Math.log(1 - p));
  return Math.ceil(factor * g) + 1;
}

/** The sum of the logs of the shares of a row's values, as R9 reads it. */
export function logWeightOf(space: Space, row: Row): number | null {
  let total = 0;
  for (const v of space.vars) {
    const x = row[v];
    if (x === undefined) continue;
    const dom = space.dom[v] as string[];
    const w = space.weight[v] as Record<string, number | undefined>;
    const any = dom.some((id) => w[id] !== undefined);
    const weightOf = (id: string): number => (any ? (w[id] ?? 0) : 1);
    const sum = dom.reduce((s, id) => s + weightOf(id), 0);
    const share = weightOf(x) / sum;
    if (share === 0) return null;
    total += Math.log(share);
  }
  return total;
}

export function sameRow(a: Row, b: Row): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/** The new rows of a plan. */
export function newRows(plan: Plan): Plan['rows'] {
  return plan.rows.filter((r) => r.kind === 'new');
}

/** Rows that stand: complete, valid, unique, with ids. Returns the new rows. */
export function assertRowsSound(space: Space, plan: Plan, seeds: readonly Row[]): Plan['rows'] {
  const ids = new Set<string>();
  for (const r of plan.rows) {
    must(typeof r.id === 'string' && r.id.length > 0, () => `a plan row has the id ${show(r.id)}`);
    must(!ids.has(r.id), () => `the row id ${r.id} appears twice`);
    ids.add(r.id);
  }
  const fresh = newRows(plan);
  const seen = new Set<string>();
  for (const r of fresh) {
    for (const v of space.vars) {
      const x = r.values[v];
      must(x !== undefined, () => `the new row ${r.id} gives no value to ${v}`);
      must(
        (space.dom[v] as string[]).includes(x as string),
        () => `the new row ${r.id} gives ${v} the unlisted value ${show(x)}`,
      );
    }
    must(
      Object.keys(r.values).length === space.vars.length,
      () =>
        `the new row ${r.id} holds ${Object.keys(r.values).length} entries for ${space.vars.length} variables`,
    );
    must(
      !violates(r.values, space.forbids),
      () => `the new row ${r.id} holds a combination the store forbids: ${show(r.values, 160)}`,
    );
    const key = space.vars.map((v) => r.values[v]).join('\u0001');
    must(!seen.has(key), () => `the new row ${r.id} repeats another new row`);
    seen.add(key);
    for (const s of seeds) {
      must(!sameRow(s, r.values), () => `the new row ${r.id} repeats a seed`);
    }
  }
  return fresh;
}

/** Every allowed required tuple is held by the seeds and the new rows (use when no budget cut applies). */
export function assertCovered(space: Space, plan: Plan, _seeds: readonly Row[] = []): void {
  const groups = requiredGroups(space);
  const rows = allRows(space);
  const allowed = allowedTuples(space, groups, rows);
  const held = plan.rows.map((r) => r.values);
  const { missing } = coveredTuples(groups, allowed, held, space);
  must(
    missing.length === 0,
    () =>
      `${missing.length} allowed required tuples are not held, for example ${missing[0]?.replaceAll('\u0001', ', ')}`,
  );
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Child count of the page's greedy bound: the product of arities of the widest required tuple. */
export function widestTuple(space: Space): number {
  let widest = 1;
  for (const g of requiredGroups(space)) {
    widest = Math.max(
      widest,
      g.reduce((p, v) => p * (space.dom[v] as string[]).length, 1),
    );
  }
  return widest;
}

/** Processor time of a call (user and system, ms): a busy machine does not fail an item. */
export function cpu<T>(run: () => T): { value: T; ms: number } {
  const start = process.cpuUsage();
  const value = run();
  const used = process.cpuUsage(start);
  return { value, ms: (used.user + used.system) / 1000 };
}
