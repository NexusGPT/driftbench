import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message, Observed, ResolvedGiven, TargetPrompt, TargetRef } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anthropicAdapter } from '../src/anthropic/index';
import { functionAdapter } from '../src/function/index';
import { googleAdapter } from '../src/google/index';
import { httpAdapter } from '../src/http/index';
import { langgraphAdapter } from '../src/langgraph/index';
import { nexusAdapter } from '../src/nexus/index';
import { openaiAgentsAdapter } from '../src/openai-agents/index';
import { processAdapter, processProtocolFiles } from '../src/process/index';
import { promptMessages } from '../src/shared/index';
import { acmeGiven, sendUser } from './contract';
import { fakeAnthropic } from './fixtures/sdk/anthropic';
import { fakeGoogle } from './fixtures/sdk/google';
import { fakeGraph } from './fixtures/sdk/langgraph';
import { acmeAgent, fakeRunner } from './fixtures/sdk/openai-agents';

/** Fictional data only: a prompt of the Acme Telecom sales assistant, as `--prompt` restores it. */
const PROMPT: TargetPrompt = {
  name: 'acme-sales',
  version: 2,
  hash: 'b'.repeat(64),
  text: 'You are the Acme Telecom sales assistant.\nAnswer in one message.\n',
};

const reply = (text: string): Observed => ({
  segments: [{ type: 'text', text }],
  text,
  toolCalls: [],
  cost: { usd: 0 },
  latencyMs: 0,
});

describe('target.prompt on the function adapter', () => {
  it('hands the prompt text to the agent in its context, and nothing without one', async () => {
    const seen: (string | undefined)[] = [];
    const adapter = functionAdapter({
      respond: (_messages, _world, _vars, _state, context) => {
        seen.push(context.prompt);
        expect(context.target.adapter).toBe('function');
        return reply('Hello from Acme.');
      },
    });
    const withPrompt = await adapter.open(
      acmeGiven({ adapter: 'function', agent: 'acme-sales', prompt: PROMPT }),
    );
    await sendUser(adapter, withPrompt, 'Hello', 0);
    const without = await adapter.open(acmeGiven({ adapter: 'function', agent: 'acme-sales' }));
    await sendUser(adapter, without, 'Hello', 0);
    expect(seen).toEqual([PROMPT.text, undefined]);
  });
});

describe('target.prompt on the process adapter', () => {
  let parent = '';
  beforeAll(async () => {
    parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-prompt-test-')));
  });
  afterAll(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  const given = (target: TargetRef): ResolvedGiven => ({
    prefix: [],
    ledger: {},
    world: { workspace: { files: { 'README.txt': 'Acme ops workspace.\n' } } },
    vars: {},
    target,
    hash: 'given-prompt',
  });

  it('writes the prompt to a file the agent finds through DRIFTBENCH_PROMPT_FILE, kept out of the diff', async () => {
    const adapter = processAdapter({
      command: 'sh',
      args: [
        '-c',
        'cat "$DRIFTBENCH_PROMPT_FILE"; printf "|%s" "$(wc -c < "$DRIFTBENCH_PROMPT_FILE" | tr -d " ")"',
      ],
      provider: localProvider({ dir: join(parent, 'boxes') }),
    });
    const session = await adapter.open(given({ adapter: 'process', agent: 'acme-ops', prompt: PROMPT }));
    try {
      const observed = await sendUser(adapter, session, 'Build the sheet.', 0);
      expect(observed.text).toBe(`${PROMPT.text}|${Buffer.byteLength(PROMPT.text)}`);
      expect(observed.workspaceDiff).toEqual({ created: [], changed: [], deleted: [] });
      expect(processProtocolFiles.prompt).toBe('driftbench-prompt.txt');
    } finally {
      await adapter.close(session);
    }
  });

  it('sets no prompt variable and writes no prompt file without a prompt', async () => {
    const adapter = processAdapter({
      command: 'sh',
      args: ['-c', 'printf "[%s]" "$DRIFTBENCH_PROMPT_FILE"; ls'],
      provider: localProvider({ dir: join(parent, 'boxes') }),
      keep: true,
    });
    const session = await adapter.open(given({ adapter: 'process', agent: 'acme-ops' }));
    try {
      const observed = await sendUser(adapter, session, 'Build the sheet.', 0);
      expect(observed.text.startsWith('[]')).toBe(true);
      expect(observed.text).not.toContain('driftbench-prompt.txt');
    } finally {
      await adapter.close(session);
    }
  });
});

describe('target.prompt on the other adapters', () => {
  it('puts the prompt first in the history as a system message', () => {
    const history: Message[] = [{ role: 'user', content: 'Hello' }];
    expect(promptMessages(history, { adapter: 'http', prompt: PROMPT })).toEqual([
      { role: 'system', content: PROMPT.text },
      { role: 'user', content: 'Hello' },
    ]);
    expect(promptMessages(history, { adapter: 'http' })).toBe(history);
  });

  it('http: the request carries target.prompt and a leading system message', async () => {
    const bodies: Record<string, unknown>[] = [];
    const adapter = httpAdapter({
      url: 'http://localhost:3000/chat',
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(reply('Hello from Acme.')), { status: 200 });
      },
    });
    const session = await adapter.open(acmeGiven({ adapter: 'http', prompt: PROMPT }));
    await sendUser(adapter, session, 'Hello', 0);
    expect(bodies[0]?.target).toMatchObject({ prompt: PROMPT });
    expect((bodies[0]?.messages as Message[] | undefined)?.[0]).toEqual({
      role: 'system',
      content: PROMPT.text,
    });
  });

  it('nexus: refuses a prompt text it cannot send, and names the variant to use instead', async () => {
    const adapter = nexusAdapter({
      env: { NEXUS_API_KEY: 'not-a-real-key' },
      fetch: async () => new Response('{}'),
    });
    await expect(
      adapter.open(acmeGiven({ adapter: 'nexus', agent: 'agent-1', prompt: PROMPT })),
    ).rejects.toThrow(
      /runs a prompt variant of the platform: push acme-sales@2 to the agent as a variant and name it in target\.variant/,
    );
  });

  it('anthropic and google: the prompt text replaces the configured system prompt', async () => {
    const anthropic = fakeAnthropic();
    const a = anthropicAdapter({ client: anthropic, model: 'claude-fake-acme', system: 'configured' });
    await sendUser(a, await a.open(acmeGiven({ adapter: 'anthropic', prompt: PROMPT })), 'Hello', 0);
    expect(anthropic.requests[0]?.system).toBe(PROMPT.text);
    const google = fakeGoogle();
    const g = googleAdapter({ client: google, model: 'gemini-fake-acme', system: 'configured' });
    await sendUser(g, await g.open(acmeGiven({ adapter: 'google', prompt: PROMPT })), 'Hello', 0);
    expect(google.requests[0]?.config?.systemInstruction).toBe(PROMPT.text);
  });

  it('openai-agents and langgraph: the input starts with a system message of the prompt text', async () => {
    const runner = fakeRunner();
    const o = openaiAgentsAdapter({ runner, agent: acmeAgent() });
    await sendUser(o, await o.open(acmeGiven({ adapter: 'openai-agents', prompt: PROMPT })), 'Hello', 0);
    expect((runner.calls[0]?.input as unknown[] | undefined)?.[0]).toEqual({
      role: 'system',
      content: PROMPT.text,
    });
    const graph = fakeGraph({ checkpointed: false });
    const l = langgraphAdapter({ graph });
    await sendUser(l, await l.open(acmeGiven({ adapter: 'langgraph', prompt: PROMPT })), 'Hello', 0);
    expect(graph.invocations[0]?.input[0]).toMatchObject({ content: PROMPT.text });
  });
});
