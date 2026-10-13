/** Run AFTER measure.ts: pnpm exec tsx comparisons/budget/random-control.ts. No model calls. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
import { rowDrafts, twiseDimensions } from '../../packages/generate/src/seed/seeders';

const measured = JSON.parse(await readFile('comparisons/budget/results.json', 'utf8')) as Array<{
  mode: string;
  budget: number;
  selectedFaultsCaught: number;
  pairs: { allowed: number; covered: number };
}>;
if (measured.length !== 8) throw new Error('Finish all eight budget comparisons before running the control');
const hybrid = measured.find((row) => row.mode === 'budget' && row.budget === 20);
if (!hybrid) throw new Error('No measured hybrid at budget 20');
const loaded = await loadApprovedMap('examples/acme/map/approved.yaml');
if (!loaded.ok) throw new Error(loaded.message);
const prepared = loaded.prepared;
const hybridReport = JSON.parse(
  await readFile('_captures/budget/budget-20/generate-report.json', 'utf8'),
) as { map: { hash: string } };
if (hybridReport.map.hash !== prepared.hash) throw new Error('Control map differs from the measured hybrid');
const dimensions = twiseDimensions(prepared);
const taskNones: Pick[] = [...prepared.axes].flatMap((index): Pick[] => {
  const dimension = prepared.space.dimensions[index];
  const empty = dimension?.index.get(NONE);
  return dimension?.kind === 'task' && empty !== undefined ? [[index, empty]] : [];
});
const pool = enumerateCells(
  dimensions.map((index) => prepared.space.dimensions[index]?.values.length ?? 0),
  (row) =>
    prepared.feasibility.allowed([
      ...row.map((value, i): Pick => [dimensions[i] as number, value]),
      ...taskNones,
    ]),
);
const pairSet = (rows: readonly (readonly number[])[]) => {
  const pairs = new Set<string>();
  for (const row of rows)
    for (let i = 0; i < dimensions.length; i++)
      for (let j = i + 1; j < dimensions.length; j++) pairs.add(`${i}=${row[i]}|${j}=${row[j]}`);
  return pairs;
};
const allowedPairs = pairSet(pool);
if (pool.length !== 747 || allowedPairs.size !== hybrid.pairs.allowed)
  throw new Error('Control pool differs from the hybrid');
await mkdir('_captures/budget/random', { recursive: true });
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
const samples = [];
for (const seed of range(30).map((i) => i + 1)) {
  // Uniform sampling without replacement from the same constrained pool, using the hybrid's shuffle stream.
  const picked = shuffle(rngFor(seed, 'budget'), range(pool.length)).slice(0, 20);
  const rows = picked.map((index) => pool[index] as number[]);
  const cells = rows.map((row) => row.map((value, i): Pick => [dimensions[i] as number, value]));
  const run = { seed, mapPath: 'examples/acme/map/approved.yaml' };
  const drafts = rowDrafts(prepared, { seed, t: 2, max: Number.POSITIVE_INFINITY }, cells, 'random');
  const killed = new Map<string, string>();
  const incomplete: string[] = [];
  const incompleteCells: Array<{
    spec: string;
    cell: Record<string, string>;
    noThen: string[];
    placeholders: unknown[];
  }> = [];
  const referenceFailures: string[] = [];
  for (const [rowIndex, draft] of drafts.entries()) {
    const rendered = renderDraft(prepared, draft, run);
    const text = specText(rendered, run, prepared.hash);
    const parsed = parseSpecText(text, 'yaml', rendered.id);
    if (!parsed.ok) throw new Error(`Invalid random row ${draft.id}`);
    const selectedCell = Object.fromEntries(
      dimensions.map((dimension, column) => [
        prepared.space.dimensions[dimension]?.id as string,
        prepared.space.dimensions[dimension]?.values[rows[rowIndex]?.[column] ?? -1]?.id as string,
      ]),
    );
    if (rendered.noThen.length > 0 || rendered.placeholders.length > 0) {
      incomplete.push(draft.id);
      incompleteCells.push({
        spec: draft.id,
        cell: selectedCell,
        noThen: rendered.noThen,
        placeholders: rendered.placeholders,
      });
      continue;
    }
    const { generated } = rendered.spec.metadata as {
      generated: {
        cell: Record<string, string>;
        blocks: Array<{ cell: Record<string, string> }>;
      };
    };
    const deviations = [...new Set(generated.blocks.flatMap((block) => block.cell.deviation ?? []))];
    const actual: Record<string, string> = { ...generated.cell, deviation: deviations[0] ?? 'none' };
    if (
      deviations.length > 1 ||
      dimensions.some((dimension, column) => {
        const axis = prepared.space.dimensions[dimension];
        return actual[axis?.id ?? ''] !== axis?.values[rows[rowIndex]?.[column] ?? -1]?.id;
      })
    )
      throw new Error(
        `Rendered random row differs from the selected cell at seed ${seed}, row ${rowIndex}: ${JSON.stringify(
          {
            actual,
            expected: selectedCell,
            deviations,
            noThen: rendered.noThen,
            placeholders: rendered.placeholders,
          },
        )}`,
      );
    const spec = parsed.spec;
    const ref = await runOnce(spec, reference, 1, ctx);
    const green = spec.blocks.map((_, index) => blockOutcome(ref, index) === 'pass');
    if (!green.every(Boolean)) referenceFailures.push(spec.id);
    const unchanged = await runOnce(
      spec,
      faultAdapter(equivalent, () => localProvider()),
      1,
      ctx,
    );
    if (JSON.stringify(projectRun(unchanged)) !== JSON.stringify(projectRun(ref)))
      throw new Error(`Equivalence changed on random seed ${seed}, ${spec.id}`);
    for (const fault of scored.filter(
      (fault) => fault.target === 'function:acme-sales' && !killed.has(fault.id),
    )) {
      const bad = await runOnce(
        spec,
        faultAdapter(fault, () => localProvider()),
        1,
        ctx,
      );
      const index = spec.blocks.findIndex((_, index) => green[index] && blockOutcome(bad, index) === 'fail');
      if (index >= 0) killed.set(fault.id, `${spec.id}#${spec.blocks[index]?.id ?? index}`);
    }
  }
  samples.push({
    seed,
    picked,
    pairsCovered: pairSet(rows).size,
    faultsCaught: killed.size,
    complete: 20 - incomplete.length,
    incompleteCount: incomplete.length,
    incomplete,
    incompleteCells,
    referenceFailures,
    witnesses: Object.fromEntries(killed),
  });
  console.log(
    `random seed ${seed}: ${killed.size}/13 faults, ${pairSet(rows).size}/${allowedPairs.size} pairs, ${incomplete.length} incomplete, ${referenceFailures.length} reference failures`,
  );
}

function spread(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  return { mean, sampleStandardDeviation: sd, min: Math.min(...values), max: Math.max(...values) };
}
const result = {
  method: 'uniform without replacement from the allowed pool; seeded shuffle, first 20 indices',
  mapHash: prepared.hash,
  pool: pool.length,
  budget: 20,
  seeds: samples.length,
  faultsScored: 13,
  pairsAllowed: allowedPairs.size,
  hybrid: { seed: 1, faultsCaught: hybrid.selectedFaultsCaught, pairsCovered: hybrid.pairs.covered },
  random: {
    faults: spread(samples.map((row) => row.faultsCaught)),
    pairs: spread(samples.map((row) => row.pairsCovered)),
  },
  samples,
};
await writeFile('comparisons/budget/random-results.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.random, null, 2));
