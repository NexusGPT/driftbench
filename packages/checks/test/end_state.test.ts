import type { Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { endState } from '../src/checks/end_state';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';

const loose = acme('acme-order-loose-confirmation');
const placed = 'Done. Your order ORD-222B51 is placed: Acme Fiber 1000 at 14 Harbor Road, Acmeville.';
/** The payload order.create recorded on the CONFIRM block of the order spec. */
const order = {
  type: 'new',
  plan_id: 'fiber-1000',
  address_id: 'addr-101',
  customer: { name: 'Jo Okafor', email: 'jo.okafor@example.com' },
};
const last = (spec: Spec) => spec.blocks.length - 1;

describe('end_state', () => {
  it('passes acme-order-loose-confirmation: the order.create payload holds every expected field (subset)', async () => {
    const verdicts = await run(endState, context(loose, last(loose), observed(placed), { endState: order }));
    expect(outcomes(verdicts)).toEqual({
      'end_state.type': 'pass',
      'end_state.plan_id': 'pass',
      'end_state.address_id': 'pass',
      'end_state.customer': 'pass',
      'end_state.port_number': 'pass',
    });
    expect(verdict(verdicts, 'end_state.plan_id').evidence).toBe(
      'tool:order.create plan_id is "fiber-1000", expected equal to "fiber-1000"',
    );
  });

  it('mutation: the payload orders fiber-300; end_state.plan_id fails and names both values', async () => {
    const wrong = { ...order, plan_id: 'fiber-300' };
    const verdicts = await run(endState, context(loose, last(loose), observed(placed), { endState: wrong }));
    expect(failing(verdicts)).toEqual(['end_state.plan_id']);
    expect(verdict(verdicts, 'end_state.plan_id').evidence).toBe(
      'tool:order.create plan_id is "fiber-300", expected equal to "fiber-1000"',
    );
  });

  it('exact mode: acme-plan-upgrade passes on the listed fields and fails on one more', async () => {
    const upgrade = acme('acme-plan-upgrade');
    const payload = { type: 'upgrade', customer_id: 'cust-001', plan_id: 'mobile-l' };
    const done = await run(
      endState,
      context(upgrade, last(upgrade), observed('Bye.'), { endState: payload }),
    );
    expect(failing(done)).toEqual([]);
    const extra = await run(
      endState,
      context(upgrade, last(upgrade), observed('Bye.'), {
        endState: { ...payload, port_number: '+12025550150' },
      }),
    );
    expect(failing(extra)).toEqual(['end_state.port_number']);
    expect(verdict(extra, 'end_state.port_number').evidence).toBe(
      'tool:order.create port_number is "+12025550150", a field the exact end state does not list',
    );
  });

  it('mutation: order.create recorded nothing; every expected field fails, absent ones included', async () => {
    const verdicts = await run(endState, context(loose, last(loose), observed(placed)));
    expect(outcomes(verdicts)).toEqual({
      'end_state.type': 'fail',
      'end_state.plan_id': 'fail',
      'end_state.address_id': 'fail',
      'end_state.customer': 'fail',
      'end_state.port_number': 'fail',
    });
    expect(verdict(verdicts, 'end_state.plan_id').evidence).toBe(
      'tool:order.create: nothing was read (no payload recorded, or the adapter cannot read end states), so plan_id is absent; expected equal to "fiber-1000"',
    );
  });

  it('mutation: the source holds a string or a list, not a mapping; every field fails, naming the type', async () => {
    for (const [state, type] of [
      ['ORD-222B51', 'a string'],
      [[order], 'a list'],
      [42, 'a number'],
    ] as const) {
      const verdicts = await run(
        endState,
        context(loose, last(loose), observed(placed), { endState: state }),
      );
      expect(failing(verdicts)).toEqual([
        'end_state.type',
        'end_state.plan_id',
        'end_state.address_id',
        'end_state.customer',
        'end_state.port_number',
      ]);
      expect(verdict(verdicts, 'end_state.plan_id').evidence).toMatch(
        new RegExp(
          `^tool:order\\.create: the state read is ${type} \\(.*\\), not a mapping, so plan_id is absent`,
        ),
      );
    }
  });

  it('mutation: the payload lacks address_id; end_state.address_id fails and says it is absent', async () => {
    const { address_id: _dropped, ...withoutAddress } = order;
    const verdicts = await run(
      endState,
      context(loose, last(loose), observed(placed), { endState: withoutAddress }),
    );
    expect(failing(verdicts)).toEqual(['end_state.address_id']);
    expect(verdict(verdicts, 'end_state.address_id').evidence).toBe(
      'tool:order.create address_id is absent, expected equal to "addr-101"',
    );
  });

  it('none: acme-off-topic-return passes on an empty payload list (source *), absent, null or empty', async () => {
    const spec = acme('acme-off-topic-return');
    for (const recorded of [undefined, null, [], {}]) {
      const verdicts = await run(endState, context(spec, last(spec), observed('ok'), { endState: recorded }));
      expect(outcomes(verdicts), JSON.stringify(recorded)).toEqual({ 'end_state.none': 'pass' });
    }
  });

  it('mutation: acme-off-topic-return records an order; end_state none fails and names the first payload', async () => {
    const spec = acme('acme-off-topic-return');
    const callback = { reason: 'callback', customer: { phone: '+12025550131' } };
    const submitted = await run(
      endState,
      context(spec, last(spec), observed('ok'), { endState: [order, callback] }),
    );
    expect(outcomes(submitted)).toEqual({ 'end_state.none': 'fail' });
    expect(verdict(submitted, 'end_state.none').evidence).toMatch(
      /^end_state is none, but the adapter recorded 2 payloads; the first: \{"type":"new","plan_id":"fiber-1000"/,
    );
    const empty = await run(endState, context(spec, last(spec), observed('ok'), { endState: [{}] }));
    expect(outcomes(empty)).toEqual({ 'end_state.none': 'fail' });
  });

  it('a list of end states reads a record keyed by source', async () => {
    const spec: Spec = {
      ...loose,
      end_state: [
        { source: 'tool:order.create', expect: { plan_id: 'fiber-1000' } },
        { source: 'tool:notify_sales', expect: { reason: 'order_failed' } },
      ],
    };
    const state = { 'tool:order.create': order, 'tool:notify_sales': { reason: 'callback' } };
    const verdicts = await run(endState, context(spec, last(spec), observed(placed), { endState: state }));
    expect(outcomes(verdicts)).toEqual({
      'end_state.tool:order.create.plan_id': 'pass',
      'end_state.tool:notify_sales.reason': 'fail',
    });
  });

  it('an empty expect fails once when its source recorded nothing, its field the source, in a list too', async () => {
    const single: Spec = { ...loose, end_state: { source: 'tool:order.create', expect: {} } };
    const verdicts = await run(endState, context(single, last(single), observed(placed)));
    expect(outcomes(verdicts)).toEqual({ 'end_state.tool:order.create': 'fail' });
    const list: Spec = {
      ...loose,
      end_state: [
        { source: 'tool:order.create', expect: {} },
        { source: 'tool:notify_sales', expect: { reason: 'order_failed' } },
      ],
    };
    const listed = await run(
      endState,
      context(list, last(list), observed(placed), {
        endState: { 'tool:notify_sales': { reason: 'order_failed' } },
      }),
    );
    expect(outcomes(listed)).toEqual({
      'end_state.tool:order.create': 'fail',
      'end_state.tool:notify_sales.reason': 'pass',
    });
    expect(
      failing(await run(endState, context(single, last(single), observed(placed), { endState: order }))),
    ).toEqual([]);
  });

  it('mutation: an empty expect passes on anything recorded, a string included; nothing recorded fails it', async () => {
    const single: Spec = { ...loose, end_state: { source: 'tool:order.create', expect: {} } };
    const recorded = await run(
      endState,
      context(single, last(single), observed(placed), { endState: 'ORD-222B51' }),
    );
    expect(recorded.map((item) => [item.id, item.outcome, item.evidence])).toEqual([
      ['end_state.tool:order.create', 'pass', 'tool:order.create recorded a string "ORD-222B51"'],
    ]);
    const nothing = await run(endState, context(single, last(single), observed(placed), { endState: null }));
    expect(outcomes(nothing)).toEqual({ 'end_state.tool:order.create': 'fail' });
    const strict: Spec = { ...loose, end_state: { source: 'tool:order.create', mode: 'exact', expect: {} } };
    const extra = await run(
      endState,
      context(strict, last(strict), observed(placed), { endState: { plan_id: 'fiber-1000' } }),
    );
    expect(outcomes(extra)).toEqual({ 'end_state.tool:order.create': 'pass', 'end_state.plan_id': 'fail' });
  });

  it('runs only on the last spec block of a T or F run, found by identity whatever the run position', () => {
    expect(endState.applies(context(loose, 1, observed('ok'), { endState: order }))).toBe(false);
    expect(
      endState.applies(context(loose, last(loose), observed('ok'), { blockIndex: last(loose) + 1 })),
    ).toBe(true);
    expect(
      endState.applies(context(loose, last(loose), observed('ok'), { endState: order, mode: 'P' })),
    ).toBe(false);
    expect(
      endState.applies(context(loose, last(loose), observed('ok'), { endState: order, mode: 'T' })),
    ).toBe(true);
  });
});
