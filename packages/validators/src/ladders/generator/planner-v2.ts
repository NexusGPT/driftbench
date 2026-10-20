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
  variables: Variable[];
  rules: Rule[];
  /** Pairs of values no row may hold. */
  forbids: Cell[];
  weighted: boolean;
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
};

const SHAPES: Shape[] = [
  { name: 'floor-only', tier: 1, axes: 4, detail: false, rules: [], forbids: 0 },
  { name: 'one-variable-rule', tier: 1, axes: 3, detail: false, rules: [1], forbids: 0 },
  { name: 'rule-of-four', tier: 2, axes: 5, detail: true, rules: [4], forbids: 0 },
  { name: 'two-rules', tier: 2, axes: 5, detail: true, rules: [3, 2], forbids: 0 },
  { name: 'constrained', tier: 3, axes: 5, detail: true, rules: [3], forbids: 3 },
  { name: 'weighted', tier: 3, axes: 5, detail: true, rules: [3, 3], forbids: 1, weighted: true },
  { name: 'wide', tier: 4, axes: 7, detail: true, rules: [4, 3], forbids: 2, weighted: true, width: 3 },
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
    const count = int(2, shape.width ?? 3);
    const values = Array.from({ length: count }, (_, j) => name(`v${k}.${j}`));
    const weights = shape.weighted ? values.map(() => int(1, 9)) : undefined;
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
  for (let n = 0; n < shape.forbids; n++) {
    const a = axes[int(0, axes.length - 1)] as Variable;
    let b = axes[int(0, axes.length - 1)] as Variable;
    if (a.id === b.id) b = axes[(axes.indexOf(a) + 1) % axes.length] as Variable;
    const forbid = {
      [a.id]: a.values[int(0, a.values.length - 1)] as string,
      [b.id]: b.values[int(0, b.values.length - 1)] as string,
    };
    // The store refuses one combination forbidden twice, whichever way round its pair is written.
    const key = (cell: Cell) => JSON.stringify(Object.entries(cell).sort());
    if (!forbids.some((other) => key(other) === key(forbid))) forbids.push(forbid);
  }
  const raw = {
    format: 1,
    agent: name('agent'),
    version: '1',
    prior: { kind: 'declared' },
    variables: variables.map((variable) => ({
      id: variable.id,
      title: variable.id,
      kind: 'data',
      role: variable.role,
      approved: true,
      values: variable.values.map((value, j) => {
        const hosted = j === 0 ? whens.get(variable.id) : undefined;
        return {
          id: value,
          title: value,
          ...(variable.weights ? { weight: variable.weights[j] } : {}),
          ...(hosted ? { polarity: 'must', when: hosted } : {}),
          ...(j === 0 && polar.has(variable.id) ? { polarity: 'must' } : {}),
        };
      }),
    })),
    constraints: forbids.map((forbid) => ({ forbid, reason: 'drawn for the item', approved: true })),
  };
  const checked = validateVariableStore(raw);
  if (!checked.ok)
    throw new Error(`the drawn store is invalid: ${checked.errors.map((issue) => issue.message).join('; ')}`);
  return {
    name: shape.name,
    tier: shape.tier,
    store: checked.store,
    variables,
    rules,
    forbids,
    weighted: shape.weighted === true,
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
  divergence?: string;
};

const rowsOf = (plan: PlanV2): Cell[] => plan.rows.map((row) => row.values);

async function answers(data: SeedData, shape: Shape, module: string): Promise<Answers> {
  return data.memoized(`planner:${shape.name}:${module}`, async () => {
    const scenario = draw(data.seed, shape);
    const oracle = new Oracle(scenario);
    const frame = isolate<{ planV2: PlanFn }>({ module, seed: data.seed, tag: `planner:${shape.name}` });
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
      return {
        scenario,
        oracle,
        full,
        other,
        budgets,
        seeded,
        fedBack,
        tight,
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
    when: (shape) => shape.forbids > 0,
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
        bad.length === 0,
        `${bad.length} new rows miss a variable or hold a value outside the store`,
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
      const ids = a.full.rows.map((row) => row.id);
      return verdict(new Set(ids).size === ids.length, `${ids.length - new Set(ids).size} row ids repeat`);
    },
  },
  {
    id: 'seeds-lead',
    cause: `${FILES.plan}: list the seed rows first, in the order given, with their own values`,
    when: () => true,
    check: (a) => {
      const { seeds, plan } = a.seeded;
      const head = plan.rows.slice(0, seeds.length);
      const ok = head.every(
        (row, index) =>
          row.source === 'seed' &&
          row.id.endsWith(seeds[index]?.id as string) &&
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
    when: (shape) => shape.weighted === true,
    tier: 4,
    check: (a) => {
      const bad = logOf(a.full).filter(
        (row) => Math.abs(row.logWeight - a.oracle.logWeight(row.values)) > 1e-6,
      ).length;
      return verdict(bad === 0, `${bad} rows carry a weight other than the sum of log shares`);
    },
  },
  {
    id: 'layers-agree',
    cause: `${FILES.plan}: the report counts the tuples each layer left uncovered`,
    when: () => true,
    tier: 3,
    check: (a) => {
      const bad = a.full.layers.filter(
        (layer) => layer.uncovered !== 0 || layer.covered + layer.uncovered !== layer.targets,
      );
      return verdict(
        bad.length === 0,
        `${bad.length} layers report uncovered targets on a plan with no budget`,
      );
    },
  },
  {
    id: 'budget-uncovered-reported',
    cause: `${FILES.plan}: the report counts the tuples of each layer that a budget left uncovered`,
    when: (shape) => shape.rules.length > 0,
    tier: 4,
    check: (a) => {
      const cut = a.budgets.get(1) as PlanV2;
      const own = new Set(
        a.oracle
          .groups('own')
          .flatMap((group) => a.oracle.tuples(group))
          .map((tuple) => JSON.stringify(tuple)),
      );
      const left = new Set(a.oracle.uncovered('own', rowsOf(cut)).map((tuple) => JSON.stringify(tuple)));
      const layer = cut.layers.find((entry) => entry.layer === 'own');
      return verdict(
        layer?.targets === own.size && layer.uncovered === left.size,
        `the own layer reports ${layer?.targets} targets and ${layer?.uncovered} uncovered at a budget of 1; the count is ${own.size} and ${left.size}`,
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
  return ([30, 50, 75, 90] as const).map((percent) => ({
    // R8 names a "mostly-covered" case without a number: it is 75 percent here, between half and ninety.
    id: `planner.seeds-reduce-new-rows.${percent === 75 ? 'mostly' : percent}`,
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
