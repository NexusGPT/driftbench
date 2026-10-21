import { fileURLToPath } from 'node:url';
import { MessageChannel, type MessagePort, receiveMessageOnPort, Worker } from 'node:worker_threads';
import { type PlanSeedRow, planV2, variablesFromSources } from '@agent-nexus/driftbench-generate';
import { countVariableTuples, type VariableStore, validateVariableStore } from '@agent-nexus/driftbench-space';
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
 * - `quotes` is `verifyVariableQuotes` of @agent-nexus/driftbench-generate. The product reads the files from a
 *   folder and is asynchronous, and the bank's port is synchronous: one worker thread per run, started on the first
 *   call, writes the files the bank gives into a fresh folder and runs the product function on it, unchanged; the
 *   call waits on a shared flag for its answer, so one request is in flight at a time.
 * - `plan` is `planV2`: the StoreDoc projection is written as a store file, so the planner reads its rules as it
 *   reads any store's, from the passages its values quote.
 * - `weightInterval` is `wilson` of @agent-nexus/driftbench-stats, the two-sided 95 percent Wilson score interval
 *   of docs/variables.md R13, clamped to 0 and 1.
 * - `coverage` is `countVariableTuples` of @agent-nexus/driftbench-space (docs/variables.md R12), on the store file
 *   the projection is written as.
 * - `buildStore` is `variablesFromSources` of @agent-nexus/driftbench-generate: tool evidence, the values of past
 *   conversations and what the owner says. It reads structure only, so an item that needs a condition span read
 *   from English fails until a reader labels the span.
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

/**
 * The worker of `quotes`, started once per run: it imports the product, then for each `{store, files}` it writes
 * the files into a fresh folder, runs the product function on it, unchanged, and answers the issues on its port.
 */
const QUOTES_WORKER = `
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { workerData } from 'node:worker_threads';
const { port, signal, generate } = workerData;
const flag = new Int32Array(signal);
const answer = (message) => {
  port.postMessage(message);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
};
let product;
try {
  product = await import(generate);
} catch (error) {
  product = { failed: String(error && error.stack ? error.stack : error) };
}
port.on('message', async ({ store, files }) => {
  if (product.failed) return answer({ error: product.failed });
  const folder = mkdtempSync(join(tmpdir(), 'driftbench-variables-quotes-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      const target = join(folder, path);
      if (!target.startsWith(folder)) continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    const issues = await product.verifyVariableQuotes(store, folder);
    answer({ errors: issues.map((issue) => ({ code: issue.code, path: issue.path })) });
  } catch (error) {
    answer({ error: String(error && error.stack ? error.stack : error) });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
`;

const GENERATE_ENTRY = fileURLToPath(new URL('../../../../generate/src/index.ts', import.meta.url));

/** How long one quote check may take before the worker is given up: the heavy item budget of the bank. */
const QUOTES_TIMEOUT_MS = 300_000;

/** The one worker of this run, started on the first call; `unref` so it never holds the process open. */
let quotesWorker: { worker: Worker; port: MessagePort; flag: Int32Array } | undefined;

function quotesWorkerOf(): NonNullable<typeof quotesWorker> {
  if (quotesWorker) return quotesWorker;
  const { port1, port2 } = new MessageChannel();
  const signal = new SharedArrayBuffer(4);
  const worker = new Worker(QUOTES_WORKER, {
    eval: true,
    execArgv: ['--import', 'tsx'],
    workerData: { port: port2, signal, generate: GENERATE_ENTRY },
    transferList: [port2],
    stderr: false,
  });
  worker.unref();
  port1.unref();
  quotesWorker = { worker, port: port1, flag: new Int32Array(signal) };
  return quotesWorker;
}

function quotes(store: FileStore, files: Record<string, string>): QuotesResult {
  const { worker, port, flag } = quotesWorkerOf();
  // One request in flight: the call blocks until the worker answers, so no second one can start.
  Atomics.store(flag, 0, 0);
  // The loader gives an absent list of constraints as an empty one (docs/variables.md: absent means every
  // combination can occur); the quote check takes the store after that default.
  port.postMessage({ store: { ...store, constraints: store.constraints ?? [] }, files });
  const waited = Atomics.wait(flag, 0, 0, QUOTES_TIMEOUT_MS);
  const reply = receiveMessageOnPort(port)?.message as
    | { errors: QuotesResult['errors'] }
    | { error: string }
    | undefined;
  if (waited === 'timed-out' || reply === undefined) {
    quotesWorker = undefined;
    void worker.terminate();
    throw new Error(`the quote check failed: no answer within ${QUOTES_TIMEOUT_MS / 1000} s`);
  }
  if ('error' in reply)
    throw new Error(`the quote check failed: ${reply.error.split('\n').slice(0, 3).join(' ')}`);
  return { errors: reply.errors };
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
        ...(value.weight === undefined ? {} : { weight: value.weight }),
        ...(value.approved === undefined ? {} : { approved: value.approved }),
        ...(value.provenance === undefined ? {} : { provenance: value.provenance as Provenance[] }),
      })),
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
