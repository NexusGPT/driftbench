import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AgentAdapter,
  Expect,
  Observed,
  RuntimeTrace,
  Session,
  Spec,
  Turn,
} from '@agent-nexus/driftbench-core';
import { scanEstate } from '../map/build';
import { guardName } from '../scan/code';
import type { EstateReader, GuardDecl } from '../scan/reader';
import type { Atom } from '../schema';
import {
  casesFromSource,
  type Exec,
  execute,
  interpreterOf,
  outcomeOf,
  type Runner,
  readConfig,
  withRunner,
} from './run';

/**
 * A unit-mode spec run on its own (docs/estate.md section 6): the spec `estate generate` writes for a guard,
 * a script or a helper alone, with no recorded outcome. Its expectations are the oracle. The runner builds
 * the events the spec's block stands for, runs the guard or the script on a copy of the estate, and hands the
 * runner a trace of what the runtime would have seen: the guard runs that fired, the commands that ran. The
 * checks then judge the expectations such a trace can hold: the guards, the skills, the tool calls and commands,
 * and the custom checks over guards and calls (`unitJudges`). What the agent would reply or change in the
 * workspace is the live run's to judge, not the unit run's.
 *
 * A block that expects a guard not to fire (`count: 0`) asks for an act the guard allows: it runs on neutral
 * events (a listing, a new file, a short reply, the block's own prompt). A block that expects it to fire asks
 * for the act the guard forbids: it runs on events built from the guard's own source (each literal its
 * conditions test, all of them together, a text longer than a length it compares with, an existing file for a
 * file tool) and stops at the first event the guard answers. A guard the estate no longer runs fails the spec.
 *
 * A script runs on its declared fixtures, else on minimal fixtures read from its own argument parsing, and
 * keeps its own argument contract: run with no argument, a script that reads arguments refuses and states its
 * usage; a script that reads none succeeds. A helper alone needs instructions to run on: an agent file with
 * no body fails. Running it headless with a model is not part of a unit run.
 */

export type UnitSpecInput = { file: string; spec: Spec };

export type GuardReport = {
  guard: string;
  event: string;
  decision: 'allow' | 'deny' | 'ask' | 'error';
  message?: string;
  output?: string;
  ms: number;
  timedOut: boolean;
};

export type ScriptReport = { script: string; exit: number; stdout: string; stderr: string; ms: number };

export type UnitSpecTrace = {
  id: string;
  testType: string;
  /** The observed trace of each block, in order. */
  blocks: Observed[];
  /** What keeps the spec from passing before any check runs: a missing guard, a broken contract. */
  problems: string[];
  guards: GuardReport[];
  scripts: ScriptReport[];
};

export type UnitSpecOptions = { root: string; reader: EstateReader; noSandbox?: boolean };

type EstateMeta = { atoms?: unknown; testType?: unknown; mode?: unknown };

function metaOf(spec: Spec): EstateMeta {
  const estate = (spec.metadata as { estate?: EstateMeta } | undefined)?.estate;
  return estate ?? {};
}

/** True for a spec `estate generate` wrote to run as a unit (`metadata.estate.mode: unit`). */
export function isUnitSpec(spec: Spec): boolean {
  return metaOf(spec).mode === 'unit';
}

export async function traceUnitSpecs(
  inputs: readonly UnitSpecInput[],
  options: UnitSpecOptions,
): Promise<{ traces: UnitSpecTrace[]; sandbox: 'sandbox-exec' | 'none'; notes: string[] }> {
  const { map, raw } = await scanEstate({
    root: options.root,
    reader: options.reader,
    now: () => new Date(0),
  });
  const atoms = new Map(map.atoms.map((atom) => [atom.id, atom]));
  const config = await readConfig(options.root);
  return withRunner(options, async (runner, notes) => {
    const traces: UnitSpecTrace[] = [];
    for (const input of inputs) traces.push(await traceOne(input.spec, raw.guards, atoms, config, runner));
    return { traces, sandbox: runner.sandbox ? 'sandbox-exec' : 'none', notes };
  });
}

async function traceOne(
  spec: Spec,
  guards: readonly GuardDecl[],
  atoms: ReadonlyMap<string, Atom>,
  config: Record<string, unknown>,
  runner: Runner,
): Promise<UnitSpecTrace> {
  const meta = metaOf(spec);
  const trace: UnitSpecTrace = {
    id: spec.id,
    testType: typeof meta.testType === 'string' ? meta.testType : '',
    blocks: [],
    problems: [],
    guards: [],
    scripts: [],
  };
  const named = (Array.isArray(meta.atoms) ? meta.atoms : []).filter(
    (id): id is string => typeof id === 'string',
  );
  for (const id of named) {
    if (!atoms.has(id)) trace.problems.push(`the estate no longer holds ${id}`);
  }
  const scripts = named.flatMap((id) => {
    const atom = atoms.get(id);
    return atom?.kind === 'script' && typeof atom.fields?.path === 'string' ? [atom] : [];
  });
  const helpers = named.flatMap((id) => {
    const atom = atoms.get(id);
    return atom?.kind === 'subagent' ? [atom] : [];
  });
  for (const helper of helpers) {
    const body = await readFile(join(runner.copy, helper.provenance.file), 'utf8')
      .then(bodyOf)
      .catch(() => undefined);
    if (body === undefined) trace.problems.push(`the estate no longer holds ${helper.provenance.file}`);
    else if (body === '')
      trace.problems.push(
        `${helper.provenance.file} holds no instructions: a helper alone has nothing to run on`,
      );
  }
  const custom = (spec.rules?.custom ?? {}) as Record<string, unknown>;
  for (const [index, block] of spec.blocks.entries()) {
    const observed = emptyObserved();
    const ask = 'user' in block.when ? block.when.user : '';
    for (const name of guardsOf(block.expect, custom, index)) {
      const declared = guards.filter((guard) => guardName(guard) === name);
      if (declared.length === 0) {
        trace.problems.push(`the estate no longer runs the guard ${name}`);
        continue;
      }
      const quiet = (block.expect?.guards ?? []).some(
        (entry) => entry.name === name && forbidsFiring(entry.count),
      );
      for (const guard of declared) {
        const fired = await runGuardCases(guard, quiet, ask, runner, trace);
        (observed.runtime as RuntimeTrace).guards?.push(...fired);
      }
    }
    for (const script of scripts) {
      await runScriptCases(script, config, runner, trace, observed);
    }
    trace.blocks.push(observed);
  }
  return trace;
}

/** An agent file's text after its frontmatter, trimmed. */
function bodyOf(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return (match ? text.slice(match[0].length) : text).trim();
}

function emptyObserved(): Observed {
  return {
    segments: [],
    text: '',
    toolCalls: [],
    runtime: { guards: [], skills: [] },
    executions: [],
    cost: { usd: 0 },
    latencyMs: 0,
  };
}

/** The guards a block names: in `expect.guards`, and in the custom guard checks that apply to it. */
function guardsOf(expect: Expect | undefined, custom: Record<string, unknown>, index: number): string[] {
  const names = new Set((expect?.guards ?? []).map((entry) => entry.name));
  for (const key of ['guard_message', 'guard_finished']) {
    const options = custom[key];
    if (options === null || typeof options !== 'object') continue;
    const { name, block } = options as { name?: unknown; block?: unknown };
    if (typeof name === 'string' && (typeof block !== 'number' || block === index)) names.add(name);
  }
  return [...names];
}

/** A count that allows no firing: `0`, or a range whose most is 0. */
function forbidsFiring(count: unknown): boolean {
  if (count === 0) return true;
  if (count !== null && typeof count === 'object') {
    const { max, exact } = count as { max?: unknown; exact?: unknown };
    return max === 0 || exact === 0;
  }
  return false;
}

/** The verdict word of a guard run the runtime acts on, or undefined when the run had no effect. */
function verdictOf(run: Exec): string | undefined {
  if (run.timedOut) return 'timeout';
  const outcome = outcomeOf(run);
  if (outcome.decision === 'deny' || outcome.decision === 'ask') return outcome.decision;
  // Another exit code than 0 or 2 does not block: the runtime shows the message, a warning.
  if (outcome.decision === 'error') return 'warn';
  // Exit 0 with output: the runtime adds it to the context, a nudge.
  if (outcome.output !== undefined) return 'nudge';
  return undefined;
}

async function runGuardCases(
  guard: GuardDecl,
  quiet: boolean,
  ask: string,
  runner: Runner,
  trace: UnitSpecTrace,
): Promise<NonNullable<RuntimeTrace['guards']>> {
  const name = guardName(guard);
  const source = guard.script
    ? await readFile(join(runner.copy, guard.script), 'utf8').catch(() => '')
    : guard.command;
  const events = quiet ? quietEvents(guard, ask) : firingEvents(guard, source, ask, guard.script ?? '');
  const timeoutMs = Math.round((guard.timeout ?? 60) * 1000);
  const fired: NonNullable<RuntimeTrace['guards']> = [];
  for (const event of events) {
    const run = await runGuardEvent(guard, event, runner, timeoutMs);
    const outcome = outcomeOf(run);
    trace.guards.push({
      guard: name,
      event: guard.event,
      decision: run.timedOut ? 'error' : outcome.decision,
      ...(outcome.message !== undefined ? { message: outcome.message } : {}),
      ...(outcome.output !== undefined ? { output: outcome.output } : {}),
      ms: run.ms,
      timedOut: run.timedOut,
    });
    const verdict = verdictOf(run);
    if (verdict === undefined) continue;
    fired.push({
      name,
      verdict,
      exitCode: run.exitCode,
      ...(run.stdout.trim() ? { stdout: run.stdout.trim() } : {}),
      ...(run.stderr.trim() || run.timedOut
        ? { stderr: run.timedOut ? 'timed out' : run.stderr.trim() }
        : {}),
      ...(run.timedOut ? { outcome: 'timeout' } : {}),
    });
    if (!quiet) break;
  }
  return fired;
}

type Event = Record<string, unknown>;

/** The tool a matcher names first (`Edit|Write` gives Edit); Bash for a tool event with no matcher. */
function toolOf(guard: GuardDecl): string {
  const first = (guard.matcher ?? '').split('|')[0]?.trim() ?? '';
  return /^[A-Za-z][\w-]*$/.test(first) ? first : 'Bash';
}

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);
const PROMPT_EVENTS = new Set(['UserPromptSubmit']);
const REPLY_EVENTS = new Set(['Stop', 'SubagentStop']);

/** The event of one text: in the field the guard's event carries it. */
function eventWith(guard: GuardDecl, text: string, file?: string): Event {
  if (TOOL_EVENTS.has(guard.event)) {
    const tool = toolOf(guard);
    const input: Record<string, unknown> =
      tool === 'Bash'
        ? { command: text, description: 'unit test' }
        : ['Edit', 'MultiEdit', 'Write', 'Read', 'NotebookEdit'].includes(tool)
          ? { file_path: file ?? text, content: text, old_string: '', new_string: text }
          : { command: text, file_path: file ?? text, prompt: text, pattern: text, url: text, content: text };
    return {
      tool_name: tool,
      tool_input: input,
      ...(guard.event === 'PreToolUse' || guard.event === 'PermissionRequest'
        ? {}
        : { tool_response: { stdout: '', stderr: '', interrupted: false } }),
    };
  }
  if (PROMPT_EVENTS.has(guard.event)) return { prompt: text };
  if (REPLY_EVENTS.has(guard.event)) {
    // The runtime's name for the last reply, and `last_reply`, the name the generated unit tests use.
    return { stop_hook_active: false, last_assistant_message: text, last_reply: text };
  }
  return { message: text, prompt: text };
}

/** Events of an act the guard allows: a listing, a new file, a short reply, the block's own prompt. */
function quietEvents(guard: GuardDecl, ask: string): Event[] {
  if (PROMPT_EVENTS.has(guard.event)) return [eventWith(guard, ask || 'Hello.')];
  if (REPLY_EVENTS.has(guard.event)) return [eventWith(guard, 'Done.')];
  if (TOOL_EVENTS.has(guard.event) && toolOf(guard) !== 'Bash')
    return [eventWith(guard, 'ok', 'unit-test-new-file.md')];
  return [eventWith(guard, 'ls')];
}

/**
 * Events of the act the guard forbids, from its own source: each literal its conditions test, every literal
 * together, a text longer than a length it compares with, an existing file of the estate for a file tool,
 * and the block's own prompt for a prompt event.
 */
export function firingEvents(guard: GuardDecl, source: string, ask: string, existing: string): Event[] {
  const { literals, fields, lengths } = conditionsOf(source);
  const texts = [...literals, ...(literals.length > 1 ? [literals.join(' ')] : [])];
  for (const length of lengths) texts.push('x'.repeat(length + 1));
  const events: Event[] = [];
  if (TOOL_EVENTS.has(guard.event) && toolOf(guard) !== 'Bash' && existing)
    events.push(eventWith(guard, 'ok', existing));
  if (PROMPT_EVENTS.has(guard.event) && ask) events.push(eventWith(guard, ask));
  for (const text of texts) events.push(eventWith(guard, text));
  for (const [field, value] of fields) {
    const event = eventWith(guard, value);
    event[field] = value;
    events.push(event);
  }
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = JSON.stringify(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const MESSAGE_LINE = /\bprint\s*\(|\becho\b|\bprintf\b|console\.(error|log)|\.write\s*\(|>&2|\braise\b/;

/**
 * What a guard's conditions test, read from its source: the string literals outside messages, docstrings,
 * comments and field reads; a JSON pair written as a literal (`"prompt":"stop"`) as a field and its value; and
 * the lengths it compares a text with (`len(x) > 1200`, `${#x} -gt 1200`).
 */
export function conditionsOf(source: string): {
  literals: string[];
  fields: Array<[string, string]>;
  lengths: number[];
} {
  const code = source
    .replace(/("""|''')[\s\S]*?\1/g, '')
    .split('\n')
    .filter((line) => !/^\s*(#|\/\/)/.test(line));
  const text = code.filter((line) => !MESSAGE_LINE.test(line)).join('\n');
  const literals: string[] = [];
  const fields: Array<[string, string]> = [];
  const add = (value: string) => {
    const pair = /^"(\w+)"\s*:\s*"([^"]*)"$/.exec(value.trim());
    if (pair) {
      fields.push([pair[1] as string, pair[2] as string]);
      return;
    }
    if (value.trim().length < 2 || /[[\]?]/.test(value) || literals.includes(value)) return;
    literals.push(value);
  };
  // Shell case patterns, whatever the branch does on the same line: `*"git push --force"*|*'x'*) exit 2 ;;`.
  for (const line of code) {
    const match = /^\s*([^()\n#]*[*"'][^()\n#]*)\)/.exec(line);
    if (!match) continue;
    for (const pattern of (match[1] as string).split('|')) {
      const bare = pattern.trim().replace(/^\*+|\*+$/g, '');
      if (bare === '' || bare.includes('*')) continue;
      add(bare.replace(/^(["'])([\s\S]*)\1$/, '$2').replace(/\\(.)/g, '$1'));
    }
  }
  for (const match of text.matchAll(/(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const value = (match[2] as string).replace(/\\(.)/g, '$1');
    const before = text.slice(Math.max(0, (match.index ?? 0) - 8), match.index);
    // A field read (`.get("command"`, `["tool_input"]`) names where to look, not what to find; `"$x"` is a
    // shell variable.
    if (/(\.get\(|\[)\s*$/.test(before) || value.startsWith('$')) continue;
    add(value);
  }
  const lengths: number[] = [];
  for (const match of text.matchAll(
    /len\((?:[^()]|\([^()]*\))*\)\s*>=?\s*(\d+)|\$\{#\w+\}"?\s*-g[te]\s*(\d+)|\.length\s*>=?\s*(\d+)/g,
  )) {
    const value = Number(match[1] ?? match[2] ?? match[3]);
    if (Number.isFinite(value) && value > 0 && value < 1_000_000) lengths.push(value);
  }
  return { literals, fields, lengths };
}

async function runGuardEvent(
  guard: GuardDecl,
  event: Event,
  runner: Runner,
  timeoutMs: number,
): Promise<Exec> {
  runner.counter += 1;
  const number = runner.counter;
  const folder = join(runner.work, `case-${number}`);
  await mkdir(folder, { recursive: true });
  const transcript = join(folder, 'transcript.jsonl');
  const prompt = typeof event.prompt === 'string' ? event.prompt : 'unit test';
  const reply = typeof event.last_assistant_message === 'string' ? event.last_assistant_message : 'ok';
  await writeFile(
    transcript,
    [
      { type: 'user', message: { role: 'user', content: prompt } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n')
      .concat('\n'),
  );
  const payload: Event = {
    session_id: `unit-${number}`,
    transcript_path: transcript,
    cwd: runner.copy,
    hook_event_name: guard.event,
    permission_mode: 'default',
    ...(event.tool_name !== undefined ? { tool_use_id: `toolu_unit_${number}` } : {}),
    ...event,
  };
  // A hook runs in the session's working folder: the project.
  return execute(
    ['/bin/sh', '-c', guard.command],
    `${JSON.stringify(payload)}\n`,
    runner,
    runner.copy,
    timeoutMs,
  );
}

const USAGE = /usage|required|missing|expects?\s+\d|argument/i;

async function runScriptCases(
  script: Atom,
  config: Record<string, unknown>,
  runner: Runner,
  trace: UnitSpecTrace,
  observed: Observed,
): Promise<void> {
  const path = String(script.fields?.path);
  const skill = typeof script.fields?.skill === 'string' ? script.fields.skill : undefined;
  if (skill) observed.runtime?.skills?.push({ name: skill });
  const source = await readFile(join(runner.copy, path), 'utf8').catch(() => undefined);
  if (source === undefined) {
    trace.problems.push(`the estate no longer holds ${path}`);
    return;
  }
  const declared = (config.scripts as Record<string, unknown> | undefined)?.[path];
  const fixtures: Array<{
    args: string[];
    files: Record<string, string>;
    stdin: string;
    expect?: Record<string, unknown>;
  }> =
    Array.isArray(declared) && declared.length > 0
      ? declared.map((entry) => {
          const record = (entry ?? {}) as Record<string, unknown>;
          return {
            args: Array.isArray(record.args) ? record.args.map(String) : [],
            files: Object.fromEntries(
              Object.entries((record.files ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
            ),
            stdin: typeof record.stdin === 'string' ? record.stdin : '',
            expect: (record.expect ?? {}) as Record<string, unknown>,
          };
        })
      : casesFromSource(source).map((entry) => ({
          args: Array.isArray(entry.payload.args) ? entry.payload.args.map(String) : [],
          files: Object.fromEntries(
            Object.entries((entry.payload.files ?? {}) as Record<string, unknown>).map(([k, v]) => [
              k,
              String(v),
            ]),
          ),
          stdin: '',
        }));
  const readsArguments = casesFromSource(source).length > 1;
  for (const fixture of fixtures) {
    runner.counter += 1;
    const folder = join(runner.work, `case-${runner.counter}`);
    await mkdir(folder, { recursive: true });
    for (const [name, text] of Object.entries(fixture.files)) {
      await mkdir(dirname(join(folder, name)), { recursive: true });
      await writeFile(join(folder, name), text);
    }
    const argv = [...interpreterOf(path), join(runner.copy, path), ...fixture.args];
    const run = await execute(argv, fixture.stdin, runner, folder, 60_000);
    const command = [...interpreterOf(path), path, ...fixture.args].join(' ');
    observed.toolCalls.push({ label: 'Bash', input: { command }, output: run.stdout });
    observed.executions?.push({
      command,
      role: 'command',
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      latencyMs: run.ms,
    });
    trace.scripts.push({
      script: path,
      exit: run.exitCode,
      stdout: run.stdout.trim(),
      stderr: run.stderr.trim(),
      ms: run.ms,
    });
    const said = `${run.stdout}\n${run.stderr}`;
    if (fixture.expect !== undefined) {
      const wanted = typeof fixture.expect.exitCode === 'number' ? fixture.expect.exitCode : 0;
      if (run.exitCode !== wanted)
        trace.problems.push(
          `${path} ${fixture.args.join(' ')}: exit ${run.exitCode} where ${wanted} is declared`,
        );
      if (typeof fixture.expect.stdout === 'string' && run.stdout.trim() !== fixture.expect.stdout.trim())
        trace.problems.push(`${path} ${fixture.args.join(' ')}: another stdout than declared`);
      continue;
    }
    if (fixture.args.length > 0) continue;
    if (readsArguments && (run.exitCode === 0 || !USAGE.test(said)))
      trace.problems.push(
        `${path} with no argument: exit ${run.exitCode} with no usage stated, though the script reads arguments`,
      );
    if (!readsArguments && run.exitCode !== 0)
      trace.problems.push(`${path} with no argument: exit ${run.exitCode}, though the script reads none`);
  }
}

/**
 * An adapter that hands the runner the traces a unit run built, block by block: no agent, no model. The checks
 * read guards, commands and skills from it as from any runtime.
 */
export function unitTraceAdapter(blocks: readonly Observed[]): AgentAdapter {
  return {
    id: 'claude-code',
    version: 'unit-1',
    capabilities: () => ({
      variants: false,
      seedPrefix: true,
      toolStubs: false,
      trace: false,
      sandbox: false,
      endState: false,
      deterministic: true,
    }),
    async open(given): Promise<Session> {
      return {
        id: `unit-${given.hash.slice(0, 12)}`,
        adapter: 'claude-code',
        target: given.target,
        given,
        history: [],
      };
    },
    async send(_session: Session, turn: Turn): Promise<Observed> {
      return structuredClone(blocks[turn.index] ?? emptyObserved());
    },
    async close() {},
  };
}

/** The checks a unit trace can feed: what fired, what loaded, what ran. */
const UNIT_CHECKS = new Set(['guards', 'skills', 'tools', 'execution', 'forbidden']);
const UNIT_CUSTOM = new Set(['guard_message', 'guard_finished', 'some_call']);

/** True when a verdict, by its id (`guards.x.deny`, `custom.guard_message.present`), judges a unit trace. */
export function unitJudges(verdictId: string): boolean {
  const [head, sub] = verdictId.split('.');
  return head === 'custom' ? UNIT_CUSTOM.has(sub ?? '') : UNIT_CHECKS.has(head ?? '');
}
