import { readFileSync } from 'node:fs';
import {
  AdapterTransportError,
  AgentFailure,
  type Message,
  type Session,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { ToolLabels } from '../src/anthropic/common';
import { PYDANTIC_AI_BRIDGE } from '../src/pydantic-ai/bridge-source';
import { pydanticAiAdapter, pydanticSegments, toPydanticMessages } from '../src/pydantic-ai/index';
import { type ExecLike, readBridgeReply, spawnExec } from '../src/shared/bridge';
import { acmeGiven, adapterContract, COVERAGE_QUESTION, expectWholeObserved, sendUser } from './contract';
import { fakePydanticBridge } from './fixtures/frameworks/python';
import { ACME_SIDE_EFFECTS, ACME_TOOL_NAMES } from './fixtures/sdk/acme-model';

const recorded = readFileSync(
  new URL('./fixtures/frameworks/recorded/pydantic-ai-run.txt', import.meta.url),
  'utf8',
);

adapterContract(
  'pydantic-ai',
  () =>
    pydanticAiAdapter({
      agent: 'acme.agent:sales',
      exec: fakePydanticBridge(),
      toolLabels: ACME_TOOL_NAMES,
      sideEffects: ACME_SIDE_EFFECTS,
      deterministic: true,
    }),
  {
    brokenTransport: () => pydanticAiAdapter({ agent: 'acme.agent:sales', python: '/no/such/python' }),
    released: (session: Session) => (session.state as { closed?: boolean }).closed === true,
  },
);

const given = acmeGiven({ adapter: 'pydantic-ai' });
const labels = new ToolLabels(ACME_TOOL_NAMES);
const replying =
  (stdout: string, exitCode = 0): ExecLike =>
  async () => ({ stdout, stderr: 'a traceback line', exitCode });

describe('pydantic-ai adapter', () => {
  it("reads the new messages the real bridge printed: text, a tool return, a retry prompt as the call's error", () => {
    const answer = readBridgeReply({ stdout: recorded, stderr: '', exitCode: 0 }, 'the agent');
    const segments = pydanticSegments(answer as unknown[], labels);
    expect(segments.map((segment) => segment.type)).toEqual([
      'text',
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'text',
    ]);
    expect(segments[1]).toMatchObject({
      type: 'tool_call',
      id: 'call_1',
      label: 'coverage.check',
      input: { address: '3 Orchard Way' },
    });
    expect(segments[2]).toMatchObject({
      type: 'tool_result',
      output: { found: true, address: '3 Orchard Way' },
    });
    expect(segments[4]).toMatchObject({ type: 'tool_result', label: 'broken', error: 'address unknown' });
    expect(segments[0]?.cost).toEqual({ inputTokens: 56, outputTokens: 16 });
  });

  it("sends the block text as the prompt and the earlier turns in Pydantic AI's format, and skips a banner on stdout", async () => {
    const exec = fakePydanticBridge();
    const adapter = pydanticAiAdapter({
      agent: 'acme.agent:sales',
      exec,
      toolLabels: ACME_TOOL_NAMES,
      cwd: '/srv/acme',
    });
    const session = await adapter.open(given);
    const first = await sendUser(adapter, session, COVERAGE_QUESTION, 0);
    expectWholeObserved(first);
    expect(first.toolCalls.map((call) => call.label)).toEqual(['coverage.check', 'catalog.search']);
    session.history.push({
      role: 'assistant',
      content: first.text,
      tool_calls: first.toolCalls.map((call) => ({
        id: call.id,
        label: call.label,
        input: call.input as never,
        output: call.output as never,
      })),
    });
    await sendUser(adapter, session, 'Acme Fiber 300, please.', 1);
    const request = JSON.parse(exec.requests[1]?.input ?? '{}');
    expect(request.user_prompt).toBe('Acme Fiber 300, please.');
    expect(request.message_history.map((message: { kind: string }) => message.kind)).toEqual([
      'request',
      'response',
      'request',
      'response',
    ]);
    expect(request.message_history[1].parts[0]).toMatchObject({
      part_kind: 'tool-call',
      tool_name: 'coverage_check',
    });
    expect(exec.requests[0]?.args[1]).toBe('acme.agent:sales');
    expect(exec.requests[0]?.env).toEqual({ PYTHONPATH: '/srv/acme' });
  });

  it('encodes an earlier failed call as a retry prompt and a system message as a system prompt part', () => {
    const history: Message[] = [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Coverage?' },
      {
        role: 'assistant',
        content: 'It is down.',
        tool_calls: [{ id: 'c1', label: 'coverage.check', input: { address: 'x' }, error: 'timeout' }],
      },
    ];
    expect(toPydanticMessages(history, labels)).toEqual([
      {
        kind: 'request',
        parts: [
          { part_kind: 'system-prompt', content: 'Be brief.' },
          { part_kind: 'user-prompt', content: 'Coverage?' },
        ],
      },
      {
        kind: 'response',
        parts: [
          { part_kind: 'tool-call', tool_name: 'coverage_check', args: { address: 'x' }, tool_call_id: 'c1' },
        ],
      },
      {
        kind: 'request',
        parts: [
          { part_kind: 'retry-prompt', content: 'timeout', tool_name: 'coverage_check', tool_call_id: 'c1' },
        ],
      },
      { kind: 'response', parts: [{ part_kind: 'text', content: 'It is down.' }] },
    ]);
  });

  it('turns a bridge error with a 429 or a 5xx into a transport error the runner retries, anything else into the agent failing', async () => {
    const run = async (exec: ExecLike) => {
      const adapter = pydanticAiAdapter({ agent: 'a:b', exec });
      return sendUser(adapter, await adapter.open(given), 'hi', 0).catch((error: unknown) => error);
    };
    const limited = await run(
      replying('driftbench-error {"type":"ModelHTTPError","message":"rate limited","status":429}\n', 3),
    );
    expect(limited).toBeInstanceOf(AdapterTransportError);
    expect(limited).toMatchObject({ status: 429 });
    expect(
      await run(
        replying('driftbench-error {"type":"ModelHTTPError","message":"overloaded","status":529}\n', 3),
      ),
    ).toBeInstanceOf(AdapterTransportError);
    expect(
      await run(
        replying('driftbench-error {"type":"APIConnectionError","message":"Connection error."}\n', 3),
      ),
    ).toBeInstanceOf(AdapterTransportError);
    expect(
      await run(replying('driftbench-error {"type":"UserError","message":"no such tool","status":400}\n', 3)),
    ).toBeInstanceOf(AgentFailure);
    const silent = await run(replying('', 1));
    expect(silent).toBeInstanceOf(AgentFailure);
    expect((silent as Error).message).toContain('exited 1 without a result: a traceback line');
  });

  it('runs a real process: stdin in, the result line out, and a missing interpreter as a transport error', async () => {
    const script =
      "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log('noise');console.log('driftbench-result '+JSON.stringify([{kind:'response',parts:[{part_kind:'text',content:'echo: '+r.user_prompt}]}]))})";
    const reply = await spawnExec({
      command: process.execPath,
      args: ['-e', script],
      input: JSON.stringify({ user_prompt: 'hi' }),
      timeoutMs: 20_000,
    });
    expect(reply.exitCode).toBe(0);
    expect(readBridgeReply(reply, 'node')).toEqual([
      { kind: 'response', parts: [{ part_kind: 'text', content: 'echo: hi' }] },
    ]);
    const missing = await spawnExec({
      command: '/no/such/python',
      args: [],
      input: '',
      timeoutMs: 5_000,
    }).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(AdapterTransportError);
    expect(missing).toMatchObject({ exhausted: true });
  });

  it('ships the bridge it documents: the embedded text equals bridge.py', () => {
    const file = readFileSync(new URL('../src/pydantic-ai/bridge.py', import.meta.url), 'utf8');
    expect(PYDANTIC_AI_BRIDGE).toBe(file);
  });
});
