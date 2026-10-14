import {
  type AdapterCapabilities,
  AdapterTransportError,
  type AgentAdapter,
  AgentFailure,
  canonicalJson,
  contentHash,
  copyHistory,
  isPlainObject,
  type Session,
  type TargetRef,
} from '@agent-nexus/driftbench-core';
import { type FetchLike, readSource, stimulusMessages, type ToolPayload } from '../shared';
import { type Answer, createClient, DEFAULT_BASE_URL, type NexusClient } from './client';
import {
  type Candidate,
  type Generation,
  observedFromCandidate,
  observedFromGenerations,
  readCandidate,
} from './turn';

/**
 * The nexus adapter: an agent on the Nexus platform, reached through its public API.
 *
 * - `open` creates a golden conversation for `target.agent` on `target.deployment`, authored under the
 *   prompt variant `target.variant` (the agent's live prompt when it is absent).
 * - `send` appends the block's user messages, generates the agent's turn (tools run live), accepts it so
 *   the next block replays it, and returns the generate view: the tool calls and the final text.
 * - `trace` reads the same turn whole from tracing: every text segment in order, every tool call with its
 *   input and output, tokens, cost and latency per segment. It waits for the platform to finish writing it.
 * - `endState('tool:<label>')` reads the payload the recording stub workflow named in
 *   `target.options.stubs[<label>]` received from this session's call of that tool; `endState('*')` lists
 *   every payload the stubs received from this session's calls, in the order of the calls.
 * - `close` deletes the golden conversation.
 *
 * The key is read from NEXUS_API_KEY and the server from NEXUS_BASE_URL (default the public API). Neither
 * ever reaches a message, a log or an Observed. The platform cannot seed an agent turn without running the
 * agent and cannot force a tool result, so `seedPrefix` and `toolStubs` are false: the agent never sees a
 * prefix, though the session history holds it, as the record the runner keeps.
 */

export const NEXUS_ADAPTER_VERSION = '0.1.0';

export type NexusAdapterOptions = {
  /** Where NEXUS_API_KEY and NEXUS_BASE_URL are read. Default `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** The fetch to use. Default the global fetch. */
  fetch?: FetchLike;
  /** The most milliseconds an ordinary request may take. Default 30000. */
  timeoutMs?: number;
  /** The most milliseconds a generate may take: it runs the whole agent turn, tools included. Default 600000. */
  generateTimeoutMs?: number;
  /** How long `trace` waits for the platform to finish writing the turn's trace. Default 60000. */
  traceWaitMs?: number;
  /** Milliseconds between two reads while `trace` waits. Default 2000. */
  pollIntervalMs?: number;
  /** Keep the golden conversations the adapter creates, for inspection on the platform. Default false. */
  keepConversations?: boolean;
};

type Generated = { block: number; sessionId: string; candidate: Candidate; latencyMs: number };

type NexusState = {
  readonly kind: 'nexus';
  readonly conversationId: string;
  readonly deploymentId: string;
  /** Tool label to the id of the workflow that records that tool's payloads. */
  readonly stubs: Readonly<Record<string, string>>;
  readonly openedAt: string;
  closed: boolean;
  /** The block in flight, so a send the runner retries resumes where it stopped and never repeats a user turn. */
  progress?: { index: number; added: number; generated?: Generated; accepted: boolean };
  /** The last block that completed, and how many blocks completed. */
  last?: Generated;
  blocks: number;
  /** Every tool call this session made, in order, for matching a stub's payloads to this session. */
  calls: { block: number; label: string; input: unknown }[];
};

/** Executions read per page, and pages read at most, when matching a stub's payloads to a session. */
const EXECUTION_PAGE = 20;
const EXECUTION_PAGES = 3;
/** How far before the session's opening the stub's executions are searched, against clock differences. */
const CLOCK_MARGIN_MS = 10 * 60_000;

export function nexusAdapter(options: NexusAdapterOptions = {}): AgentAdapter {
  const id = 'nexus';
  const env = options.env ?? process.env;
  const baseUrl = env.NEXUS_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const fetchFn: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const generateTimeoutMs = options.generateTimeoutMs ?? 600_000;
  const traceWaitMs = options.traceWaitMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const capabilities: AdapterCapabilities = {
    variants: true,
    seedPrefix: false,
    toolStubs: false,
    trace: true,
    sandbox: false,
    endState: true,
    deterministic: false,
  };
  let client: NexusClient | undefined;

  function api(): NexusClient {
    if (client) return client;
    const apiKey = env.NEXUS_API_KEY?.trim();
    if (!apiKey) throw new Error('the nexus adapter reads its API key from NEXUS_API_KEY, which is not set');
    client = createClient({ apiKey, baseUrl, fetch: fetchFn, timeoutMs: options.timeoutMs ?? 30_000 });
    return client;
  }

  function own(session: Session): NexusState {
    const state = session.state as NexusState | undefined;
    if (session.adapter !== id || state?.kind !== 'nexus') {
      throw new Error(`session ${session.id} was not opened by the nexus adapter`);
    }
    if (state.closed) throw new Error(`session ${session.id} is closed`);
    return state;
  }

  const conversationPath = (state: NexusState) =>
    `/prompt-eval/golden-conversations/${encodeURIComponent(state.conversationId)}`;

  /** Every generation of the session's traces, read whole, once the platform has finished writing them. */
  async function readGenerations(state: NexusState, last: Generated) {
    const session = await api().get(
      `/emulator/${encodeURIComponent(state.deploymentId)}/sessions/${encodeURIComponent(last.sessionId)}`,
    );
    const chatId = field(session.data, 'chatId', 'the emulator session');
    const deadline = Date.now() + traceWaitMs;
    for (;;) {
      const read = await readTrace(chatId);
      if (read.complete) return { chatId, ...read };
      if (Date.now() >= deadline) {
        throw new AdapterTransportError(
          `the trace of emulator session ${last.sessionId} is not complete after ${traceWaitMs} ms`,
        );
      }
      await sleep(pollIntervalMs);
    }
  }

  async function readTrace(chatId: string) {
    const listed = await api().get('/tracing/traces', {
      conversationId: chatId,
      sortBy: 'startedAt',
      order: 'asc',
      limit: 100,
    });
    const traces = rows(listed, 'the trace list');
    const generations: Generation[] = [];
    let complete = traces.length > 0;
    for (const trace of traces) {
      const traceId = field(trace, 'id', 'a trace');
      if (trace.status === 'IN_PROGRESS') complete = false;
      for (const row of await generationRows(traceId)) {
        const detail = await api().get(
          `/tracing/generations/${encodeURIComponent(field(row, 'id', 'a generation'))}`,
        );
        if (!isPlainObject(detail.data)) {
          throw new AgentFailure(`generation ${String(row.id)} is not an object`);
        }
        const generation = detail.data as Generation;
        if (generation.status === 'PENDING' || generation.status === 'RUNNING') complete = false;
        generations.push(generation);
      }
    }
    return { complete, traceIds: traces.map((trace) => String(trace.id)), generations };
  }

  /** The generations of one trace; the trace read lists the first 100, so a longer trace is paged. */
  async function generationRows(traceId: string): Promise<Record<string, unknown>[]> {
    const detail = await api().get(`/tracing/traces/${encodeURIComponent(traceId)}`);
    if (!isPlainObject(detail.data)) throw new AgentFailure(`trace ${traceId} is not an object`);
    const listed = Array.isArray(detail.data.generations)
      ? detail.data.generations.filter(isPlainObject)
      : [];
    const count =
      typeof detail.data.generationCount === 'number' ? detail.data.generationCount : listed.length;
    if (count <= listed.length) return listed;
    const all: Record<string, unknown>[] = [];
    for (let page = 1; all.length < count; page++) {
      const answer = await api().get('/tracing/generations', {
        traceId,
        sortBy: 'startedAt',
        order: 'asc',
        limit: 100,
        page,
      });
      const batch = rows(answer, 'the generation list');
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  /** The payloads a stub workflow received since the session opened, newest first: its executions' trigger data. */
  async function* stubPayloads(state: NexusState, workflowId: string): AsyncGenerator<unknown> {
    const since = new Date(Date.parse(state.openedAt) - CLOCK_MARGIN_MS).toISOString();
    for (let page = 1; page <= EXECUTION_PAGES; page++) {
      const listed = await api().get('/workflows/executions', {
        workflowId,
        startDate: since,
        sortBy: 'createdAt',
        order: 'desc',
        limit: EXECUTION_PAGE,
        page,
      });
      const executions = rows(listed, 'the execution list');
      for (const execution of executions) {
        const executionId = field(execution, 'id', 'an execution');
        const detail = await api().get(`/workflows/executions/${encodeURIComponent(executionId)}`);
        yield isPlainObject(detail.data) ? detail.data.triggerData : undefined;
      }
      if (executions.length < EXECUTION_PAGE) return;
    }
  }

  return {
    id,
    version: `${NEXUS_ADAPTER_VERSION}+${contentHash(baseUrl)}`,
    capabilities: () => ({ ...capabilities }),

    async open(given) {
      const history = copyHistory(given.prefix);
      const target = given.target;
      if (target.prompt !== undefined) {
        // The platform runs its own prompt variants; this adapter never uploads prompt text.
        const { name, version } = target.prompt;
        throw new Error(
          `the nexus adapter runs a prompt variant of the platform: push ${name}@${version} to the agent as a variant and name it in target.variant`,
        );
      }
      const agentId = required(target.agent, 'target.agent: the agent id');
      const deploymentId = required(target.deployment, 'target.deployment: a deployment id of that agent');
      const stubs = readStubs(target);
      const created = await api().post('/prompt-eval/golden-conversations', {
        agentId,
        deploymentId,
        title: `driftbench ${given.hash.slice(0, 12)}`,
        description:
          'Created by the driftbench nexus adapter for one evaluated conversation. Safe to delete.',
        ...(target.variant === undefined ? {} : { variant: target.variant }),
      });
      const conversationId = field(created.data, 'id', 'the created golden conversation');
      const state: NexusState = {
        kind: 'nexus',
        conversationId,
        deploymentId,
        stubs,
        openedAt: new Date().toISOString(),
        closed: false,
        blocks: 0,
        calls: [],
      };
      return {
        id: conversationId,
        adapter: id,
        target,
        given,
        history,
        state,
      };
    },

    async send(session, turn) {
      copyHistory(session.history);
      const state = own(session);
      const path = conversationPath(state);
      const messages = stimulusMessages(turn.stimulus);
      const progress: NonNullable<NexusState['progress']> =
        state.progress?.index === turn.index
          ? state.progress
          : { index: turn.index, added: 0, accepted: false };
      state.progress = progress;
      for (; progress.added < messages.length; progress.added++) {
        await api().post(`${path}/turns/user`, { text: messages[progress.added]?.content ?? '' });
      }
      if (!progress.generated) {
        const started = performance.now();
        const answer = await api().post(`${path}/generate`, undefined, generateTimeoutMs);
        const where = `POST ${path}/generate`;
        progress.generated = {
          block: state.blocks + 1,
          sessionId: field(answer.data, 'sessionId', where),
          candidate: readCandidate(isPlainObject(answer.data) ? answer.data.candidate : undefined, where),
          latencyMs: Math.round(performance.now() - started),
        };
      }
      const generated = progress.generated;
      if (!progress.accepted) {
        await api().post(`${path}/accept`);
        progress.accepted = true;
      }
      state.progress = undefined;
      state.last = generated;
      state.blocks = generated.block;
      state.calls.push(
        ...generated.candidate.toolCalls.map((call) => ({
          block: generated.block,
          label: call.name,
          input: call.input,
        })),
      );
      return observedFromCandidate(generated.candidate, generated.latencyMs, {
        conversationId: state.conversationId,
        sessionId: generated.sessionId,
      });
    },

    async trace(session) {
      const state = own(session);
      const last = state.last;
      if (!last) throw new Error(`session ${session.id} has no block to trace yet`);
      const read = await readGenerations(state, last);
      const observed = observedFromGenerations(read.generations, last.candidate, {
        conversationId: state.conversationId,
        sessionId: last.sessionId,
        chatId: read.chatId,
        traceIds: read.traceIds,
        generationIds: read.generations.map((generation) => generation.id),
      });
      // The traced calls replace the candidate's for that block: the same calls, read from the trace.
      state.calls = [
        ...state.calls.filter((call) => call.block !== last.block),
        ...observed.toolCalls.map((call) => ({ block: last.block, label: call.label, input: call.input })),
      ];
      return observed;
    },

    async endState(session, source) {
      const state = own(session);
      const read = readSource(source, id);
      if ('all' in read) {
        // Each call of a stubbed tool claims the oldest payload it carries that no earlier call claimed.
        const received = new Map<string, { payload: unknown; claimed: boolean }[]>();
        const payloads: ToolPayload[] = [];
        for (const call of state.calls) {
          const workflowId = state.stubs[call.label];
          if (workflowId === undefined) continue;
          let list = received.get(call.label);
          if (!list) {
            list = [];
            for await (const payload of stubPayloads(state, workflowId)) {
              list.unshift({ payload, claimed: false });
            }
            received.set(call.label, list);
          }
          const entry = list.find(
            (candidate) => !candidate.claimed && carries(candidate.payload, call.input),
          );
          if (!entry) continue;
          entry.claimed = true;
          payloads.push({ tool: call.label, input: structuredClone(entry.payload) });
        }
        return payloads;
      }
      const workflowId = state.stubs[read.tool];
      if (workflowId === undefined) {
        throw new Error(
          `no recording stub for tool ${read.tool}: name its workflow id in target.options.stubs`,
        );
      }
      const sent = state.calls.filter((call) => call.label === read.tool);
      if (sent.length === 0) return undefined;
      for await (const payload of stubPayloads(state, workflowId)) {
        if (sent.some((call) => carries(payload, call.input))) return structuredClone(payload);
      }
      return undefined;
    },

    async close(session) {
      const state = session.state as NexusState | undefined;
      if (state?.kind !== 'nexus' || state.closed) return;
      state.closed = true;
      if (!options.keepConversations) await api().delete(conversationPath(state));
    },
  };
}

/**
 * True when a stub received this call: every field the agent sent is in the payload with the same value.
 * The payload may hold more fields than the call, such as defaults the workflow added.
 */
function carries(received: unknown, sent: unknown): boolean {
  if (isPlainObject(received) && isPlainObject(sent)) {
    return Object.entries(sent).every(
      ([key, value]) => value === undefined || canonicalJson(received[key]) === canonicalJson(value),
    );
  }
  return received !== undefined && canonicalJson(received) === canonicalJson(sent);
}

function readStubs(target: TargetRef): Record<string, string> {
  const stubs = target.options?.stubs;
  if (stubs === undefined) return {};
  if (!isPlainObject(stubs) || !Object.values(stubs).every((value) => typeof value === 'string')) {
    throw new Error(
      'target.options.stubs maps a tool label to the id of the workflow that records its payloads',
    );
  }
  return { ...(stubs as Record<string, string>) };
}

function required(value: string | undefined, what: string): string {
  if (value === undefined || value.trim() === '') throw new Error(`the nexus adapter needs ${what}`);
  return value;
}

function field(value: unknown, key: string, where: string): string {
  const found = isPlainObject(value) ? value[key] : undefined;
  if (typeof found !== 'string' || found === '') {
    throw new AgentFailure(`${where} carries no ${key}: the platform answer changed shape`);
  }
  return found;
}

function rows(answer: Answer, where: string): Record<string, unknown>[] {
  if (!Array.isArray(answer.data)) {
    throw new AgentFailure(`${where} is not a list: the platform answer changed shape`);
  }
  return answer.data.filter(isPlainObject);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
