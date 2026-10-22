import type { Atom } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { reached } from '../src/commands/estate-stats';

const reference = {
  id: 'reference.a',
  kind: 'reference',
  title: 'tide table',
  fields: { path: 'refs/tide.md' },
} as unknown as Atom;
const observed = (over: Record<string, unknown>) => ({
  segments: [],
  text: '',
  toolCalls: [],
  cost: {},
  latencyMs: 0,
  ...over,
});

describe('reach in the estate statistics', () => {
  it('counts a reference a helper read as reached', () => {
    const read = { label: 'Read', input: { file_path: '/work/refs/tide.md' }, actor: 'helper' };
    expect(reached(reference, [observed({ helperCalls: [read] }) as never])).toBe(true);
  });

  it('does not reach a reference nobody read', () => {
    expect(reached(reference, [observed({}) as never])).toBe(false);
  });
});
