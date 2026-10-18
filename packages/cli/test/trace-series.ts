import type { Trace } from '@agent-nexus/driftbench-adapters';
import { mulberry32 } from '@agent-nexus/driftbench-stats';

/**
 * A synthetic production series, fictional: `windows` hourly windows from 2026-03-02T00:00Z, `perWindow`
 * one-turn conversations in each, latency normal with `mean` ms and `sd` ms, `shiftAt` the first window
 * where the mean becomes `shifted`. Tokens and cost ride along. Deterministic for a seed.
 */
export type SeriesPlan = {
  seed: number;
  windows?: number;
  perWindow?: number;
  mean?: number;
  sd?: number;
  shiftAt?: number;
  shifted?: number;
};

export const START = Date.UTC(2026, 2, 2);
export const HOUR = 3_600_000;

export function seriesTraces(plan: SeriesPlan): Trace[] {
  const random = mulberry32(plan.seed);
  const normal = () => {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const windows = plan.windows ?? 60;
  const perWindow = plan.perWindow ?? 6;
  const traces: Trace[] = [];
  for (let window = 0; window < windows; window += 1) {
    const mean =
      plan.shiftAt !== undefined && window >= plan.shiftAt ? (plan.shifted ?? 1500) : (plan.mean ?? 1200);
    for (let n = 0; n < perWindow; n += 1) {
      const at = START + window * HOUR + Math.floor(random() * (HOUR - 60_000));
      const latency = Math.max(50, Math.round(mean + (plan.sd ?? 300) * normal()));
      traces.push({
        id: `conv-${window}-${n}`,
        source: 'otel',
        startedAt: new Date(at).toISOString(),
        turns: [
          {
            user: 'Can I get more data on my plan?',
            startedAt: new Date(at).toISOString(),
            observed: {
              segments: [{ type: 'text', text: 'Yes, Acme Mobile M has 40 GB.' }],
              text: 'Yes, Acme Mobile M has 40 GB.',
              toolCalls: [],
              cost: { usd: 0.001, inputTokens: 400, outputTokens: 30 },
              latencyMs: latency,
            },
          },
        ],
        issues: [],
      });
    }
  }
  return traces;
}

/** The same series as OTLP JSON Lines: one document per conversation, one chat span each. */
export function seriesOtlp(traces: readonly Trace[]): string {
  return traces
    .map((trace, index) => {
      const turn = trace.turns[0];
      const start = BigInt(Date.parse(turn?.startedAt ?? '')) * 1_000_000n;
      const end = start + BigInt(Math.round((turn?.observed.latencyMs ?? 0) * 1e6));
      const attributes = Object.entries({
        'gen_ai.operation.name': { stringValue: 'chat' },
        'gen_ai.response.model': { stringValue: 'example-model-1' },
        'gen_ai.conversation.id': { stringValue: trace.id },
        'gen_ai.input.messages': {
          stringValue: JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: turn?.user }] }]),
        },
        'gen_ai.output.messages': {
          stringValue: JSON.stringify([
            { role: 'assistant', parts: [{ type: 'text', content: turn?.observed.text }] },
          ]),
        },
        'gen_ai.usage.input_tokens': { intValue: '400' },
        'gen_ai.usage.output_tokens': { intValue: '30' },
      }).map(([key, value]) => ({ key, value }));
      const span = {
        traceId: index.toString(16).padStart(32, '0'),
        spanId: index.toString(16).padStart(16, '0'),
        name: 'chat example-model-1',
        startTimeUnixNano: start.toString(),
        endTimeUnixNano: end.toString(),
        attributes,
      };
      return JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] });
    })
    .join('\n');
}
