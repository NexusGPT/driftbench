import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Message, WorldState } from '@agent-nexus/driftbench-core';
import { type AcmeStore, createAcmeAgent, createStore } from '../../../../../examples/acme/src/index';
import type { ChatMessage } from '../../../src/http/index';

/**
 * A local endpoint that speaks the http adapter's protocol and answers with the Acme agent.
 *
 * - `POST /turn` decodes the chat messages back into driftbench messages, runs the session's Acme agent (one
 *   store per session id) with the block's world, and answers with its Observed.
 * - `POST /end-state` answers `{ state }`: for `tool:<label>` the last payload that tool accepted, or 404;
 *   for `*` every payload, in order, as `{ tool, input }`.
 * - `POST /close` drops the session's store.
 * - `POST /status/<code>` answers that status; `POST /not-json` answers text; `POST /silent` never answers.
 * - Any other path answers with the chat completions queued by `queueCompletion`, one per request.
 */

export type AcmeHttpServer = {
  readonly url: string;
  readonly base: string;
  readonly requests: { path: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }[];
  readonly closedSessions: Set<string>;
  queueCompletion(...bodies: unknown[]): void;
  stop(): Promise<void>;
};

export async function startAcmeServer(): Promise<AcmeHttpServer> {
  const stores = new Map<string, AcmeStore>();
  const closedSessions = new Set<string>();
  const requests: AcmeHttpServer['requests'] = [];
  const completions: unknown[] = [];
  const hanging = new Set<ServerResponse>();

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBody(request);
    const path = request.url ?? '/';
    requests.push({ path, headers: request.headers, body });
    const store = (session: unknown) => {
      const key = String(session);
      let found = stores.get(key);
      if (!found) {
        found = createStore();
        stores.set(key, found);
      }
      return found;
    };

    if (path === '/turn') {
      const messages = fromChatMessages(body.messages as ChatMessage[]);
      const agent = createAcmeAgent(store(body.session));
      const observed = await agent.respond(messages, body.world as WorldState);
      return send(response, 200, observed);
    }
    if (path === '/end-state') {
      const payloads = store(body.session).payloads;
      if (body.source === '*') {
        return send(response, 200, { state: payloads.map(({ tool, input }) => ({ tool, input })) });
      }
      const label = /^tool:(.+)$/.exec(String(body.source))?.[1];
      const payload = [...payloads].reverse().find((entry) => entry.tool === label);
      return payload ? send(response, 200, { state: payload.input }) : send(response, 404, { error: 'none' });
    }
    if (path === '/close') {
      stores.delete(String(body.session));
      closedSessions.add(String(body.session));
      return send(response, 200, { closed: true });
    }
    const status = /^\/status\/(\d{3})$/.exec(path)?.[1];
    if (status) return send(response, Number(status), { error: `status ${status} on purpose` });
    if (path === '/not-json') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('this is not json');
      return;
    }
    if (path === '/silent') {
      hanging.add(response);
      return;
    }
    const next = completions.shift();
    return next === undefined
      ? send(response, 500, { error: 'no completion queued' })
      : send(response, 200, next);
  }

  // An agent that throws answers 500 with its message, as an endpoint would, instead of hanging.
  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) =>
      send(response, 500, { error: error instanceof Error ? error.message : String(error) }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  return {
    url: `${base}/turn`,
    base,
    requests,
    closedSessions,
    queueCompletion: (...bodies) => completions.push(...bodies),
    async stop() {
      for (const response of hanging) response.destroy();
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await closed;
    },
  };
}

/** An address that refuses connections: a port that was free a moment ago. */
export async function deadUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}/turn`;
}

/**
 * The chat messages back into driftbench messages: an assistant's `tool_calls`, the `tool` messages that
 * answer them and the assistant text after them become one assistant message with recorded tool calls.
 */
export function fromChatMessages(chat: readonly ChatMessage[]): Message[] {
  const out: Message[] = [];
  for (let index = 0; index < chat.length; index++) {
    const message = chat[index] as ChatMessage;
    if (message.role !== 'assistant' || !message.tool_calls?.length) {
      out.push({ role: message.role as Message['role'], content: message.content ?? '' });
      continue;
    }
    const calls: NonNullable<Message['tool_calls']> = message.tool_calls.map((call) => ({
      id: call.id,
      label: call.function.name,
      input: JSON.parse(call.function.arguments),
    }));
    let next = index + 1;
    for (; chat[next]?.role === 'tool'; next++) {
      const answer = chat[next] as ChatMessage;
      const call = calls.find((entry) => entry.id === answer.tool_call_id);
      const value = JSON.parse(answer.content ?? 'null');
      if (!call) continue;
      if (
        value !== null &&
        typeof value === 'object' &&
        'error' in value &&
        Object.keys(value).length === 1
      ) {
        call.error = String(value.error);
      } else {
        call.output = value;
      }
    }
    let content = '';
    const after = chat[next];
    if (after?.role === 'assistant' && !after.tool_calls?.length) {
      content = after.content ?? '';
      next++;
    }
    out.push({ role: 'assistant', content, tool_calls: calls });
    index = next - 1;
  }
  return out;
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
