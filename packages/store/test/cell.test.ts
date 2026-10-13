import { cellId as coreCellId } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { cellId } from '../src/index';
import { run } from './fixtures';

/**
 * The store has no cell id of its own: it exports the runner's, from @agent-nexus/driftbench-core, where the format,
 * key order and field cases are tested. Here only the link is held, so the two can never drift apart.
 */
describe('cellId', () => {
  it("is core's cellId, so a resumed campaign finds the runs the runner filed", () => {
    expect(cellId).toBe(coreCellId);
    const stored = run();
    expect(stored.runId).toBe(coreCellId(stored));
  });
});
