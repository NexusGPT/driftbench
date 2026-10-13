import { spawn } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import type { GuardCase, UnitDecision, UnitOutcome, UnitTest } from '@agent-nexus/driftbench-generate';
import {
  reapFolder,
  trackFolder,
  trackGroup,
  untrackFolder,
  untrackGroup,
} from '@agent-nexus/driftbench-sandbox';
import { parse as parseYaml } from 'yaml';
import { guardName } from '../scan/code';
import type { EstateReader, GuardDecl } from '../scan/reader';

/**
 * The estate unit runner: runs the guards and scripts of an estate directly, with no model in the loop.
 *
 * A guard case is a hook payload in the runtime's input shape. The runner adds the session fields the
 * runtime sends (session id, a transcript that holds the case's last reply, the working folder, the event
 * name, the permission mode), finds the guard in the estate as it is now (the event, the matcher and the
 * guard's name; a guard the estate no longer configures fails every case), and runs the guard's command on a
 * copy of the estate, its stdin the payload, `CLAUDE_PROJECT_DIR` the copy. What the runtime would read from
 * the run is the outcome: deny on exit 2 or a JSON decision that blocks, ask, allow, or error on any other
 * exit code; the message (stderr on exit 2, the reason of a JSON decision) and what the guard printed.
 *
 * `record` runs each case twice on the original estate and writes the outcome into the test (a message or an
 * output that differs between the two runs is not kept). A positive case recorded with no effect is inert; a
 * hostile case recorded allowed is a weakness of the guard. Without `record`, every recorded case that is not
 * inert must give its recorded outcome again; guard_speed also holds every run under its budget.
 *
 * A script test runs the fixtures the estate declares for the script (`scripts:` in driftbench.estate.yaml),
 * each in a fresh working folder, and compares its exit code and stdout with the declared ones.
 *
 * Runs are sandboxed where the platform has a sandbox (macOS sandbox-exec): no network, no read of the
 * credential folders of the home folder, writes only into the copy and the run's temporary folder. The
 * environment holds PATH, a fresh HOME and CLAUDE_PROJECT_DIR, nothing else.
 */

export const ESTATE_CONFIG_FILE = 'driftbench.estate.yaml';

export type UnitCaseResult = {
  case: string;
  material: string;
  outcome: UnitOutcome;
  expected?: UnitOutcome;
  inert?: boolean;
  /** The outcome varied across the record runs: the case is reported, never compared. */
  flaky?: boolean;
  pass: boolean;
  ms: number;
  detail: string;
};

export type UnitResult = {
  id: string;
  testType: UnitTest['testType'];
  atom: string;
  status: 'pass' | 'fail' | 'unrecorded' | 'inert';
  detail: string;
  cases: UnitCaseResult[];
  /** With record: the test with its recorded cases, to write back. */
  recorded?: UnitTest;
  /** A catalogue check's test: whether the host hook's answer to its trigger names the check. */
  exercised?: boolean;
};

export type UnitRunOptions = {
  root: string;
  reader: EstateReader;
  record?: boolean;
  /** Run without the sandbox even where one exists. */
  noSandbox?: boolean;
  /** How many tests run at once (1 by default). The results keep the order of the tests. */
  jobs?: number;
};

export type UnitRun = { results: UnitResult[]; sandbox: 'sandbox-exec' | 'none'; notes: string[] };

type Exec = { exitCode: number; stdout: string; stderr: string; ms: number; timedOut: boolean };

const CREDENTIAL_FOLDERS = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.config/gcloud',
  '.azure',
  '.kube',
  '.docker',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.git-credentials',
  '.claude',
  '.claude.json',
  'Library/Keychains',
];

export async function runUnitTests(tests: readonly UnitTest[], options: UnitRunOptions): Promise<UnitRun> {
  const notes: string[] = [];
  const raw = await options.reader.read(options.root);
  const work = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-unit-')));
  // Removed at exit or on a signal if the run never reaches its finally, with what still runs in it.
  trackFolder(work);
  const copy = join(work, 'estate');
  try {
    await copyListed(options.root, copy, options.reader);
    const sandbox =
      !options.noSandbox && process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');
    if (!sandbox)
      notes.push('no sandbox: the guards and scripts ran with the network and the home folder open');
    const runner = { work, copy, sandbox, counter: 0 };
    const config = await readConfig(options.root);
    const results: UnitResult[] = new Array(tests.length);
    const runOne = async (test: UnitTest): Promise<UnitResult> => {
      if (test.target.kind === 'script') return runScriptTest(test, config, runner, options.record === true);
      const result = await runGuardTest(test, raw.guards, options.record === true, runner);
      const check = test.target.check;
      if (check === undefined) return result;
      const named = new RegExp(`(^|[^\\w-])${check.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`);
      const exercised = result.cases.some((entry) =>
        named.test(`${entry.outcome.message ?? ''}\n${entry.outcome.output ?? ''}`),
      );
      return { ...result, exercised };
    };
    let next = 0;
    const lanes = Math.max(1, Math.min(Math.floor(options.jobs ?? 1), tests.length));
    await Promise.all(
      Array.from({ length: lanes }, async () => {
        while (next < tests.length) {
          const index = next++;
          results[index] = await runOne(tests[index] as UnitTest);
        }
      }),
    );
    return { results, sandbox: sandbox ? 'sandbox-exec' : 'none', notes };
  } finally {
    // A guard may start a daemon that leaves its process group (a new session) and outlives the run: what
    // still names or stands in the run's folder ends before the folder goes.
    await reapFolder([work]);
    await rm(work, { recursive: true, force: true });
    untrackFolder(work);
  }
}

type Runner = { work: string; copy: string; sandbox: boolean; counter: number };

async function runGuardTest(
  test: UnitTest,
  guards: readonly GuardDecl[],
  record: boolean,
  runner: Runner,
): Promise<UnitResult> {
  const base = { id: test.id, testType: test.testType, atom: test.atom };
  const target = test.target;
  if (target.kind !== 'guard') throw new Error('not a guard test');
  const guard = guards.find(
    (candidate) =>
      guardName(candidate) === target.name &&
      candidate.event === target.event &&
      (candidate.matcher ?? '') === (target.matcher ?? ''),
  );
  if (!guard) {
    return {
      ...base,
      status: 'fail',
      detail: `the estate no longer runs the ${target.event} guard ${target.name}${target.matcher ? ` on ${target.matcher}` : ''}`,
      cases: [],
    };
  }
  if (!record && test.recordedOn === undefined) {
    return {
      ...base,
      status: 'unrecorded',
      detail: 'no outcome recorded: run --record on the original first',
      cases: [],
    };
  }
  const timeoutMs = Math.round((guard.timeout ?? target.timeout ?? 60) * 1000);
  const repeats = test.testType === 'guard_speed' || record ? RECORD_RUNS : 1;
  const cases: UnitCaseResult[] = [];
  const recordedCases: GuardCase[] = [];
  for (const unitCase of test.cases) {
    const runs: Exec[] = [];
    for (let index = 0; index < repeats; index++)
      runs.push(await runGuard(guard, test, unitCase, runner, timeoutMs));
    const outcomes = runs.map(outcomeOf);
    const first = outcomes[0] as UnitOutcome;
    const ms = Math.max(...runs.map((run) => run.ms));
    if (record) {
      const stable: UnitOutcome = {
        decision: first.decision,
        exitCode: first.exitCode,
        ...(first.message !== undefined && outcomes.every((other) => other.message === first.message)
          ? { message: first.message }
          : {}),
        ...(first.output !== undefined && outcomes.every((other) => other.output === first.output)
          ? { output: first.output }
          : {}),
      };
      const flaky = varies(outcomes);
      const noEffect =
        stable.decision === 'allow' && stable.message === undefined && stable.output === undefined;
      const inert =
        (test.testType === 'guard_positive' || test.testType === 'guard_speed') && noEffect
          ? true
          : test.testType === 'guard_hostile' && stable.decision === 'allow';
      recordedCases.push({
        ...unitCase,
        expected: stable,
        ...(flaky ? { flaky: true } : inert ? { inert: true } : {}),
      });
      cases.push({
        case: unitCase.id,
        material: unitCase.material,
        outcome: stable,
        ...(inert ? { inert } : {}),
        pass: true,
        ms,
        detail: inert
          ? test.testType === 'guard_hostile'
            ? 'slips past the guard'
            : 'no effect'
          : 'recorded',
      });
      continue;
    }
    const expected = unitCase.expected;
    if (unitCase.flaky) {
      cases.push({
        case: unitCase.id,
        material: unitCase.material,
        outcome: first,
        flaky: true,
        pass: true,
        ms,
        detail: 'flaky on the original: not compared',
      });
      continue;
    }
    if (unitCase.inert || expected === undefined) {
      cases.push({
        case: unitCase.id,
        material: unitCase.material,
        outcome: first,
        inert: true,
        pass: true,
        ms,
        detail: 'inert',
      });
      continue;
    }
    const differences = outcomes.flatMap((outcome) => differ(expected, outcome));
    const slow = test.budgetMs !== undefined && ms > test.budgetMs;
    const pass = differences.length === 0 && !slow;
    cases.push({
      case: unitCase.id,
      material: unitCase.material,
      outcome: first,
      expected,
      pass,
      ms,
      detail: pass
        ? `${first.decision} as recorded`
        : [
            ...new Set(differences),
            ...(slow ? [`took ${ms} ms, over the budget of ${test.budgetMs} ms`] : []),
          ].join('; '),
    });
  }
  if (record) {
    const active = recordedCases.filter((entry) => !entry.inert).length;
    return {
      ...base,
      status: 'pass',
      detail: `recorded ${recordedCases.length} cases, ${active} active, ${recordedCases.length - active} ${test.testType === 'guard_hostile' ? 'slipping past the guard' : 'inert'}`,
      cases,
      recorded: { ...test, cases: recordedCases, recordedOn: test.mapHash },
    };
  }
  const active = cases.filter((entry) => !entry.inert && !entry.flaky);
  if (active.length === 0)
    return { ...base, status: 'inert', detail: 'no recorded case shows the guard at work', cases };
  const failed = active.filter((entry) => !entry.pass);
  return {
    ...base,
    status: failed.length === 0 ? 'pass' : 'fail',
    detail:
      failed.length === 0
        ? `${active.length} of ${active.length} cases as recorded`
        : `${failed.length} of ${active.length} cases changed: ${failed.map((entry) => `${entry.case} ${entry.detail}`).join(' | ')}`,
    cases,
  };
}

/** Record runs per case: an outcome that varies across them marks the case flaky. */
export const RECORD_RUNS = 3;

/** True when the decision or the exit code differs between runs of one case. */
function varies(outcomes: readonly UnitOutcome[]): boolean {
  const first = outcomes[0];
  return outcomes.some((other) => other.decision !== first?.decision || other.exitCode !== first?.exitCode);
}

/** How a recorded outcome and a new one differ, in words; empty when they agree. */
function differ(expected: UnitOutcome, actual: UnitOutcome): string[] {
  const out: string[] = [];
  if (expected.decision !== actual.decision)
    out.push(`${actual.decision} where ${expected.decision} was recorded`);
  if (expected.exitCode !== actual.exitCode)
    out.push(`exit ${actual.exitCode} where ${expected.exitCode} was recorded`);
  if (expected.message !== undefined && expected.message !== actual.message) out.push('another message');
  if (expected.output !== undefined && expected.output !== actual.output) out.push('another output');
  return out;
}

/** What the runtime reads from a guard run. */
export function outcomeOf(run: Pick<Exec, 'exitCode' | 'stdout' | 'stderr' | 'timedOut'>): UnitOutcome {
  const stdout = run.stdout.trim();
  const stderr = run.stderr.trim();
  if (run.timedOut) return { decision: 'error', exitCode: run.exitCode, message: 'timed out' };
  if (run.exitCode === 2) return { decision: 'deny', exitCode: 2, ...(stderr ? { message: stderr } : {}) };
  if (run.exitCode !== 0)
    return { decision: 'error', exitCode: run.exitCode, ...(stderr ? { message: stderr } : {}) };
  let decision: UnitDecision = 'allow';
  let message: string | undefined;
  try {
    const json: unknown = stdout.startsWith('{') ? JSON.parse(stdout) : undefined;
    if (json !== null && typeof json === 'object') {
      const record = json as Record<string, unknown>;
      const specific = record.hookSpecificOutput as Record<string, unknown> | undefined;
      const permission = specific?.permissionDecision;
      if (permission === 'deny' || permission === 'ask' || permission === 'allow') {
        decision = permission;
        if (typeof specific?.permissionDecisionReason === 'string')
          message = specific.permissionDecisionReason;
      } else if (record.decision === 'block') {
        decision = 'deny';
        if (typeof record.reason === 'string') message = record.reason;
      } else if (record.continue === false) {
        decision = 'deny';
        if (typeof record.stopReason === 'string') message = record.stopReason;
      }
    }
  } catch {
    // Plain text on stdout: kept as the output, the decision stays allow.
  }
  return {
    decision,
    exitCode: 0,
    ...(message !== undefined ? { message } : {}),
    ...(stdout ? { output: stdout } : {}),
  };
}

async function runGuard(
  guard: GuardDecl,
  test: UnitTest,
  unitCase: GuardCase,
  runner: Runner,
  timeoutMs: number,
): Promise<Exec> {
  runner.counter += 1;
  const number = runner.counter;
  const folder = join(runner.work, `case-${number}`);
  await mkdir(folder, { recursive: true });
  const transcript = join(folder, 'transcript.jsonl');
  const reply = typeof unitCase.payload.last_reply === 'string' ? unitCase.payload.last_reply : '';
  const prompt = typeof unitCase.payload.prompt === 'string' ? unitCase.payload.prompt : 'unit test';
  await writeFile(
    transcript,
    [
      { type: 'user', message: { role: 'user', content: prompt } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply || 'ok' }] } },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n')
      .concat('\n'),
  );
  const payload: Record<string, unknown> = {
    session_id: `unit-${test.id}-${unitCase.id}`,
    transcript_path: transcript,
    cwd: runner.copy,
    hook_event_name: guard.event,
    permission_mode: 'default',
    ...(unitCase.payload.tool_name !== undefined ? { tool_use_id: `toolu_unit_${number}` } : {}),
    ...unitCase.payload,
  };
  // The runtime hands a Stop guard the last reply as last_assistant_message; the test file names it last_reply.
  if ('last_reply' in payload) {
    payload.last_assistant_message = reply || 'ok';
    delete payload.last_reply;
  }
  return execute(['/bin/sh', '-c', guard.command], `${JSON.stringify(payload)}\n`, runner, folder, timeoutMs);
}

async function runScriptTest(
  test: UnitTest,
  config: Record<string, unknown>,
  runner: Runner,
  record: boolean,
): Promise<UnitResult> {
  const base = { id: test.id, testType: test.testType, atom: test.atom };
  if (test.target.kind !== 'script') throw new Error('not a script test');
  const path = test.target.path;
  if (!existsSync(join(runner.copy, path))) {
    return { ...base, status: 'fail', detail: `the estate no longer holds ${path}`, cases: [] };
  }
  const scripts = config.scripts as Record<string, unknown> | undefined;
  const declared = scripts?.[path];
  if (!Array.isArray(declared) || declared.length === 0) return runRecordedScript(test, path, runner, record);
  const cases: UnitCaseResult[] = [];
  for (const [index, fixture] of declared.entries()) {
    const entry = (fixture ?? {}) as Record<string, unknown>;
    const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
    const expect = (entry.expect ?? {}) as Record<string, unknown>;
    runner.counter += 1;
    const folder = join(runner.work, `case-${runner.counter}`);
    await mkdir(folder, { recursive: true });
    const files = (entry.files ?? {}) as Record<string, unknown>;
    for (const [name, text] of Object.entries(files)) {
      await mkdir(dirname(join(folder, name)), { recursive: true });
      await writeFile(join(folder, name), String(text));
    }
    const run = await execute(
      [...interpreterOf(path), join(runner.copy, path), ...args],
      typeof entry.stdin === 'string' ? entry.stdin : '',
      runner,
      folder,
      60_000,
    );
    const problems: string[] = [];
    const wantedExit = typeof expect.exitCode === 'number' ? expect.exitCode : 0;
    if (run.exitCode !== wantedExit) problems.push(`exit ${run.exitCode} where ${wantedExit} is declared`);
    if (typeof expect.stdout === 'string' && run.stdout.trim() !== expect.stdout.trim())
      problems.push('another stdout');
    const includes = Array.isArray(expect.stdoutIncludes) ? expect.stdoutIncludes.map(String) : [];
    for (const piece of includes) if (!run.stdout.includes(piece)) problems.push(`stdout lacks "${piece}"`);
    const outcome: UnitOutcome = {
      decision: run.exitCode === 0 ? 'allow' : 'error',
      exitCode: run.exitCode,
      ...(run.stdout.trim() ? { output: run.stdout.trim() } : {}),
    };
    cases.push({
      case: `fixture-${index + 1}`,
      material: args.join(' '),
      outcome,
      pass: problems.length === 0,
      ms: run.ms,
      detail: problems.length === 0 ? 'as declared' : problems.join('; '),
    });
  }
  const failed = cases.filter((entry) => !entry.pass);
  return {
    ...base,
    status: failed.length === 0 ? 'pass' : 'fail',
    detail:
      failed.length === 0
        ? `${cases.length} of ${cases.length} fixtures as declared`
        : failed.map((entry) => `${entry.case}: ${entry.detail}`).join(' | '),
    cases,
  };
}

/**
 * A script with no declared fixture runs its minimal fixtures (from the generator, else from its own
 * argument parsing): recorded on the original like a guard's cases, compared on a copy.
 */
async function runRecordedScript(
  test: UnitTest,
  path: string,
  runner: Runner,
  record: boolean,
): Promise<UnitResult> {
  const base = { id: test.id, testType: test.testType, atom: test.atom };
  let fixtures = test.cases;
  if (fixtures.length === 0) {
    if (!record) {
      return {
        ...base,
        status: 'inert',
        detail: `${ESTATE_CONFIG_FILE} declares no fixture for ${path}`,
        cases: [],
      };
    }
    fixtures = casesFromSource(await readFile(join(runner.copy, path), 'utf8'));
  }
  if (!record && test.recordedOn === undefined) {
    return {
      ...base,
      status: 'unrecorded',
      detail: 'no outcome recorded: run --record on the original first',
      cases: [],
    };
  }
  const cases: UnitCaseResult[] = [];
  const recorded: GuardCase[] = [];
  for (const fixture of fixtures) {
    const runs: Exec[] = [];
    for (let index = 0; index < (record ? RECORD_RUNS : 1); index++)
      runs.push(await runScript(path, fixture, runner));
    const outcomes = runs.map(scriptOutcome);
    const first = outcomes[0] as UnitOutcome;
    const ms = Math.max(...runs.map((run) => run.ms));
    if (record) {
      const stable: UnitOutcome = {
        decision: first.decision,
        exitCode: first.exitCode,
        ...(first.message !== undefined && outcomes.every((other) => other.message === first.message)
          ? { message: first.message }
          : {}),
        ...(first.output !== undefined && outcomes.every((other) => other.output === first.output)
          ? { output: first.output }
          : {}),
      };
      const flaky = varies(outcomes);
      recorded.push({ ...fixture, expected: stable, ...(flaky ? { flaky: true } : {}) });
      cases.push({
        case: fixture.id,
        material: fixture.material,
        outcome: stable,
        pass: true,
        ms,
        detail: 'recorded',
      });
      continue;
    }
    const expected = fixture.expected;
    if (fixture.flaky) {
      cases.push({
        case: fixture.id,
        material: fixture.material,
        outcome: first,
        flaky: true,
        pass: true,
        ms,
        detail: 'flaky on the original: not compared',
      });
      continue;
    }
    if (expected === undefined) {
      cases.push({
        case: fixture.id,
        material: fixture.material,
        outcome: first,
        inert: true,
        pass: true,
        ms,
        detail: 'inert',
      });
      continue;
    }
    const differences = differ(expected, first);
    cases.push({
      case: fixture.id,
      material: fixture.material,
      outcome: first,
      expected,
      pass: differences.length === 0,
      ms,
      detail: differences.length === 0 ? `exit ${first.exitCode} as recorded` : differences.join('; '),
    });
  }
  if (record) {
    return {
      ...base,
      status: 'pass',
      detail: `recorded ${recorded.length} minimal fixtures`,
      cases,
      recorded: { ...test, cases: recorded, recordedOn: test.mapHash },
    };
  }
  const compared = cases.filter((entry) => !entry.flaky);
  if (compared.length === 0)
    return { ...base, status: 'inert', detail: 'every fixture is flaky on the original', cases };
  const failed = compared.filter((entry) => !entry.pass);
  return {
    ...base,
    status: failed.length === 0 ? 'pass' : 'fail',
    detail:
      failed.length === 0
        ? `${compared.length} of ${compared.length} fixtures as recorded`
        : failed.map((entry) => `${entry.case}: ${entry.detail}`).join(' | '),
    cases,
  };
}

/** A script's outcome: allow on exit 0, error otherwise; stderr the message, stdout the output. */
function scriptOutcome(run: Exec): UnitOutcome {
  const stdout = run.stdout.trim();
  const stderr = run.stderr.trim();
  return {
    decision: run.exitCode === 0 && !run.timedOut ? 'allow' : 'error',
    exitCode: run.exitCode,
    ...(stderr ? { message: stderr } : {}),
    ...(stdout ? { output: stdout } : {}),
  };
}

async function runScript(path: string, fixture: GuardCase, runner: Runner): Promise<Exec> {
  runner.counter += 1;
  const folder = join(runner.work, `case-${runner.counter}`);
  await mkdir(folder, { recursive: true });
  const files = (fixture.payload.files ?? {}) as Record<string, unknown>;
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, name)), { recursive: true });
    await writeFile(join(folder, name), String(text));
  }
  const args = Array.isArray(fixture.payload.args) ? fixture.payload.args.map(String) : [];
  return execute([...interpreterOf(path), join(runner.copy, path), ...args], '', runner, folder, 60_000);
}

/**
 * Minimal fixtures from a script's own argument parsing: no argument, then as many as the script reads
 * (the highest `sys.argv[n]`, `argv[n]` or `$n` it names, or the count a `len(argv) != n` or `"$#" -ne n`
 * check demands), each an empty file in the working folder.
 */
export function casesFromSource(source: string): GuardCase[] {
  const indexes = [
    ...[...source.matchAll(/\bargv\[(\d+)\]/g)].map((match) => Number(match[1])),
    ...[...source.matchAll(/\$\{?([1-9])\}?/g)].map((match) => Number(match[1])),
    ...[...source.matchAll(/len\([\w.]*argv\)\s*[!=<>]=?\s*(\d+)/g)].map((match) => Number(match[1]) - 1),
    ...[...source.matchAll(/"\$#"\s*-(?:ne|lt|eq)\s*(\d+)/g)].map((match) => Number(match[1])),
  ];
  const count = Math.max(0, ...indexes);
  const cases: GuardCase[] = [{ id: 'case-01', payload: { args: [] }, material: 'no argument' }];
  if (count > 0) {
    const args = Array.from({ length: count }, (_, index) => `arg-${index + 1}`);
    cases.push({
      id: 'case-02',
      payload: { args, files: Object.fromEntries(args.map((arg) => [arg, ''])) },
      material: args.join(' '),
    });
  }
  return cases;
}

/**
 * How a TypeScript script runs offline: the tsx loader where available, else Node's own type stripping.
 * The loader avoids the CLI's Unix socket, which cannot represent long temporary paths.
 * Never `npx tsx`, which reaches for the network the sandbox closes and waits out the timeout.
 */
function typeScriptRunner(): string[] {
  try {
    return [process.execPath, '--import', createRequire(import.meta.url).resolve('tsx')];
  } catch {
    return [process.execPath, '--experimental-strip-types', '--no-warnings'];
  }
}

function interpreterOf(path: string): string[] {
  switch (extname(path)) {
    case '.py':
      return ['python3'];
    case '.js':
    case '.mjs':
    case '.cjs':
      return ['node'];
    case '.ts':
      return typeScriptRunner();
    case '.rb':
      return ['ruby'];
    default:
      return ['/bin/sh'];
  }
}

/** The macOS sandbox profile of a run: no network, no credential folder, writes only where the run may. */
export function sandboxProfile(writable: readonly string[], home: string): string {
  const quote = (path: string) => JSON.stringify(path);
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    // Local sockets inside the run only (a TypeScript runner talks to its child through one); no network.
    `(allow network* ${writable.map((path) => `(local unix-socket (subpath ${quote(path)})) (remote unix-socket (subpath ${quote(path)}))`).join(' ')})`,
    `(deny file-read* ${CREDENTIAL_FOLDERS.map((name) => `(subpath ${quote(join(home, name))})`).join(' ')})`,
    '(deny file-write*)',
    `(allow file-write* ${writable.map((path) => `(subpath ${quote(path)})`).join(' ')} (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/fd/"))`,
  ].join('\n');
}

async function execute(
  argv: string[],
  stdin: string,
  runner: Runner,
  cwd: string,
  timeoutMs: number,
): Promise<Exec> {
  const home = join(runner.work, 'home');
  await mkdir(home, { recursive: true });
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: home,
    TMPDIR: runner.work,
    CLAUDE_PROJECT_DIR: runner.copy,
  };
  const realHome = await realpath(homedir()).catch(() => homedir());
  const command = runner.sandbox
    ? ['/usr/bin/sandbox-exec', '-p', sandboxProfile([runner.work], realHome), ...argv]
    : argv;
  const started = performance.now();
  return await new Promise<Exec>((resolve) => {
    // Its own process group, so what it leaves running in the background ends with it.
    const child = spawn(command[0] as string, command.slice(1), {
      cwd,
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (child.pid !== undefined) trackGroup(child.pid);
    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The group already ended.
      }
    };
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout,
        stderr: `${stderr}${error.message}`,
        ms: performance.now() - started,
        timedOut,
      });
    });
    child.on('exit', killGroup);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (child.pid !== undefined) untrackGroup(child.pid);
      resolve({
        exitCode: code ?? 1,
        stdout: neutral(stdout, runner.work),
        stderr: neutral(stderr, runner.work),
        ms: Math.round(performance.now() - started),
        timedOut,
      });
    });
  });
}

/**
 * Output with the run's own folders named the same way on every run: the temporary folder (with or without
 * the /private prefix macOS adds) becomes `$RUN`, a case folder `case`. A message that holds the path of the
 * copy is then the same on the original and on a mutant.
 */
export function neutral(text: string, work: string): string {
  const bare = work.replace(/^\/private(?=\/)/, '');
  return text
    .split(`/private${bare}`)
    .join('$RUN')
    .split(bare)
    .join('$RUN')
    .replace(/\$RUN\/case-\d+/g, '$RUN/case');
}

/** The estate configuration, when the estate has one. */
async function readConfig(root: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(root, ESTATE_CONFIG_FILE), 'utf8').catch(() => undefined);
  if (text === undefined) return {};
  try {
    const parsed: unknown = parseYaml(text);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A copy of the files the reader lists, cloned where the file system can, never linked to the source. */
async function copyListed(root: string, to: string, reader: EstateReader): Promise<void> {
  const files = reader.listFiles ? await reader.listFiles(root) : [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(16, files.length) }, async () => {
      while (next < files.length) {
        const file = files[next++] as string;
        await mkdir(dirname(join(to, file)), { recursive: true });
        await copyFile(join(root, file), join(to, file), constants.COPYFILE_FICLONE);
      }
    }),
  );
  await mkdir(to, { recursive: true });
}
