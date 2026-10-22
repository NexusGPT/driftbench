import { fileURLToPath } from 'node:url';
import type { PlanSeedRow, PlanV2 } from '@agent-nexus/driftbench-generate';
import { type VariableStore, validateVariableStore } from '@agent-nexus/driftbench-space';
import { isolate, neutralName, rngOf } from '../../frame';
import type { BankItem, SeedData, Tier, Verdict } from './bank';

/**
 * The planner v2 family of the generator bank (docs/variables.md, "Planning"; docs/generating.md). Planner v2
 * builds the rows of a test plan from a variable store: strength 3 on the variables of one rule, 2 on every pair
 * of approved axes, 1 elsewhere; real sessions enter as seed rows; the new rows come most common first, so a
 * budget cuts the rarest first. Each item draws a store from the seed, asks the planner through the frame (the
 * product runs apart, docs/validators.md section 12.9) and checks the plan against a brute-force count written
 * here: the valid cells of the store, the tuples each strength asks for, and the traffic weight of each row.
 *
 * The items point at the planner's files; none reads the planner's own helpers, and none knows an id the planner
 * writes except the `seed.` prefix of a seed row and the order of the rows.
 */

const PLANNER_MODULE = fileURLToPath(new URL('../../../../generate/src/plan-v2/index.ts', import.meta.url));
const FILES = {
  plan: 'packages/generate/src/plan-v2/plan.ts',
  groups: 'packages/generate/src/plan-v2/groups.ts',
  rules: 'packages/generate/src/plan-v2/rules.ts',
  solver: 'packages/generate/src/plan-v2/solver.ts',
  view: 'packages/generate/src/plan-v2/view.ts',
} as const;

const LEVEL = 'planner';
const FAMILY = 'planner';

type Cell = Record<string, string>;
type PlanFn = (store: VariableStore, options?: Record<string, unknown>) => PlanV2;
/** The planner module as the items call it: the planner, and the JSON text of a plan. */
type PlannerModule = { planV2: PlanFn; renderPlanV2: (plan: PlanV2) => string };

const verdict = (pass: boolean, detail: string, cause?: string): Verdict => ({
  pass,
  detail,
  ...(cause === undefined ? {} : { cause }),
});

/** One variable of a drawn store, as the oracle reads it. */
type Variable = { id: string; role: 'axis' | 'detail'; values: string[]; weights?: number[] };
/** A rule: the variables of one value that states where it applies (host first), as the oracle counts them. */
type Rule = { variables: string[] };
type Scenario = {
  name: string;
  tier: Tier;
  store: VariableStore;
  /** The approved variables with their approved values: what the planner plans over. */
  variables: Variable[];
  rules: Rule[];
  /** Approved combinations of values no row may hold: pairs, and on some shapes one value or three. */
  forbids: Cell[];
  weighted: boolean;
  /** What the store holds that nobody approved: a value of an axis, a whole variable, a constraint. */
  excluded: { values: Cell; variables: string[]; forbids: Cell[] };
  /** A pair of values that no constraint names and no valid row can hold (shape `non-extendable`). */
  pinched?: Cell;
};

type Shape = {
  name: string;
  tier: Tier;
  axes: number;
  detail: boolean;
  /** Sizes of the rules, each hosted by an axis of its own. */
  rules: number[];
  forbids: number;
  weighted?: boolean;
  /** Values per variable: from 2 to this. */
  width?: number;
  /**
   * Constraints drawn on purpose instead of at random: `non-extendable` forbids no pair of two axes yet leaves a
   * pair of them in no valid row (R6: a tuple is allowed only if it extends to a full valid assignment);
   * `odd-sizes` forbids one combination of three values and one value alone (R7).
   */
  special?: 'non-extendable' | 'odd-sizes';
  /** One value of an axis, one whole variable and one constraint that nobody approved (R6, R7). */
  unapproved?: boolean;
  /** With `weighted`, only every other variable has weights; the rest use equal shares (R9). */
  weightedSome?: boolean;
  /** With `weighted`, the last value of the last axis weighs 0: its rows weigh minus infinity (R9). */
  zeroWeight?: boolean;
};

const SHAPES: Shape[] = [
  { name: 'floor-only', tier: 1, axes: 4, detail: false, rules: [], forbids: 0 },
  { name: 'one-variable-rule', tier: 1, axes: 3, detail: false, rules: [1], forbids: 0 },
  { name: 'rule-of-four', tier: 2, axes: 5, detail: true, rules: [4], forbids: 0 },
  { name: 'two-rules', tier: 2, axes: 5, detail: true, rules: [3, 2], forbids: 0 },
  { name: 'constrained', tier: 3, axes: 5, detail: true, rules: [3], forbids: 3 },
  { name: 'weighted', tier: 3, axes: 5, detail: true, rules: [3, 3], forbids: 1, weighted: true },
  { name: 'wide', tier: 4, axes: 7, detail: true, rules: [4, 3], forbids: 2, weighted: true, width: 3 },
  // Ladder version 3: the shapes the strength items need (R6, R7, R14).
  { name: 'rule-of-six', tier: 3, axes: 7, detail: false, rules: [6], forbids: 0, width: 2 },
  {
    name: 'non-extendable',
    tier: 4,
    axes: 5,
    detail: true,
    rules: [3],
    forbids: 0,
    special: 'non-extendable',
  },
  { name: 'odd-sizes', tier: 3, axes: 5, detail: true, rules: [3], forbids: 0, special: 'odd-sizes' },
  { name: 'unapproved', tier: 3, axes: 5, detail: true, rules: [3], forbids: 1, unapproved: true },
  // Ladder version 3: the shapes the traffic items need (R9).
  {
    name: 'mixed-weights',
    tier: 3,
    axes: 5,
    detail: true,
    rules: [3],
    forbids: 0,
    weighted: true,
    weightedSome: true,
  },
  {
    name: 'zero-weight',
    tier: 4,
    axes: 4,
    detail: false,
    rules: [3],
    forbids: 0,
    weighted: true,
    zeroWeight: true,
  },
];

function draw(seed: number, shape: Shape): Scenario {
  const rng = rngOf(seed, `planner:${shape.name}`);
  const int = (low: number, high: number) => low + Math.floor(rng() * (high - low + 1));
  const used = new Set<string>();
  const name = (tag: string) => {
    let id = neutralName(seed, `planner:${shape.name}:${tag}`);
    for (let n = 2; used.has(id); n++) id = neutralName(seed, `planner:${shape.name}:${tag}:${n}`);
    used.add(id);
    return id;
  };
  const variables: Variable[] = [];
  const total = shape.axes + (shape.detail ? 1 : 0);
  for (let k = 0; k < total; k++) {
    const id = name(`v${k}`);
    // The axis that keeps a value nobody approved has three, so two approved ones are left.
    const count = shape.unapproved && k === shape.axes - 1 ? 3 : int(2, shape.width ?? 3);
    const values = Array.from({ length: count }, (_, j) => name(`v${k}.${j}`));
    const weights =
      shape.weighted && !(shape.weightedSome && k % 2 === 1)
        ? values.map((_, j) => (shape.zeroWeight && k === shape.axes - 1 && j === count - 1 ? 0 : int(1, 9)))
        : undefined;
    variables.push({
      id,
      role: k < shape.axes ? 'axis' : 'detail',
      values,
      ...(weights ? { weights } : {}),
    });
  }
  const axes = variables.filter((variable) => variable.role === 'axis');
  // Each rule is hosted by one axis (its first value states the rule) and names the next axes.
  const rules: Rule[] = [];
  const whens = new Map<string, Record<string, string[]>>();
  const polar = new Set<string>();
  shape.rules.forEach((size, index) => {
    const host = axes[index] as Variable;
    const names = axes.slice(index + 1, index + size);
    // A rule that outgrows the axes after its host borrows axes before it.
    for (let back = index - 1; names.length < size - 1 && back >= 0; back--)
      names.push(axes[back] as Variable);
    rules.push({ variables: [host.id, ...names.map((variable) => variable.id)] });
    if (size === 1) polar.add(host.id);
    else
      whens.set(host.id, Object.fromEntries(names.map((other) => [other.id, [other.values[0] as string]])));
  });
  const forbids: Cell[] = [];
  const key = (cell: Cell) => JSON.stringify(Object.entries(cell).sort());
  let pinched: Cell | undefined;
  if (shape.special === 'non-extendable') {
    // a0 with any value of e but the last, and b0 with the last value of e: no row holds a0 and b0 together,
    // though no constraint names the two.
    const [, a, , b, e] = axes as [Variable, Variable, Variable, Variable, Variable];
    for (const value of e.values.slice(0, -1)) forbids.push({ [a.id]: a.values[0] as string, [e.id]: value });
    forbids.push({ [b.id]: b.values[0] as string, [e.id]: e.values.at(-1) as string });
    pinched = { [a.id]: a.values[0] as string, [b.id]: b.values[0] as string };
  }
  if (shape.special === 'odd-sizes') {
    const [, a, b, c, e] = axes as [Variable, Variable, Variable, Variable, Variable];
    forbids.push({
      [a.id]: a.values[1] as string,
      [b.id]: b.values[1] as string,
      [c.id]: c.values[0] as string,
    });
    forbids.push({ [e.id]: e.values.at(-1) as string });
  }
  for (let n = 0; n < shape.forbids; n++) {
    const a = axes[int(0, axes.length - 1)] as Variable;
    let b = axes[int(0, axes.length - 1)] as Variable;
    if (a.id === b.id) b = axes[(axes.indexOf(a) + 1) % axes.length] as Variable;
    const forbid = {
      [a.id]: a.values[int(0, a.values.length - 1)] as string,
      [b.id]: b.values[int(0, b.values.length - 1)] as string,
    };
    // The store refuses one combination forbidden twice, whichever way round its pair is written.
    if (!forbids.some((other) => key(other) === key(forbid))) forbids.push(forbid);
  }
  // What nobody approved: the last value of the last axis, an extra axis, and a constraint on two values the
  // plan must still pair (both stand in the first rule, whose triples hold them).
  const excluded: Scenario['excluded'] = { values: {}, variables: [], forbids: [] };
  const extra: Variable[] = [];
  if (shape.unapproved) {
    const last = axes.at(-1) as Variable;
    excluded.values[last.id] = last.values.at(-1) as string;
    const id = name('unapproved');
    extra.push({ id, role: 'axis', values: [name('unapproved.0'), name('unapproved.1')] });
    excluded.variables.push(id);
    const [first, second] = axes as [Variable, Variable];
    const forbid = { [first.id]: first.values[0] as string, [second.id]: second.values[0] as string };
    if (!forbids.some((other) => key(other) === key(forbid))) excluded.forbids.push(forbid);
  }
  const raw = {
    format: 1,
    agent: name('agent'),
    version: '1',
    prior: { kind: 'declared' },
    variables: [...variables, ...extra].map((variable) => ({
      id: variable.id,
      title: variable.id,
      kind: 'data',
      role: variable.role,
      approved: !excluded.variables.includes(variable.id),
      values: variable.values.map((value, j) => {
        const hosted = j === 0 ? whens.get(variable.id) : undefined;
        return {
          id: value,
          title: value,
          ...(variable.weights ? { weight: variable.weights[j] } : {}),
          ...(hosted ? { polarity: 'must', when: hosted } : {}),
          ...(j === 0 && polar.has(variable.id) ? { polarity: 'must' } : {}),
          ...(excluded.values[variable.id] === value ? { approved: false } : {}),
        };
      }),
    })),
    constraints: [
      ...forbids.map((forbid) => ({ forbid, reason: 'drawn for the item', approved: true })),
      ...excluded.forbids.map((forbid) => ({ forbid, reason: 'nobody approved it', approved: false })),
    ],
  };
  const checked = validateVariableStore(raw);
  if (!checked.ok)
    throw new Error(`the drawn store is invalid: ${checked.errors.map((issue) => issue.message).join('; ')}`);
  // The oracle plans over what was approved, as the planner must.
  const planned = variables.map((variable) => {
    const out = excluded.values[variable.id];
    if (out === undefined) return variable;
    const at = variable.values.indexOf(out);
    return {
      ...variable,
      values: variable.values.filter((_, j) => j !== at),
      ...(variable.weights ? { weights: variable.weights.filter((_, j) => j !== at) } : {}),
    };
  });
  return {
    name: shape.name,
    tier: shape.tier,
    store: checked.store,
    variables: planned,
    rules,
    forbids,
    weighted: shape.weighted === true,
    excluded,
    ...(pinched ? { pinched } : {}),
  };
}

/** Every combination of one value per variable. */
function product(variables: readonly Variable[]): Cell[] {
  return variables.reduce<Cell[]>(
    (cells, variable) =>
      cells.flatMap((cell) => variable.values.map((value) => ({ ...cell, [variable.id]: value }))),
    [{}],
  );
}

const holds = (row: Cell, tuple: Cell) => Object.entries(tuple).every(([key, value]) => row[key] === value);

function subsets<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [...subsets(rest, size - 1).map((tail) => [head, ...tail]), ...subsets(rest, size)];
}

/** The oracle of a scenario: the valid cells and the tuples each strength asks for. */
class Oracle {
  readonly cells: Cell[];
  constructor(readonly scenario: Scenario) {
    this.cells = product(scenario.variables).filter(
      (cell) => !scenario.forbids.some((forbid) => holds(cell, forbid)),
    );
  }
  tuples(variables: readonly string[]): Cell[] {
    const seen = new Map<string, Cell>();
    for (const cell of this.cells) {
      const tuple = Object.fromEntries(variables.map((id) => [id, cell[id] as string]));
      seen.set(JSON.stringify(tuple), tuple);
    }
    return [...seen.values()];
  }
  /** The groups of variables a strength asks for. */
  groups(kind: 'own' | 'axes' | 'values'): string[][] {
    const { scenario } = this;
    if (kind === 'own')
      return scenario.rules.flatMap((rule) => subsets(rule.variables, Math.min(3, rule.variables.length)));
    if (kind === 'axes')
      return subsets(
        scenario.variables.filter((variable) => variable.role === 'axis').map((variable) => variable.id),
        2,
      );
    return scenario.variables.map((variable) => [variable.id]);
  }
  /** The tuples of a kind that no row holds. */
  uncovered(kind: 'own' | 'axes' | 'values', rows: readonly Cell[]): Cell[] {
    return this.groups(kind)
      .flatMap((group) => this.tuples(group))
      .filter((tuple) => !rows.some((row) => holds(row, tuple)));
  }
  /**
   * The groups of each report layer, as docs/variables.md and the planner's own header describe them: `own` has
   * every min(3, n) variables of each rule; `shared` has every pair of approved axes except a pair that a group of
   * a rule holds already; `single` has each variable that no group names yet. A set of variables is one group.
   */
  layerGroups(): Record<'own' | 'shared' | 'single', string[][]> {
    const { scenario } = this;
    const order = new Map(scenario.variables.map((variable, at) => [variable.id, at]));
    const sorted = (group: string[]) =>
      [...group].sort((a, b) => (order.get(a) as number) - (order.get(b) as number));
    const keys = new Set<string>();
    const fresh = (group: string[]) => {
      const key = sorted(group).join(',');
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    };
    const own = scenario.rules
      .flatMap((rule) => subsets(rule.variables, Math.min(3, rule.variables.length)))
      .map(sorted)
      .filter(fresh);
    const axes = scenario.variables
      .filter((variable) => variable.role === 'axis')
      .map((variable) => variable.id);
    const shared = subsets(axes, 2)
      .filter((pair) => !own.some((group) => pair.every((id) => group.includes(id))))
      .map(sorted)
      .filter(fresh);
    const named = new Set([...own, ...shared].flat());
    const single = scenario.variables
      .filter((variable) => !named.has(variable.id))
      .map((variable) => [variable.id]);
    return { own, shared, single };
  }
  /**
   * What the report must say about each layer for a plan whose rows are `rows` and whose seeds are `seeds`:
   * the groups, the value combinations a valid row can hold (targets), those none can (infeasible), the targets
   * the seeds hold, the targets the rows hold and the rest.
   */
  expectedLayers(rows: readonly Cell[], seeds: readonly Cell[]) {
    const strength = { own: 3, shared: 2, single: 1 } as const;
    const groups = this.layerGroups();
    const sizes = new Map(this.scenario.variables.map((variable) => [variable.id, variable.values.length]));
    return (['own', 'shared', 'single'] as const).map((layer) => {
      let targets = 0;
      let infeasible = 0;
      let seeded = 0;
      let covered = 0;
      for (const group of groups[layer]) {
        const tuples = this.tuples(group);
        targets += tuples.length;
        infeasible += group.reduce((product, id) => product * (sizes.get(id) as number), 1) - tuples.length;
        for (const tuple of tuples) {
          if (seeds.some((row) => holds(row, tuple))) seeded += 1;
          if (rows.some((row) => holds(row, tuple))) covered += 1;
        }
      }
      return {
        layer,
        strength: strength[layer],
        groups: groups[layer].length,
        targets,
        infeasible,
        seeded,
        covered,
        uncovered: targets - covered,
      };
    });
  }
  /** The natural logarithm of the share of each value, over its variable's weights; equal shares with none. */
  logWeight(row: Cell): number {
    let sum = 0;
    for (const variable of this.scenario.variables) {
      const total = variable.weights ? variable.weights.reduce((a, b) => a + b, 0) : variable.values.length;
      const at = variable.values.indexOf(row[variable.id] as string);
      sum += Math.log((variable.weights ? (variable.weights[at] as number) : 1) / total);
    }
    return sum;
  }
}

/** What the planner answered for one scenario of one seed, with the calls the items read. */
type Answers = {
  scenario: Scenario;
  oracle: Oracle;
  full: PlanV2;
  other: PlanV2;
  budgets: Map<number, PlanV2>;
  seeded: { seeds: PlanSeedRow[]; plan: PlanV2 };
  fedBack: PlanV2;
  /** The seeds of the budget-below-seeds call. */
  tight: { seeds: PlanSeedRow[]; plan: PlanV2 };
  /** Seeds that set two variables each, as a session that shows only some does (R8). */
  partial: { seeds: PlanSeedRow[]; plan: PlanV2 };
  /** A seed that holds a combination the store forbids, on a store with constraints. */
  forbidden?: { seeds: PlanSeedRow[]; plan: PlanV2 };
  /** A seed that holds a value nobody approved, on a store with one. */
  unapproved?: { seeds: PlanSeedRow[]; plan: PlanV2 };
  /** The plan of the same store with every weight three times as large (R9: weights are relative). */
  scaled?: PlanV2;
  /** The plan of the same store with the keys of every object written in reverse order (R11). */
  reordered: PlanV2;
  /** The JSON text of the plan without a budget, on a store with a value of weight 0. */
  rendered?: string;
  divergence?: string;
};

const rowsOf = (plan: PlanV2): Cell[] => plan.rows.map((row) => row.values);
/** Two rows hold the same values, whatever order their keys are written in. */
const sameValues = (a: Cell | undefined, b: Cell | undefined) =>
  a !== undefined &&
  b !== undefined &&
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/**
 * Every field of the report, layer by layer, against the oracle's count: the layers must be exactly the three,
 * once each, in order, and a field that is zeroed, blank or missing differs from the count and is named.
 */
function layerVerdict(plan: PlanV2, a: Answers, seeds: readonly Cell[]): Verdict {
  const want = a.oracle.expectedLayers(rowsOf(plan), seeds);
  const got = plan.layers;
  if (!Array.isArray(got) || got.length !== want.length)
    return verdict(
      false,
      `the report has ${Array.isArray(got) ? got.length : 'no'} layers where ${want.length} are wanted`,
    );
  const wrong: string[] = [];
  want.forEach((expected, at) => {
    const found = got[at] as unknown as Record<string, unknown> | undefined;
    for (const [field, value] of Object.entries(expected))
      if (found?.[field] !== value)
        wrong.push(`${expected.layer}.${field} is ${String(found?.[field])}, wanted ${value}`);
  });
  return verdict(wrong.length === 0, wrong.slice(0, 4).join('; '));
}

/** The store with every weight multiplied by `factor`. */
function scaledStore(store: VariableStore, factor: number): VariableStore {
  return {
    ...store,
    variables: store.variables.map((variable) => ({
      ...variable,
      values: variable.values.map((value) =>
        value.weight === undefined ? value : { ...value, weight: value.weight * factor },
      ),
    })),
  };
}

/** The same data with the keys of every object in reverse order; arrays keep their order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reversedKeys(entry)]),
  );
}

async function answers(data: SeedData, shape: Shape, module: string): Promise<Answers> {
  return data.memoized(`planner:${shape.name}:${module}`, async () => {
    const scenario = draw(data.seed, shape);
    const oracle = new Oracle(scenario);
    const frame = isolate<PlannerModule>({ module, seed: data.seed, tag: `planner:${shape.name}` });
    try {
      const plan = frame.product.planV2;
      const full = plan(scenario.store, { seed: 1 });
      const other = plan(scenario.store, { seed: 2 });
      const planned = full.rows.length;
      const budgets = new Map<number, PlanV2>();
      for (const budget of new Set([1, Math.ceil(planned / 2)]))
        budgets.set(budget, plan(scenario.store, { seed: 1, budget }));
      const pick = oracle.cells.filter(
        (_, index) => index % Math.max(1, Math.floor(oracle.cells.length / 3)) === 0,
      );
      const seeds: PlanSeedRow[] = pick.slice(0, 3).map((cell, index) => ({ id: `s${index}`, values: cell }));
      const seeded = { seeds, plan: plan(scenario.store, { seed: 1, seeds }) };
      const fedBack = plan(scenario.store, {
        seed: 1,
        seeds: rowsOf(full).map((values, index) => ({ id: `r${index}`, values })),
      });
      const tight = { seeds, plan: plan(scenario.store, { seed: 1, seeds, budget: 1 }) };
      const two = scenario.variables.slice(0, 2).map((variable) => variable.id);
      const partialSeeds: PlanSeedRow[] = [pick[0], pick.at(-1)]
        .filter((cell): cell is Cell => cell !== undefined)
        .map((cell, index) => ({
          id: `p${index}`,
          values: Object.fromEntries(two.map((id) => [id, cell[id] as string])),
        }));
      const partial = { seeds: partialSeeds, plan: plan(scenario.store, { seed: 1, seeds: partialSeeds }) };
      const first = scenario.forbids[0];
      const forbiddenSeeds: PlanSeedRow[] | undefined =
        first && oracle.cells[0] ? [{ id: 'f0', values: { ...oracle.cells[0], ...first } }] : undefined;
      const forbidden = forbiddenSeeds && {
        seeds: forbiddenSeeds,
        plan: plan(scenario.store, { seed: 1, seeds: forbiddenSeeds }),
      };
      const outside = Object.entries(scenario.excluded.values)[0];
      const unapprovedSeeds: PlanSeedRow[] | undefined =
        outside && oracle.cells[0]
          ? [{ id: 'u0', values: { ...oracle.cells[0], [outside[0]]: outside[1] } }]
          : undefined;
      const unapproved = unapprovedSeeds && {
        seeds: unapprovedSeeds,
        plan: plan(scenario.store, { seed: 1, seeds: unapprovedSeeds }),
      };
      const scaled = scenario.weighted ? plan(scaledStore(scenario.store, 3), { seed: 1 }) : undefined;
      const reordered = plan(reversedKeys(scenario.store) as VariableStore, { seed: 1 });
      const rendered = shape.zeroWeight ? frame.product.renderPlanV2(full) : undefined;
      return {
        scenario,
        oracle,
        full,
        other,
        budgets,
        seeded,
        fedBack,
        tight,
        partial,
        ...(forbidden ? { forbidden } : {}),
        ...(unapproved ? { unapproved } : {}),
        ...(scaled ? { scaled } : {}),
        reordered,
        ...(rendered === undefined ? {} : { rendered }),
        divergence: frame.divergence(),
      };
    } finally {
      frame.close();
    }
  });
}

type Check = (a: Answers) => Verdict;

const logOf = (plan: PlanV2) => plan.rows.filter((row) => row.source === 'planned');

const STEMS: {
  id: string;
  cause: string;
  /** Scenarios the stem applies to. */
  when: (shape: Shape) => boolean;
  /** Raises the tier of the item above the scenario's own. */
  tier?: Tier;
  check: Check;
}[] = [
  {
    id: 'own-rule-tuples',
    cause: `${FILES.groups}: cover every tuple of strength 3 over the variables of each rule`,
    when: (shape) => shape.rules.length > 0,
    check: (a) => {
      const missing = a.oracle.uncovered('own', rowsOf(a.full));
      return verdict(
        missing.length === 0,
        `${missing.length} tuples of strength 3 on the rules' variables are in no row`,
      );
    },
  },
  {
    id: 'axis-pairs',
    cause: `${FILES.groups}: cover every pair of approved axes`,
    when: () => true,
    check: (a) => {
      const missing = a.oracle.uncovered('axes', rowsOf(a.full));
      return verdict(missing.length === 0, `${missing.length} pairs of approved axes are in no row`);
    },
  },
  {
    id: 'every-value',
    cause: `${FILES.groups}: cover every reachable value of every variable`,
    when: () => true,
    check: (a) => {
      const missing = a.oracle.uncovered('values', rowsOf(a.full));
      return verdict(missing.length === 0, `${missing.length} reachable values are in no row`);
    },
  },
  {
    id: 'no-forbidden-row',
    cause: `${FILES.solver}: never place a combination the store forbids`,
    when: (shape) => shape.forbids > 0 || shape.special !== undefined,
    check: (a) => {
      const bad = rowsOf(a.full).filter((row) => a.scenario.forbids.some((forbid) => holds(row, forbid)));
      return verdict(bad.length === 0, `${bad.length} rows hold a forbidden pair`);
    },
  },
  {
    id: 'rows-complete',
    cause: `${FILES.plan}: give every approved variable a value of its own in a new row`,
    when: () => true,
    check: (a) => {
      const bad = logOf(a.full).filter((row) =>
        a.scenario.variables.some((variable) => !variable.values.includes(row.values[variable.id] as string)),
      );
      return verdict(
        bad.length === 0 && logOf(a.full).length > 0,
        `${bad.length} new rows miss a variable or hold a value outside the store; ${logOf(a.full).length} new rows`,
      );
    },
  },
  {
    id: 'rows-within-bounds',
    cause: `${FILES.solver}: choose rows that cover many tuples at once`,
    when: () => true,
    tier: 3,
    check: (a) => {
      const sizes = [...a.oracle.groups('own'), ...a.oracle.groups('axes')].map(
        (group) => a.oracle.tuples(group).length,
      );
      const lower = Math.max(1, ...sizes);
      const n = a.full.rows.length;
      return verdict(
        n >= lower && n <= a.oracle.cells.length,
        `${n} rows for a plan that needs at least ${lower} and has ${a.oracle.cells.length} valid cells`,
      );
    },
  },
  {
    id: 'other-seed-still-covers',
    cause: `${FILES.solver}: the seed only breaks ties, never the coverage`,
    when: () => true,
    check: (a) => {
      const rows = rowsOf(a.other);
      const missing = [
        ...a.oracle.uncovered('own', rows),
        ...a.oracle.uncovered('axes', rows),
        ...a.oracle.uncovered('values', rows),
      ];
      const forbidden = rows.filter((row) => a.scenario.forbids.some((forbid) => holds(row, forbid))).length;
      return verdict(
        missing.length === 0 && forbidden === 0,
        `with seed 2: ${missing.length} tuples uncovered, ${forbidden} rows hold a forbidden pair`,
      );
    },
  },
  {
    id: 'ids-in-order',
    cause: `${FILES.plan}: number the new rows in plan order`,
    when: () => true,
    check: (a) => {
      // The ids the planner documents: `seed.<id>` for a seed, then `row.001`, `row.002` ... in plan order, the
      // number padded to at least three places. A repeated, empty or out-of-order id is wrong.
      const planned = logOf(a.full);
      const width = Math.max(3, String(planned.length).length);
      const wanted = planned.map((_, at) => `row.${String(at + 1).padStart(width, '0')}`);
      const got = planned.map((row) => row.id);
      const ids = a.full.rows.map((row) => row.id);
      return verdict(
        planned.length > 0 &&
          new Set(ids).size === ids.length &&
          got.length === wanted.length &&
          got.every((id, at) => id === wanted[at]),
        `${ids.length - new Set(ids).size} ids repeat; the new rows are ${JSON.stringify(got.slice(0, 3))} where ${JSON.stringify(wanted.slice(0, 3))} is wanted`,
      );
    },
  },
  {
    id: 'seeds-lead',
    cause: `${FILES.plan}: list the seed rows first, in the order given, with their own values`,
    when: () => true,
    check: (a) => {
      const { seeds, plan } = a.seeded;
      const head = plan.rows.slice(0, seeds.length);
      const ok =
        head.length === seeds.length &&
        head.every(
          (row, index) =>
            row.source === 'seed' &&
            row.id === `seed.${seeds[index]?.id}` &&
            JSON.stringify(row.values) === JSON.stringify(seeds[index]?.values),
        );
      const planned = plan.rows.slice(seeds.length).every((row) => row.source === 'planned');
      return verdict(ok && planned, 'the seeds do not lead the plan in order with their values');
    },
  },
  {
    id: 'seeds-count-as-covered',
    cause: `${FILES.groups}: count the tuples a seed holds as covered`,
    when: () => true,
    tier: 3,
    check: (a) => {
      const withSeeds = rowsOf(a.seeded.plan);
      const missing = [
        ...a.oracle.uncovered('own', withSeeds),
        ...a.oracle.uncovered('axes', withSeeds),
        ...a.oracle.uncovered('values', withSeeds),
      ];
      return verdict(missing.length === 0, `${missing.length} tuples uncovered with seeds`);
    },
  },
  {
    id: 'plan-fed-back-adds-nothing',
    cause: `${FILES.groups}: a seed that holds a tuple removes it from the targets`,
    when: () => true,
    tier: 4,
    check: (a) =>
      verdict(
        logOf(a.fedBack).length === 0,
        `${logOf(a.fedBack).length} new rows after the whole plan came back as seeds`,
      ),
  },
  {
    id: 'budget-keeps-seeds',
    cause: `${FILES.plan}: never cut a seed row, whatever the budget`,
    when: () => true,
    tier: 4,
    check: (a) => {
      const kept = a.tight.plan.rows.filter((row) => row.source === 'seed').length;
      return verdict(
        kept === a.tight.seeds.length,
        `${kept} of ${a.tight.seeds.length} seeds kept at a budget of 1`,
      );
    },
  },
  {
    id: 'budget-prefix',
    cause: `${FILES.plan}: a budget keeps the first rows of the plan without one`,
    when: () => true,
    check: (a) => {
      const bad: string[] = [];
      for (const [budget, plan] of a.budgets) {
        const expect = a.full.rows.slice(0, budget);
        if (JSON.stringify(plan.rows) !== JSON.stringify(expect)) bad.push(String(budget));
      }
      return verdict(
        bad.length === 0,
        `the plan at budgets ${bad.join(', ')} is not the first rows of the full plan`,
      );
    },
  },
  {
    id: 'budget-cut-count',
    cause: `${FILES.plan}: report how many rows the budget cut`,
    when: () => true,
    check: (a) => {
      const bad: string[] = [];
      for (const [budget, plan] of a.budgets) {
        const kept = plan.rows.length;
        if (
          plan.cut !== a.full.rows.length - kept ||
          plan.generated !== a.full.rows.length ||
          kept !== Math.min(budget, a.full.rows.length)
        )
          bad.push(`${budget}: kept ${kept}, cut ${plan.cut}, generated ${plan.generated}`);
      }
      return verdict(bad.length === 0, `wrong counts at budget ${bad.join('; ')}`);
    },
  },
  {
    id: 'rarest-cut-first',
    cause: `${FILES.plan}: order new rows from the most common to the rarest`,
    when: () => true,
    tier: 3,
    check: (a) => {
      const weights = logOf(a.full).map((row) => a.oracle.logWeight(row.values));
      const bad = weights.filter(
        (weight, index) => index > 0 && weight > (weights[index - 1] as number) + 1e-9,
      ).length;
      return verdict(bad === 0, `${bad} new rows are more common than the row before them`);
    },
  },
  {
    id: 'traffic-weight-of-a-row',
    cause: `${FILES.plan}: a row weighs the sum of the logarithms of the shares of its values`,
    // A value of weight 0 gives minus infinity, which zero-weight-last checks.
    when: (shape) => shape.weighted === true && !shape.zeroWeight,
    tier: 4,
    check: (a) => {
      const bad = logOf(a.full).filter(
        // Fails closed: a weight that is not a finite number is wrong, and a comparison with NaN is never true.
        (row) =>
          !(
            Number.isFinite(row.logWeight) && Math.abs(row.logWeight - a.oracle.logWeight(row.values)) <= 1e-6
          ),
      ).length;
      return verdict(
        bad === 0 && logOf(a.full).length > 0,
        `${bad} rows carry a weight other than the sum of log shares`,
      );
    },
  },
  {
    id: 'layers-agree',
    cause: `${FILES.plan}: the report counts the groups and tuples of each layer, and those the rows hold`,
    when: () => true,
    tier: 3,
    check: (a) => {
      // Kept from the earlier check, beside the exact recount: an uncut plan leaves nothing uncovered, and each
      // layer's covered and uncovered add up to its targets.
      const open = a.full.layers.filter(
        (layer) => layer.uncovered !== 0 || layer.covered + layer.uncovered !== layer.targets,
      );
      const exact = layerVerdict(a.full, a, []);
      return verdict(
        open.length === 0 && exact.pass,
        open.length > 0
          ? `${open.length} layers leave targets uncovered or do not add up on a plan with no budget`
          : exact.detail,
      );
    },
  },
  {
    id: 'budget-uncovered-reported',
    cause: `${FILES.plan}: the report counts the tuples of each layer that a budget left uncovered`,
    when: () => true,
    tier: 4,
    check: (a) => {
      for (const [budget, plan] of a.budgets) {
        const found = layerVerdict(plan, a, []);
        if (!found.pass) return verdict(false, `at a budget of ${budget}: ${found.detail}`);
      }
      return verdict(true, 'every budgeted report matches the count');
    },
  },
  {
    id: 'layers-with-seeds',
    cause: `${FILES.plan}: the report counts the targets the seeds hold, and those the seeds and the new rows hold`,
    when: () => true,
    tier: 4,
    check: (a) => {
      const seeds = a.seeded.seeds.map((seed) => seed.values);
      const free = layerVerdict(a.seeded.plan, a, seeds);
      if (!free.pass) return verdict(false, `with seeds: ${free.detail}`);
      const tight = layerVerdict(
        a.tight.plan,
        a,
        a.tight.seeds.map((seed) => seed.values),
      );
      return verdict(tight.pass, `with seeds and a budget of 1: ${tight.detail}`);
    },
  },
  {
    id: 'report-header',
    cause: `${FILES.plan}: echo the agent, version, seed and budget, count the rows built and cut, list the rules and the unreachable values`,
    when: () => true,
    tier: 3,
    check: (a) => {
      const { store } = a.scenario;
      const wrong: string[] = [];
      const plan = a.full;
      if (plan.agent !== store.agent) wrong.push(`agent ${plan.agent}`);
      if (plan.version !== store.version) wrong.push(`version ${plan.version}`);
      if (plan.seed !== 1) wrong.push(`seed ${plan.seed}`);
      if (a.other.seed !== 2) wrong.push(`other seed ${a.other.seed}`);
      if (plan.budget !== undefined) wrong.push(`budget ${plan.budget} on a plan without one`);
      const planned = logOf(plan).length;
      if (plan.generated !== planned || plan.cut !== 0)
        wrong.push(`generated ${plan.generated}, cut ${plan.cut}, ${planned} rows`);
      for (const [budget, cut] of a.budgets)
        if (cut.budget !== budget) wrong.push(`budget ${cut.budget} echoed for ${budget}`);
      const rules = plan.rules ?? [];
      const wanted = a.scenario.rules.map((rule) => [...rule.variables].sort().join(','));
      const found = rules.map((rule) => [...(rule.variables ?? [])].sort().join(','));
      if (rules.length !== wanted.length || [...found].sort().join('|') !== [...wanted].sort().join('|'))
        wrong.push(`rules ${JSON.stringify(found)} where ${JSON.stringify(wanted)} are wanted`);
      if (
        rules.some(
          (rule, at) => rule.id !== `rule.${at + 1}` || typeof rule.label !== 'string' || rule.label === '',
        )
      )
        wrong.push('a rule has no id rule.N in order or no label');
      // A value no valid row can hold is reported once, and nothing else is: these stores have no seeds.
      const unreachable = a.scenario.variables.flatMap((variable) =>
        variable.values
          .filter((value) => !a.oracle.cells.some((cell) => cell[variable.id] === value))
          .map((value) => `${variable.id}=${value}`),
      );
      const warned = plan.warnings.map((warning) =>
        warning.code === 'value_unreachable' ? `${warning.variable}=${warning.value}` : warning.code,
      );
      if ([...warned].sort().join('|') !== [...unreachable].sort().join('|'))
        wrong.push(`warnings ${JSON.stringify(warned)} where ${JSON.stringify(unreachable)} are wanted`);
      return verdict(wrong.length === 0, wrong.join('; '));
    },
  },
  // Ladder version 3, strength (R6, R7, R14).
  {
    id: 'row-cap',
    cause: `${FILES.solver}: keep the new rows within the covering-array cap of R14`,
    when: (shape) => shape.forbids === 0 && shape.special === undefined && !shape.unapproved,
    tier: 3,
    check: (a) => {
      // R14 (docs/variables.md): M required tuples, p the reciprocal of the largest product of arities of a
      // required tuple, G = ceil(log(M) / -log(1 - p)), the cap ceil(1.25 G) + 1.
      const sizes = new Map(a.scenario.variables.map((variable) => [variable.id, variable.values.length]));
      const groups = Object.values(a.oracle.layerGroups()).flat();
      const m = groups.reduce((sum, group) => sum + a.oracle.tuples(group).length, 0);
      const widest = Math.max(
        1,
        ...groups.map((group) => group.reduce((product, id) => product * (sizes.get(id) as number), 1)),
      );
      const p = 1 / widest;
      const g = m === 0 ? 0 : p === 1 ? 1 : Math.ceil(Math.log(m) / -Math.log(1 - p));
      const cap = m === 0 ? 0 : Math.ceil(1.25 * g) + 1;
      const n = logOf(a.full).length;
      return verdict(n <= cap, `${n} new rows where R14 caps them at ${cap} (M ${m}, G ${g})`);
    },
  },
  {
    id: 'non-extendable-not-target',
    cause: `${FILES.groups}: a combination no valid row extends is infeasible, not a target`,
    when: (shape) => shape.special === 'non-extendable',
    tier: 4,
    check: (a) => {
      const pinched = a.scenario.pinched as Cell;
      if (a.oracle.cells.some((cell) => holds(cell, pinched)))
        throw new Error('the drawn store lets a valid row hold the pinched pair');
      const held = rowsOf(a.full).filter((row) => holds(row, pinched)).length;
      const report = layerVerdict(a.full, a, []);
      return verdict(
        held === 0 && report.pass,
        held > 0 ? `${held} rows hold a pair no valid row can hold` : report.detail,
      );
    },
  },
  {
    id: 'odd-size-forbids',
    cause: `${FILES.solver}: a constraint of one value or of three values forbids every row that holds it`,
    when: (shape) => shape.special === 'odd-sizes',
    check: (a) => {
      const odd = a.scenario.forbids.filter((forbid) => Object.keys(forbid).length !== 2);
      const bad = rowsOf(a.full).filter((row) => odd.some((forbid) => holds(row, forbid))).length;
      return verdict(bad === 0 && odd.length === 2, `${bad} rows hold a forbidden value or triple`);
    },
  },
  {
    id: 'approved-only',
    cause: `${FILES.view}: plan only the values, variables and constraints a person approved`,
    when: (shape) => shape.unapproved === true,
    tier: 3,
    check: (a) => {
      const { excluded } = a.scenario;
      const wrong: string[] = [];
      for (const row of logOf(a.full)) {
        if (Object.entries(excluded.values).some(([variable, value]) => row.values[variable] === value))
          wrong.push(`${row.id} holds a value nobody approved`);
        if (excluded.variables.some((variable) => row.values[variable] !== undefined))
          wrong.push(`${row.id} names a variable nobody approved`);
      }
      // A constraint nobody approved plans nothing: the pair it names is a target of the first rule, so a row
      // holds it.
      for (const forbid of excluded.forbids)
        if (!rowsOf(a.full).some((row) => holds(row, forbid)))
          wrong.push('no row holds the pair a constraint nobody approved names');
      return verdict(wrong.length === 0, wrong.slice(0, 3).join('; '));
    },
  },
  // Ladder version 3, seed rows (R8).
  {
    id: 'partial-seed-credit',
    cause: `${FILES.groups}: a partial seed covers only the combinations whose variables it sets`,
    when: () => true,
    tier: 3,
    check: (a) => {
      const { seeds, plan } = a.partial;
      const head = plan.rows.slice(0, seeds.length);
      // Each seed row is `seed.<id>` of its input seed (docs/variables.md, the plan's rows), in order, with exactly
      // the values the seed sets.
      const kept =
        head.length === seeds.length &&
        head.every(
          (row, at) =>
            row.source === 'seed' &&
            row.id === `seed.${seeds[at]?.id}` &&
            sameValues(row.values, seeds[at]?.values),
        );
      if (!kept)
        return verdict(
          false,
          'the partial seeds do not lead the plan as seed.<id> rows in order with exactly their own values',
        );
      const missing = [
        ...a.oracle.uncovered('own', rowsOf(plan)),
        ...a.oracle.uncovered('axes', rowsOf(plan)),
        ...a.oracle.uncovered('values', rowsOf(plan)),
      ];
      if (missing.length > 0) return verdict(false, `${missing.length} tuples uncovered with partial seeds`);
      const report = layerVerdict(
        plan,
        a,
        seeds.map((seed) => seed.values),
      );
      return verdict(report.pass, `with partial seeds: ${report.detail}`);
    },
  },
  {
    id: 'seed-forbidden-kept',
    cause: `${FILES.plan}: keep a seed that holds a forbidden combination, and warn seed_forbidden`,
    // On the unapproved shape a drawn constraint may name the value nobody approved, and then it forbids nothing.
    when: (shape) => (shape.forbids > 0 || shape.special !== undefined) && !shape.unapproved,
    check: (a) => {
      const got = a.forbidden;
      if (!got) throw new Error('the store of this shape has no constraint');
      const [seed] = got.seeds as [PlanSeedRow];
      const row = got.plan.rows[0];
      const kept =
        row?.source === 'seed' && row.id === `seed.${seed.id}` && sameValues(row.values, seed.values);
      const warned = got.plan.warnings.some(
        (warning) => warning.code === 'seed_forbidden' && warning.seed === seed.id,
      );
      return verdict(kept && warned, `kept ${kept}, warned ${warned}`);
    },
  },
  {
    id: 'seed-unapproved-covers-nothing',
    cause: `${FILES.plan}: keep a seed's value nobody approved, warn seed_unapproved_value, and credit nothing with it`,
    when: (shape) => shape.unapproved === true,
    tier: 4,
    check: (a) => {
      const got = a.unapproved;
      if (!got) throw new Error('the store of this shape has no value nobody approved');
      const [seed] = got.seeds as [PlanSeedRow];
      const [variable, value] = Object.entries(a.scenario.excluded.values)[0] as [string, string];
      const row = got.plan.rows[0];
      const kept = row?.source === 'seed' && row.id === `seed.${seed.id}` && sameValues(row.values, seed.values);
      const warned = got.plan.warnings.some(
        (warning) =>
          warning.code === 'seed_unapproved_value' &&
          warning.seed === seed.id &&
          warning.variable === variable &&
          warning.value === value,
      );
      if (!kept || !warned) return verdict(false, `kept whole ${kept}, warned ${warned}`);
      const report = layerVerdict(got.plan, a, [seed.values]);
      return verdict(report.pass, `with a value nobody approved in a seed: ${report.detail}`);
    },
  },
  {
    id: 'new-row-novel',
    cause: `${FILES.plan}: a new row repeats no seed and no other new row, and holds a target the seeds miss`,
    when: () => true,
    check: (a) => {
      const groups = Object.values(a.oracle.layerGroups()).flat();
      const targets = groups.flatMap((group) => a.oracle.tuples(group));
      const wrong: string[] = [];
      for (const [name, plan] of [
        ['without seeds', a.full],
        ['with seeds', a.seeded.plan],
      ] as const) {
        const seeds = plan.rows.filter((row) => row.source === 'seed').map((row) => row.values);
        const seen = new Set(seeds.map((values) => JSON.stringify(Object.entries(values).sort())));
        for (const row of logOf(plan)) {
          const key = JSON.stringify(Object.entries(row.values).sort());
          if (seen.has(key)) wrong.push(`${name}: ${row.id} repeats an earlier row`);
          seen.add(key);
          const fresh = targets.some(
            (tuple) => holds(row.values, tuple) && !seeds.some((seed) => holds(seed, tuple)),
          );
          if (!fresh) wrong.push(`${name}: ${row.id} holds no target the seeds miss`);
        }
      }
      return verdict(wrong.length === 0, wrong.slice(0, 3).join('; '));
    },
  },
  // Ladder version 3, traffic order (R9, R11).
  {
    id: 'weight-scale-invariance',
    cause: `${FILES.view}: weigh a value by its share of its variable's weights, not by the weight itself`,
    when: (shape) => shape.weighted === true,
    tier: 3,
    check: (a) => {
      const scaled = a.scaled as PlanV2;
      const same =
        scaled.rows.length === a.full.rows.length &&
        scaled.rows.every((row, at) => {
          const other = a.full.rows[at];
          const close =
            row.logWeight === other?.logWeight ||
            Math.abs(row.logWeight - (other?.logWeight ?? Number.NaN)) <= 1e-9;
          return (
            row.id === other?.id && JSON.stringify(row.values) === JSON.stringify(other?.values) && close
          );
        });
      return verdict(same, 'the plan changes when every weight is three times as large');
    },
  },
  {
    id: 'zero-weight-last',
    cause: `${FILES.plan}: a row with a value of weight 0 weighs minus infinity, comes last, and is written null`,
    when: (shape) => shape.zeroWeight === true,
    tier: 4,
    check: (a) => {
      const axis = a.scenario.variables.filter((variable) => variable.role === 'axis').at(-1) as Variable;
      const zero = axis.values.at(-1) as string;
      const planned = logOf(a.full);
      const holding = planned.map((row) => row.values[axis.id] === zero);
      const wrong: string[] = [];
      if (!holding.some(Boolean)) wrong.push('no new row holds the value of weight 0');
      if (holding.some((held, at) => !held && holding.slice(0, at).some(Boolean)))
        wrong.push('a row with the value of weight 0 comes before a row without it');
      planned.forEach((row, at) => {
        if (holding[at] && row.logWeight !== Number.NEGATIVE_INFINITY)
          wrong.push(`${row.id} weighs ${row.logWeight} in memory, not minus infinity`);
        // Every other row weighs the sum of the logarithms of its shares, a finite number (R9).
        const wanted = a.oracle.logWeight(row.values);
        if (
          !holding[at] &&
          !(Number.isFinite(row.logWeight) && Math.abs(row.logWeight - wanted) <= 1e-6)
        )
          wrong.push(`${row.id} weighs ${row.logWeight}, not the sum of log shares ${wanted}`);
      });
      let written: Array<{ id?: unknown; logWeight?: unknown }> = [];
      try {
        written = (JSON.parse(a.rendered ?? '') as { rows?: typeof written }).rows ?? [];
      } catch {
        wrong.push('the plan is not written as JSON');
      }
      for (const row of planned) {
        const out = written.find((entry) => entry.id === row.id);
        const held = row.values[axis.id] === zero;
        if (held && out?.logWeight !== null)
          wrong.push(`${row.id} is written ${String(out?.logWeight)}, not null`);
        if (!held && typeof out?.logWeight !== 'number') wrong.push(`${row.id} is written without a number`);
      }
      return verdict(wrong.length === 0, wrong.slice(0, 3).join('; '));
    },
  },
  {
    id: 'key-order-invariance',
    cause: `${FILES.plan}: the order of the keys of the store changes nothing in the plan`,
    when: () => true,
    tier: 3,
    check: (a) => {
      const rows = JSON.stringify(a.reordered.rows) === JSON.stringify(a.full.rows);
      const layers = JSON.stringify(a.reordered.layers) === JSON.stringify(a.full.layers);
      const rules = (plan: PlanV2) =>
        plan.rules
          .map((rule) => [...rule.variables].sort().join(','))
          .sort()
          .join('|');
      const same = rows && layers && rules(a.reordered) === rules(a.full);
      return verdict(
        same,
        `rows ${rows}, layers ${layers}, rules ${rules(a.reordered) === rules(a.full)} with the keys reordered`,
      );
    },
  },
];

/** Hostile stores: no approved variable, and a seed that names what the store lacks. */
function hostileItems(module: string): BankItem[] {
  const base = (data: SeedData) => draw(data.seed, SHAPES[0] as Shape);
  const call = async (
    data: SeedData,
    tag: string,
    make: (scenario: Scenario) => [unknown, Record<string, unknown>],
  ) =>
    data.memoized(`planner:hostile:${tag}:${module}`, async () => {
      const scenario = base(data);
      const [store, options] = make(scenario);
      const frame = isolate<{ planV2: PlanFn }>({ module, seed: data.seed, tag: `planner:hostile:${tag}` });
      try {
        const out = frame.product.planV2(store as VariableStore, options);
        return { scenario, out, divergence: frame.divergence() };
      } finally {
        frame.close();
      }
    });
  const unapproved = (scenario: Scenario) => ({
    ...scenario.store,
    variables: scenario.store.variables.map((variable) => ({ ...variable, approved: false })),
  });
  return [
    {
      id: 'planner.hostile.nothing-approved-keeps-seeds',
      family: FAMILY,
      tier: 4,
      level: LEVEL,
      component: FILES.plan,
      cause: `${FILES.plan}: keep the seeds when nothing is approved, and say why`,
      async check(data) {
        const { scenario, out, divergence } = await call(data, 'nothing', (s) => [
          unapproved(s),
          {
            seeds: [
              { id: 'only', values: { [s.variables[0]?.id as string]: s.variables[0]?.values[0] as string } },
            ],
          },
        ]);
        const ok =
          out.rows.length === 1 &&
          out.rows[0]?.source === 'seed' &&
          out.warnings.some((w) => w.code === 'no_variables');
        return verdict(
          ok && divergence === undefined,
          divergence ??
            `${out.rows.length} rows and warnings ${out.warnings.map((w) => w.code).join(',')} for a store with nothing approved (${scenario.name})`,
        );
      },
    },
    {
      id: 'planner.hostile.unreachable-value-warned',
      family: FAMILY,
      tier: 4,
      level: LEVEL,
      component: FILES.plan,
      cause: `${FILES.plan}: warn value_unreachable once for a value no valid row can hold, and plan no row with it`,
      async check(data) {
        const { out, scenario, divergence } = await call(data, 'unreachable', (s) => {
          const [a, b] = s.variables as [Variable, Variable];
          // Every value of b is forbidden next to the first value of a, so that value can be in no row.
          const forbids = b.values.map((value) => ({
            forbid: { [a.id]: a.values[0] as string, [b.id]: value },
            reason: 'drawn for the item',
            approved: true,
          }));
          return [{ ...s.store, constraints: [...s.store.constraints, ...forbids] }, {}];
        });
        const [a] = scenario.variables as [Variable];
        const target = `${a.id}=${a.values[0]}`;
        const warned = out.warnings
          .filter((w) => w.code === 'value_unreachable')
          .map((w) => `${(w as { variable: string }).variable}=${(w as { value: string }).value}`);
        const held = out.rows.filter((row) => row.values[a.id] === a.values[0]).length;
        return verdict(
          divergence === undefined && warned.join('|') === target && held === 0,
          divergence ?? `warned ${JSON.stringify(warned)} where ${target} is wanted; ${held} rows hold it`,
        );
      },
    },
    {
      id: 'planner.hostile.budget-zero-no-seeds',
      family: FAMILY,
      tier: 4,
      level: LEVEL,
      component: FILES.plan,
      cause: `${FILES.plan}: a budget of zero with no seeds gives no row`,
      async check(data) {
        const { out, divergence } = await call(data, 'zero', (s) => [s.store, { budget: 0 }]);
        return verdict(
          out.rows.length === 0 && divergence === undefined,
          divergence ?? `${out.rows.length} rows at a budget of zero`,
        );
      },
    },
    {
      id: 'planner.hostile.unknown-seed-value-kept',
      family: FAMILY,
      tier: 4,
      level: LEVEL,
      component: FILES.plan,
      cause: `${FILES.plan}: keep a seed that names a value the store lacks, drop the entry, and report it`,
      async check(data) {
        const { out, scenario, divergence } = await call(data, 'unknown', (s) => [
          s.store,
          {
            seeds: [
              {
                id: 'odd',
                values: {
                  [s.variables[0]?.id as string]: s.variables[0]?.values[0] as string,
                  [s.variables[1]?.id as string]: 'a-value-the-store-never-had',
                },
              },
            ],
          },
        ]);
        const first = scenario.variables[0] as Variable;
        const second = scenario.variables[1] as Variable;
        const row = out.rows[0];
        const kept =
          row?.source === 'seed' &&
          row.values[first.id] === first.values[0] &&
          row.values[second.id] === undefined;
        const warned = out.warnings.some(
          (w) =>
            w.code === 'seed_unknown_value' &&
            w.variable === second.id &&
            w.value === 'a-value-the-store-never-had',
        );
        return verdict(
          kept && warned && divergence === undefined,
          divergence ?? `kept ${kept}, reported ${warned}`,
        );
      },
    },
    {
      id: 'planner.hostile.bad-budget-refused',
      family: FAMILY,
      tier: 4,
      level: LEVEL,
      component: FILES.plan,
      cause: `${FILES.plan}: refuse a budget that is not a whole number from 0`,
      async check(data) {
        const scenario = base(data);
        const frame = isolate<{ planV2: PlanFn }>({ module, seed: data.seed, tag: 'planner:hostile:budget' });
        try {
          const refused = [-1, 1.5].map((budget) => {
            try {
              frame.product.planV2(scenario.store, { budget });
              return false;
            } catch {
              return true;
            }
          });
          return verdict(
            refused.every(Boolean) && frame.divergence() === undefined,
            frame.divergence() ?? `refused: ${refused.join(', ')}`,
          );
        } finally {
          frame.close();
        }
      },
    },
  ];
}

/**
 * R8 (docs/variables.md:426): in the thirty-percent-covered, half-covered and ninety-percent-covered benchmark
 * cases, seed credit must reduce the new-row count compared with the same unseeded plan. A benchmark case is an
 * unconstrained space (no impossible pair, no detail). The seeds are the first rows of the unseeded plan, so they
 * hold a known part of what it covers. On the other stores of this family the clause does not apply:
 * docs/variables.md:338 says "The array is not minimal" (a greedy plan), so a seeded plan may need as many rows.
 */
const BENCHMARK: Shape = { name: 'benchmark', tier: 3, axes: 6, detail: false, rules: [3], forbids: 0 };

function benchmarkItems(module: string): BankItem[] {
  return ([30, 50, 90, 97] as const).map((percent) => ({
    // R8 lists the cases in the order thirty, half, ninety, mostly-covered and gives the last no number. It is
    // read here as 97 percent: above the ninety that comes before it in the list.
    id: `planner.seeds-reduce-new-rows.${percent === 97 ? 'mostly' : percent}`,
    family: FAMILY,
    tier: 3 as Tier,
    level: LEVEL,
    component: FILES.groups,
    cause: `${FILES.groups}: count the tuples a seed holds as covered, so the plan needs fewer new rows`,
    async check(data: SeedData) {
      const scenario = draw(data.seed, BENCHMARK);
      const frame = isolate<{ planV2: PlanFn }>({
        module,
        seed: data.seed,
        tag: `planner:benchmark:${percent}`,
      });
      try {
        const plan = frame.product.planV2;
        const bare = plan(scenario.store, { seed: 1 });
        const planned = bare.rows.filter((row) => row.source === 'planned');
        const seeds = planned
          .slice(0, Math.max(1, Math.floor((planned.length * percent) / 100)))
          .map((row, index) => ({ id: `b${index}`, values: row.values }));
        const seeded = plan(scenario.store, { seed: 1, seeds });
        const fresh = seeded.rows.filter((row) => row.source === 'planned').length;
        const divergence = frame.divergence();
        return verdict(
          divergence === undefined && fresh < planned.length,
          divergence ??
            `${seeds.length} seeds from the first ${percent} percent of ${planned.length} rows: ${fresh} new rows with seeds, ${planned.length} without`,
        );
      } finally {
        frame.close();
      }
    },
  }));
}

/**
 * The items of the planner v2 family, one per stem and scenario that fits it, and the hostile ones. `module` is
 * the product: the planner's own module unless a test puts a planted fault in its place; `only` keeps the
 * scenarios of those names (a test of a planted fault runs few).
 */
export function plannerItems(module: string = PLANNER_MODULE, only?: readonly string[]): BankItem[] {
  const items: BankItem[] = [];
  for (const shape of SHAPES) {
    if (only && !only.includes(shape.name)) continue;
    for (const stem of STEMS) {
      if (!stem.when(shape)) continue;
      items.push({
        id: `planner.${stem.id}.${shape.name}`,
        family: FAMILY,
        tier: Math.max(shape.tier, stem.tier ?? 1) as Tier,
        level: LEVEL,
        component: FILES.plan,
        cause: stem.cause,
        async check(data) {
          const got = await answers(data, shape, module);
          if (got.divergence !== undefined)
            return verdict(false, got.divergence, `${FILES.plan}: answer the same in every run`);
          return stem.check(got);
        },
      });
    }
  }
  return [...items, ...hostileItems(module), ...benchmarkItems(module)];
}
