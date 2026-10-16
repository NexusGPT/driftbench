import { defaultChecks } from '@agent-nexus/driftbench-checks';
import * as core from '@agent-nexus/driftbench-core';
import {
  AdapterTransportError,
  AgentFailure,
  type Check,
  type CheckContext,
  contentHash,
  type DriverStep,
  machineVerdict,
  type Observed,
  RunResult,
  type Spec,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
import { openMemoryStore, cellId as storeCellId } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { describe, expect, it } from 'vitest';
import * as runner from '../../src/runner';
import { blockCacheKey, cellId, runSpec } from '../../src/runner';
import {
  acmeAdapter,
  acmeSpec,
  broken,
  dropsFirstToolCall,
  echoAdapter,
  failures,
  loadAcmeConversations,
  memoryCache,
  minimalChecks,
  putCampaign,
  realAcmeAdapter,
  specOf,
} from './support';

const loaded = await loadAcmeConversations();
const driver = createScriptedDriver();
const noWait = { sleep: async () => {} };

/** A check that records the context of every block and judges nothing. */
function spy(): Check & { seen: CheckContext[] } {
  const seen: CheckContext[] = [];
  return {
    name: 'spy',
    seen,
    applies: () => true,
    evaluate: (ctx) => {
      seen.push(ctx);
      return [];
    },
  };
}

/** Every run must survive a trip through JSON and still validate, the way a store keeps it. */
function expectValid(run: RunResult): void {
  expect(RunResult.safeParse(run).success).toBe(true);
  expect(RunResult.safeParse(JSON.parse(JSON.stringify(run))).success).toBe(true);
}

describe('runSpec on the Acme conversations, free-running, with the real Acme agent', () => {
  it('runs all six conversation specs', () => {
    expect(loaded.map((entry) => entry.spec.id)).toEqual([
      'acme-new-customer-coverage',
      'acme-number-porting',
      'acme-off-topic-return',
      'acme-order-loose-confirmation',
      'acme-plan-upgrade',
      'acme-tool-failure',
    ]);
  });

  it.each(loaded.map((entry) => ({ id: entry.spec.id, spec: entry.spec, hash: entry.hash })))(
    '$id passes every machine check and its end state',
    async ({ spec, hash }) => {
      const adapter = acmeAdapter();
      const run = await runSpec(spec, { adapter, driver, checks: minimalChecks, mode: 'F', repeat: 0 });
      expectValid(run);
      expect(run.status, run.error).toBe('completed');
      expect(failures(run)).toEqual([]);
      expect(run.blocks).toHaveLength(spec.blocks.length);
      for (const block of run.blocks) {
        expect(block.verdicts.length, `block ${block.index} has no machine verdict`).toBeGreaterThan(0);
        expect(block.pass).toBe(true);
        expect(block.drift).toEqual([]);
        expect(block.ledgerCheck).toEqual({ ok: true, contradictions: [] });
        expect(block.stageObserved).toBe(spec.blocks[block.index]?.expect?.stage);
      }
      expect(run.specHash).toBe(hash);
      expect(run.specId).toBe(spec.id);
      expect(run.target).toEqual(spec.target);
      expect(run.succession).toEqual({
        driftCount: 0,
        driftRate: 0,
        longestClean: spec.blocks.length,
        minOverBlocks: true,
      });
      expect(run.endState).toEqual({ match: true, diff: [] });
      expect(run.cacheHit).toBe(false);
      expect(adapter.calls).toMatchObject({ open: 1, send: spec.blocks.length, close: 1 });
    },
  );

  it('sums cost and latency, and stamps the start and the end', async () => {
    const spec = acmeSpec(loaded, 'acme-tool-failure');
    const times = ['2026-10-11T10:00:00.000Z', '2026-10-11T10:00:05.000Z'];
    const run = await runSpec(spec, {
      adapter: acmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 2,
      now: () => new Date(times.shift() ?? 'invalid'),
      runId: 'run-1',
    });
    // coverage.check is forced to fail at 1500 ms from block 0 on and is tried twice in blocks 0 and 2.
    expect(run.blocks.map((block) => block.observed.latencyMs)).toEqual([3000, 0, 3000]);
    expect(run.latencyMs).toBe(6000);
    expect(run.cost).toBe(0);
    expect(run).toMatchObject({
      runId: 'run-1',
      repeat: 2,
      startedAt: '2026-10-11T10:00:00.000Z',
      finishedAt: '2026-10-11T10:00:05.000Z',
    });
  });
});

describe('the real stack: the function adapter of @agent-nexus/driftbench-adapters, defaultChecks of @agent-nexus/driftbench-checks', () => {
  it.each(loaded.map((entry) => ({ id: entry.spec.id, spec: entry.spec })))(
    '$id passes every machine check',
    async ({ spec }) => {
      const run = await runSpec(spec, {
        adapter: realAcmeAdapter(),
        driver,
        checks: defaultChecks(),
        mode: 'F',
        repeat: 0,
      });
      expectValid(run);
      expect(run.status, run.error).toBe('completed');
      expect(failures(run)).toEqual([]);
      expect(run.blocks).toHaveLength(spec.blocks.length);
      for (const block of run.blocks) {
        expect(block.pass).toBe(true);
        expect(block.verdicts.length).toBeGreaterThan(0);
        // What does not pass is never gating: a reply too short for the language detector.
        for (const verdict of block.verdicts.filter((each) => each.outcome !== 'pass')) {
          expect(verdict).toMatchObject({ id: 'lang.stable', outcome: 'inconclusive', gating: false });
        }
      }
      expect(run.endState).toEqual({ match: true, diff: [] });
    },
  );

  it('fails an agent that drops a tool call, on the tools check, with X5 drift', async () => {
    const run = await runSpec(acmeSpec(loaded, 'acme-plan-upgrade'), {
      adapter: realAcmeAdapter(dropsFirstToolCall),
      driver,
      checks: defaultChecks(),
      mode: 'F',
      repeat: 0,
    });
    expect(run.status).toBe('completed');
    expect(run.blocks.map((block) => block.pass)).toEqual([true, false, true, false, true]);
    expect(run.blocks[1]?.drift).toContain('X5_tool');
    expect(failures(run).map((line) => line.split(': ')[1])).toContain('tools.catalog.search.count');
    expect(run.succession).toMatchObject({ firstDriftBlock: 1, driftCount: 2, minOverBlocks: false });
  });
});

describe('the resolved Given', () => {
  it('merges the spec given forward, block by block, with the ledger seed and every earlier ledger_add', async () => {
    const spec = acmeSpec(loaded, 'acme-plan-upgrade');
    const watch = spy();
    await runSpec(spec, { adapter: acmeAdapter(), driver, checks: [watch], mode: 'F', repeat: 0 });
    const [b0, b1, b2] = watch.seen;
    expect(b0?.given.ledger).toEqual({ customer: 'existing', lang: 'EN' });
    expect(b1?.given.ledger).toEqual({ customer: 'existing', lang: 'EN' });
    expect(b1?.ledger).toEqual({
      customer: 'existing',
      lang: 'EN',
      customer_id: 'cust-001',
      current_plan: 'mobile-s',
    });
    expect(b2?.given.ledger).toEqual(b1?.ledger);
    expect(b2?.ledger).toEqual({ ...b1?.ledger, plan_id: 'mobile-l' });
    expect(b0?.given.target).toEqual({ adapter: 'function', agent: 'acme-sales' });
  });

  it('carries the history: block k starts from the user turns and replies before it', async () => {
    const spec = acmeSpec(loaded, 'acme-plan-upgrade');
    const watch = spy();
    const run = await runSpec(spec, {
      adapter: acmeAdapter(),
      driver,
      checks: [watch],
      mode: 'F',
      repeat: 0,
    });
    expect(watch.seen[0]?.given.prefix).toEqual([]);
    const prefix = watch.seen[2]?.given.prefix ?? [];
    expect(prefix.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(prefix[2]?.content).toBe("It's sam.rivera@example.com");
    expect(prefix[3]?.content).toBe(run.blocks[1]?.observed.text);
    expect(prefix[3]?.tool_calls?.map((call) => call.label)).toEqual(['catalog.search']);
    const hashes = run.blocks.map((block) => block.givenHash);
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const [index, ctx] of watch.seen.entries()) {
      const { hash, ...body } = ctx.given;
      expect(hash).toBe(contentHash(body));
      expect(run.blocks[index]?.givenHash).toBe(hash);
    }
  });

  it('applies a block world from that block onwards, over the spec world', async () => {
    const spec = acmeSpec(loaded, 'acme-tool-failure');
    const watch = spy();
    await runSpec(spec, { adapter: acmeAdapter(), driver, checks: [watch], mode: 'F', repeat: 0 });
    const tools = watch.seen.map((ctx) => Object.keys(ctx.given.world.tools ?? {}).sort());
    expect(tools).toEqual([
      ['coverage.check', 'notify_sales'],
      ['coverage.check', 'notify_sales'],
      ['coverage.check', 'notify_sales'],
    ]);
    expect(watch.seen[2]?.given.world.tools?.['coverage.check']).toEqual({
      error: 'coverage service timeout',
      latency_ms: 1500,
    });
  });

  it('opens a new session from a block that sets its own prefix', async () => {
    const spec = specOf({
      id: 'restart',
      blocks: [
        { user: 'one', expect: { must: ['ok'] } },
        {
          user: 'two',
          given: {
            prefix: [
              { role: 'user', content: 'earlier' },
              { role: 'assistant', content: 'reply' },
            ],
          },
          expect: { must: ['ok'] },
        },
      ],
    });
    const adapter = echoAdapter();
    const watch = spy();
    const run = await runSpec(spec, { adapter, driver, checks: [watch], mode: 'F', repeat: 0 });
    expect(run.status).toBe('completed');
    expect(adapter.opened).toEqual([
      { prefix: [] },
      {
        prefix: [
          { role: 'user', content: 'earlier' },
          { role: 'assistant', content: 'reply' },
        ],
      },
    ]);
    expect(watch.seen[1]?.given.prefix).toHaveLength(2);
  });
});

describe('the ledger check', () => {
  it('flags a fact a block adds with another value, and names it', async () => {
    const spec = specOf({
      id: 'ledger',
      ledger_seed: { lang: 'EN' },
      blocks: [
        { user: 'a', expect: { ledger_add: { plan: 'mobile-m' } } },
        { user: 'b', expect: { ledger_add: { plan: 'mobile-m', email: 'jo@example.com' } } },
        { user: 'c', expect: { ledger_add: { plan: 'mobile-l' } } },
      ],
    });
    const run = await runSpec(spec, { adapter: echoAdapter(), driver, checks: [], mode: 'F', repeat: 0 });
    expect(run.blocks.map((block) => block.ledgerCheck)).toEqual([
      { ok: true, contradictions: [] },
      { ok: true, contradictions: [] },
      { ok: false, contradictions: ['plan: the ledger holds "mobile-m", the block adds "mobile-l"'] },
    ]);
  });
});

describe('verdicts, pass and drift', () => {
  it('fails a known-bad agent that drops a tool call, with X5_tool drift', async () => {
    const spec = acmeSpec(loaded, 'acme-plan-upgrade');
    const run = await runSpec(spec, {
      adapter: acmeAdapter({ wrap: dropsFirstToolCall }),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
    });
    expectValid(run);
    expect(run.status).toBe('completed');
    expect(run.blocks.map((block) => block.pass)).toEqual([true, false, true, false, true]);
    expect(run.blocks[1]?.drift).toEqual(['X5_tool']);
    expect(failures(run)).toContain(
      'block 1: tools.catalog.search.count: catalog.search: expected exactly 1, saw 0',
    );
    expect(failures(run)).toContain(
      'block 3: tools.order.create.count: order.create: expected exactly 1, saw 0',
    );
    expect(run.succession).toEqual({
      firstDriftBlock: 1,
      driftCount: 2,
      driftRate: 0.4,
      longestClean: 1,
      minOverBlocks: false,
    });
  });

  it('fails the stage check when the runtime reports another stage', async () => {
    const spec = acmeSpec(loaded, 'acme-number-porting');
    const wrongStage = broken((observed) => {
      observed.runtime = { stages: [{ name: 'needs' }] };
    });
    const run = await runSpec(spec, {
      adapter: acmeAdapter({ wrap: wrongStage }),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
    });
    expect(run.blocks.every((block) => !block.pass)).toBe(true);
    expect(failures(run)[0]).toBe(
      'block 0: stage.port_number: expected port_number, the runtime reports needs',
    );
  });

  it('fails must and must_not when the reply changes', async () => {
    const spec = acmeSpec(loaded, 'acme-order-loose-confirmation');
    const invents = broken((observed) => {
      observed.text = 'Your order ORD-ABC123 is placed.';
      observed.segments = [{ type: 'text', text: observed.text }];
    });
    const run = await runSpec(spec, {
      adapter: acmeAdapter({ wrap: invents }),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
    });
    expect(failures(run)).toContain('block 2: must_not.0: /ORD-[0-9A-F]{6}/ is present');
    expect(failures(run)).toContain('block 0: must.0: /Acme Fiber 1000 is available/ is missing');
  });

  it('passes a block whose only failing verdict does not gate, with no drift, and names X4 for lang and cards', async () => {
    const spec = specOf({ id: 'drift', blocks: [{ user: 'a', expect: { must: ['ok'] } }] });
    const fixed = (verdicts: ReturnType<typeof machineVerdict>[]): Check => ({
      name: 'fixed',
      applies: () => true,
      evaluate: () => verdicts,
    });
    const soft = await runSpec(spec, {
      adapter: echoAdapter(),
      driver,
      checks: [fixed([machineVerdict('tools', 'x.count', 'fail', 'soft', { gating: false })])],
      mode: 'F',
      repeat: 0,
    });
    expect(soft.blocks[0]).toMatchObject({ pass: true, drift: [] });

    const format = await runSpec(spec, {
      adapter: echoAdapter(),
      driver,
      checks: [
        fixed([
          machineVerdict('lang', 'reply', 'fail', 'FR, expected EN'),
          machineVerdict('cards', 'offer.count', 'fail', 'sent twice'),
          machineVerdict('must', '0', 'fail', 'missing'),
        ]),
      ],
      mode: 'F',
      repeat: 0,
    });
    expect(format.blocks[0]).toMatchObject({ pass: false, drift: ['X1_local', 'X4_format'] });

    const unsure = await runSpec(spec, {
      adapter: echoAdapter(),
      driver,
      checks: [fixed([machineVerdict('judge', 'tone', 'inconclusive', 'no answer')])],
      mode: 'F',
      repeat: 0,
    });
    expect(unsure.blocks[0]).toMatchObject({ pass: false, drift: [] });
  });

  it.each([
    ['tools.order.create.count', ['X5_tool']],
    ['skills.xlsx.count', ['X5_tool']],
    ['guards.explicit_confirmation.block', ['X5_tool']],
    ['forbidden.port.check', ['X5_tool']],
    ['lang.reply', ['X4_format']],
    ['cards.offer.count', ['X4_format']],
    ['cards.one_message_per_turn', ['X4_format']],
    ['must.0', ['X1_local']],
    ['must_not.1', ['X1_local']],
    ['pii.email', ['X4_format']],
    ['safety.max_destructive_ops', ['X5_tool']],
    ['judge.no_invented_data', ['X1_local']],
    ['ledger.plan_id', ['X2_contradiction']],
    ['flow.stage', ['X3_flow']],
    ['execution.exit_code', ['X1_local']],
    ['unknown.thing', []],
    ['stage.reached', ['X3_flow']],
    ['forbidden.max_calls.coverage.check', ['X5_tool']],
    ['custom.tools.reply', []],
    ['artifacts.out/acme-price-sheet.xlsx.0.sheets', ['X1_local']],
    ['end_state.plan_id', ['X1_local']],
  ])('gives a failing %s verdict the drift %j', async (id, drift) => {
    const spec = specOf({ id: 'drift-map', blocks: [{ user: 'a', expect: { must: ['ok'] } }] });
    const [check, ...rest] = id.split('.');
    const failing: Check = {
      name: check ?? 'x',
      applies: () => true,
      evaluate: () => [machineVerdict(check ?? 'x', rest.join('.'), 'fail', 'planted failure')],
    };
    const run = await runSpec(spec, {
      adapter: echoAdapter(),
      driver,
      checks: [failing],
      mode: 'F',
      repeat: 0,
    });
    expect(run.blocks[0]?.verdicts[0]?.id).toBe(id);
    expect(run.blocks[0]?.drift).toEqual(drift);
  });

  it('turns a check that throws or returns a bad verdict into an inconclusive gating verdict', async () => {
    const spec = specOf({ id: 'bad-check', blocks: [{ user: 'a', expect: { must: ['ok'] } }] });
    const throws: Check = {
      name: 'boom',
      applies: () => true,
      evaluate: () => {
        throw new Error('the reader is missing');
      },
    };
    const malformed: Check = {
      name: 'shape',
      applies: () => true,
      evaluate: () => [
        { id: '', kind: 'machine', name: 'shape', gating: true, outcome: 'pass', evidence: '' },
      ],
    };
    const run = await runSpec(spec, {
      adapter: echoAdapter(),
      driver,
      checks: [throws, malformed],
      mode: 'F',
      repeat: 0,
    });
    expectValid(run);
    expect(run.status).toBe('completed');
    expect(run.blocks[0]?.pass).toBe(false);
    expect(run.blocks[0]?.verdicts.map((verdict) => [verdict.id, verdict.outcome, verdict.evidence])).toEqual(
      [
        ['boom.error', 'inconclusive', 'the check threw Error: the reader is missing'],
        [
          'shape.invalid',
          'inconclusive',
          'the check returned a verdict the schema refuses: id Too small: expected string to have >=1 characters',
        ],
      ],
    );
  });
});

describe('the end state', () => {
  it('reads it after the last block, gives it to that block only, and compares it field by field', async () => {
    const spec = acmeSpec(loaded, 'acme-plan-upgrade');
    const watch = spy();
    const adapter = acmeAdapter();
    const run = await runSpec(spec, { adapter, driver, checks: [watch], mode: 'F', repeat: 0 });
    expect(watch.seen.slice(0, -1).map((ctx) => ctx.endState)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(watch.seen.at(-1)?.endState).toEqual({
      type: 'upgrade',
      customer_id: 'cust-001',
      plan_id: 'mobile-l',
    });
    expect(adapter.calls.endState).toBe(1);
    // The run keeps the value read, so a later reader compares end states without reading them again.
    expect(run.endState).toEqual({ match: true, diff: [] });
    expect(run.endStateValue).toEqual({ type: 'upgrade', customer_id: 'cust-001', plan_id: 'mobile-l' });
  });

  it('reports a diff per field, and every unexpected field in exact mode', async () => {
    const base = acmeSpec(loaded, 'acme-plan-upgrade');
    const spec: Spec = {
      ...base,
      end_state: {
        source: 'tool:order.create',
        mode: 'exact',
        expect: { plan_id: 'mobile-m', type: 'upgrade' },
      },
    };
    const run = await runSpec(spec, { adapter: acmeAdapter(), driver, checks: [], mode: 'F', repeat: 0 });
    expect(run.endState).toEqual({
      match: false,
      diff: [
        { field: 'plan_id', expected: 'mobile-m', observed: 'mobile-l' },
        { field: 'customer_id', expected: { absent: true }, observed: 'cust-001' },
      ],
    });
    expect(run.endStateValue).toEqual({ type: 'upgrade', customer_id: 'cust-001', plan_id: 'mobile-l' });
  });

  it('reads every source of a list and names fields by source', async () => {
    const base = acmeSpec(loaded, 'acme-plan-upgrade');
    const spec: Spec = {
      ...base,
      end_state: [
        { source: 'tool:order.create', expect: { plan_id: 'mobile-l' } },
        { source: 'tool:notify_sales', expect: { reason: { nonempty: true } } },
      ],
    };
    const watch = spy();
    const run = await runSpec(spec, {
      adapter: acmeAdapter(),
      driver,
      checks: [watch],
      mode: 'F',
      repeat: 0,
    });
    expect(watch.seen.at(-1)?.endState).toEqual({
      'tool:order.create': { type: 'upgrade', customer_id: 'cust-001', plan_id: 'mobile-l' },
      'tool:notify_sales': undefined,
    });
    expect(run.endState).toEqual({
      match: false,
      diff: [{ field: 'tool:notify_sales.reason', expected: { nonempty: true }, observed: { absent: true } }],
    });
    expect(run.endStateValue).toEqual({
      'tool:order.create': { type: 'upgrade', customer_id: 'cust-001', plan_id: 'mobile-l' },
      'tool:notify_sales': undefined,
    });
  });

  it('reads source * for end_state none: an empty list passes, a recorded payload fails', async () => {
    const quiet = acmeAdapter();
    const watch = spy();
    const run = await runSpec(acmeSpec(loaded, 'acme-off-topic-return'), {
      adapter: quiet,
      driver,
      checks: [watch],
      mode: 'F',
      repeat: 0,
    });
    expect(quiet.calls.endState).toBe(1);
    expect(watch.seen.at(-1)?.endState).toEqual([]);
    expect(run.endState).toEqual({ match: true, diff: [] });
    expect(run.endStateValue).toEqual([]);

    const ordered = await runSpec(
      { ...acmeSpec(loaded, 'acme-plan-upgrade'), end_state: 'none' },
      { adapter: acmeAdapter(), driver, checks: [], mode: 'F', repeat: 0 },
    );
    expect(ordered.endState).toEqual({
      match: false,
      diff: [
        {
          field: '*.0',
          expected: { absent: true },
          observed: {
            tool: 'order.create',
            input: { type: 'upgrade', customer_id: 'cust-001', plan_id: 'mobile-l' },
          },
        },
      ],
    });
    expect(ordered.endStateValue).toEqual([
      { tool: 'order.create', input: { type: 'upgrade', customer_id: 'cust-001', plan_id: 'mobile-l' } },
    ]);
  });

  it('gives one diff entry per payload found under end_state none', async () => {
    const twice = { ...acmeSpec(loaded, 'acme-tool-failure'), end_state: 'none' as const };
    const run = await runSpec(twice, {
      adapter: acmeAdapter(),
      driver,
      checks: [],
      mode: 'F',
      repeat: 0,
      perturbationId: undefined,
    });
    // The stubbed notify_sales records one payload; the coverage check fails and records none.
    expect(run.endState?.match).toBe(false);
    expect(run.endState?.diff.map((entry) => entry.field)).toEqual(['*.0']);
    const store = acmeAdapter();
    const upgrade = await runSpec(
      {
        ...acmeSpec(loaded, 'acme-order-loose-confirmation'),
        end_state: 'none',
        perturbations: undefined,
      },
      { adapter: store, driver, checks: [], mode: 'F', repeat: 0 },
    );
    expect(
      upgrade.endState?.diff.map((entry) => [entry.field, (entry.observed as { tool: string }).tool]),
    ).toEqual([['*.0', 'order.create']]);
  });

  it('fails the end state, and says why, when the adapter cannot read one', async () => {
    const blind = acmeAdapter({ capabilities: { endState: false } });
    const unread = await runSpec(acmeSpec(loaded, 'acme-plan-upgrade'), {
      adapter: blind,
      driver,
      checks: [],
      mode: 'F',
      repeat: 0,
    });
    expect(blind.calls.endState).toBe(0);
    expect(unread.endState).toEqual({
      match: false,
      diff: [
        {
          field: 'tool:order.create',
          expected: 'an end state read through adapter.endState',
          observed: 'the adapter function cannot read end states',
        },
      ],
    });
  });
});

describe('failures', () => {
  const spec = () => acmeSpec(loaded, 'acme-plan-upgrade');

  it('retries a transport error with backoff, then goes on', async () => {
    const adapter = acmeAdapter();
    const send = adapter.send.bind(adapter);
    let failures = 2;
    adapter.send = async (session, turn) => {
      if (turn.index === 1 && failures > 0) {
        failures -= 1;
        throw new AdapterTransportError('socket hang up');
      }
      return send(session, turn);
    };
    const waits: number[] = [];
    const run = await runSpec(spec(), {
      adapter,
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      retry: { sleep: async (ms) => void waits.push(ms), jitter: false },
    });
    expect(run.status).toBe('completed');
    expect(waits).toEqual([500, 1_000]);
    expect(run.blocks[1]?.observed.retries?.map(({ at: _at, ...event }) => event)).toEqual([
      { call: 'send on block 1', attempt: 1, reason: 'AdapterTransportError: socket hang up', delayMs: 500 },
      {
        call: 'send on block 1',
        attempt: 2,
        reason: 'AdapterTransportError: socket hang up',
        delayMs: 1_000,
      },
    ]);
    expect(run.blocks[0]?.observed.retries).toBeUndefined();
    expect(run.blocks.every((block) => block.pass)).toBe(true);
  });

  it('fails the run after 3 retries of a transport error, keeps the blocks done, and closes the session', async () => {
    const adapter = acmeAdapter();
    const send = adapter.send.bind(adapter);
    let attempts = 0;
    adapter.send = async (session, turn) => {
      if (turn.index === 2) {
        attempts += 1;
        throw new AdapterTransportError('503 from the platform');
      }
      return send(session, turn);
    };
    const waits: number[] = [];
    const run = await runSpec(spec(), {
      adapter,
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      retry: { sleep: async (ms) => void waits.push(ms), jitter: false },
    });
    expectValid(run);
    expect(run.status).toBe('failed');
    expect(run.error).toBe(
      'send on block 2 failed after 4 attempts: AdapterTransportError: 503 from the platform',
    );
    expect(attempts).toBe(4);
    expect(waits).toEqual([500, 1_000, 2_000]);
    expect(run.blocks).toHaveLength(2);
    // The end state is read after the failure too: the order was never placed.
    expect(run.endState?.match).toBe(false);
    expect(run.endState?.diff.map((entry) => entry.field)).toEqual(['type', 'customer_id', 'plan_id']);
    expect(adapter.calls.close).toBe(1);
  });

  it('retries under the spec target settings, the run settings over them, and hands the policy to the adapter', async () => {
    const adapter = acmeAdapter();
    const send = adapter.send.bind(adapter);
    const policies: unknown[] = [];
    let attempts = 0;
    adapter.send = async (session, turn) => {
      policies.push(turn.retry);
      if (turn.index === 0) {
        attempts += 1;
        throw new AdapterTransportError('overloaded', { status: 529 });
      }
      return send(session, turn);
    };
    const target = { adapter: adapter.id, retry: { max_attempts: 2, base_delay_ms: 50, jitter: false } };
    const waits: number[] = [];
    const run = await runSpec(spec(), {
      adapter,
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      target,
      retry: { sleep: async (ms) => void waits.push(ms) },
    });
    expect(run.status).toBe('failed');
    expect(attempts, 'max_attempts 2 from the spec target').toBe(2);
    expect(waits).toEqual([50]);
    expect(policies[0]).toEqual({
      maxAttempts: 2,
      baseDelayMs: 50,
      maxDelayMs: 30_000,
      jitter: false,
      retryAfter: true,
    });

    attempts = 0;
    const overridden = await runSpec(spec(), {
      adapter,
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      target,
      retry: { sleep: async () => {}, maxAttempts: 3 },
    });
    expect(overridden.status).toBe('failed');
    expect(attempts, 'the run settings win over the spec target').toBe(3);
  });

  it('waits what Retry-After asks, retries a 408 like a 429, and never retries a call the adapter already retried in full', async () => {
    const waits: number[] = [];
    const run = async (errors: AdapterTransportError[]) => {
      const adapter = acmeAdapter();
      const send = adapter.send.bind(adapter);
      let attempts = 0;
      adapter.send = async (session, turn) => {
        const error = turn.index === 0 ? errors[attempts] : undefined;
        if (turn.index === 0) attempts += 1;
        if (error) throw error;
        return send(session, turn);
      };
      const result = await runSpec(spec(), {
        adapter,
        driver,
        checks: minimalChecks,
        mode: 'F',
        repeat: 0,
        retry: { sleep: async (ms) => void waits.push(ms), jitter: false },
      });
      return { result, attempts };
    };
    const asked = await run([new AdapterTransportError('slow down', { status: 429, retryAfterMs: 4_000 })]);
    expect(asked.result.status).toBe('completed');
    expect(waits).toEqual([4_000]);
    expect(asked.result.blocks[0]?.observed.retries?.[0]).toMatchObject({
      status: 429,
      retryAfterMs: 4_000,
      delayMs: 4_000,
    });

    const timeout = await run([new AdapterTransportError('request timeout', { status: 408 })]);
    expect(timeout.attempts).toBe(2);
    expect(timeout.result.status).toBe('completed');
    expect(timeout.result.blocks[0]?.observed.retries?.[0]).toMatchObject({ status: 408 });

    const spent = await run([
      new AdapterTransportError('messages.create failed after 4 attempts', { status: 503, exhausted: true }),
    ]);
    expect(spent.attempts).toBe(1);
    expect(spent.result.status).toBe('failed');
  });

  it('keeps the retries out of the cache, so a replayed block reports none', async () => {
    const cache = memoryCache();
    const adapter = acmeAdapter();
    const send = adapter.send.bind(adapter);
    let failures = 1;
    adapter.send = async (session, turn) => {
      if (turn.index === 0 && failures > 0) {
        failures -= 1;
        throw new AdapterTransportError('socket hang up');
      }
      return send(session, turn);
    };
    const options = {
      adapter,
      driver,
      checks: minimalChecks,
      mode: 'F' as const,
      repeat: 0,
      cache,
      retry: noWait,
    };
    const live = await runSpec(spec(), options);
    expect(live.blocks[0]?.observed.retries).toHaveLength(1);
    const replayed = await runSpec(spec(), options);
    expect(replayed.cacheHit).toBe(true);
    expect(replayed.blocks[0]?.observed.retries).toBeUndefined();
  });

  it('records an agent failure as a failed run, without a retry', async () => {
    const adapter = acmeAdapter();
    const send = adapter.send.bind(adapter);
    let attempts = 0;
    adapter.send = async (session, turn) => {
      if (turn.index === 3) {
        attempts += 1;
        throw new AgentFailure('the agent crashed on the order');
      }
      return send(session, turn);
    };
    const run = await runSpec(spec(), { adapter, driver, checks: [], mode: 'F', repeat: 0, retry: noWait });
    expectValid(run);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('send on block 3 failed: AgentFailure: the agent crashed on the order');
    expect(attempts).toBe(1);
    expect(run.blocks).toHaveLength(3);
    expect(adapter.calls).toMatchObject({ endState: 1, close: 1 });
    expect(run.endState).toEqual({
      match: false,
      diff: [
        { field: 'type', expected: 'upgrade', observed: { absent: true } },
        { field: 'customer_id', expected: 'cust-001', observed: { absent: true } },
        { field: 'plan_id', expected: 'mobile-l', observed: { absent: true } },
      ],
    });
    // Read, and nothing was recorded: null, unlike an end state no read reached (no value).
    expect(run.endStateValue).toBeNull();
  });

  it('carries an end state that says why when no block ran', async () => {
    const adapter = acmeAdapter();
    adapter.open = async () => {
      throw new AgentFailure('the agent would not start');
    };
    const run = await runSpec(spec(), { adapter, driver, checks: [], mode: 'F', repeat: 0 });
    expectValid(run);
    expect(run.status).toBe('failed');
    expect(run.error).toBe('open on block 0 failed: AgentFailure: the agent would not start');
    expect(run.endState).toEqual({
      match: false,
      diff: [
        {
          field: 'tool:order.create',
          expected: 'an end state read through adapter.endState',
          observed: 'no block ran, so no session was open to read from',
        },
      ],
    });
  });

  it('fails the run when the adapter returns an Observed the schema refuses', async () => {
    const adapter = acmeAdapter();
    adapter.send = async () => ({ text: 'no segments' }) as unknown as Observed;
    const run = await runSpec(spec(), { adapter, driver, checks: [], mode: 'F', repeat: 0 });
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(
      /^the adapter's Observed for block 0 does not match the schema as JSON: segments /,
    );
  });

  it('fails the run when an Observed holds an undefined that JSON would drop', async () => {
    const adapter = acmeAdapter({
      wrap: broken((observed) => {
        const [call] = observed.toolCalls;
        if (call) call.input = undefined;
      }),
    });
    const run = await runSpec(spec(), { adapter, driver, checks: [], mode: 'F', repeat: 0 });
    expectValid(run);
    expect(run.status).toBe('failed');
    expect(run.error).toBe(
      "the adapter's Observed for block 1 does not match the schema as JSON: toolCalls.0.input Invalid input: expected nonoptional, received undefined",
    );
  });

  it('returns what the store gives back, an end state with absent fields included', async () => {
    const store = openMemoryStore();
    await putCampaign(store, 'c-json', loaded);
    const adapter = acmeAdapter();
    const send = adapter.send.bind(adapter);
    adapter.send = async (session, turn) => {
      if (turn.index === 3) throw new AgentFailure('the agent crashed on the order');
      return send(session, turn);
    };
    const run = await runSpec(spec(), {
      adapter,
      driver,
      checks: [],
      mode: 'F',
      repeat: 0,
      store,
      campaignId: 'c-json',
    });
    expect(run.endState?.diff[0]).toEqual({ field: 'type', expected: 'upgrade', observed: { absent: true } });
    expect(await store.getRun(run.runId, 'c-json')).toEqual(run);
    await store.close();
  });

  it('fails the run when the driver asks for a block the spec does not have', async () => {
    const wild: UserDriver = {
      id: 'wild',
      next: () => ({ kind: 'block', blockIndex: 9, stimulus: { user: 'x' } }),
    };
    const run = await runSpec(spec(), {
      adapter: acmeAdapter(),
      driver: wild,
      checks: [],
      mode: 'F',
      repeat: 0,
    });
    expect(run.status).toBe('failed');
    expect(run.error).toBe('the driver asked for block 9; the spec has blocks 0 to 4');
  });

  it('stops a run whose driver never stops', async () => {
    const endless: UserDriver = {
      id: 'endless',
      next: () => ({
        kind: 'injected',
        perturbationId: 'again',
        stimulus: { user: 'again?' },
        beforeBlock: 0,
      }),
    };
    const run = await runSpec(spec(), {
      adapter: echoAdapter(),
      driver: endless,
      checks: [],
      mode: 'F',
      repeat: 0,
      maxSteps: 5,
    });
    expectValid(run);
    expect(run.status).toBe('stopped');
    expect(run.error).toBe('the driver endless did not stop within 5 steps');
    expect(run.blocks).toHaveLength(5);
  });

  it('refuses a store without a campaign', async () => {
    await expect(
      runSpec(spec(), {
        adapter: echoAdapter(),
        driver,
        checks: [],
        mode: 'F',
        repeat: 0,
        store: openMemoryStore(),
      }),
    ).rejects.toThrow(/a store needs a campaignId/);
  });
});

describe('injected blocks', () => {
  it('runs a perturbation before its block, with its expect, and marks it injected', async () => {
    const spec = acmeSpec(loaded, 'acme-new-customer-coverage');
    const perturbation = spec.perturbations?.find((entry) => entry.id === 'shop-hours');
    if (!perturbation?.user) throw new Error('missing perturbation');
    let injected = false;
    const perturbing: UserDriver = {
      id: 'perturbing-test',
      next(ctx) {
        if (ctx.blockIndex === perturbation.inject_at && !injected) {
          injected = true;
          return {
            kind: 'injected',
            perturbationId: perturbation.id,
            stimulus: { user: perturbation.user ?? '' },
            beforeBlock: perturbation.inject_at,
          };
        }
        return driver.next(ctx);
      },
    };
    const watch = spy();
    const adapter = acmeAdapter();
    const run = await runSpec(spec, {
      adapter,
      driver: perturbing,
      checks: [...minimalChecks, watch],
      mode: 'P',
      repeat: 0,
      perturbationId: perturbation.id,
    });
    expectValid(run);
    expect(failures(run)).toEqual([]);
    expect(run.blocks.map((block) => [block.index, block.blockId, block.injected])).toEqual([
      [0, undefined, undefined],
      [1, 'shop-hours', true],
      [2, undefined, undefined],
      [3, undefined, undefined],
      [4, undefined, undefined],
    ]);
    expect(watch.seen[1]?.expect).toEqual(perturbation.expect);
    expect(run.perturbationId).toBe('shop-hours');
    expect(run.mode).toBe('P');
    // In P mode the spec's end state is not read: it describes the unperturbed run.
    expect(run.endState).toBeUndefined();
    expect(watch.seen.every((ctx) => ctx.endState === undefined)).toBe(true);
    expect(adapter.calls.endState).toBe(0);
  });

  it("merges an injected perturbation's world from that block onwards", async () => {
    const spec = specOf({
      id: 'world',
      given: { world: { tools: { lookup: { result: { ok: true } } } } },
      blocks: [
        { user: 'a', expect: { must: ['ok'] } },
        { user: 'b', expect: { must: ['ok'] } },
      ],
      perturbations: [
        {
          id: 'lookup-down',
          class: 'D8_tool_failure',
          inject_at: 1,
          user: 'try again',
          world: { tools: { lookup: { error: 'timeout' } } },
          recovery: { within_blocks: 0 },
        },
      ],
    });
    const steps: DriverStep[] = [
      { kind: 'block', blockIndex: 0, stimulus: { user: 'a' } },
      { kind: 'injected', perturbationId: 'lookup-down', stimulus: { user: 'try again' }, beforeBlock: 1 },
      { kind: 'block', blockIndex: 1, stimulus: { user: 'b' } },
      { kind: 'stop', reason: 'done' },
    ];
    const scripted: UserDriver = {
      id: 'list',
      next: () => steps.shift() ?? { kind: 'stop', reason: 'empty' },
    };
    const watch = spy();
    // Forced tool results need toolStubs: on an adapter without it the blocks are not run.
    const echo = echoAdapter();
    const adapter = { ...echo, capabilities: () => ({ ...echo.capabilities(), toolStubs: true }) };
    await runSpec(spec, { adapter, driver: scripted, checks: [watch], mode: 'P', repeat: 0 });
    expect(watch.seen.map((ctx) => ctx.given.world.tools?.lookup)).toEqual([
      { result: { ok: true } },
      { error: 'timeout' },
      { error: 'timeout' },
    ]);
    expect(watch.seen[1]?.block).toEqual({ id: 'lookup-down', when: { user: 'try again' }, expect: {} });
  });

  it('marks a spec block whose stimulus is an injection as injected', async () => {
    const run = await runSpec(acmeSpec(loaded, 'acme-off-topic-return'), {
      adapter: acmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
    });
    expect(run.blocks.map((block) => block.injected ?? false)).toEqual([false, true, true, true, false]);
    expect(run.blocks.map((block) => block.blockId)).toEqual([
      undefined,
      'store-hours',
      'consoles',
      'where-were-we',
      undefined,
    ]);
  });
});

describe('workspace reads and traces', () => {
  it('hands the checks the adapter workspace read, and none when the adapter has no workspace', async () => {
    const spec = specOf({
      id: 'task',
      kind: 'task',
      blocks: [{ user: 'build it', expect: { must: ['ok'] } }],
    });
    const reading = Object.assign(echoAdapter(), {
      async readArtifact(session: { id: string }, path: string) {
        return new TextEncoder().encode(`${session.id}:${path}`);
      },
    });
    const read: string[] = [];
    const reader: Check = {
      name: 'artifact',
      applies: (ctx) => ctx.readArtifact !== undefined,
      async evaluate(ctx) {
        const bytes = await ctx.readArtifact?.('out/sheet.xlsx');
        read.push(new TextDecoder().decode(bytes));
        return [];
      },
    };
    await runSpec(spec, { adapter: reading, driver, checks: [reader], mode: 'F', repeat: 0 });
    expect(read).toEqual(['echo-1:out/sheet.xlsx']);

    const watch = spy();
    await runSpec(spec, { adapter: echoAdapter(), driver, checks: [watch], mode: 'F', repeat: 0 });
    expect(watch.seen[0]?.readArtifact).toBeUndefined();
  });

  it('replaces the view of send with trace when the adapter has the capability', async () => {
    const spec = specOf({ id: 'trace', blocks: [{ user: 'a', expect: { must: ['traced'] } }] });
    const tracing = Object.assign(echoAdapter('sent'), {
      capabilities: () => ({ ...echoAdapter().capabilities(), trace: true }),
      async trace(): Promise<Observed> {
        return {
          segments: [{ type: 'text', text: 'traced' }],
          text: 'traced',
          toolCalls: [],
          cost: { usd: 0.002 },
          latencyMs: 40,
        };
      },
    });
    const run = await runSpec(spec, {
      adapter: tracing,
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
    });
    expect(run.blocks[0]?.observed.text).toBe('traced');
    expect(run.blocks[0]?.pass).toBe(true);
    expect(run.cost).toBe(0.002);
    expect(run.latencyMs).toBe(40);
  });
});

describe('the cache', () => {
  it('replays a spec whose version label alone changed', async () => {
    const cache = memoryCache();
    await runSpec(spec(), { adapter: acmeAdapter(), driver, checks: [], mode: 'F', repeat: 0, cache });
    const relabelled = await runSpec(
      { ...spec(), version: 'relabelled' },
      { adapter: acmeAdapter(), driver, checks: [], mode: 'F', repeat: 0, cache },
    );
    expect(relabelled.cacheHit).toBe(true);
  });

  const spec = () => acmeSpec(loaded, 'acme-plan-upgrade');

  it('returns the same Observed for the same key', async () => {
    const cache = memoryCache();
    const first = await runSpec(spec(), {
      adapter: acmeAdapter(),
      driver,
      checks: [],
      mode: 'F',
      repeat: 0,
      cache,
    });
    // Five blocks and one end-state read.
    expect(cache.entries.size).toBe(6);
    const watch = spy();
    const key = (index: number) => {
      const ctx = watch.seen[index];
      if (!ctx) throw new Error('no context');
      // The key carries the spec's hash without its version label, which plays no part in the cache.
      const { version: _version, ...unlabelled } = spec();
      return blockCacheKey({
        specHash: contentHash(unlabelled),
        repeat: 0,
        position: index,
        given: ctx.given,
        stimulus: ctx.block.when,
        target: first.target,
        adapter: 'function',
        adapterVersion: 'test-acme-1',
      });
    };
    await runSpec(spec(), { adapter: acmeAdapter(), driver, checks: [watch], mode: 'F', repeat: 0 });
    for (const block of first.blocks) {
      expect(await cache.cacheGet(key(block.index))).toEqual(block.observed);
    }
  });

  it('a script that ends with a failure verdict records it on the run, and the run is not passed', async () => {
    const ended = { ...spec(), end: { verdict: 'failure' as const, reason: 'the agent refused' } };
    const result = await runSpec(ended, {
      adapter: acmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
    });
    expectValid(result);
    expect(result.endVerdict).toBe('failure');
    expect(result.status).toBe('completed');
  });

  it('a script that ends mid-spec runs only the blocks before its stop, and the run keeps its verdict', async () => {
    const full = spec();
    expect(full.blocks.length).toBeGreaterThan(1);
    const stopped = { ...full, end: { verdict: 'success' as const, reason: 'served', atBlock: 0 } };
    const result = await runSpec(stopped, {
      adapter: acmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
    });
    expectValid(result);
    expect(result.blocks).toHaveLength(1);
    expect(result.endVerdict).toBe('success');
    expect(result.status).toBe('completed');
  });

  it('each block of a cached run records the key it was stored under', async () => {
    const cache = memoryCache();
    const first = await runSpec(spec(), {
      adapter: acmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      cache,
    });
    for (const block of first.blocks) {
      expect(block.cacheKey).toMatch(/^block:[0-9a-f]{64}$/);
      expect(await cache.cacheGet(block.cacheKey as string)).toEqual(block.observed);
    }
  });

  it('a run in another suite does not replay the cache of the first suite', async () => {
    const cache = memoryCache();
    await runSpec(spec(), {
      adapter: acmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      cache,
      suite: 'nightly-1',
    });
    const adapter = acmeAdapter();
    const other = await runSpec(spec(), {
      adapter,
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      cache,
      suite: 'nightly-2',
    });
    expectValid(other);
    expect(other.cacheHit).toBe(false);
    expect(adapter.calls.send).toBeGreaterThan(0);
  });

  it('replays a whole run from the cache without reaching the agent', async () => {
    const cache = memoryCache();
    const first = await runSpec(spec(), {
      adapter: acmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      cache,
    });
    const adapter = acmeAdapter();
    const second = await runSpec(spec(), {
      adapter,
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      cache,
    });
    expectValid(second);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(adapter.calls).toEqual({ open: 0, send: 0, close: 0, endState: 0 });
    expect(second.blocks).toEqual(first.blocks);
    expect(second.endState).toEqual(first.endState);
  });

  it('runs live when any entry is missing, and keeps repeats apart', async () => {
    const cache = memoryCache();
    await runSpec(spec(), { adapter: acmeAdapter(), driver, checks: [], mode: 'F', repeat: 0, cache });
    const otherRepeat = acmeAdapter();
    const repeat1 = await runSpec(spec(), {
      adapter: otherRepeat,
      driver,
      checks: [],
      mode: 'F',
      repeat: 1,
      cache,
    });
    expect(repeat1.cacheHit).toBe(false);
    expect(otherRepeat.calls.send).toBe(5);

    const [firstKey] = cache.entries.keys();
    if (firstKey === undefined) throw new Error('empty cache');
    cache.entries.delete(firstKey);
    const partial = acmeAdapter();
    const live = await runSpec(spec(), { adapter: partial, driver, checks: [], mode: 'F', repeat: 0, cache });
    expect(live.cacheHit).toBe(false);
    expect(partial.calls).toMatchObject({ open: 1, send: 5, endState: 1 });
    expect(live.endState).toEqual({ match: true, diff: [] });
  });

  it('replays through the SQLite store cache, whose JSON gives back what was put', async () => {
    const store = openMemoryStore();
    const first = await runSpec(spec(), {
      adapter: acmeAdapter(),
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      cache: store,
    });
    const adapter = acmeAdapter();
    const second = await runSpec(spec(), {
      adapter,
      driver,
      checks: minimalChecks,
      mode: 'F',
      repeat: 0,
      cache: store,
    });
    expect(second.cacheHit).toBe(true);
    expect(adapter.calls.send).toBe(0);
    expect(second.blocks).toEqual(first.blocks);
    expect(second.endState).toEqual(first.endState);
    await store.close();
  });

  it('files the run under its campaign, with the cell id as its run id', async () => {
    const store = openMemoryStore();
    const options = {
      adapter: acmeAdapter(),
      driver,
      checks: [],
      mode: 'F' as const,
      repeat: 1,
      store,
      campaignId: 'c-test',
    };
    await expect(runSpec(spec(), options)).rejects.toThrow(
      /CAMPAIGN_MISSING|campaign c-test is not in the store/,
    );
    await putCampaign(store, 'c-test', loaded);
    const run = await runSpec(spec(), options);
    const key = { specHash: run.specHash, target: run.target, mode: run.mode, repeat: 1 };
    expect(run.runId).toBe(cellId(key));
    expect(run.runId).toBe(storeCellId(key));
    expect(await store.listRuns({ campaignId: 'c-test' })).toEqual([run]);
    expect(await store.getRun(run.runId, 'c-test')).toEqual(run);
    await store.close();
  });
});

describe('the runner module', () => {
  it('exports no name that the core index binds to something else, so `export * from ./runner` is safe', () => {
    const exported = core as Record<string, unknown>;
    const clashes = Object.entries(runner).filter(
      ([name, value]) => name in exported && exported[name] !== value,
    );
    expect(clashes.map(([name]) => name)).toEqual([]);
  });
});
