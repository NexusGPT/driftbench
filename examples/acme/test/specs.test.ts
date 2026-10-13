import { type Assertion, DeviationClass } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import type { AcmeAgent } from '../src/agent';
import { createStore } from '../src/store';
import { checkEndState, driveSpec, matches } from './support/drive';
import { loadAcmeSpecs } from './support/specs';

const loaded = await loadAcmeSpecs();
const conversations = loaded.filter((entry) => entry.spec.kind === 'conversation').map((entry) => entry.spec);

describe('the Acme spec tree', () => {
  it('holds six conversation specs and one task spec, valid and free of lint warnings', () => {
    expect(loaded.map((entry) => `${entry.spec.kind} ${entry.spec.id}`)).toEqual([
      'conversation acme-new-customer-coverage',
      'conversation acme-number-porting',
      'conversation acme-off-topic-return',
      'conversation acme-order-loose-confirmation',
      'conversation acme-plan-upgrade',
      'conversation acme-tool-failure',
      'task acme-price-sheet',
    ]);
    expect(loaded.flatMap((entry) => entry.warnings)).toEqual([]);
  });

  it('gives every spec covers, a channel and exactly one flow tag', () => {
    for (const { spec } of loaded) {
      expect(spec.covers?.length, spec.id).toBeGreaterThan(0);
      expect(spec.channel, spec.id).toBeTruthy();
      expect(spec.tags?.filter((tag) => tag.startsWith('flow:')) ?? [], spec.id).toHaveLength(1);
    }
  });

  it('perturbs with at least four deviation classes, each perturbation with a recovery stage', () => {
    const perturbations = loaded.flatMap((entry) => entry.spec.perturbations ?? []);
    expect(new Set(perturbations.map((perturbation) => perturbation.class)).size).toBeGreaterThanOrEqual(4);
    for (const perturbation of perturbations) {
      expect(perturbation.recovery?.stage_after, perturbation.id).toBeTruthy();
    }
  });

  it('uses the rules, the ledger, given overrides, an end state and local criteria', () => {
    const specs = loaded.map((entry) => entry.spec);
    expect(specs.filter((spec) => spec.rules?.max_calls && spec.rules.forbidden_tools)).not.toHaveLength(0);
    expect(specs.every((spec) => spec.kind === 'task' || spec.rules?.lang_stable)).toBe(true);
    expect(specs.filter((spec) => spec.given?.ledger)).not.toHaveLength(0);
    expect(specs.filter((spec) => spec.blocks.some((block) => block.given?.world?.tools))).not.toHaveLength(
      0,
    );
    expect(specs.find((spec) => spec.id === 'acme-order-loose-confirmation')?.end_state).toBeDefined();
    expect(specs.every((spec) => (spec.criteria?.length ?? 0) > 0)).toBe(true);
    const guarded = specs.filter((spec) =>
      [...spec.blocks.map((block) => block.expect), ...(spec.perturbations ?? []).map((p) => p.expect)].some(
        (expect) => (expect?.guards?.length ?? 0) > 0,
      ),
    );
    expect(guarded.map((spec) => spec.kind).sort()).toEqual([
      'conversation',
      'conversation',
      'conversation',
      'task',
    ]);
  });
});

describe.each(conversations.map((spec) => ({ id: spec.id, spec })))('$id', ({ spec }) => {
  it('passes every block, rule and its end state when driven through the agent', async () => {
    const run = await driveSpec(spec);
    expect(run.failures, run.transcript).toEqual([]);
    expect(run.blocks).toHaveLength(spec.blocks.length);
  });

  const perturbations = (spec.perturbations ?? []).map((perturbation) => ({
    id: perturbation.id,
    class: perturbation.class,
    perturbation,
  }));
  it.each(perturbations)('recovers from $class ($id)', async ({ perturbation }) => {
    const run = await driveSpec(spec, { perturbation });
    expect(run.failures, run.transcript).toEqual([]);
    expect(run.blocks.some((block) => block.injected)).toBe(true);
  });

  it('gives the same run twice', async () => {
    const first = await driveSpec(spec);
    const second = await driveSpec(spec);
    expect(second.blocks).toEqual(first.blocks);
    expect(second.store.payloads).toEqual(first.store.payloads);
  });
});

/** Breaks the agent on purpose. A check that cannot fail proves nothing. */
function broken(change: (observed: Awaited<ReturnType<AcmeAgent['respond']>>) => void) {
  return (agent: AcmeAgent): AcmeAgent => ({
    async respond(messages, world) {
      const observed = await agent.respond(messages, world);
      change(observed);
      return observed;
    },
  });
}

describe('the hand-rolled checks fail on a broken agent', () => {
  it.each(conversations.map((spec) => ({ id: spec.id, spec })))(
    'flags $id when the agent hides its tool calls',
    async ({ spec }) => {
      const wrap = broken((observed) => {
        observed.toolCalls = [];
        observed.segments = observed.segments.filter((segment) => segment.type === 'text');
      });
      const run = await driveSpec(spec, { wrap });
      expect(run.failures.some((failure) => /tool \S+: expected/.test(failure))).toBe(true);
    },
  );

  it.each(conversations.map((spec) => ({ id: spec.id, spec })))(
    'flags $id when the agent reports the wrong stage',
    async ({ spec }) => {
      const wrap = broken((observed) => {
        observed.runtime = { stages: [{ name: 'needs' }] };
      });
      const run = await driveSpec(spec, { wrap });
      expect(run.failures.some((failure) => failure.includes('stage: expected'))).toBe(true);
    },
  );

  it('flags a guardrail that never reports firing', async () => {
    const spec = conversations.find((entry) => entry.id === 'acme-order-loose-confirmation');
    if (!spec) throw new Error('missing spec');
    const wrap = broken((observed) => {
      observed.runtime = { stages: observed.runtime?.stages ?? [] };
    });
    const run = await driveSpec(spec, { wrap });
    expect(run.failures).toContain(
      'block 2 (loose-yes): guard explicit_confirmation with verdict block: expected exactly 1, saw 0',
    );
  });

  it('flags an order number invented on a loose yes', async () => {
    const spec = conversations.find((entry) => entry.id === 'acme-order-loose-confirmation');
    if (!spec) throw new Error('missing spec');
    const wrap = broken((observed) => {
      observed.text = `${observed.text} Your order ORD-ABC123 is placed.`;
    });
    const run = await driveSpec(spec, { wrap });
    expect(run.failures).toContain('block 2 (loose-yes): must_not /ORD-[0-9A-F]{6}/ is present');
  });

  it('flags a second message in one turn and a reply in another language', async () => {
    const spec = conversations.find((entry) => entry.id === 'acme-plan-upgrade');
    if (!spec) throw new Error('missing spec');
    const wrap = broken((observed) => {
      observed.segments.push({ type: 'text', text: 'Gracias.' });
      observed.text = `${observed.text}\nGracias.`;
    });
    const run = await driveSpec(spec, { wrap });
    expect(run.failures).toContain('block 0: rules.one_message_per_turn: 2 text segments');
    expect(run.failures).toContain('block 0: rules.lang_stable: the reply leaves English');
  });

  it('flags an end state that does not match the recorded payload', () => {
    const store = createStore();
    store.payloads.push({ tool: 'order.create', input: { type: 'new', plan_id: 'fiber-300' }, output: {} });
    const endState = {
      source: 'tool:order.create',
      mode: 'exact' as const,
      expect: { plan_id: 'fiber-1000' },
    };
    expect(checkEndState(endState, store)).toEqual([
      'end_state order.create.plan_id is "fiber-300", expected "fiber-1000"',
      'end_state exact: order.create.type is not expected',
    ]);
    expect(checkEndState('none', store)).toEqual(['end_state none: 1 payloads recorded']);
  });
});

describe('assertions', () => {
  const cases: Array<[string, Assertion, unknown, unknown]> = [
    ['a bare scalar', 'mobile-l', 'mobile-l', 'mobile-m'],
    ['exact', { exact: { a: [1, 2] } }, { a: [1, 2] }, { a: [2, 1] }],
    ['regex', { regex: '^7 Quarry' }, '7 Quarry Lane', '17 Quarry Lane'],
    ['contains', { contains: 'Summit' }, '88 Summit Avenue', '88 Harbor Road'],
    ['one_of', { one_of: ['mobile-m', 'mobile-l'] }, 'mobile-l', 'mobile-s'],
    ['nonempty', { nonempty: true }, 'x', ''],
    ['absent', { absent: true }, undefined, null],
    [
      'subset',
      { subset: { name: 'Jo Okafor' } },
      { name: 'Jo Okafor', email: 'jo.okafor@example.com' },
      { name: 'Jo' },
    ],
  ];
  it.each(cases)('%s passes the right value and fails the wrong one', (_name, assertion, good, bad) => {
    expect(matches(good, assertion)).toBe(true);
    expect(matches(bad, assertion)).toBe(false);
  });

  it('names deviation classes the schema knows', () => {
    const used = loaded.flatMap((entry) =>
      (entry.spec.perturbations ?? []).map((perturbation) => perturbation.class),
    );
    for (const value of used) expect(DeviationClass.options).toContain(value);
  });
});
