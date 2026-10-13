import { readFile, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { loadSpecFile } from '@agent-nexus/driftbench-core';
import {
  type EstateReader,
  type GuardObservation,
  type GuardSpecThen,
  guardName,
  judgeGuardSpec,
  judgeHelperSpec,
  judgeScriptSpec,
  type RawEstate,
  runUnitTests,
  slug,
  type UnitResult,
} from '@agent-nexus/driftbench-estate';
import { UnitTest } from '@agent-nexus/driftbench-generate';
import type { UnitContract } from './estate-unit';

/**
 * `driftbench estate unit` on the unit-mode specs `estate generate` writes (`specs/unit/**.yaml`), the
 * command of docs/estate.md section 6. A spec is judged on the estate root as it is, with no recorded
 * outcome: its own Then says what must be seen.
 *
 * - A guard spec takes its payloads from the native unit tests the generator wrote beside the specs
 *   (`unit/<test type>/unit.<test type>.<atom>.json`): the test of its own type, and the guard's positive
 *   and hostile payloads (every type but the negative control), so "the guard fires" is asked of what its
 *   rules forbid, in plain and hostile forms. The guard runs once per payload.
 * - A script spec runs the script on its minimal fixtures, in a folder holding the spec's workspace files.
 * - A helper spec (`contract_alone`) reads the helper's agent file: with no model, it checks that the file
 *   gives a system prompt to run.
 */

export type UnitSpecRun = { code: number; contract?: UnitContract; error?: string };

type Loaded = {
  file: string;
  id: string;
  testType: string;
  atom: string;
  wants: GuardSpecThen;
  workspace: Record<string, string>;
  /** The suite folder: the one that holds `specs/` and `unit/`. */
  suite: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function loadUnitSpec(file: string, cwd: string): Promise<Loaded | string> {
  const loaded = await loadSpecFile(file);
  const shown = relative(cwd, file);
  if (!loaded.ok) return `✗ ${shown}  ${loaded.errors.map((issue) => issue.message).join('; ')}`;
  const spec = loaded.spec as unknown as Record<string, unknown>;
  const meta = isRecord(spec.metadata) && isRecord(spec.metadata.estate) ? spec.metadata.estate : undefined;
  const atoms = Array.isArray(meta?.atoms) ? meta.atoms.filter((atom) => typeof atom === 'string') : [];
  if (meta?.mode !== 'unit' || typeof meta.testType !== 'string' || atoms.length === 0) {
    return `✗ ${shown}  not a unit-mode spec of an estate (metadata.estate with mode: unit, a testType and atoms)`;
  }
  const blocks = Array.isArray(spec.blocks) ? spec.blocks : [];
  const expect = isRecord(blocks[0]) && isRecord(blocks[0].expect) ? blocks[0].expect : {};
  const guards = (Array.isArray(expect.guards) ? expect.guards : []).filter(isRecord).flatMap((entry) =>
    typeof entry.name === 'string'
      ? [
          {
            name: entry.name,
            ...(typeof entry.verdict === 'string' ? { verdict: entry.verdict } : {}),
            ...(entry.count !== undefined ? { count: entry.count as number | { min?: number } } : {}),
          },
        ]
      : [],
  );
  const custom = isRecord(spec.rules) && isRecord(spec.rules.custom) ? spec.rules.custom : {};
  const finished = isRecord(custom.guard_finished) ? custom.guard_finished.name : undefined;
  const message = isRecord(custom.guard_message) ? custom.guard_message : undefined;
  const given = isRecord(spec.given) && isRecord(spec.given.world) ? spec.given.world : {};
  const files = isRecord(given.workspace) && isRecord(given.workspace.files) ? given.workspace.files : {};
  return {
    file,
    id: String(spec.id),
    testType: meta.testType,
    atom: atoms[0] as string,
    wants: {
      guards,
      ...(typeof finished === 'string' ? { finished } : {}),
      ...(message && typeof message.name === 'string'
        ? {
            message: {
              name: message.name,
              mustNot: Array.isArray(message.mustNot)
                ? message.mustNot.filter((pattern): pattern is string => typeof pattern === 'string')
                : [],
            },
          }
        : {}),
    },
    workspace: Object.fromEntries(
      Object.entries(files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
    // <suite>/specs/unit/<test type>/<file>, or <suite>/incomplete/unit/<test type>/<file>.
    suite: resolve(file, '..', '..', '..', '..'),
  };
}

/** The native unit test the generator wrote for a test type and an atom, when the suite holds one. */
async function nativeTest(suite: string, testType: string, atom: string): Promise<UnitTest | undefined> {
  const path = join(suite, 'unit', testType, `unit.${testType}.${atom}.json`);
  if (!(await stat(path).catch(() => undefined))?.isFile()) return undefined;
  try {
    const parsed = UnitTest.safeParse(JSON.parse(await readFile(path, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The helper a subagent atom id names: the id the scanner gives `Helper <name>` in the helper's file. */
function helperOf(atom: string, raw: RawEstate): RawEstate['subagents'][number] | undefined {
  return raw.subagents.find(
    (helper) =>
      `subagent.${slug(basename(helper.file).replace(/\.md$/, ''), 6)}.${slug(`Helper ${helper.name}`)}` ===
      atom,
  );
}

export async function runUnitSpecs(
  files: readonly string[],
  options: { root: string; reader: EstateReader; noSandbox: boolean; jobs: number; cwd: string },
): Promise<UnitSpecRun> {
  const specs: Loaded[] = [];
  for (const file of files) {
    const loaded = await loadUnitSpec(file, options.cwd);
    if (typeof loaded === 'string') return { code: 2, error: loaded };
    specs.push(loaded);
  }
  const raw = await options.reader.read(options.root);
  const tests: UnitTest[] = [];
  /** For each spec: the index of its test among `tests`, or why it has none, or a verdict reached at once. */
  const plan: Array<{ test: number } | { failing: string[] }> = [];
  for (const spec of specs) {
    if (spec.testType === 'contract_alone') {
      const helper = helperOf(spec.atom, raw);
      const file = helper ? raw.files.find((entry) => entry.path === helper.file) : undefined;
      const body =
        helper && file
          ? file.text
              .split('\n')
              .slice(helper.body.startLine - 1)
              .join('\n')
          : '';
      plan.push({
        failing: judgeHelperSpec(
          helper?.name ?? spec.atom,
          helper
            ? {
                name: helper.name,
                ...(helper.description ? { description: helper.description.value } : {}),
                body,
              }
            : undefined,
        ),
      });
      continue;
    }
    const own = await nativeTest(spec.suite, spec.testType, spec.atom);
    if (spec.testType === 'script_fixture') {
      if (!own) {
        plan.push({
          failing: ['script_fixture: the suite holds no unit test with the fixtures of the script'],
        });
        continue;
      }
      plan.push({ test: tests.length });
      tests.push({
        ...own,
        id: spec.id,
        cases: own.cases.map((entry) => ({
          ...entry,
          payload: {
            ...entry.payload,
            files: { ...spec.workspace, ...(isRecord(entry.payload.files) ? entry.payload.files : {}) },
          },
        })),
      });
      continue;
    }
    // A guard spec: the payloads of its own type, then the guard's other payloads built from what its rules
    // forbid (plain and hostile forms). The negative control runs its neutral payloads only.
    const others =
      spec.testType === 'guard_negative'
        ? []
        : (
            await Promise.all(
              ['guard_positive', 'guard_hostile']
                .filter((type) => type !== spec.testType)
                .map((type) => nativeTest(spec.suite, type, spec.atom)),
            )
          ).filter((test): test is UnitTest => test !== undefined);
    const base = own ?? others[0];
    if (!base) {
      plan.push({ failing: [`guards: the suite holds no payload for ${spec.atom}`] });
      continue;
    }
    const cases = [...(own?.cases ?? []), ...others.flatMap((test) => test.cases)]
      .filter((entry, index, all) => all.findIndex((other) => other.material === entry.material) === index)
      .map((entry, index) => ({
        id: `case-${String(index + 1).padStart(2, '0')}`,
        payload: entry.payload,
        material: entry.material,
      }));
    plan.push({ test: tests.length });
    tests.push({ ...base, id: spec.id, cases });
  }

  const run =
    tests.length > 0
      ? await runUnitTests(tests, {
          root: options.root,
          reader: options.reader,
          observe: true,
          noSandbox: options.noSandbox,
          jobs: options.jobs,
        })
      : { results: [] as UnitResult[] };

  const contract: UnitContract = { runs: [], guards: [], scripts: [] };
  specs.forEach((spec, index) => {
    const entry = plan[index];
    if (!entry || 'failing' in entry) {
      const failing = entry && 'failing' in entry ? entry.failing : ['no run'];
      contract.runs.push({ spec: spec.id, pass: failing.length === 0, failing });
      return;
    }
    const test = tests[entry.test] as UnitTest;
    const result = run.results[entry.test] as UnitResult;
    if (result.status === 'fail' && result.cases.length === 0) {
      contract.runs.push({ spec: spec.id, pass: false, failing: [result.detail] });
      return;
    }
    if (test.target.kind === 'script') {
      const path = test.target.path;
      const observed = result.cases.map((item, at) => {
        const args = test.cases[at]?.payload.args;
        return {
          args: Array.isArray(args) ? args.map(String) : [],
          exitCode: item.outcome.exitCode,
          ...(item.outcome.message !== undefined ? { message: item.outcome.message } : {}),
          ...(item.outcome.output !== undefined ? { output: item.outcome.output } : {}),
        };
      });
      for (const item of observed) {
        contract.scripts.push({ script: path, exit: item.exitCode, stdout: item.output ?? '' });
      }
      const failing = judgeScriptSpec(observed);
      contract.runs.push({ spec: spec.id, pass: failing.length === 0, failing });
      return;
    }
    const target = test.target;
    const decl = raw.guards.find(
      (candidate) =>
        guardName(candidate) === target.name &&
        candidate.event === target.event &&
        (candidate.matcher ?? '') === (target.matcher ?? ''),
    );
    const timeoutMs = Math.round((decl?.timeout ?? target.timeout ?? 60) * 1000);
    const observed: GuardObservation[] = result.cases.map((item) => ({
      decision: item.outcome.decision,
      ...(item.outcome.message !== undefined ? { message: item.outcome.message } : {}),
      ...(item.outcome.output !== undefined ? { output: item.outcome.output } : {}),
      ms: Math.round(item.ms),
      timedOut: item.timedOut === true,
    }));
    for (const item of observed) {
      contract.guards.push({
        guard: target.name,
        event: target.event,
        // As the runtime acts on it: a guard that fails with another exit code than 2 does not block.
        decision: item.decision === 'error' ? 'allow' : item.decision,
        ...(item.message !== undefined ? { message: item.message } : {}),
        ms: item.ms,
      });
    }
    const failing = judgeGuardSpec(spec.wants, { name: target.name, timeoutMs }, observed);
    contract.runs.push({ spec: spec.id, pass: failing.length === 0, failing });
  });
  return { code: contract.runs.every((entry) => entry.pass) ? 0 : 1, contract };
}
