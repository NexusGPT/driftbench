import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { loadSpecFile, runSpec, type Spec } from '@agent-nexus/driftbench-core';
import {
  isUnitSpec,
  RUNTIMES,
  readerFor,
  runUnitTests,
  traceUnitSpecs,
  type UnitResult,
  type UnitSpecTrace,
  unitJudges,
  unitTraceAdapter,
} from '@agent-nexus/driftbench-estate';
import { formatJson, UnitTest } from '@agent-nexus/driftbench-generate';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import type { Io } from '../io';
import { replayChecks } from './replay';

export type EstateUnitOptions = {
  estate?: string;
  runtime?: string;
  record?: boolean;
  /** False with --no-sandbox. */
  sandbox?: boolean;
  /** How many tests run at once, from --jobs (1 by default). */
  jobs?: string;
  json?: boolean;
};

/**
 * `driftbench estate unit <tests...> --estate <root>`: runs the unit tests `estate generate` wrote
 * (`unit/**.json`: guards with hook payloads, scripts with their declared fixtures) directly, with no model;
 * or its unit-mode specs (`specs/unit/**.yaml`), each judged by its own expectations (`traceUnitSpecs`).
 * `--record` runs them on the original estate and writes each guard's outcomes into its test file, the oracle
 * a later run on a mutant copy compares with. Exit 0 every test passes, 1 one fails, 2 a usage or input
 * error (an unrecorded guard test included).
 */
export function registerEstateUnitCommand(estate: Command, io: Io, setExit: (code: number) => void): void {
  estate
    .command('unit')
    .description(
      'Run the unit tests of a generated suite (guards and scripts, no model) against an estate root',
    )
    .argument(
      '<tests...>',
      'unit test files or unit-mode specs, or folders holding them (such as <suite>/unit or <suite>/specs/unit)',
    )
    .option('--estate <root>', 'the estate root: the original (with --record) or a mutant copy')
    .option('--runtime <name>', `the runtime that reads the estate: ${RUNTIMES.join(', ')}`, 'claude-code')
    .option('--record', 'run on the original estate and write the outcomes into the test files')
    .option(
      '--no-sandbox',
      'run without the sandbox (no network, no credential folders) even where one exists',
    )
    .option('--jobs <n>', 'how many tests run at once; the results keep their order', '1')
    .option('--json', 'print the results as JSON')
    .action(async (paths: string[], options: EstateUnitOptions) => {
      setExit(await estateUnitCommand(paths, options, io));
    });
}

export async function estateUnitCommand(
  paths: string[],
  options: EstateUnitOptions,
  io: Io,
): Promise<number> {
  if (!options.estate) {
    io.err("error: required option '--estate <root>' not specified\n");
    return 2;
  }
  const reader = readerFor(options.runtime ?? 'claude-code');
  if (!reader) {
    io.err(`error: unknown runtime "${options.runtime}": use ${RUNTIMES.join(', ')}\n`);
    return 2;
  }
  const root = resolve(io.cwd, options.estate);
  if (!(await stat(root).catch(() => undefined))?.isDirectory()) {
    io.err(`Cannot find the estate folder ${root}.\n`);
    return 2;
  }
  const files: string[] = [];
  // A file named on the command line must be a unit test or a unit spec; one found in a folder may be anything.
  const named = new Set<string>();
  for (const path of paths) {
    const full = resolve(io.cwd, path);
    const info = await stat(full).catch(() => undefined);
    if (!info) {
      io.err(`Cannot find ${path}.\n`);
      return 2;
    }
    if (info.isDirectory()) files.push(...(await testFiles(full)));
    else {
      files.push(full);
      named.add(full);
    }
  }
  const tests: Array<{ file: string; test: UnitTest }> = [];
  const specs: Array<{ file: string; spec: Spec }> = [];
  for (const file of files.sort()) {
    const text = await readFile(file, 'utf8');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    const parsed = raw === undefined ? undefined : UnitTest.safeParse(raw);
    if (parsed?.success) {
      tests.push({ file, test: parsed.data });
      continue;
    }
    // Not a unit test file: a spec `estate generate` wrote to run as a unit (YAML or JSON).
    const loaded = await loadSpecFile(file);
    if (loaded.ok && isUnitSpec(loaded.spec)) {
      specs.push({ file, spec: loaded.spec });
      continue;
    }
    if (!named.has(file)) continue;
    const why = loaded.ok
      ? 'a spec that does not run as a unit (metadata.estate.mode is not unit)'
      : raw === undefined
        ? `neither a unit test nor a spec: ${loaded.errors[0]?.message ?? 'unreadable'}`
        : `not a unit test: ${parsed?.success === false ? (parsed.error.issues[0]?.message ?? 'invalid') : 'invalid'}`;
    io.err(`✗ ${relative(io.cwd, file)}  ${why}\n`);
    return 2;
  }
  if (tests.length === 0 && specs.length === 0) {
    io.err('No unit test found.\n');
    return 2;
  }
  const jobs = Number(options.jobs ?? '1');
  if (!Number.isInteger(jobs) || jobs < 1) {
    io.err(`--jobs takes a whole number of 1 or more, not ${options.jobs}\n`);
    return 2;
  }
  if (specs.length > 0 && options.record) {
    io.err(
      '--record writes the outcomes of unit test files; a unit spec judges itself and records nothing.\n',
    );
    return 2;
  }
  if (tests.length > 0 && specs.length > 0) {
    io.err('Give unit test files or unit specs, not both in one run.\n');
    return 2;
  }
  if (tests.length === 0) return unitSpecCommand(specs, { root, reader, options }, io);
  const run = await runUnitTests(
    tests.map((entry) => entry.test),
    { root, reader, record: options.record === true, noSandbox: options.sandbox === false, jobs },
  );
  if (options.record) {
    for (const [index, result] of run.results.entries()) {
      const entry = tests[index];
      if (entry && result.recorded) await writeFile(entry.file, formatJson(result.recorded));
    }
  }
  const counts = { pass: 0, fail: 0, inert: 0, unrecorded: 0 };
  for (const result of run.results) counts[result.status] += 1;
  if (options.json) {
    io.out(
      formatJson(
        contractOf(
          run.results,
          tests.map((entry) => entry.test),
        ),
      ),
    );
  } else io.out(report(run.results, counts, run.sandbox, run.notes, options.record === true));
  if (counts.unrecorded > 0 && !options.record) return 2;
  return counts.fail > 0 ? 1 : 0;
}

/**
 * The JSON the estate validator reads (a frozen contract, kept in step with that lane):
 * `{ runs: [{ spec, pass, failing }], guards: [{ guard, event, decision, message?, ms }], scripts: [{ script,
 * exit, stdout }] }`. One run per unit test; one guard entry per guard case run, its decision as the runtime
 * acts on it (a guard that fails with another exit code than 2 does not block: allow, its stderr the
 * message); one script entry per fixture run. An inert test passes: nothing in it can fail.
 */
export type UnitContract = {
  runs: Array<{ spec: string; pass: boolean; failing: string[] }>;
  guards: Array<{
    guard: string;
    event: string;
    decision: 'allow' | 'deny' | 'ask';
    message?: string;
    ms: number;
  }>;
  scripts: Array<{ script: string; exit: number; stdout: string }>;
};

export function contractOf(results: readonly UnitResult[], tests: readonly UnitTest[]): UnitContract {
  const contract: UnitContract = { runs: [], guards: [], scripts: [] };
  results.forEach((result, index) => {
    const test = tests[index];
    const failedCases = result.cases.filter((entry) => !entry.pass);
    const failing =
      result.status === 'fail'
        ? failedCases.length > 0
          ? failedCases.map((entry) => `${entry.case}: ${entry.detail}`)
          : [result.detail]
        : result.status === 'unrecorded'
          ? [result.detail]
          : [];
    contract.runs.push({
      spec: result.id,
      pass: result.status === 'pass' || result.status === 'inert',
      failing,
    });
    if (!test) return;
    for (const entry of result.cases) {
      if (test.target.kind === 'guard') {
        const decision = entry.outcome.decision === 'error' ? 'allow' : entry.outcome.decision;
        contract.guards.push({
          guard: test.target.name,
          event: test.target.event,
          decision,
          ...(entry.outcome.message !== undefined ? { message: entry.outcome.message } : {}),
          ms: Math.round(entry.ms),
        });
      } else {
        contract.scripts.push({
          script: test.target.path,
          exit: entry.outcome.exitCode,
          stdout: entry.outcome.output ?? '',
        });
      }
    }
  });
  return contract;
}

function report(
  results: readonly UnitResult[],
  counts: Record<UnitResult['status'], number>,
  sandbox: string,
  notes: readonly string[],
  record: boolean,
): string {
  const mark = { pass: '✓', fail: '✗', inert: '·', unrecorded: '?' } as const;
  const lines = results.map((result) => `${mark[result.status]} ${result.id}  ${result.detail}`);
  for (const note of notes) lines.push(`note: ${note}`);
  const flaky = results.flatMap((result) => result.cases.filter((entry) => entry.flaky).map(() => result.id));
  if (flaky.length > 0) {
    lines.push(
      `Flaky: ${flaky.length} cases in ${new Set(flaky).size} tests vary on the original; they are reported, never compared.`,
    );
  }
  const checks = results.filter((result) => result.exercised !== undefined);
  if (checks.length > 0) {
    const exercised = checks.filter((result) => result.exercised).length;
    lines.push(
      `Catalogue checks: ${exercised} of ${checks.length} exercised (the host hook's answer to the trigger names the check).`,
    );
  }
  lines.push(
    record
      ? `Recorded ${results.length} unit tests (sandbox: ${sandbox}); ${counts.inert} have no fixture.`
      : `${counts.pass} of ${results.length} unit tests pass, ${counts.fail} fail, ${counts.inert} inert, ${counts.unrecorded} unrecorded (sandbox: ${sandbox}).`,
    '',
  );
  return lines.join('\n');
}

/** Every unit test file (.json) and spec file (.yaml, .yml) under a folder, at any depth. */
async function testFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await testFiles(full)));
    else if (/\.(json|ya?ml)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Unit specs judged on their own (docs/estate.md section 6): each spec's blocks get the trace the unit run
 * built (the guard runs that fired, the commands the script ran) and the replay checks judge them. A spec
 * passes when the run completes, every block passes and the run found nothing that keeps it from passing.
 */
async function unitSpecCommand(
  specs: ReadonlyArray<{ file: string; spec: Spec }>,
  context: { root: string; reader: NonNullable<ReturnType<typeof readerFor>>; options: EstateUnitOptions },
  io: Io,
): Promise<number> {
  const { traces, sandbox, notes } = await traceUnitSpecs(
    specs.map(({ file, spec }) => ({ file, spec })),
    { root: context.root, reader: context.reader, noSandbox: context.options.sandbox === false },
  );
  const checks = replayChecks();
  const runs: UnitContract['runs'] = [];
  for (const [index, trace] of traces.entries()) {
    const spec = (specs[index] as { spec: Spec }).spec;
    const failing = [...trace.problems];
    const result = await runSpec(spec, {
      adapter: unitTraceAdapter(trace.blocks),
      driver: createScriptedDriver(),
      checks,
      mode: 'F',
      repeat: 0,
      target: { adapter: 'claude-code', agent: 'estate-unit' },
    });
    if (result.status !== 'completed')
      failing.push(`the run did not complete: ${result.error ?? result.status}`);
    for (const block of result.blocks) {
      for (const verdict of block.verdicts) {
        if (verdict.gating && verdict.outcome !== 'pass' && unitJudges(verdict.id))
          failing.push(`block ${block.index}: ${verdict.id}: ${verdict.evidence}`.trim());
      }
    }
    runs.push({ spec: trace.id, pass: failing.length === 0, failing });
  }
  const contract: UnitContract = { runs, guards: guardsOf(traces), scripts: scriptsOf(traces) };
  const failed = runs.filter((run) => !run.pass).length;
  if (context.options.json) io.out(formatJson(contract));
  else {
    const lines = runs.map(
      (run) => `${run.pass ? '✓' : '✗'} ${run.spec}${run.pass ? '' : `\n    ${run.failing.join('\n    ')}`}`,
    );
    for (const note of notes) lines.push(`note: ${note}`);
    lines.push(
      `${runs.length - failed} of ${runs.length} unit specs pass, ${failed} fail (sandbox: ${sandbox}).`,
      '',
    );
    io.out(lines.join('\n'));
  }
  return failed > 0 ? 1 : 0;
}

function guardsOf(traces: readonly UnitSpecTrace[]): UnitContract['guards'] {
  return traces.flatMap((trace) =>
    trace.guards.map((run) => ({
      guard: run.guard,
      event: run.event,
      decision: run.decision === 'error' ? 'allow' : run.decision,
      ...(run.message !== undefined ? { message: run.message } : {}),
      ms: Math.round(run.ms),
    })),
  );
}

function scriptsOf(traces: readonly UnitSpecTrace[]): UnitContract['scripts'] {
  return traces.flatMap((trace) =>
    trace.scripts.map((run) => ({ script: run.script, exit: run.exit, stdout: run.stdout })),
  );
}
