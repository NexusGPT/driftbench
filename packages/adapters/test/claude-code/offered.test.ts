import { toolsOffered } from '@agent-nexus/driftbench-checks';
import type { CheckContext, Observed } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { mapSession, parseJsonl, type ReplayRaw } from '../../src/claude-code';

/** A fictional headless-run transcript: an optional init record, then two turns. */
function transcript(init: unknown[] | undefined, between?: unknown[]) {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 2, 9, 0, s)).toISOString();
  const records: unknown[] = [];
  const system = (tools: unknown[], s: number) => ({
    type: 'system',
    subtype: 'init',
    session_id: 'fixture',
    cwd: '/work/demo',
    model: 'model-fixture',
    tools,
    timestamp: at(s),
  });
  if (init) records.push(system(init, 0));
  records.push({ type: 'user', timestamp: at(1), message: { role: 'user', content: 'first ask' } });
  records.push({
    type: 'assistant',
    timestamp: at(2),
    message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'one' }] },
  });
  records.push({ type: 'user', timestamp: at(3), message: { role: 'user', content: 'second ask' } });
  if (between) records.push(system(between, 4));
  records.push({
    type: 'assistant',
    timestamp: at(5),
    message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'two' }] },
  });
  return mapSession({ transcript: parseJsonl(records.map((record) => JSON.stringify(record)).join('\n')) });
}

function check(observed: Observed, expect: { include?: string[]; exclude?: string[] }) {
  const ctx = { expect: { tools_offered: expect }, observed } as unknown as CheckContext;
  return toolsOffered.applies(ctx) ? toolsOffered.evaluate(ctx) : [];
}

describe('offered tools from the init record', () => {
  it('fills runtime.offered of every block from the init record, keeping only names', () => {
    const session = transcript(['Read', 'Edit', 'WebFetch', 7]);
    expect(session.blocks.map((block) => block.observed.runtime?.offered)).toEqual([
      ['Read', 'Edit', 'WebFetch'],
      ['Read', 'Edit', 'WebFetch'],
    ]);
    expect(session.meta.preamble.map((entry) => entry.reason)).toEqual([
      'the init record (its tools are the offered tools)',
    ]);
  });

  it('a later init record replaces the list from its block on', () => {
    const session = transcript(['Read', 'WebFetch'], ['Read']);
    expect(session.blocks.map((block) => block.observed.runtime?.offered)).toEqual([
      ['Read', 'WebFetch'],
      ['Read'],
    ]);
    expect(
      (session.blocks[1]?.observed.raw as ReplayRaw | undefined)?.kept.map((entry) => entry.reason),
    ).toEqual(['the init record (its tools are the offered tools)']);
  });

  it('without an init record the field is absent, never empty', () => {
    const session = transcript(undefined);
    for (const block of session.blocks) expect(block.observed.runtime).not.toHaveProperty('offered');
  });

  it('an init record that offers nothing gives an empty list, which is data', () => {
    expect(transcript([]).blocks[0]?.observed.runtime?.offered).toEqual([]);
  });

  it('the tools_offered check judges a replay: a WebFetch deny is seen, and no record is inconclusive', async () => {
    const offered = transcript(['Read', 'WebFetch']).blocks[0]?.observed as Observed;
    const denied = transcript(['Read']).blocks[0]?.observed as Observed;
    const unknown = transcript(undefined).blocks[0]?.observed as Observed;
    const outcome = async (observed: Observed) =>
      (await check(observed, { include: ['WebFetch'] })).map((verdict) => verdict.outcome);
    expect(await outcome(offered)).toEqual(['pass']);
    expect(await outcome(denied)).toEqual(['fail']);
    expect(await outcome(unknown)).toEqual(['inconclusive']);
  });
});
