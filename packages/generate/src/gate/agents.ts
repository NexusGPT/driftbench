import { pathToFileURL } from 'node:url';
import { functionAdapter, processAdapter } from '@agent-nexus/driftbench-adapters';
import {
  type AgentAdapter,
  type ArtifactReaderRegistry,
  type CheckSet,
  canonicalJson,
  isScored,
  type Message,
  type Observed,
  type RunResult,
  runSpec,
  type SandboxProvider,
  type Segment,
  type Spec,
  type ToolCall,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
import type { BlockOutcome, FaultDef, FaultSet, TrivialAgent } from './types';

/**
 * The agents the gate runs a block on, and how it reads a run: the three trivial agents of the shortcut
 * stage, the adapters of a fault set, one run through the real runner, a block's outcome, and the part of
 * an observation a fault can change.
 */

/** The reply of the constant agent: English, long enough for the language detector to judge it. */
export const CONSTANT_REPLY = 'Thank you for your message. Someone from our team will get back to you soon.';

/**
 * A trivial agent for one spec. Each reports the first stage of the spec's catalogue, so a Then that only
 * asks the agent to stay where it started is caught. `constant` sends the same reply to every message;
 * `echo` sends the user's message back with every literal word of the spec's patterns; `first-tool`
 * calls the first tool the spec names, with no argument, and sends the constant reply.
 */
export function trivialAdapter(name: TrivialAgent, spec: Spec): AgentAdapter {
  const stage = spec.stages?.[0];
  const keywords = patternWords(spec);
  const tool = firstTool(spec);
  type Session = { payloads: { tool: string; input: unknown }[] };
  return functionAdapter<Session>({
    create: () => ({ payloads: [] }),
    respond: (messages, world, _vars, session) => {
      const user = lastUserText(messages);
      const segments: Segment[] = [];
      const toolCalls: ToolCall[] = [];
      if (name === 'first-tool' && tool !== undefined) {
        const override = world.tools?.[tool];
        const id = 'call-1';
        segments.push({ type: 'tool_call', id, label: tool, input: {} });
        if (override?.error !== undefined) {
          segments.push({ type: 'tool_result', id, label: tool, output: null, error: override.error });
          toolCalls.push({ id, label: tool, input: {}, error: override.error });
        } else {
          const output = override?.result ?? {};
          segments.push({ type: 'tool_result', id, label: tool, output });
          toolCalls.push({ id, label: tool, input: {}, output });
          session.payloads.push({ tool, input: {} });
        }
      }
      const text = name === 'echo' ? [user, ...keywords].join(' ').trim() || CONSTANT_REPLY : CONSTANT_REPLY;
      segments.push({ type: 'text', text });
      return {
        segments,
        text,
        toolCalls,
        ...(stage === undefined ? {} : { runtime: { stages: [{ name: stage }] } }),
        cost: { usd: 0 },
        latencyMs: 0,
      };
    },
    payloads: (session) => session.payloads,
    deterministic: true,
    version: `trivial-${name}`,
  });
}

/** The literal words of every must pattern of the spec: what a keyword matcher would echo. */
export function patternWords(spec: Spec): string[] {
  const words = new Set<string>();
  for (const block of spec.blocks) {
    for (const pattern of block.expect?.must ?? []) {
      const literal = pattern.replace(/\\(.)/g, '$1').replace(/[\^$.*+?()[\]{}|]/g, ' ');
      for (const word of literal.split(/\s+/)) if (word !== '') words.add(word);
    }
  }
  return [...words];
}

/** The first tool the spec names: in a block's expected tools, else in the Given world. */
export function firstTool(spec: Spec): string | undefined {
  for (const block of spec.blocks) {
    const label = block.expect?.tools?.[0]?.label;
    if (label !== undefined) return label;
  }
  const given = Object.keys(spec.given?.world?.tools ?? {})[0];
  if (given !== undefined) return given;
  for (const block of spec.blocks) {
    const label = Object.keys(block.given?.world?.tools ?? {})[0];
    if (label !== undefined) return label;
  }
  return undefined;
}

function lastUserText(messages: Message[]): string {
  const texts: string[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'user') break;
    texts.unshift(message.content);
  }
  return texts.join('\n');
}

/** Imports a fault set: a module, or a folder whose index module exports `faults`. */
export async function importFaultSet(path: string): Promise<FaultSet> {
  const url = pathToFileURL(path).href;
  // Fault sets are often authored as TypeScript with extensionless local imports.
  // Load their dependency graph the same way from the installed CLI and from source.
  const module: unknown = /\.[cm]?tsx?$/.test(path)
    ? await (await import('tsx/esm/api')).tsImport(url, import.meta.url)
    : await import(url);
  const faults = (module as { faults?: unknown }).faults;
  if (!Array.isArray(faults)) throw new Error(`${path} exports no list named faults`);
  const seen = new Set<string>();
  for (const [index, fault] of faults.entries()) {
    const problem = faultProblem(fault);
    if (problem) throw new Error(`fault ${index} of ${path}: ${problem}`);
    const id = (fault as FaultDef).id;
    if (seen.has(id)) throw new Error(`fault id ${id} appears twice in ${path}`);
    seen.add(id);
  }
  return { faults: faults as FaultDef[] };
}

function faultProblem(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return 'not an object';
  const fault = value as Partial<FaultDef>;
  if (typeof fault.id !== 'string' || fault.id === '') return 'no id';
  if (fault.kind !== 'drift' && fault.kind !== 'deviation' && fault.kind !== 'control') {
    return `${fault.id}: kind must be drift, deviation or control`;
  }
  if (typeof fault.class !== 'string') return `${fault.id}: no class`;
  if (typeof fault.target !== 'string' || !fault.target.includes(':')) {
    return `${fault.id}: target must read adapter:agent`;
  }
  if (!Array.isArray(fault.affects)) return `${fault.id}: no affects list`;
  if (typeof fault.description !== 'string' || fault.description === '') return `${fault.id}: no description`;
  const agent = fault.agent;
  if (agent?.kind === 'function' && typeof agent.create === 'function') return undefined;
  if (agent?.kind === 'process' && typeof agent.script === 'string') return undefined;
  return `${fault.id}: agent must be { kind: function, create } or { kind: process, script }`;
}

/** The adapter of one fault. A process fault runs `node <script>` in a sandbox from `provider`. */
export function faultAdapter(fault: FaultDef, provider: () => SandboxProvider): AgentAdapter {
  const agent = fault.agent;
  if (agent.kind === 'function') {
    return functionAdapter({
      create: () => agent.create(),
      respond: (messages, world, _vars, session) => session.respond(messages, world),
      payloads: (session) => session.payloads(),
      deterministic: true,
      version: `fault-${fault.id}`,
    });
  }
  return processAdapter({
    command: process.execPath,
    args: [agent.script],
    provider: provider(),
    deterministic: true,
  });
}

export type RunContext = {
  checks: CheckSet;
  artifacts?: ArtifactReaderRegistry;
  driver: () => UserDriver;
};

/** One free-running run of a spec, through the real runner, with no cache and no store. */
export async function runOnce(
  spec: Spec,
  adapter: AgentAdapter,
  repeat: number,
  ctx: RunContext,
): Promise<RunResult> {
  return runSpec(spec, {
    adapter,
    driver: ctx.driver(),
    checks: ctx.checks,
    mode: 'F',
    repeat,
    ...(ctx.artifacts ? { artifacts: ctx.artifacts } : {}),
  });
}

/**
 * The checks that are not part of any block's Then: hygiene the runner applies everywhere (personal data,
 * strict tool schemas) and resource limits. They neither make a block pass nor fail it here.
 */
const NOT_THEN: ReadonlySet<string> = new Set(['pii', 'schema_strict', 'budget']);

/** The gating verdicts of block `index` that come from its Then. The runner numbers blocks by position. */
function thenVerdicts(run: RunResult, index: number) {
  const block = run.blocks.find((entry) => entry.index === index);
  return (block?.verdicts ?? []).filter(
    (verdict) => verdict.gating && !NOT_THEN.has(verdict.id.split('.', 1)[0] ?? ''),
  );
}

/**
 * Block `index` on one run: `fail` on any failing gating verdict of its Then, `pass` when at least one
 * decided and every one passed, `unjudged` otherwise. A pass that rests on no verdict is no pass.
 */
export function blockOutcome(run: RunResult, index: number): BlockOutcome {
  const verdicts = thenVerdicts(run, index);
  if (verdicts.some((verdict) => verdict.outcome === 'fail')) return 'fail';
  if (verdicts.length === 0 || verdicts.some((verdict) => verdict.outcome !== 'pass')) return 'unjudged';
  return 'pass';
}

/** True when the runner did not send block `index` (not_run or blocked): the run measured nothing there. */
export function blockNotRun(run: RunResult, index: number): boolean {
  const block = run.blocks.find((entry) => entry.index === index);
  return block !== undefined && !isScored(block);
}

/** The failing gating verdict ids of block `index`'s Then, for the report. */
export function failingIds(run: RunResult, index: number): string[] {
  return thenVerdicts(run, index)
    .filter((verdict) => verdict.outcome === 'fail')
    .map((verdict) => verdict.id);
}

/**
 * What a fault can change in a block, without timings, costs, ids or sandbox paths: the reply, the
 * segments, the tool calls, the runtime trace, the artifacts, the workspace diff and the commands.
 */
export function projectObserved(observed: Observed): string {
  return canonicalJson({
    text: observed.text,
    segments: observed.segments.map((segment) => {
      const { cost: _cost, latencyMs: _latency, ...rest } = segment;
      return 'id' in rest ? { ...rest, id: undefined } : rest;
    }),
    tools: observed.toolCalls.map((call) => ({
      label: call.label,
      input: call.input,
      output: call.output,
      error: call.error,
    })),
    runtime: {
      skills: (observed.runtime?.skills ?? []).map((entry) => entry.name),
      guards: (observed.runtime?.guards ?? []).map((entry) => `${entry.name}:${entry.verdict}`),
      stages: (observed.runtime?.stages ?? []).map((entry) => entry.name),
    },
    artifacts: (observed.artifacts ?? []).map((entry) => ({ path: entry.path, sha256: entry.sha256 })),
    workspace: observed.workspaceDiff ?? null,
    // The agent's own record names the script that ran: a wrapper is another path for the same agent.
    commands: (observed.executions ?? []).map((entry) => ({
      command: entry.role === 'agent' ? 'agent' : entry.command,
      exitCode: entry.exitCode,
    })),
  });
}

/** One projection per block of a run, then its end-state match: what two runs are compared on. */
export function projectRun(run: RunResult): string[] {
  return [
    ...run.blocks.map((block) => projectObserved(block.observed)),
    canonicalJson({ status: run.status, endState: run.endState ?? null }),
  ];
}
