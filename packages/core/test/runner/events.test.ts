import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it, vi } from 'vitest';
import { type RunEvent, runSpec } from '../../src/runner';
import { acmeSpec, loadAcmeConversations, minimalChecks, realAcmeAdapter } from './support';

const loaded = await loadAcmeConversations();
const spec = acmeSpec(loaded, 'acme-new-customer-coverage');
const driver = createScriptedDriver();

describe('runSpec reports its events as they happen', () => {
  it('emits a start and an end for every block, the tool calls between them, and the run end last', async () => {
    const events: RunEvent[] = [];
    const run = await runSpec(spec, {
      adapter: realAcmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      onEvent: (event) => events.push(event),
    });
    const starts = events.filter((event) => event.type === 'block_start');
    const ends = events.filter((event) => event.type === 'block_end');
    expect(starts).toHaveLength(run.blocks.length);
    expect(ends).toHaveLength(run.blocks.length);
    const calls = events.filter((event) => event.type === 'tool_call');
    expect(calls.length).toBe(run.blocks.reduce((sum, block) => sum + block.observed.toolCalls.length, 0));
    expect(events.at(-1)).toMatchObject({ type: 'run_end', status: run.status });
    const firstStart = events.findIndex((event) => event.type === 'block_start');
    const firstEnd = events.findIndex((event) => event.type === 'block_end');
    expect(firstStart).toBeLessThan(firstEnd);
  });
});

describe('model calls on the event stream carry their token counts and latency', () => {
  it('a model call reported on a segment is an event with its tokens, usd and latency, and its own end time', async () => {
    const events: RunEvent[] = [];
    const inner = realAcmeAdapter();
    const adapter = {
      ...inner,
      async send(session: never, turn: never) {
        const observed = await inner.send(session, turn);
        return {
          ...observed,
          segments: observed.segments.map((segment, i) =>
            i === 0
              ? { ...segment, cost: { inputTokens: 120, outputTokens: 40, usd: 0.0021 }, latencyMs: 640 }
              : segment,
          ),
        };
      },
    } as typeof inner;
    // A clock that moves a millisecond on every reading: a start and an end taken from two readings differ.
    let tick = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => tick++);
    try {
      await runSpec(spec, {
        adapter,
        driver,
        checks: minimalChecks,
        mode: 'F',
        repeat: 0,
        onEvent: (event) => events.push(event),
      });
    } finally {
      clock.mockRestore();
    }
    const calls = events.filter((event) => event.type === 'model_call');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toMatchObject({
      type: 'model_call',
      index: 0,
      inputTokens: 120,
      outputTokens: 40,
      usd: 0.0021,
      latencyMs: 640,
    });
    expect(typeof (calls[0] as { at: string }).at).toBe('string');
    const call = calls[0] as { at: string; startedAt: string; latencyMs: number };
    expect(Date.parse(call.at) - Date.parse(call.startedAt)).toBe(640);
  });
});

describe('recordEvents keeps the events on the run record', () => {
  it('a run with recordEvents has its events on the record, in order and ending with run_end', async () => {
    const run = await runSpec(spec, {
      adapter: realAcmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      recordEvents: true,
    });
    expect(run.events?.[0]?.type).toBe('block_start');
    expect(run.events?.at(-1)).toMatchObject({ type: 'run_end', status: run.status });
  });

  it('a run without recordEvents has no events field', async () => {
    const run = await runSpec(spec, {
      adapter: realAcmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
    });
    expect(run.events).toBeUndefined();
  });
});
