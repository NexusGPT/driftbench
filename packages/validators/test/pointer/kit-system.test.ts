import { describe, expect, it } from 'vitest';
import { DENSE_SYSTEM, TARGET_RULE } from '../../src/ladders/pointer/kit/fixture';

// The Haiku fixtures are built by the kit, and a replay finds an answer only when the kit's request equals the
// reader's. The system text is the part that drifts when the reader's answer contract changes.
const reader = async () =>
  (await import('@agent-nexus/driftbench-estate')).pointer as Record<string, unknown>;

describe('the kit builds the Haiku request the reader sends', () => {
  it('uses the reader system text and target rule, word for word', async () => {
    const pointer = await reader();
    expect(DENSE_SYSTEM).toBe(pointer.DENSE_SYSTEM);
    expect(TARGET_RULE).toBe(pointer.TARGET_RULE);
  });
});
