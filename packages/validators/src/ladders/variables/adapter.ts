import {
  checkVariableQuotes,
  type PlanSeedRow,
  planV2,
  variablesFromSources,
} from '@agent-nexus/driftbench-generate';
import {
  countVariableTuples,
  type VariableStore,
  validateVariableStore,
} from '@agent-nexus/driftbench-space';
import { wilson } from '@agent-nexus/driftbench-stats';
import type {
  CoverageResult,
  FileStore,
  Group,
  Plan,
  PlanOptions,
  Provenance,
  QuotesResult,
  Row,
  Sources,
  StoreDoc,
  ValidateResult,
  VariablesImpl,
} from './interface';

/**
 * The variables implementation as the validator scores it: the one place that maps the real variable store and
 * planner to the neutral interface of the bank (interface.ts), as docs/variables.md "Adapter projection" says.
 *
 * - `validate` is `validateVariableStore` of @agent-nexus/driftbench-space.
 * - `quotes` is `checkVariableQuotes` of @agent-nexus/driftbench-generate: the quote check on the text of the files,
 *   which `verifyVariableQuotes` runs after it has read a folder. The bank gives the files as text, so the product
 *   runs with no file access, in the confined processes of the frame.
 * - `plan` is `planV2`: the StoreDoc projection is written as a store file, so the planner reads its rules as it
 *   reads any store's, from the passages its values quote.
 * - `weightInterval` is `wilson` of @agent-nexus/driftbench-stats, the two-sided 95 percent Wilson score interval
 *   of docs/variables.md R13, clamped to 0 and 1.
 * - `coverage` is `countVariableTuples` of @agent-nexus/driftbench-space (docs/variables.md R12), on the store file
 *   the projection is written as.
 * - `buildStore` is `variablesFromSources` of @agent-nexus/driftbench-generate: tool evidence, the values of past
 *   conversations and what the owner says. It reads structure only, so an item that needs a condition span read
 *   from English fails until a reader labels the span. The labels a reader recorded are put on the spans by the
 *   validator before the call (labels.ts); this module reads no file, no variable of the environment and no clock.
 *
 * The adapter repairs nothing the product returns. Executors never edit it (it is part of the validator, and CI
 * refuses a change to it from an `exec/` branch). A mutant is planted by pointing DRIFTBENCH_VARIABLES_IMPL at
 * another module that exports `variablesImpl`.
 */

/** The file the projection's rules are quoted from: one passage per rule, so planV2 reads one rule per passage. */
const RULES_FILE = 'rules.md';

const issuesOf = (issues: ReadonlyArray<{ code: string; path: string }>) =>
  issues.map((issue) => ({ code: issue.code, path: issue.path }));

function validate(value: unknown): ValidateResult {
  const result = validateVariableStore(value);
  return result.ok
    ? { ok: true, store: result.store, warnings: issuesOf(result.warnings) }
    : { ok: false, errors: issuesOf(result.errors) };
}

function quotes(store: FileStore, files: Record<string, string>): QuotesResult {
  // The loader gives an absent list of constraints as an empty one (docs/variables.md: absent means every
  // combination can occur); the quote check takes the store after that default.
  const issues = checkVariableQuotes(
    { ...store, constraints: store.constraints ?? [] } as unknown as VariableStore,
    files,
  );
  return { errors: issues.map((issue) => ({ code: issue.code, path: issue.path })) };
}

/** The projection's provenance as a store file holds it, without its quotes: the rules are quoted apart. */
const ownProvenance = (entries: readonly Provenance[] | undefined) =>
  (entries ?? []).filter((entry) => entry.kind !== 'quote');

/**
 * The projection as a store file. Each variable is an axis when it is `shared`, else a detail; omitted approval
 * flags mean approved. Each rule of `rules` becomes one passage of RULES_FILE, quoted by the first value of every
 * variable it names, so planV2 reads exactly those rules. Impossible pairs and `forbids` become constraints.
 */
function storeOf(doc: StoreDoc): VariableStore {
  const quotesOf = new Map<string, Array<{ kind: 'quote'; path: string; quote: string }>>();
  for (const rule of doc.rules ?? []) {
    for (const variable of new Set(rule.variables)) {
      const list = quotesOf.get(variable) ?? [];
      list.push({ kind: 'quote', path: RULES_FILE, quote: `Rule ${rule.id} applies.` });
      quotesOf.set(variable, list);
    }
  }
  const constraints = [
    // A pair that names two values of one variable excludes nothing (R7): a row holds one value of a variable.
    ...(doc.impossible ?? [])
      .filter((pair) => pair.a.variable !== pair.b.variable)
      .map((pair) => ({
        forbid: { [pair.a.variable]: pair.a.value, [pair.b.variable]: pair.b.value },
        reason: `${pair.a.variable}=${pair.a.value} never occurs with ${pair.b.variable}=${pair.b.value}`,
        approved: true,
        provenance: ownProvenance(pair.provenance),
      })),
    ...(doc.forbids ?? []).map((entry) => ({
      forbid: { ...entry.forbid },
      reason: `${Object.entries(entry.forbid)
        .map(([variable, value]) => `${variable}=${value}`)
        .join(' and ')} never occur together`,
      approved: entry.approved ?? true,
      provenance: ownProvenance(entry.provenance),
    })),
  ];
  return {
    format: 1,
    agent: 'variables-bank',
    version: '1',
    variables: doc.variables.map((variable) => ({
      id: variable.id,
      title: variable.title ?? variable.id,
      kind: 'data',
      role: variable.shared ? 'axis' : 'detail',
      approved: variable.approved ?? true,
      values: variable.values.map((value, index) => {
        const provenance = [
          ...ownProvenance(value.provenance),
          ...(index === 0 ? (quotesOf.get(variable.id) ?? []) : []),
        ];
        return {
          id: value.id,
          title: value.title ?? value.id,
          ...(value.weight === undefined ? {} : { weight: value.weight }),
          ...(value.approved === undefined ? {} : { approved: value.approved }),
          ...(provenance.length > 0 ? { provenance } : {}),
        };
      }),
      ...(variable.boundaries && variable.boundaries.length > 0
        ? { boundaries: variable.boundaries.map((boundary) => ({ ...boundary })) }
        : {}),
    })),
    // The loader gives an absent list as an empty one; the projection never passes the loader, which would
    // refuse value ids shared across axes that the bank uses on purpose.
    constraints,
  } as unknown as VariableStore;
}

function plan(doc: StoreDoc, options: PlanOptions): Plan {
  const seeds: PlanSeedRow[] = (options.seeds ?? []).map((values, index) => ({
    id: `s${String(index + 1).padStart(3, '0')}`,
    values: { ...values },
  }));
  const planned = planV2(storeOf(doc), {
    seed: options.seed,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(seeds.length > 0 ? { seeds } : {}),
  });
  return {
    rows: planned.rows.map((row) => ({
      id: row.id,
      kind: row.source === 'seed' ? 'seed' : 'new',
      values: { ...row.values },
      logWeight: Number.isFinite(row.logWeight) ? Math.round(row.logWeight * 1e9) / 1e9 : null,
    })),
    // The plan's own counts, summed over its layers: the targets a valid row can hold, and those the kept rows hold.
    report: {
      allowed: planned.layers.reduce((sum, layer) => sum + layer.targets, 0),
      covered: planned.layers.reduce((sum, layer) => sum + layer.covered, 0),
    },
    warnings: planned.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
  };
}

function weightInterval(count: number, total: number): [number, number] {
  const interval = wilson(count, total);
  return [interval.lower, interval.upper];
}

function coverage(
  doc: StoreDoc,
  rows: Row[],
  groups: Group[],
  options?: { uncovered?: number },
): CoverageResult {
  return countVariableTuples(
    storeOf(doc),
    rows,
    groups,
    options?.uncovered === undefined ? {} : { uncovered: options.uncovered },
  );
}

function buildStore(sources: Sources): StoreDoc {
  const built = variablesFromSources({
    ...(sources.estate === undefined ? {} : { estate: sources.estate }),
    ...(sources.conversations === undefined ? {} : { conversations: sources.conversations }),
    ...(sources.owner === undefined ? {} : { owner: sources.owner }),
  });
  return {
    variables: built.store.variables.map((variable) => ({
      id: variable.id,
      title: variable.title,
      values: variable.values.map((value) => ({
        id: value.id,
        ...(value.title === undefined ? {} : { title: value.title }),
        ...(built.samples[variable.id]?.[value.id] === undefined
          ? {}
          : { sample: built.samples[variable.id]?.[value.id] }),
        ...(value.weight === undefined ? {} : { weight: value.weight }),
        ...(value.approved === undefined ? {} : { approved: value.approved }),
        ...(value.provenance === undefined ? {} : { provenance: value.provenance as Provenance[] }),
      })),
      ...(variable.boundaries === undefined || variable.boundaries.length === 0
        ? {}
        : {
            boundaries: variable.boundaries.map((boundary) => ({
              holds: boundary.holds,
              fails: boundary.fails,
              edge: boundary.edge,
              ...(boundary.limit === undefined ? {} : { limit: boundary.limit }),
              ...(boundary.comparison === undefined ? {} : { comparison: boundary.comparison }),
              ...(boundary.unit === undefined ? {} : { unit: boundary.unit }),
              ...(boundary.provenance === undefined
                ? {}
                : { provenance: boundary.provenance as Provenance[] }),
            })),
          }),
    })),
    impossible: built.store.constraints.map((constraint) => {
      const [[variableA, valueA], [variableB, valueB]] = Object.entries(constraint.forbid) as [
        [string, string],
        [string, string],
      ];
      return {
        a: { variable: variableA, value: valueA },
        b: { variable: variableB, value: valueB },
        provenance: (constraint.provenance ?? []) as Provenance[],
      };
    }),
    rules: built.rules,
    refused: built.refused,
  };
}

export const variablesImpl: Partial<VariablesImpl> = {
  buildStore,
  validate,
  quotes,
  plan,
  weightInterval,
  coverage,
};

// The functions by name too: the frame calls a product module by its exports (impl.ts says how a module is read).
export { buildStore, coverage, plan, quotes, validate, weightInterval };
