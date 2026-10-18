import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { describeSpec } from '../../src/index';

// Fictional data only. The agent says which origin its session was opened with.
const agent = () =>
  functionAdapter<string | undefined>({
    create: (given) => given.origin,
    respond: (_messages, _world, _vars, origin) => {
      const text = `origin ${origin ?? 'none'}, reference LD-4471`;
      return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: { usd: 0 }, latencyMs: 0 };
    },
  });

describeSpec('packages/vitest/test/fixtures/blast-wire3-origin.yaml', agent);
describeSpec('packages/vitest/test/fixtures/blast-wire3-origin-alone.yaml', agent);
