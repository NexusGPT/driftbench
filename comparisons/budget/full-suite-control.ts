/** Whole-suite seed-1 supplement. Run: pnpm exec tsx comparisons/budget/full-suite-control.ts. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { functionAdapter, processAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { type AgentAdapter, loadSpecs } from '@agent-nexus/driftbench-core';
import {
  blockOutcome,
  faultAdapter,
  type GenerateReport,
  loadApprovedMap,
  projectRun,
  runOnce,
} from '@agent-nexus/driftbench-generate';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { coverage } from '@agent-nexus/driftbench-space';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { faults } from '../../examples/acme/faults/index';
import { createAcmeAgent, createStore } from '../../examples/acme/src/index';
import { main } from '../../packages/cli/src/index';

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const map = await loadApprovedMap('examples/acme/map/approved.yaml');
if (!map.ok) throw new Error(JSON.stringify(map));
const prepared = map.prepared;
const root = process.cwd();
const outputRoot = resolve('_captures/budget/full-suite');
await mkdir(`${outputRoot}/tmp`, { recursive: true });
process.env.TMPDIR = `${outputRoot}/tmp`;
const provider = () => localProvider({ dir: `${outputRoot}/sandboxes` });
const ctx = { checks: defaultChecks(), artifacts: defaultReaders(), driver: createScriptedDriver };
const reference: Record<string, AgentAdapter> = {
  'function:acme-sales': functionAdapter({
    create: () => {
      const store = createStore();
      return { store, agent: createAcmeAgent(store) };
    },
    respond: (messages, world, _vars, session) => session.agent.respond(messages, world),
    payloads: (session) => session.store.payloads,
    deterministic: true,
  }),
  'process:acme-ops': processAdapter({
    command: process.execPath,
    args: [resolve('examples/acme/ops/agent.mjs')],
    provider: provider(),
    deterministic: true,
  }),
};

// Keep a fixed denominator across budgets. This mutant is equivalent on the full generated Acme suite;
// each measured suite checks that equivalence again, instead of counting it as a missed fault.
const equivalent = faults.find((fault) => fault.id === 'x2-keeps-first-email');
if (!equivalent) throw new Error('Missing equivalence control');
const scored = faults.filter((fault) => fault.kind !== 'control' && fault.id !== equivalent.id);
if (scored.length !== 13) throw new Error(`Expected 13 scored Acme faults, found ${scored.length}`);

const results = [];
for (const budget of [20, 50, 100, 200]) {
  for (const mode of ['budget', 'pairwise'] as const) {
    const started = performance.now();
    const out = `_captures/budget/full-suite/${mode}-${budget}`;
    const argv = [
      'generate',
      '--map',
      'examples/acme/map/approved.yaml',
      '--out',
      out,
      '--t',
      '2',
      '--seed',
      '1',
      ...(mode === 'pairwise' ? ['--max', String(budget)] : ['--budget', String(budget)]),
      '--force',
    ];
    let stdout = '';
    let stderr = '';
    const exitCode = await main(argv, {
      cwd: root,
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    });
    await writeFile(
      `${out}/command.txt`,
      `pnpm -s driftbench ${argv.join(' ')}\n${stdout}${stderr}exit ${exitCode}\n`,
    );
    if (exitCode === 2) throw new Error(stderr || stdout);
    const generationMs = performance.now() - started;
    const report: GenerateReport = JSON.parse(await readFile(`${out}/generate-report.json`, 'utf8'));
    if (report.budget)
      await writeFile('_captures/budget/full-suite/domains.json', JSON.stringify(report.budget));
    // Both complete and incomplete selected rows count toward selection coverage and balance.
    const rowPaths = [`${out}/specs/twise`, `${out}/incomplete/twise`].filter(existsSync);
    const twise = (await loadSpecs(rowPaths)).map((entry) => {
      if (!entry.ok) throw new Error(`Invalid selected row: ${entry.path}`);
      return entry.spec;
    });
    // The allowed-value domain comes from the same constrained pool, including values with zero picks.
    const domains: GenerateReport['budget'] =
      mode === 'budget'
        ? report.budget
        : JSON.parse(await readFile(`_captures/budget/full-suite/domains.json`, 'utf8'));
    if (!domains) throw new Error('No budget domain');
    const cells = twise.map<Record<string, string>>((spec) => {
      const generated = spec.metadata?.generated as {
        cell: Record<string, string>;
        blocks: Array<{ cell: Record<string, string> }>;
      };
      // Deviations live on the injected block, not on the conversation's shared cell.
      const deviations = [...new Set(generated.blocks.flatMap((block) => block.cell.deviation ?? []))];
      if (deviations.length > 1) throw new Error(`More than one deviation in selected row ${spec.id}`);
      return { ...generated.cell, deviation: deviations[0] ?? 'none' };
    });
    const covered = new Set<string>();
    for (const cell of cells) {
      domains.dimensions.forEach((left, i) => {
        for (const right of domains.dimensions.slice(i + 1))
          covered.add(`${left}=${cell[left]}|${right}=${cell[right]}`);
      });
    }
    if (covered.size !== report.twise.covered) throw new Error('Selected cells disagree with reported pairs');
    const balance = domains.values.map((dimension) => {
      const values = dimension.values.map(({ value }) => {
        const count = cells.filter((cell) => cell[dimension.dimension] === value).length;
        const fair = twise.length / dimension.allowed;
        return { value, count, fair, deviation: count - fair };
      });
      if (values.reduce((sum, value) => sum + value.count, 0) !== twise.length)
        throw new Error(`Missing cell values for ${dimension.dimension}`);
      if (mode === 'budget' && values.some((value, i) => value.count !== dimension.values[i]?.count))
        throw new Error(`Selected cells disagree with budget counts for ${dimension.dimension}`);
      return { dimension: dimension.dimension, values };
    });
    const loaded = await loadSpecs([`${out}/specs`]);
    const killed = new Map<string, string>();
    const twiseKilled = new Set<string>();
    const referenceFailures: string[] = [];
    let executedRuns = 0;
    let executedBlocks = 0;
    for (const entry of loaded) {
      if (!entry.ok) throw new Error(`Invalid spec: ${entry.path}`);
      const spec = entry.spec;
      const target = spec.target
        ? `${spec.target.adapter}:${spec.target.agent}`
        : spec.kind === 'task'
          ? 'process:acme-ops'
          : 'function:acme-sales';
      const adapter = reference[target];
      if (!adapter) throw new Error(`No reference for ${target}`);
      const ref = await runOnce(spec, adapter, 1, ctx);
      executedRuns++;
      executedBlocks += spec.blocks.length;
      const green = spec.blocks.map((_, index) => blockOutcome(ref, index) === 'pass');
      if (!green.every(Boolean)) referenceFailures.push(spec.id);
      if (target === equivalent.target) {
        const unchanged = await runOnce(spec, faultAdapter(equivalent, provider), 1, ctx);
        executedRuns++;
        executedBlocks += spec.blocks.length;
        if (JSON.stringify(projectRun(unchanged)) !== JSON.stringify(projectRun(ref)))
          throw new Error(`${equivalent.id} is not equivalent on ${spec.id}; revisit the denominator`);
      }
      for (const fault of scored.filter((fault) => fault.target === target)) {
        const isTwise = spec.id.startsWith('gen-twise-');
        if (killed.has(fault.id) && (!isTwise || twiseKilled.has(fault.id))) continue;
        const bad = await runOnce(spec, faultAdapter(fault, provider), 1, ctx);
        executedRuns++;
        executedBlocks += spec.blocks.length;
        const index = spec.blocks.findIndex(
          (_, index) => green[index] && blockOutcome(bad, index) === 'fail',
        );
        if (index < 0) continue;
        if (!killed.has(fault.id)) killed.set(fault.id, `${spec.id}#${spec.blocks[index]?.id ?? index}`);
        if (isTwise) twiseKilled.add(fault.id);
      }
    }
    const selectedComplete = (await loadSpecs([`${out}/specs/twise`])).length;
    if (referenceFailures.length) throw new Error(`Reference failures: ${referenceFailures.join(', ')}`);
    const singleton = coverage(prepared.axisMap, loaded, {
      t: 1,
      ...(prepared.inventory ? { inventory: prepared.inventory } : {}),
    });
    const wholeBalance = prepared.axisMap.dimensions.map((dimension) => {
      const cells = singleton.grid.cells.filter((cell) => dimension.id in cell.values);
      const incidences = cells.reduce((sum, cell) => sum + cell.count, 0);
      const fair = incidences / cells.length;
      return {
        dimension: dimension.id,
        incidences,
        allowedValues: cells.length,
        values: cells.map((cell) => ({
          value: cell.values[dimension.id],
          count: cell.count,
          fair,
          deviation: cell.count - fair,
        })),
      };
    });
    const wallMs = performance.now() - started;
    const result = {
      provenance: {
        sourceCommit,
        measuredAt: new Date().toISOString(),
        node: process.version,
        mapHash: prepared.hash,
      },
      timing: {
        generationMs,
        wallMs,
        scope:
          'CLI generation plus suite loading, rendering audits, reference/equivalence/fault execution and coverage audit; includes output I/O, excludes final result-file write',
      },
      cost: { modelCalls: 0, usd: 0, executedRuns, executedBlocks },
      wholeBalanceCountingRule:
        't=1 coverage spec/value incidences on all axis-map dimensions among complete specs; fair=sum(spec/value incidences)/feasible values per dimension; a spec can expose multiple values',
      wholeBalance,
      wholeMaxDeviation: Math.max(
        0,
        ...wholeBalance.flatMap((dimension) => dimension.values.map((value) => Math.abs(value.deviation))),
      ),
      mode,
      budget,
      seed: 1,
      command: `pnpm -s driftbench ${argv.join(' ')}`,
      exitCode,
      selected: report.twise.rows,
      complete: loaded.length,
      incomplete: report.summary.incomplete,
      selectedComplete,
      selectedIncomplete: twise.length - selectedComplete,
      pairs: { covered: report.twise.covered, allowed: report.twise.allowed },
      wholePairs: { covered: report.coverage.complete.covered, allowed: report.coverage.allowed },
      maxDeviation: Math.max(
        0,
        ...balance.flatMap((dimension) => dimension.values.map((value) => Math.abs(value.deviation))),
      ),
      balance,
      faultsCaught: killed.size,
      faultsScored: scored.length,
      witnesses: Object.fromEntries(killed),
      missed: scored.filter((fault) => !killed.has(fault.id)).map((fault) => fault.id),
      selectedFaultsCaught: twiseKilled.size,
      selectedCaught: [...twiseKilled].sort(),
      referenceFailures,
    };
    results.push(result);
    await writeFile('comparisons/budget/full-suite-results.json', `${JSON.stringify(results, null, 2)}\n`);
    console.log(
      `${mode} ${budget}: ${result.selected} rows, ${result.pairs.covered}/${result.pairs.allowed} pairs, ${result.faultsCaught}/13 faults, deviation ${result.maxDeviation.toFixed(2)}, reference failures ${referenceFailures.length}`,
    );
  }
}
