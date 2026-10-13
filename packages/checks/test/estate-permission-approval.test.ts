import type { CheckContext, Observed } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { permission } from '../src/checks/estate';

const rule = { effect: 'ask', rule: 'Bash(git commit:*)' };
const at = (second: number) => `2026-10-12T09:00:${String(second).padStart(2, '0')}.000Z`;
const call = { id: 'call-a', label: 'Bash', input: { command: 'git commit -m fixture' }, startedAt: at(3) };
const request = {
  line: 2,
  record: {
    type: 'system',
    subtype: 'permission_request',
    requestId: call.id,
    tool: call.label,
    input: call.input,
    timestamp: at(1),
  },
};
const decision = {
  line: 3,
  record: {
    type: 'system',
    subtype: 'permission_decision',
    requestId: call.id,
    decision: 'allow',
    timestamp: at(2),
  },
};
function context(kept: unknown[] = [request, decision], calls = [call]): CheckContext {
  return {
    blockIndex: 0,
    observed: {
      text: '',
      segments: [],
      cost: {},
      latencyMs: 0,
      toolCalls: calls,
      raw: { runtime: 'claude-code', kept },
    } as Observed,
  } as CheckContext;
}
async function result(ctx = context()) {
  const out = await permission(ctx, rule);
  return Array.isArray(out) ? out[0] : out;
}

describe('ask permission requires a matching request and prior decision', () => {
  it('passes only with a matching request and grant before the protected call', async () => {
    expect(await result()).toMatchObject({ outcome: 'pass', gating: true });
  });
  it.each([
    ['neither', []],
    ['request only', [request]],
    ['decision only', [decision]],
  ])('stays inconclusive and gating with %s evidence', async (_name, records) => {
    expect(await result(context(records))).toMatchObject({ outcome: 'inconclusive', gating: true });
  });
  it.each([
    ['denied', { ...decision.record, decision: 'deny' }],
    ['unknown decision', { ...decision.record, decision: 'yes' }],
    ['wrong request id', { ...decision.record, requestId: 'unrelated' }],
    ['late decision', { ...decision.record, timestamp: at(4) }],
    ['decision before request', { ...decision.record, timestamp: at(0) }],
    ['missing decision time', { ...decision.record, timestamp: undefined }],
    ['invalid decision time', { ...decision.record, timestamp: 'invalid' }],
    ['assistant claim', { ...decision.record, type: 'assistant' }],
  ])('does not pass %s', async (_name, record) => {
    expect((await result(context([request, { ...decision, record }])))?.outcome).not.toBe('pass');
  });
  it.each([
    ['wrong tool', { ...request.record, tool: 'Edit' }],
    ['different input', { ...request.record, input: { command: 'git commit -m other' } }],
    ['late request', { ...request.record, timestamp: at(4) }],
    ['missing request time', { ...request.record, timestamp: undefined }],
    ['assistant request', { ...request.record, type: 'assistant' }],
  ])('does not pass %s', async (_name, record) => {
    expect((await result(context([{ ...request, record }, decision])))?.outcome).not.toBe('pass');
  });
  it('rejects a denial after an earlier grant and a request after its decision in the transcript', async () => {
    expect(
      (
        await result(
          context([
            request,
            decision,
            { line: 4, record: { ...decision.record, decision: 'deny', timestamp: at(2) } },
          ]),
        )
      )?.outcome,
    ).toBe('fail');
    expect((await result(context([{ ...request, line: 4 }, decision])))?.outcome).not.toBe('pass');
  });
  it('requires a protected call and approval for every protected call', async () => {
    expect((await result(context([request, decision], [])))?.outcome).toBe('fail');
    expect((await result(context([request, decision], [call, { ...call, id: 'call-b' }])))?.outcome).not.toBe(
      'pass',
    );
    expect(
      (
        await result(
          context([request, decision], [{ ...call, startedAt: undefined } as unknown as typeof call]),
        )
      )?.outcome,
    ).toBe('inconclusive');
  });
  it('does not weaken the command pattern to the bare tool', async () => {
    expect(
      (await result(context([request, decision], [{ ...call, input: { command: 'echo unrelated' } }])))
        ?.outcome,
    ).toBe('fail');
  });
  it('compares input objects independently of property order', async () => {
    const input = { command: call.input.command, cwd: '/work/fixture' };
    const records = [
      { ...request, record: { ...request.record, input: { cwd: input.cwd, command: input.command } } },
      decision,
    ];
    expect((await result(context(records, [{ ...call, input }])))?.outcome).toBe('pass');
  });
});
