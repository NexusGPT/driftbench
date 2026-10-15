import {
  type AdapterCapabilities,
  AdapterTransportError,
  type AgentAdapter,
  AgentFailure,
  copyHistory,
  isPlainObject,
  type Message,
  type ResolvedGiven,
  retryableStatus,
  type Segment,
  type Session,
  type Turn,
} from '@agent-nexus/driftbench-core';
import {
  addUsage,
  newUsage,
  observedOf,
  openSession,
  ownState,
  payloadLog,
  readPayloads,
  readToolText,
  recordPayloads,
  type SdkState,
  ToolLabels,
} from '../anthropic/common';
import { bridgeFile, type ExecLike, readBridgeReply, spawnExec } from '../shared/bridge';
import { excerpt, type FetchLike, sendRequest } from '../shared/transport';
import { CREWAI_BRIDGE } from './bridge-source';

/**
 * The crewai adapter: a CrewAI crew, reached through one of its two interfaces.
 *
 * - `crewaiProcess`: the crew in a Python process. The adapter runs a bridge script (shipped with it) that
 *   imports the crew, kicks it off with the block's inputs, and reports the final output, each task's
 *   output, and every tool the crew's agents used, from CrewAI's event bus.
 * - `crewaiHttp`: a crew deployed on CrewAI AMP. The adapter posts `/kickoff` with the inputs and polls
 *   `/status/{kickoff_id}` until the run completes or fails. That API reports outputs only, no tool calls.
 *
 * A crew runs tasks; a conversation reaches it through its inputs. By default each block hands the crew
 * `message` (the block's user text), `history` (the earlier turns as text) and `messages` (the whole history
 * as JSON); `inputs` replaces that mapping. The crew runs its own tools, so `world.tools` cannot reach them.
 * With the default inputs, a Given whose prefix holds tool calls the spec states as a record (`origin:
 * recorded` or `authored`) is refused: the crew would read them as prose. A canonical prefix runs.
 */

export const CREWAI_ADAPTER_VERSION = '0.1.0';

/** One tool use the crew reported: the tool, its arguments, its output or error. */
export type CrewToolUse = { tool: string; input?: unknown; output?: unknown; error?: string };

/** What one kickoff came to. */
export type CrewRun = {
  /** The crew's final output. */
  raw: string;
  /** Each task's output, in order. */
  tasks?: readonly { name?: string | null; agent?: string | null; raw?: string | null }[];
  /** The tools the crew's agents used, in order. Empty when the interface does not report them. */
  tools?: readonly CrewToolUse[];
  usage?: { prompt_tokens?: number | null; completion_tokens?: number | null };
};

/** How the adapter reaches the crew: one kickoff per block. */
export type CrewTransport = {
  readonly kind: 'process' | 'http';
  /** Whether the interface reports the tools the crew used. */
  readonly reportsTools: boolean;
  kickoff(inputs: Record<string, string>): Promise<CrewRun>;
};

export type CrewaiAdapterOptions = {
  transport: CrewTransport;
  /** The crew's inputs for a block. Default `{ message, history, messages }`, all strings. */
  inputs?: (history: readonly Message[], turn: Turn) => Record<string, string>;
  /** The crew's tool names mapped to spec labels, such as `{ coverage_check: 'coverage.check' }`. */
  toolLabels?: Readonly<Record<string, string>>;
  /** The tools that change the world, by spec label. Their inputs are the payloads `endState` reads. */
  sideEffects?: readonly string[];
  deterministic?: boolean;
  /** The version the runner's cache key carries; name the crew's version here. */
  version?: string;
};

type CrewState = SdkState & { readonly kind: 'crewai' };

export function crewaiAdapter(options: CrewaiAdapterOptions): AgentAdapter {
  const id = 'crewai';
  const labels = new ToolLabels(options.toolLabels);
  const sideEffects = new Set(options.sideEffects ?? []);
  const capabilities: AdapterCapabilities = {
    variants: false,
    seedPrefix: true,
    // The crew runs its own tools; a forced result in world.tools does not reach them.
    toolStubs: false,
    trace: false,
    sandbox: false,
    endState: options.sideEffects !== undefined && options.transport.reportsTools,
    deterministic: options.deterministic ?? false,
  };

  return {
    id,
    version: options.version ?? CREWAI_ADAPTER_VERSION,
    capabilities: () => ({ ...capabilities }),

    async open(given: ResolvedGiven) {
      // A crew takes its history as text inputs: the earlier turns as `role: text` lines and the whole history
      // as JSON. With the default inputs, tool calls the spec wrote as a record (origin recorded or authored)
      // would reach the crew's agents as data in a text field, never as tool results: a different test from the
      // one the spec states, so it is refused. The origin covers only the messages the spec wrote
      // (`originLength`); the canonical calls a teacher-forced replay adds after them, a canonical prefix and a
      // prefix of unstated origin go as they always did.
      const prefix = copyHistory(given.prefix);
      const stated = given.origin === 'recorded' || given.origin === 'authored';
      const written = prefix.slice(0, given.originLength ?? prefix.length);
      const recorded =
        options.inputs || !stated ? 0 : written.reduce((n, m) => n + (m.tool_calls?.length ?? 0), 0);
      if (recorded > 0) {
        throw new AgentFailure(
          `crewai: the Given prefix (origin ${given.origin}) holds ${recorded} recorded tool call(s), and a crew takes its history as text inputs, so its agents would read them as prose, not as tool results. Write those turns as blocks the crew runs, or pass \`inputs\` that hand the calls to the crew in a form it reads as records.`,
        );
      }
      return openSession(id, given, {
        kind: 'crewai',
        closed: false,
        payloads: new Map(),
      } satisfies CrewState);
    },

    async send(session: Session, turn: Turn) {
      const history = copyHistory(session.history);
      const state = ownState<CrewState>(session, id, 'crewai');
      const inputs = (options.inputs ?? crewaiInputs)(history, turn);
      const started = performance.now();
      const run = await options.transport.kickoff(inputs);
      const latencyMs = Math.round(performance.now() - started);
      if (!isPlainObject(run) || typeof run.raw !== 'string') {
        throw new AgentFailure(`the crew answered block ${turn.index} without a raw output`);
      }
      const segments: Segment[] = [];
      (run.tools ?? []).forEach((use, index) => {
        const label = labels.label(use.tool);
        const callId = `crew-${turn.index}-${index + 1}`;
        segments.push({ type: 'tool_call', id: callId, label, input: use.input ?? null });
        if (use.error !== undefined) {
          segments.push({ type: 'tool_result', id: callId, label, output: null, error: use.error });
        } else {
          const outcome =
            typeof use.output === 'string' ? readToolText(use.output) : { output: use.output ?? null };
          segments.push(
            outcome.error !== undefined
              ? { type: 'tool_result', id: callId, label, output: null, error: outcome.error }
              : { type: 'tool_result', id: callId, label, output: outcome.output },
          );
        }
      });
      if (run.raw !== '') segments.push({ type: 'text', text: run.raw });
      const usage = newUsage();
      const cost = addUsage(usage, run.usage?.prompt_tokens, run.usage?.completion_tokens);
      const first = segments[0];
      if (first) {
        first.latencyMs = latencyMs;
        if (cost) first.cost = cost;
      }
      const tasks = (run.tasks ?? []).flatMap((task) => (task.name ? [{ name: task.name }] : []));
      const observed = observedOf(segments, usage, latencyMs, 'the crew', {
        ...(tasks.length > 0 ? { runtime: { stages: tasks } } : {}),
        raw: { tasks: run.tasks ?? [] },
      });
      recordPayloads(state, turn.index, observed.toolCalls, sideEffects);
      return observed;
    },

    async endState(session, source) {
      const state = ownState<CrewState>(session, id, 'crewai');
      if (!capabilities.endState) {
        throw new Error('the crewai adapter reads payloads only with sideEffects and a process transport');
      }
      return readPayloads(payloadLog(state), source, id);
    },

    async close(session) {
      const state = session.state as CrewState | undefined;
      if (state?.kind !== 'crewai') return;
      state.closed = true;
      state.payloads.clear();
    },
  };
}

/** The default inputs: the block's user text, the earlier turns as text, and the whole history as JSON. */
export function crewaiInputs(history: readonly Message[], _turn: Turn): Record<string, string> {
  let start = history.length;
  while (start > 0 && history[start - 1]?.role === 'user') start--;
  const earlier = history.slice(0, start);
  return {
    message: history
      .slice(start)
      .map((message) => message.content)
      .join('\n'),
    history: earlier.map((message) => `${message.role}: ${message.content}`).join('\n'),
    messages: JSON.stringify(history),
  };
}

export type CrewaiProcessOptions = {
  /** The crew, as `<module>:<name>`: a Crew, or a function that returns a fresh one. */
  crew: string;
  /** The Python interpreter. Default `python3`. */
  python?: string;
  /** Where the process runs, so the crew's module is importable. */
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** The most milliseconds one kickoff may take. Default 600000. */
  timeoutMs?: number;
  /** Runs the process. Default `spawnExec`; tests pass one that plays the bridge. */
  exec?: ExecLike;
};

/** A crew run in a Python process through the shipped bridge, which reports the tools from CrewAI's event bus. */
export function crewaiProcess(options: CrewaiProcessOptions): CrewTransport {
  const exec = options.exec ?? spawnExec;
  return {
    kind: 'process',
    reportsTools: true,
    async kickoff(inputs) {
      const reply = await exec({
        command: options.python ?? 'python3',
        args: [bridgeFile('crewai', CREWAI_BRIDGE), options.crew],
        input: JSON.stringify({ inputs }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        env: { ...(options.cwd === undefined ? {} : { PYTHONPATH: options.cwd }), ...options.env },
        timeoutMs: options.timeoutMs ?? 600_000,
      });
      return readBridgeReply(reply, `the crew ${options.crew}`) as CrewRun;
    },
  };
}

export type CrewaiHttpOptions = {
  /** The crew's URL from the CrewAI AMP dashboard. */
  url: string;
  /** The crew's bearer token. Read it from the environment; it reaches no message. */
  token: string;
  fetch?: FetchLike;
  /** Wait between two status reads. Default 2000 ms. */
  pollIntervalMs?: number;
  /** The most milliseconds one kickoff may take, polling included. Default 600000. */
  timeoutMs?: number;
  /** How a wait is spent. Tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * A crew deployed on CrewAI AMP: `POST /kickoff` with `{ inputs }` gives a `kickoff_id`; `GET
 * /status/{kickoff_id}` answers `running`, `completed` (with `result.output` and `result.tasks`) or `error`.
 * The API reports no tool calls. A 429 or a 5xx is a transport error the runner retries.
 */
export function crewaiHttp(options: CrewaiHttpOptions): CrewTransport {
  const base = options.url.replace(/\/+$/, '');
  const fetchFn: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 600_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const headers = {
    authorization: `Bearer ${options.token}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };

  async function call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const label = `${method} ${base}${path}`;
    const reply = await sendRequest(
      fetchFn,
      `${base}${path}`,
      { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      timeoutMs,
      label,
    );
    if (reply.status < 200 || reply.status >= 300) {
      const message = `${label} answered ${reply.status}: ${excerpt(reply.text).split(options.token).join('[redacted]')}`;
      if (retryableStatus(reply.status)) {
        throw new AdapterTransportError(message, {
          status: reply.status,
          ...(reply.retryAfterMs === undefined ? {} : { retryAfterMs: reply.retryAfterMs }),
        });
      }
      throw new AgentFailure(message);
    }
    if (!isPlainObject(reply.json))
      throw new AgentFailure(`${label} answered with a body that is not a JSON object`);
    return reply.json;
  }

  return {
    kind: 'http',
    reportsTools: false,
    async kickoff(inputs) {
      const started = Date.now();
      const kicked = await call('POST', '/kickoff', { inputs });
      const kickoffId = kicked.kickoff_id;
      if (typeof kickoffId !== 'string')
        throw new AgentFailure(`POST ${base}/kickoff answered no kickoff_id`);
      for (;;) {
        const status = await call('GET', `/status/${encodeURIComponent(kickoffId)}`);
        if (status.status === 'completed') {
          const result = isPlainObject(status.result) ? status.result : {};
          const tasks = Array.isArray(result.tasks) ? result.tasks.filter(isPlainObject) : [];
          return {
            raw: typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? ''),
            tasks: tasks.map((task) => ({
              name: typeof task.task_id === 'string' ? task.task_id : null,
              agent: typeof task.agent === 'string' ? task.agent : null,
              raw: typeof task.output === 'string' ? task.output : null,
            })),
            tools: [],
          };
        }
        if (status.status === 'error') {
          throw new AgentFailure(
            `the crew run ${kickoffId} failed: ${String(status.error ?? 'no error given')}`,
          );
        }
        if (Date.now() - started > timeoutMs) {
          throw new AdapterTransportError(`the crew run ${kickoffId} did not finish within ${timeoutMs} ms`, {
            exhausted: true,
          });
        }
        await sleep(options.pollIntervalMs ?? 2_000);
      }
    },
  };
}
