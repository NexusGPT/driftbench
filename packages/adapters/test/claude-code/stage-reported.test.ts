import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type Observed,
  type ObservedCache,
  type RunMode,
  runSpec,
  Spec,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it, vi } from 'vitest';
import { mapSession, parseJsonl, replayAdapter } from '../../src/claude-code';

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 9, 0, seconds)).toISOString();
const lines = (records: unknown[]) => parseJsonl(records.map((record) => JSON.stringify(record)).join('\n'));
const modes = ['T', 'F', 'P'] as const;

function session(steps: { at: string; step: string }[]) {
  return mapSession({
    transcript: lines([
      { type: 'user', timestamp: at(10), message: { role: 'user', content: 'Plan the sheet.' } },
      { type: 'assistant', timestamp: at(11), message: { content: [{ type: 'text', text: 'Ready.' }] } },
      { type: 'user', timestamp: at(20), message: { role: 'user', content: 'Continue.' } },
      { type: 'assistant', timestamp: at(21), message: { content: [{ type: 'text', text: 'Ready.' }] } },
    ]),
    steps: lines(steps),
  });
}

function replay(steps: { at: string; step: string }[], mode: RunMode, reported?: boolean) {
  const spec = Spec.parse({
    id: 'pre-turn-stage',
    kind: 'conversation',
    stages: ['plan'],
    blocks: [
      {
        when: { user: 'Plan the sheet.' },
        expect: { stage: 'plan', ...(reported === undefined ? {} : { stage_reported: reported }) },
      },
      { when: { user: 'Continue.' }, expect: { stage: 'plan', stage_reported: true } },
    ],
  });
  return runSpec(spec, {
    adapter: replayAdapter({ session: session(steps) }),
    driver: createScriptedDriver(),
    checks: defaultChecks(),
    mode,
    repeat: 0,
  });
}

describe('replay stage reporting provenance', () => {
  it.each(modes)('%s: invalidates legacy cached stages and caches the corrected failure', async (mode) => {
    const mapped = session([{ at: at(9), step: 'plan' }]);
    const legacy = structuredClone(mapped);
    for (const block of legacy.blocks) {
      for (const entry of block.observed.runtime?.stages ?? []) delete entry.carried;
    }
    const spec = Spec.parse({
      id: 'cached-pre-turn-stage',
      kind: 'conversation',
      stages: ['plan'],
      blocks: [{ when: { user: 'Plan the sheet.' }, expect: { stage: 'plan', stage_reported: true } }],
    });
    const entries = new Map<string, Observed>();
    const cache: ObservedCache = {
      async cacheGet(key) {
        return structuredClone(entries.get(key));
      },
      async cachePut(key, observed) {
        entries.set(key, structuredClone(observed));
      },
    };
    const run = (adapter: AgentAdapter) =>
      runSpec(spec, {
        adapter,
        driver: createScriptedDriver(),
        checks: defaultChecks(),
        mode,
        repeat: 0,
        cache,
      });
    const seeded = await run({ ...replayAdapter({ session: legacy }), version: '0.1.0' });
    expect(seeded.status).toBe('completed');
    expect(seeded.blocks[0]?.pass).toBe(true);
    expect(entries.size).toBe(1);

    const current = replayAdapter({ session: mapped });
    const send = vi.spyOn(current, 'send');
    const refreshed = await run(current);
    expect(refreshed.blocks[0]?.verdicts.find((verdict) => verdict.id === 'stage.reported')?.outcome).toBe(
      'fail',
    );
    expect(refreshed.blocks[0]?.verdicts.find((verdict) => verdict.id === 'stage.reached')?.outcome).toBe(
      'pass',
    );
    expect(refreshed.cacheHit).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(entries.size).toBe(2);

    const cached = await run(current);
    expect(cached.cacheHit).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(cached.blocks[0]?.verdicts).toEqual(refreshed.blocks[0]?.verdicts);
    expect(cached.blocks[0]?.observed.runtime?.stages).toEqual([{ name: 'plan', at: at(9), carried: true }]);
  });

  it.each(modes)('%s: a pre-turn stage is carried state, not a report in either block', async (mode) => {
    const result = await replay([{ at: at(9), step: 'plan' }], mode, true);
    expect(result.status).toBe('completed');
    expect(result.blocks).toHaveLength(2);
    for (const block of result.blocks) {
      expect(block.verdicts.find((verdict) => verdict.id === 'stage.reported')).toMatchObject({
        outcome: 'fail',
        gating: true,
      });
    }
    expect(result.blocks[0]?.verdicts.find((verdict) => verdict.id === 'stage.reached')?.outcome).toBe(
      'pass',
    );
    expect(result.blocks[0]?.observed.runtime?.stages).toEqual([{ name: 'plan', at: at(9), carried: true }]);
    expect(result.blocks[1]?.observed.runtime?.stages).toEqual([]);
  });

  it.each(modes)(
    '%s: omitted and false reporting flags preserve the legacy first-block verdict',
    async (mode) => {
      for (const flag of [undefined, false]) {
        const result = await replay([{ at: at(9), step: 'plan' }], mode, flag);
        expect(result.status).toBe('completed');
        expect(result.blocks[0]?.pass).toBe(true);
        expect(result.blocks[0]?.stageObserved).toBe('plan');
        expect(result.blocks[0]?.verdicts.filter((verdict) => verdict.name === 'stage')).toEqual([
          expect.objectContaining({
            id: 'stage.reached',
            outcome: 'pass',
            evidence: 'reached plan, expected plan (stages in this block: plan)',
          }),
        ]);
      }
    },
  );

  it.each(modes)('%s: reports at a block start count only in that block', async (mode) => {
    const result = await replay(
      [
        { at: at(9), step: 'plan' },
        { at: at(10), step: 'plan' },
        { at: at(20), step: 'plan' },
      ],
      mode,
      true,
    );
    expect(result.status).toBe('completed');
    expect(result.blocks.map((block) => block.pass)).toEqual([true, true]);
    expect(result.blocks[0]?.observed.runtime?.stages).toEqual([
      { name: 'plan', at: at(9), carried: true },
      { name: 'plan', at: at(10) },
    ]);
    expect(result.blocks[1]?.observed.runtime?.stages).toEqual([{ name: 'plan', at: at(20) }]);
  });
});
