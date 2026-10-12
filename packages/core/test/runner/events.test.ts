import { createScriptedDriver } from '@driftbench/users';
import { describe, expect, it } from 'vitest';
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
    await runSpec(spec, {
      adapter,
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      onEvent: (event) => events.push(event),
    });
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
  });
});
