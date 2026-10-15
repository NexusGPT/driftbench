import { readFileSync } from 'node:fs';
import {
  AdapterTransportError,
  AgentFailure,
  canonicalGiven,
  type Message,
  resolveGiven,
  type Session,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { acmeSpec, loadAcmeConversations } from '../../core/test/runner/support';
import { CREWAI_BRIDGE } from '../src/crewai/bridge-source';
import { type CrewRun, crewaiAdapter, crewaiHttp, crewaiInputs, crewaiProcess } from '../src/crewai/index';
import { readBridgeReply } from '../src/shared/bridge';
import {
  acmeGiven,
  adapterContract,
  COVERAGE_QUESTION,
  expectWholeObserved,
  sendUser,
  userTurn,
} from './contract';
import { fakeCrewBridge } from './fixtures/frameworks/python';
import { ACME_SIDE_EFFECTS, ACME_TOOL_NAMES } from './fixtures/sdk/acme-model';

const recorded = readFileSync(
  new URL('./fixtures/frameworks/recorded/crewai-run.txt', import.meta.url),
  'utf8',
);

adapterContract(
  'crewai',
  () =>
    crewaiAdapter({
      transport: crewaiProcess({ crew: 'acme.crew:build', exec: fakeCrewBridge() }),
      toolLabels: ACME_TOOL_NAMES,
      sideEffects: ACME_SIDE_EFFECTS,
      deterministic: true,
    }),
  {
    brokenTransport: () =>
      crewaiAdapter({ transport: crewaiProcess({ crew: 'acme.crew:build', python: '/no/such/python' }) }),
    released: (session: Session) => (session.state as { closed?: boolean }).closed === true,
  },
);

const given = acmeGiven({ adapter: 'crewai' });
const TOKEN = ['crew', 'token', 'not', 'real', '42'].join('-');

describe('crewai adapter', () => {
  it('reads what the real bridge printed: the tools from the event bus, their outputs and errors, the task, the reply', async () => {
    const transport = {
      kind: 'process' as const,
      reportsTools: true,
      kickoff: async () => readBridgeReply({ stdout: recorded, stderr: '', exitCode: 0 }, 'crew') as CrewRun,
    };
    const adapter = crewaiAdapter({ transport, toolLabels: ACME_TOOL_NAMES });
    const observed = await sendUser(adapter, await adapter.open(given), COVERAGE_QUESTION, 0);
    expectWholeObserved(observed);
    expect(observed.toolCalls[0]).toMatchObject({
      label: 'coverage.check',
      input: { address: '3 Orchard Way, Acmeville' },
      output: { found: true, address_id: 'addr-102', address: '3 Orchard Way, Acmeville' },
    });
    expect(observed.toolCalls.slice(1).map((call) => call.error)).toEqual([
      'address unknown',
      'address unknown',
      'address unknown',
    ]);
    expect(observed.text).toBe('3 Orchard Way, Acmeville has fiber up to 300 Mbps.');
    expect(observed.runtime?.stages).toEqual([{ name: 'answer' }]);
  });

  it('hands the crew the block text, the earlier turns as text and the history as JSON', async () => {
    const exec = fakeCrewBridge();
    const adapter = crewaiAdapter({
      transport: crewaiProcess({ crew: 'acme.crew:build', exec, cwd: '/srv/acme' }),
      toolLabels: ACME_TOOL_NAMES,
    });
    const session = await adapter.open(
      acmeGiven({ adapter: 'crewai' }, {}, [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there.' },
      ]),
    );
    await sendUser(adapter, session, COVERAGE_QUESTION, 0);
    const { inputs } = JSON.parse(exec.requests[0]?.input ?? '{}');
    expect(inputs.message).toBe(COVERAGE_QUESTION);
    expect(inputs.history).toBe('user: Hello\nassistant: Hi there.');
    expect(JSON.parse(inputs.messages)).toHaveLength(3);
    expect(exec.requests[0]?.args[1]).toBe('acme.crew:build');
    expect(
      crewaiInputs(
        [
          { role: 'user', content: 'a' },
          { role: 'user', content: 'b' },
        ],
        userTurn(0, 'b', given),
      ).message,
    ).toBe('a\nb');
  });

  it('refuses a prefix whose tool calls the spec states as a record, on the default text inputs', async () => {
    const prefix = [
      { role: 'user' as const, content: 'Is fiber available at 3 Orchard Way?' },
      {
        role: 'assistant' as const,
        content: 'Yes.',
        tool_calls: [
          { id: 'c1', label: 'coverage.check', input: { address: '3 Orchard Way' }, output: { found: true } },
        ],
      },
    ];
    const exec = fakeCrewBridge();
    const plain = crewaiAdapter({ transport: crewaiProcess({ crew: 'acme.crew:build', exec }) });
    for (const origin of ['recorded', 'authored'] as const) {
      const refused = plain.open({ ...acmeGiven({ adapter: 'crewai' }, {}, prefix), origin });
      await expect(refused).rejects.toBeInstanceOf(AgentFailure);
      await expect(refused).rejects.toThrow(/1 recorded tool call.*as prose, not as tool results/);
    }
    expect(exec.requests).toHaveLength(0);
    // A canonical prefix, or one whose origin the spec does not state, goes to the crew as it always did.
    await expect(
      plain.open({ ...acmeGiven({ adapter: 'crewai' }, {}, prefix), origin: 'canonical' }),
    ).resolves.toBeDefined();
    await expect(plain.open(acmeGiven({ adapter: 'crewai' }, {}, prefix))).resolves.toBeDefined();
    // A crew given its own inputs takes the history its own way.
    const own = crewaiAdapter({
      transport: crewaiProcess({ crew: 'acme.crew:build', exec }),
      inputs: (history) => ({ message: 'x', messages: JSON.stringify(history) }),
    });
    await expect(
      own.open({ ...acmeGiven({ adapter: 'crewai' }, {}, prefix), origin: 'recorded' }),
    ).resolves.toBeDefined();
  });

  it('opens every mode T block of a tool spec: the canonical calls of earlier blocks are not refused', async () => {
    // The Acme plan upgrade: its blocks expect catalog.search and order.create, so the mode T prefixes of the
    // later blocks hold canonical calls. Mode T opens a session per block from its canonical Given.
    const spec = acmeSpec(await loadAcmeConversations(), 'acme-plan-upgrade');
    const adapter = crewaiAdapter({
      transport: crewaiProcess({ crew: 'acme.crew:build', exec: fakeCrewBridge() }),
      toolLabels: ACME_TOOL_NAMES,
    });
    const target = { adapter: 'crewai' };
    let canonicalCalls = 0;
    for (let index = 0; index < spec.blocks.length; index++) {
      const canonical = canonicalGiven(spec, index);
      canonicalCalls += canonical.prefix.reduce((n, message) => n + (message.tool_calls?.length ?? 0), 0);
      const session = await adapter.open(resolveGiven(canonical.state, canonical.prefix, target));
      await adapter.close(session);
    }
    // The spec is a real case: its canonical prefixes hold calls.
    expect(canonicalCalls).toBeGreaterThan(0);
  });

  it('in mode T, an origin covers only the prefix the spec wrote, never the canonical calls appended after it', async () => {
    const base = acmeSpec(await loadAcmeConversations(), 'acme-plan-upgrade');
    const target = { adapter: 'crewai' };
    const adapter = crewaiAdapter({
      transport: crewaiProcess({ crew: 'acme.crew:build', exec: fakeCrewBridge() }),
      toolLabels: ACME_TOOL_NAMES,
    });
    const opens = async (prefix: Message[], origin: 'recorded' | 'authored') => {
      // Block 0 writes the prefix and states its origin; every later block's mode T prefix starts with it.
      const spec = {
        ...base,
        blocks: base.blocks.map((block, index) =>
          index === 0 ? { ...block, given: { ...block.given, prefix, origin } } : block,
        ),
      };
      const outcomes: string[] = [];
      for (let index = 0; index < spec.blocks.length; index++) {
        const canonical = canonicalGiven(spec, index);
        const opened = await adapter.open(resolveGiven(canonical.state, canonical.prefix, target)).then(
          () => 'open',
          (cause: Error) => (cause instanceof AgentFailure ? 'refused' : String(cause)),
        );
        outcomes.push(opened);
      }
      return outcomes;
    };
    const prose: Message[] = [
      { role: 'user', content: 'Hi, I am an existing customer.' },
      { role: 'assistant', content: 'Welcome back. What is the email address on your account?' },
    ];
    const withCall: Message[] = [
      prose[0] as Message,
      {
        role: 'assistant',
        content: 'Welcome back.',
        tool_calls: [
          { id: 'c1', label: 'catalog.search', input: { category: 'mobile' }, output: { plans: [] } },
        ],
      },
    ];
    for (const origin of ['recorded', 'authored'] as const) {
      // A call-free prefix stated as a record: the canonical calls of later blocks are not the spec's record.
      expect(new Set(await opens(prose, origin)), origin).toEqual(new Set(['open']));
      // A prefix that holds a call the spec wrote is refused at every block that starts from it.
      expect(new Set(await opens(withCall, origin)), origin).toEqual(new Set(['refused']));
    }
  });

  it('kicks off a deployed crew over HTTP, polls its status until it completes, and never prints the token', async () => {
    const seen: { method: string; url: string; auth: string | null }[] = [];
    let polls = 0;
    const fetch = async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ method: init?.method ?? 'GET', url, auth: headers.get('authorization') });
      if (url.endsWith('/kickoff')) return Response.json({ kickoff_id: 'k-1' });
      polls += 1;
      if (polls === 1)
        return Response.json({
          status: 'running',
          current_task: 'answer',
          progress: { completed_tasks: 0, total_tasks: 1 },
        });
      return Response.json({
        status: 'completed',
        result: {
          output: 'We cover 3 Orchard Way.',
          tasks: [
            {
              task_id: 'answer',
              output: 'We cover 3 Orchard Way.',
              agent: 'Acme sales',
              execution_time: 1.2,
            },
          ],
        },
        execution_time: 1.4,
      });
    };
    const waits: number[] = [];
    const transport = crewaiHttp({
      url: 'https://acme-sales.crew.example/',
      token: TOKEN,
      fetch,
      sleep: async (ms) => void waits.push(ms),
    });
    const adapter = crewaiAdapter({ transport, sideEffects: ['order.create'] });
    expect(adapter.capabilities().endState, 'the HTTP API reports no tool calls to read payloads from').toBe(
      false,
    );
    const observed = await sendUser(adapter, await adapter.open(given), COVERAGE_QUESTION, 0);
    expect(observed.text).toBe('We cover 3 Orchard Way.');
    expect(observed.toolCalls).toEqual([]);
    expect(seen.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
      'POST https://acme-sales.crew.example/kickoff',
      'GET https://acme-sales.crew.example/status/k-1',
      'GET https://acme-sales.crew.example/status/k-1',
    ]);
    expect(seen[0]?.auth).toBe(`Bearer ${TOKEN}`);
    expect(waits).toEqual([2_000]);
  });

  it('maps the HTTP errors: 429 and 5xx retried with Retry-After, 401 and a failed run the agent', async () => {
    const send = async (fetch: (url: string, init?: RequestInit) => Promise<Response>) => {
      const adapter = crewaiAdapter({
        transport: crewaiHttp({
          url: 'https://acme.crew.example',
          token: TOKEN,
          fetch,
          sleep: async () => {},
        }),
      });
      return sendUser(adapter, await adapter.open(given), 'hi', 0).catch((error: unknown) => error);
    };
    const limited = await send(
      async () =>
        new Response(`{"error":"slow down ${TOKEN}"}`, { status: 429, headers: { 'retry-after': '5' } }),
    );
    expect(limited).toBeInstanceOf(AdapterTransportError);
    expect(limited).toMatchObject({ status: 429, retryAfterMs: 5_000 });
    expect((limited as Error).message).not.toContain(TOKEN);
    expect(await send(async () => new Response('{}', { status: 502 }))).toBeInstanceOf(AdapterTransportError);
    expect(await send(async () => new Response('{"error":"Unauthorized"}', { status: 401 }))).toBeInstanceOf(
      AgentFailure,
    );
    const failed = await send(async (url) =>
      url.endsWith('/kickoff')
        ? Response.json({ kickoff_id: 'k-2' })
        : Response.json({ status: 'error', error: 'Task execution failed' }),
    );
    expect(failed).toBeInstanceOf(AgentFailure);
    expect((failed as Error).message).toContain('Task execution failed');
  });

  it('ships the bridge it documents: the embedded text equals bridge.py', () => {
    const file = readFileSync(new URL('../src/crewai/bridge.py', import.meta.url), 'utf8');
    expect(CREWAI_BRIDGE).toBe(file);
  });
});
