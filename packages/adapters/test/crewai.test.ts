import { readFileSync } from 'node:fs';
import { AdapterTransportError, AgentFailure, type Session } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
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
