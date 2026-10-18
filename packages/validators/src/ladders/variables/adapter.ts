import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type PlanSeedRow, planV2 } from '@agent-nexus/driftbench-generate';
import { type VariableStore, validateVariableStore } from '@agent-nexus/driftbench-space';
import type {
  FileStore,
  Plan,
  PlanOptions,
  Provenance,
  QuotesResult,
  StoreDoc,
  ValidateResult,
  VariablesImpl,
} from './interface';

/**
 * The variables implementation as the validator scores it: the one place that maps the real variable store and
 * planner to the neutral interface of the bank (interface.ts), as docs/variables.md "Adapter projection" says.
 *
 * - `validate` is `validateVariableStore` of @agent-nexus/driftbench-space.
 * - `quotes` is `verifyVariableQuotes` of @agent-nexus/driftbench-generate. The product reads the files from a
 *   folder and is asynchronous, and the bank's port is synchronous: a child process writes the files the bank
 *   gives into a fresh folder and runs the product function on it, unchanged.
 * - `plan` is `planV2`: the StoreDoc projection is written as a store file, so the planner reads its rules as it
 *   reads any store's, from the passages its values quote.
 * - `buildStore`, `weightInterval` and `coverage` have no product yet: they stay unmapped, and their items fail
 *   with the name of the function they need. That is the roadmap.
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

/** The child of `quotes`: reads `{store, files}` on stdin, writes the files, prints the product's issues. */
const QUOTES_CHILD = `
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { store, files, generate } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const { verifyVariableQuotes } = await import(generate);
const folder = mkdtempSync(join(tmpdir(), 'driftbench-variables-quotes-'));
try {
  for (const [path, text] of Object.entries(files)) {
    const target = join(folder, path);
    if (!target.startsWith(folder)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  const issues = await verifyVariableQuotes(store, folder);
  process.stdout.write(JSON.stringify(issues.map((issue) => ({ code: issue.code, path: issue.path }))));
} finally {
  rmSync(folder, { recursive: true, force: true });
}
`;

const GENERATE_ENTRY = fileURLToPath(new URL('../../../../generate/src/index.ts', import.meta.url));

function quotes(store: FileStore, files: Record<string, string>): QuotesResult {
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', QUOTES_CHILD], {
    input: JSON.stringify({ store, files, generate: GENERATE_ENTRY }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (child.status !== 0)
    throw new Error(`the quote check failed: ${(child.stderr ?? '').split('\n').slice(0, 3).join(' ')}`);
  return { errors: JSON.parse(child.stdout) as QuotesResult['errors'] };
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
    ...(doc.impossible ?? []).map((pair) => ({
      forbid: { [pair.a.variable]: pair.a.value, [pair.b.variable]: pair.b.value },
      reason: 'an impossible pair of the store',
      approved: true,
      provenance: ownProvenance(pair.provenance),
    })),
    ...(doc.forbids ?? []).map((entry) => ({
      forbid: { ...entry.forbid },
      reason: 'a combination the store forbids',
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

export const variablesImpl: Partial<VariablesImpl> = { validate, quotes, plan };
