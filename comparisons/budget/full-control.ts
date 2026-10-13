/** Offline selected-row grid: pnpm exec tsx comparisons/budget/full-control.ts. */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { parseSpecText } from '@agent-nexus/driftbench-core';
import {
  blockOutcome,
  enumerateCells,
  faultAdapter,
  loadApprovedMap,
  projectRun,
  runOnce,
} from '@agent-nexus/driftbench-generate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { NONE } from '@agent-nexus/driftbench-space';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { faults } from '../../examples/acme/faults/index';
import { createAcmeAgent, createStore } from '../../examples/acme/src/index';
import { type Pick, renderDraft, specText } from '../../packages/generate/src/seed/assemble';
import { range, rngFor, shuffle } from '../../packages/generate/src/seed/random';
import {
  budgetSeeder,
  rowDrafts,
  twiseDimensions,
  twiseSeeder,
} from '../../packages/generate/src/seed/seeders';
import { analysisPolicy, paired, spread } from './statistics';

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const mapPath = 'examples/acme/map/approved.yaml';
const loaded = await loadApprovedMap(mapPath);
if (!loaded.ok) throw new Error(JSON.stringify(loaded));
const prepared = loaded.prepared;
const dimensions = twiseDimensions(prepared);
const sizes = dimensions.map((index) => prepared.space.dimensions[index]?.values.length ?? 0);
const taskNones: Pick[] = [...prepared.axes].flatMap((index): Pick[] => {
  const dimension = prepared.space.dimensions[index];
  const empty = dimension?.index.get(NONE);
  return dimension?.kind === 'task' && empty !== undefined ? [[index, empty]] : [];
});
const pool = enumerateCells(sizes, (row) =>
  prepared.feasibility.allowed([
    ...row.map((value, column): Pick => [dimensions[column] as number, value]),
    ...taskNones,
  ]),
);
const poolIndex = new Map(pool.map((row, index) => [JSON.stringify(row), index]));
const pairsOf = (rows: readonly (readonly number[])[]) => {
  const pairs = new Set<string>();
  for (const row of rows)
    for (let i = 0; i < dimensions.length; i++)
      for (let j = i + 1; j < dimensions.length; j++) pairs.add(`${i}=${row[i]}|${j}=${row[j]}`);
  return pairs;
};
const allowedPairs = pairsOf(pool);
if (pool.length !== 747 || allowedPairs.size !== 314) throw new Error('Acme control domain changed');
const allowedValues = sizes.map((_, column) => [...new Set(pool.map((row) => row[column] as number))]);
const reference = functionAdapter({
  create: () => {
    const store = createStore();
    return { store, agent: createAcmeAgent(store) };
  },
  respond: (messages, world, _vars, session) => session.agent.respond(messages, world),
  payloads: (session) => session.store.payloads,
  deterministic: true,
});
const ctx = { checks: defaultChecks(), artifacts: defaultReaders(), driver: createScriptedDriver };
const equivalent = faults.find((fault) => fault.id === 'x2-keeps-first-email');
if (!equivalent) throw new Error('Missing equivalence control');
const scored = faults.filter((fault) => fault.kind !== 'control' && fault.id !== equivalent.id);
if (scored.length !== 13) throw new Error('Fault denominator changed');
const sales = scored.filter((fault) => fault.target === 'function:acme-sales');
const output = 'comparisons/budget/full-results.json';
await mkdir('_captures/budget/full', { recursive: true });
type Method = 'hybrid' | 'pairwise' | 'random';
const methods: Method[] = ['hybrid', 'pairwise', 'random'];
const budgets = [20, 50, 100, 200];
type Sample = {
  budget: number;
  seed: number;
  method: Method;
  selected: number;
  picked: number[];
  faultsCaught: number;
  pairsCovered: number;
  runnablePairsCovered: number;
  complete: number;
  incompleteCount: number;
  maxDeviation: number;
  balance: unknown[];
  selectionMs: number;
  renderAndScoreMs: number;
  wallMs: number;
  executedRuns: number;
  executedBlocks: number;
  incompleteCells: unknown[];
  referenceFailures: string[];
  equivalenceChecked: number;
  witnesses: Record<string, string>;
  missed: string[];
};
const samples: Sample[] = [];
for (const budget of budgets) {
  for (const seed of range(30).map((i) => i + 1)) {
    // Rotate execution order to avoid always charging cold startup to the same method.
    const order = methods.map((_, index) => methods[(index + seed - 1) % methods.length] as Method);
    for (const method of order) {
      const started = performance.now();
      const context = { seed, t: 2, max: Number.POSITIVE_INFINITY };
      const generated =
        method === 'hybrid'
          ? budgetSeeder(prepared, context, { budget })
          : method === 'pairwise'
            ? twiseSeeder(prepared, { ...context, max: budget })
            : undefined;
      const randomPicked =
        method === 'random' ? shuffle(rngFor(seed, 'budget'), range(pool.length)).slice(0, budget) : [];
      const drafts =
        generated?.drafts ??
        rowDrafts(
          prepared,
          context,
          randomPicked.map((index) =>
            (pool[index] as number[]).map((value, column): Pick => [dimensions[column] as number, value]),
          ),
          'random',
        );
      const rows = drafts.map((draft) =>
        dimensions.map((dimension) => {
          const pick = draft.cell.find(([at]) => at === dimension);
          if (!pick) throw new Error(`Missing selected dimension ${dimension}`);
          return pick[1];
        }),
      );
      const picked = rows.map((row) => {
        const index = poolIndex.get(JSON.stringify(row));
        if (index === undefined) throw new Error('Selected row outside common feasible pool');
        return index;
      });
      if (new Set(picked).size !== picked.length || picked.length > budget)
        throw new Error('Duplicate selection or budget overrun');
      if (generated && generated.summary.covered !== pairsOf(rows).size)
        throw new Error('Seeder and independently recounted coverage differ');
      if (method === 'random' && JSON.stringify(picked) !== JSON.stringify(randomPicked))
        throw new Error('Random drafts changed selected cells');
      const selectionMs = performance.now() - started;
      const balance = allowedValues.map((values, column) => ({
        dimension: prepared.space.dimensions[dimensions[column] as number]?.id,
        values: values.map((value) => ({
          value: prepared.space.dimensions[dimensions[column] as number]?.values[value]?.id,
          count: rows.filter((row) => row[column] === value).length,
          fair: rows.length / values.length,
          deviation: rows.filter((row) => row[column] === value).length - rows.length / values.length,
        })),
      }));
      const killed = new Map<string, string>();
      const incompleteCells = [];
      const referenceFailures: string[] = [];
      const completeRows: number[][] = [];
      let executedRuns = 0;
      let executedBlocks = 0;
      for (const [rowIndex, draft] of drafts.entries()) {
        const run = { seed, mapPath };
        const rendered = renderDraft(prepared, draft, run);
        const parsed = parseSpecText(specText(rendered, run, prepared.hash), 'yaml', rendered.id);
        if (!parsed.ok) throw new Error(`Invalid ${method} spec ${draft.id}`);
        if (rendered.noThen.length > 0 || rendered.placeholders.length > 0) {
          incompleteCells.push({
            spec: draft.id,
            picked: picked[rowIndex],
            row: rows[rowIndex],
            noThen: rendered.noThen,
            placeholders: rendered.placeholders,
          });
          continue;
        }
        const { generated: metadata } = rendered.spec.metadata as {
          generated: { cell: Record<string, string>; blocks: Array<{ cell: Record<string, string> }> };
        };
        const deviations = [...new Set(metadata.blocks.flatMap((block) => block.cell.deviation ?? []))];
        const actual: Record<string, string> = { ...metadata.cell, deviation: deviations[0] ?? 'none' };
        if (
          deviations.length > 1 ||
          dimensions.some((dimension, column) => {
            const axis = prepared.space.dimensions[dimension];
            return actual[axis?.id ?? ''] !== axis?.values[rows[rowIndex]?.[column] ?? -1]?.id;
          })
        )
          throw new Error(`Rendered cell differs from selection: ${method}/${budget}/${seed}/${draft.id}`);
        completeRows.push(rows[rowIndex] as number[]);
        const spec = parsed.spec;
        const ref = await runOnce(spec, reference, 1, ctx);
        executedRuns++;
        executedBlocks += spec.blocks.length;
        const green = spec.blocks.map((_, index) => blockOutcome(ref, index) === 'pass');
        if (!green.every(Boolean)) referenceFailures.push(spec.id);
        const unchanged = await runOnce(
          spec,
          faultAdapter(equivalent, () => localProvider()),
          1,
          ctx,
        );
        executedRuns++;
        executedBlocks += spec.blocks.length;
        if (JSON.stringify(projectRun(unchanged)) !== JSON.stringify(projectRun(ref)))
          throw new Error(`Equivalence changed on ${method}/${budget}/${seed}/${spec.id}`);
        for (const fault of sales.filter((fault) => !killed.has(fault.id))) {
          const bad = await runOnce(
            spec,
            faultAdapter(fault, () => localProvider()),
            1,
            ctx,
          );
          executedRuns++;
          executedBlocks += spec.blocks.length;
          const index = spec.blocks.findIndex(
            (_, index) => green[index] && blockOutcome(bad, index) === 'fail',
          );
          if (index >= 0) killed.set(fault.id, `${spec.id}#${spec.blocks[index]?.id ?? index}`);
        }
      }
      const wallMs = performance.now() - started;
      if (referenceFailures.length) throw new Error(`Reference failures: ${referenceFailures.join(', ')}`);
      samples.push({
        budget,
        seed,
        method,
        selected: rows.length,
        picked,
        faultsCaught: killed.size,
        pairsCovered: pairsOf(rows).size,
        runnablePairsCovered: pairsOf(completeRows).size,
        complete: completeRows.length,
        incompleteCount: incompleteCells.length,
        maxDeviation: Math.max(
          0,
          ...balance.flatMap((dimension) => dimension.values.map((v) => Math.abs(v.deviation))),
        ),
        balance,
        selectionMs,
        renderAndScoreMs: wallMs - selectionMs,
        wallMs,
        executedRuns,
        executedBlocks,
        incompleteCells,
        referenceFailures,
        equivalenceChecked: completeRows.length,
        witnesses: Object.fromEntries(killed),
        missed: scored.filter((fault) => !killed.has(fault.id)).map((fault) => fault.id),
      });
      console.log(
        `${budget}/${seed}/${method}: ${killed.size} faults, ${pairsOf(rows).size} pairs, ${wallMs.toFixed(1)} ms`,
      );
    }
    // Checkpoint contains measured samples only; summary is written after the full paired grid.
    await writeFile('_captures/budget/full/checkpoint.json', `${JSON.stringify(samples)}\n`);
  }
}
const metrics = [
  'faultsCaught',
  'pairsCovered',
  'runnablePairsCovered',
  'selected',
  'complete',
  'incompleteCount',
  'maxDeviation',
  'wallMs',
  'selectionMs',
  'renderAndScoreMs',
  'executedRuns',
  'executedBlocks',
] as const;
const summaries = budgets.flatMap((budget) =>
  methods.map((method) => {
    const own = samples
      .filter((sample) => sample.budget === budget && sample.method === method)
      .sort((a, b) => a.seed - b.seed);
    if (own.length !== 30 || own.some((row, index) => row.seed !== index + 1))
      throw new Error('Incomplete seed grid');
    return {
      budget,
      method,
      metrics: Object.fromEntries(metrics.map((metric) => [metric, spread(own.map((row) => row[metric]))])),
    };
  }),
);
const pairedTests = budgets.flatMap((budget) =>
  (['pairwise', 'random'] as const).map((control) => {
    const own = (method: Method) =>
      samples.filter((row) => row.budget === budget && row.method === method).sort((a, b) => a.seed - b.seed);
    const hybrid = own('hybrid');
    const baseline = own(control);
    const integerMetrics = [
      'faultsCaught',
      'pairsCovered',
      'runnablePairsCovered',
      'selected',
      'complete',
      'incompleteCount',
    ] as const;
    return {
      budget,
      control,
      metrics: Object.fromEntries(
        integerMetrics.map((metric) => [
          metric,
          paired(
            hybrid.map((row) => row[metric]),
            baseline.map((row) => row[metric]),
          ),
        ]),
      ),
      wallMsDifference: spread(hybrid.map((row, index) => row.wallMs - (baseline[index]?.wallMs as number))),
    };
  }),
);
// Retained budget-20 controls are an independent regression oracle for cell selection and scoring.
for (const method of ['hybrid', 'random'] as const) {
  const historical = JSON.parse(await readFile(`comparisons/budget/${method}-results.json`, 'utf8'));
  for (const row of samples.filter((row) => row.budget === 20 && row.method === method)) {
    const old = historical.samples.find((old: { seed: number }) => old.seed === row.seed);
    if (
      !old ||
      ['picked', 'faultsCaught', 'pairsCovered', 'complete', 'incompleteCount'].some(
        (key) => JSON.stringify(old[key]) !== JSON.stringify(row[key as keyof typeof row]),
      )
    )
      throw new Error(`Historical budget-20 control mismatch: ${method}/${row.seed}`);
  }
}
await writeFile(
  output,
  `${JSON.stringify(
    {
      provenance: {
        sourceCommit,
        measuredAt: new Date().toISOString(),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        mapPath,
        mapHash: prepared.hash,
      },
      policy: {
        budgets,
        seeds: range(30).map((i) => i + 1),
        pool: pool.length,
        pairsAllowed: allowedPairs.size,
        dimensions: dimensions.map((index) => prepared.space.dimensions[index]?.id),
        faultsScored: scored.length,
        reachableSalesFaults: sales.map((fault) => fault.id),
        executionSeed: 1,
        renderingSeed: 'same as selection seed for all methods; identical to existing hybrid/random controls',
        pairwise: 'production twiseSeeder at t=2, max=budget; stop at complete pair coverage',
        random: 'uniform sampling without replacement; rngFor(seed, budget) shuffled pool prefix',
        rowScope:
          'selected twise rows only; incomplete rows included in drawn coverage/balance, excluded from scoring',
        timing:
          'performance.now wall time from selection/drafting through rendering and fault scoring; excludes map load, disk output and analysis; rotated method order; no cached scoring',
        faultScoring:
          'reference-pass/fault-fail block witness; stop running a mutant after its first witness, as in prior controls',
        modelCalls: 0,
        usd: 0,
        ...analysisPolicy,
      },
      summaries,
      pairedTests,
      samples,
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote ${samples.length} paired-grid samples to ${output}`);
