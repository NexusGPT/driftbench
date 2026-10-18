import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { RunResult } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import {
  blockStatus,
  capabilityGap,
  compoundingIndex,
  runOutcome,
  runSpec,
  succession,
} from '../../src/runner';
import { acmeAdapter, acmeSpec, loadAcmeConversations, specOf } from './support';

const loaded = await loadAcmeConversations();
const driver = createScriptedDriver();
const NO_STUBS = { toolStubs: false };
const NO_PREFIX = { seedPrefix: false };

/** Two blocks; the second starts from a prefix the spec writes. */
const withPrefix = specOf({
  id: 'prefix-at-block-1',
  blocks: [
    { when: { user: 'Hi, I want home internet at 12 Oak Street, Acmeville.' } },
    {
      when: { user: 'Yes, the 500 one please.' },
      given: {
        prefix: [
          { role: 'user', content: 'Hi, I want home internet at 12 Oak Street, Acmeville.' },
          { role: 'assistant', content: 'Fiber is available there. Which plan would you like?' },
        ],
      },
    },
    { when: { user: 'Thanks.' } },
  ],
});

describe('the capability check: a layer the adapter cannot apply is not_run, never a silent drop', () => {
  it('a forced tool result on an adapter without toolStubs: every block not_run, the agent never called', async () => {
    const spec = acmeSpec(loaded, 'acme-tool-failure');
    const adapter = acmeAdapter({ capabilities: NO_STUBS });
    const run = await runSpec(spec, { adapter, driver, checks: defaultChecks(), mode: 'F', repeat: 0 });
    expect(RunResult.safeParse(run).success).toBe(true);
    expect(run.blocks).toHaveLength(spec.blocks.length);
    for (const block of run.blocks) {
      expect(block.status).toBe('not_run');
      expect(block.pass).toBe(false);
      expect(block.verdicts).toEqual([]);
      expect(block.notRun).toMatchObject({ kind: 'unsupported', check: 'capability', layer: '5 world' });
    }
    expect(run.blocks[0]?.notRun?.expected).toContain('toolStubs');
    expect(run.blocks[1]?.notRun?.got).toContain('block 0 was not run');
    expect(adapter.calls.send).toBe(0);
    expect(runOutcome(run)).toBe('not_run');
    // Not run is never drift: the succession counts no failing block.
    expect(run.succession.driftCount).toBe(0);
    expect(run.succession.minOverBlocks).toBe(false);
  });

  it('the same spec on an adapter with toolStubs runs as before: no status on any block', async () => {
    const spec = acmeSpec(loaded, 'acme-tool-failure');
    const adapter = acmeAdapter();
    const run = await runSpec(spec, { adapter, driver, checks: defaultChecks(), mode: 'F', repeat: 0 });
    expect(adapter.calls.send).toBe(spec.blocks.length);
    for (const block of run.blocks) {
      expect(block.status).toBeUndefined();
      expect(block.notRun).toBeUndefined();
    }
  });

  it('a prefix on an adapter without seedPrefix: F runs block 0, then stops at the prefix', async () => {
    const adapter = acmeAdapter({ capabilities: NO_PREFIX });
    const run = await runSpec(withPrefix, { adapter, driver, checks: defaultChecks(), mode: 'F', repeat: 0 });
    expect(run.blocks.map(blockStatus)).toEqual([expect.stringMatching(/pass|fail/), 'not_run', 'not_run']);
    expect(run.blocks[1]?.notRun).toMatchObject({ layer: '1 history', check: 'capability' });
    expect(run.blocks[1]?.notRun?.expected).toContain('seedPrefix');
    expect(adapter.calls.send).toBe(1);
  });

  it('mode T: each block is judged alone, and a block after the prefix carries it too', async () => {
    const adapter = acmeAdapter({ capabilities: NO_PREFIX });
    const run = await runSpec(withPrefix, { adapter, driver, checks: defaultChecks(), mode: 'T', repeat: 0 });
    expect(run.blocks.map((block) => block.status)).toEqual([undefined, 'not_run', 'not_run']);
    expect(adapter.calls.send).toBe(1);
  });

  it('mode T: the canonical history of the blocks before needs seedPrefix too, never dropped', async () => {
    const plain = specOf({
      id: 'canonical-history',
      blocks: [
        { when: { user: 'Hi, I want home internet at 12 Oak Street, Acmeville.' } },
        { when: { user: 'Yes, the 500 one please.' } },
      ],
    });
    const adapter = acmeAdapter({ capabilities: NO_PREFIX });
    const run = await runSpec(plain, { adapter, driver, checks: defaultChecks(), mode: 'T', repeat: 0 });
    expect(run.blocks.map((block) => block.status)).toEqual([undefined, 'not_run']);
    expect(run.blocks[1]?.notRun).toMatchObject({
      kind: 'unsupported',
      check: 'capability',
      layer: '1 history',
    });
    expect(run.blocks[1]?.notRun?.expected).toBe(
      'the adapter applies the canonical history mode T builds from the blocks before (seedPrefix)',
    );
    expect(adapter.calls.send).toBe(1);
    // In mode F the agent's own session carries the history: both blocks run.
    const free = await runSpec(plain, {
      adapter: acmeAdapter({ capabilities: NO_PREFIX }),
      driver,
      checks: defaultChecks(),
      mode: 'F',
      repeat: 0,
    });
    expect(free.blocks.map((block) => block.status)).toEqual([undefined, undefined]);
  });

  it('mode T: a later block whose empty prefix clears the history runs', async () => {
    const cleared = specOf({
      id: 'prefix-cleared',
      blocks: [
        {
          when: { user: 'Yes, the 500 one please.' },
          given: {
            prefix: [{ role: 'user', content: 'Hi, I want home internet at 12 Oak Street, Acmeville.' }],
          },
        },
        { when: { user: 'Hi, I want home internet at 12 Oak Street, Acmeville.' }, given: { prefix: [] } },
      ],
    });
    const adapter = acmeAdapter({ capabilities: NO_PREFIX });
    const run = await runSpec(cleared, { adapter, driver, checks: defaultChecks(), mode: 'T', repeat: 0 });
    expect(run.blocks.map((block) => block.status)).toEqual(['not_run', undefined]);
    expect(adapter.calls.send).toBe(1);
  });

  it('the same prefix on an adapter with seedPrefix runs every block', async () => {
    const adapter = acmeAdapter();
    const run = await runSpec(withPrefix, { adapter, driver, checks: defaultChecks(), mode: 'T', repeat: 0 });
    expect(run.blocks.every((block) => block.status === undefined)).toBe(true);
    expect(adapter.calls.send).toBe(3);
  });

  it('a run with a block not run compares no end state, so a setup gap never reads as a fail', async () => {
    const base = acmeSpec(loaded, 'acme-plan-upgrade');
    expect(base.end_state).toBeDefined();
    const spec = {
      ...base,
      given: { ...base.given, world: { tools: { 'catalog.search': { result: [] } } } },
    };
    const run = await runSpec(spec, {
      adapter: acmeAdapter({ capabilities: NO_STUBS }),
      driver,
      checks: defaultChecks(),
      mode: 'F',
      repeat: 0,
    });
    expect(run.endState).toBeUndefined();
    expect(runOutcome(run)).toBe('not_run');
  });

  it('reports block_end with the status', async () => {
    const events: unknown[] = [];
    await runSpec(acmeSpec(loaded, 'acme-tool-failure'), {
      adapter: acmeAdapter({ capabilities: NO_STUBS }),
      driver,
      checks: defaultChecks(),
      mode: 'F',
      repeat: 0,
      onEvent: (event) => events.push(event),
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'block_end', index: 0, status: 'not_run' }),
    );
  });
});

describe('capabilityGap', () => {
  const caps = {
    variants: false,
    seedPrefix: true,
    toolStubs: true,
    trace: false,
    sandbox: false,
    endState: false,
    deterministic: true,
  };
  it('names the missing capability, and finds none when every layer is supported', () => {
    expect(
      capabilityGap('x', caps, { prefix: 'authored', world: { tools: { a: { error: 'e' } } } }),
    ).toBeUndefined();
    expect(capabilityGap('x', { ...caps, seedPrefix: false }, { world: {} })).toBeUndefined();
    expect(capabilityGap('x', { ...caps, toolStubs: false }, { world: { tools: {} } })).toBeUndefined();
    expect(capabilityGap('x', { ...caps, seedPrefix: false }, { prefix: 'authored', world: {} })?.got).toBe(
      'x declares seedPrefix false: the agent would never see it',
    );
    expect(
      capabilityGap('x', { ...caps, toolStubs: false }, { world: { tools: { a: { error: 'e' } } } })
        ?.expected,
    ).toBe('the adapter applies forced tool results (a) (toolStubs)');
  });
});

describe('verdict helpers', () => {
  const block = (pass: boolean, status?: 'not_run' | 'blocked') => ({ pass, ...(status ? { status } : {}) });
  const run = (blocks: ReturnType<typeof block>[], extra: Partial<RunResult> = {}) =>
    ({ status: 'completed', blocks, ...extra }) as unknown as RunResult;

  it('a record without status reads from pass', () => {
    expect(blockStatus({ pass: true })).toBe('pass');
    expect(blockStatus({ pass: false })).toBe('fail');
    expect(blockStatus({ pass: false, status: 'blocked' })).toBe('blocked');
  });

  it('a measured failure stands over a block not run; not_run outranks blocked', () => {
    expect(runOutcome(run([block(false), block(false, 'not_run')]))).toBe('fail');
    expect(runOutcome(run([block(true), block(false, 'not_run')]))).toBe('not_run');
    expect(runOutcome(run([block(true), block(false, 'blocked'), block(false, 'not_run')]))).toBe('not_run');
    expect(runOutcome(run([block(true), block(false, 'blocked')]))).toBe('blocked');
    expect(runOutcome(run([block(true)]))).toBe('pass');
    expect(runOutcome(run([block(true), block(false, 'not_run')], { status: 'failed' }))).toBe('fail');
    expect(runOutcome(run([]))).toBe('fail');
  });

  it('succession leaves unscored blocks out of the drift rate', () => {
    const blocks = [block(true), block(false), block(false, 'not_run'), block(false, 'blocked')].map(
      (entry, index) => ({ ...entry, index }),
    ) as unknown as RunResult['blocks'];
    const metrics = succession(blocks);
    expect(metrics.driftCount).toBe(1);
    expect(metrics.driftRate).toBe(0.5);
    expect(metrics.firstDriftBlock).toBe(1);
  });

  it('the compounding index rates each block over the runs that scored it', async () => {
    const spec = acmeSpec(loaded, 'acme-tool-failure');
    const tRun = await runSpec(spec, {
      adapter: acmeAdapter({ capabilities: NO_STUBS }),
      driver,
      checks: defaultChecks(),
      mode: 'T',
      repeat: 0,
    });
    const fRun = await runSpec(spec, {
      adapter: acmeAdapter(),
      driver,
      checks: defaultChecks(),
      mode: 'F',
      repeat: 0,
    });
    // Every T block was not run: no block has a T rate, so nothing is compared.
    expect(compoundingIndex([tRun, fRun]).specs).toEqual([]);
  });
});
