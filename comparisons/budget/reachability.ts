/** Audit the full selected-conversation space and task witnesses, without model calls. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { loadSpecs, parseSpecText } from '@agent-nexus/driftbench-core';
import { enumerateCells, loadApprovedMap } from '@agent-nexus/driftbench-generate';
import { NONE } from '@agent-nexus/driftbench-space';
import { faults } from '../../examples/acme/faults/index';
import { type Pick, renderDraft, specText } from '../../packages/generate/src/seed/assemble';
import { range } from '../../packages/generate/src/seed/random';
import { rowDrafts, twiseDimensions } from '../../packages/generate/src/seed/seeders';

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const mapPath = 'examples/acme/map/approved.yaml';
const loaded = await loadApprovedMap(mapPath);
if (!loaded.ok) throw new Error(JSON.stringify(loaded));
const prepared = loaded.prepared;
const dimensions = twiseDimensions(prepared);
const taskAxes = [...prepared.axes].filter((index) => prepared.space.dimensions[index]?.kind === 'task');
const taskNones: Pick[] = taskAxes.map((index) => {
  const none = prepared.space.dimensions[index]?.index.get(NONE);
  if (none === undefined) throw new Error('Task axis without none');
  return [index, none];
});
const pool = enumerateCells(
  dimensions.map((index) => prepared.space.dimensions[index]?.values.length ?? 0),
  (row) =>
    prepared.feasibility.allowed([
      ...row.map((value, column): Pick => [dimensions[column] as number, value]),
      ...taskNones,
    ]),
);
if (pool.length !== 747 || dimensions.some((index) => taskAxes.includes(index)))
  throw new Error('Conversation scope changed');
const excluded = faults.filter((fault) => fault.kind !== 'control' && fault.target === 'process:acme-ops');
if (excluded.length !== 4) throw new Error('Expected four task faults');
const seedAudits = [];
for (const seed of range(30).map((i) => i + 1)) {
  const cells = pool.map((row) => row.map((value, column): Pick => [dimensions[column] as number, value]));
  const drafts = rowDrafts(
    prepared,
    { seed, t: 2, max: Number.POSITIVE_INFINITY },
    cells,
    'exhaustive-audit',
  );
  const targets: Record<string, number> = {};
  const kinds: Record<string, number> = {};
  let incomplete = 0;
  for (const draft of drafts) {
    const run = { seed, mapPath };
    const rendered = renderDraft(prepared, draft, run);
    const parsed = parseSpecText(specText(rendered, run, prepared.hash), 'yaml', rendered.id);
    if (!parsed.ok) throw new Error(`Invalid exhaustive row ${draft.id}`);
    const spec = parsed.spec;
    const target = spec.target
      ? `${spec.target.adapter}:${spec.target.agent}`
      : spec.kind === 'task'
        ? 'process:acme-ops'
        : 'function:acme-sales';
    targets[target] = (targets[target] ?? 0) + 1;
    kinds[spec.kind ?? 'conversation'] = (kinds[spec.kind ?? 'conversation'] ?? 0) + 1;
    if (rendered.noThen.length || rendered.placeholders.length) incomplete++;
  }
  if (targets['process:acme-ops'] || kinds.task)
    throw new Error('A conversation row reaches the operations target');
  seedAudits.push({
    seed,
    selected: drafts.length,
    complete: drafts.length - incomplete,
    incomplete,
    targets,
    kinds,
  });
}
const whole = JSON.parse(await readFile('comparisons/budget/full-suite-results.json', 'utf8')) as Array<{
  mode: string;
  budget: number;
  witnesses: Record<string, string>;
}>;
const first = whole.find((row) => row.mode === 'budget' && row.budget === 20);
if (!first) throw new Error('Run the whole-suite supplement first');
const specs = await loadSpecs(['_captures/budget/full-suite/budget-20/specs']);
const findings = excluded.map((fault) => {
  const witness = first.witnesses[fault.id];
  if (!witness) throw new Error(`Whole generator has no witness for ${fault.id}`);
  const [id, blockId] = witness.split('#');
  const entry = specs.find((entry) => entry.ok && entry.spec.id === id);
  if (!entry?.ok) throw new Error(`Missing witness spec ${id}`);
  const spec = entry.spec;
  const block = spec.blocks.find((block) => block.id === blockId);
  const target = spec.target
    ? `${spec.target.adapter}:${spec.target.agent}`
    : spec.kind === 'task'
      ? 'process:acme-ops'
      : 'function:acme-sales';
  if (!block || spec.kind !== 'task' || target !== fault.target) throw new Error('Witness target mismatch');
  return {
    fault: fault.id,
    description: fault.description,
    target: fault.target,
    affects: fault.affects,
    classification: 'unreachable in the selected-conversation space; not a missed selection',
    selectedConversationWitnesses: 0,
    fullGeneratorReachable: true,
    fullGeneratorWitness: { budget: 20, seed: 1, method: 'hybrid whole suite', witness, spec, blockId },
  };
});
await writeFile(
  'comparisons/budget/reachability-results.json',
  `${JSON.stringify(
    {
      provenance: { sourceCommit, measuredAt: new Date().toISOString(), mapHash: prepared.hash, mapPath },
      policy: {
        seeds: range(30).map((i) => i + 1),
        pool: pool.length,
        renderedCells: pool.length * seedAudits.length,
        executionSeed: 1,
        scope:
          'all feasible selected-conversation cells, not only the method-selected prefixes; audit of kind and routing, no extra fault executions',
        structuralCause:
          'twiseDimensions excludes task-kind axes, conversation feasibility fixes them to none; renderDraft emits conversation specs; taskSpecs supplies process-backed task-family specs outside selection',
        sources: [
          'packages/generate/src/seed/seeders.ts',
          'packages/generate/src/seed/assemble.ts',
          'packages/generate/src/seed/tasks.ts',
          'examples/acme/faults/ops.ts',
        ],
        modelCalls: 0,
        usd: 0,
      },
      taskAxesHeldAtNone: taskAxes.map((index) => ({
        dimension: prepared.space.dimensions[index]?.id,
        value: NONE,
      })),
      seedAudits,
      findings,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Audited ${pool.length * seedAudits.length} conversation renderings; four task faults have whole-suite witnesses.`,
);
