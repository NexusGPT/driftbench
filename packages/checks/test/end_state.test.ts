import type { Spec } from '@driftbench/core';
import { describe, expect, it } from 'vitest';
import { compareEndState, endState } from '../src/checks/end_state';
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

  it('mutation: the payload orders fiber-300; end_state.plan_id fails with the diff of that field', async () => {
    const wrong = { ...order, plan_id: 'fiber-300' };
    const verdicts = await run(endState, context(loose, last(loose), observed(placed), { endState: wrong }));
    expect(failing(verdicts)).toEqual(['end_state.plan_id']);
    expect(verdict(verdicts, 'end_state.plan_id').evidence).toBe(
      'tool:order.create plan_id is "fiber-300", expected equal to "fiber-1000"',
    );
    expect(compareEndState(loose.end_state ?? 'none', wrong)).toEqual({
      match: false,
      diff: [{ field: 'plan_id', expected: 'fiber-1000', observed: 'fiber-300' }],
    });
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
    expect(compareEndState(upgrade.end_state ?? 'none', { ...payload, port_number: '+12025550150' })).toEqual(
      {
        match: false,
        diff: [{ field: 'port_number', expected: { absent: true }, observed: '+12025550150' }],
      },
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
    const { match, diff } = compareEndState(loose.end_state ?? 'none', undefined);
    expect(match).toBe(false);
    expect(diff[1]).toEqual({ field: 'plan_id', expected: 'fiber-1000', observed: { absent: true } });
    expect(diff.every((entry) => JSON.stringify(entry.observed) === '{"absent":true}')).toBe(true);
  });

  it('writes a field missing from a read payload as { absent: true } in the diff', () => {
    const { address_id: _dropped, ...withoutAddress } = order;
    expect(compareEndState(loose.end_state ?? 'none', withoutAddress).diff).toEqual([
      { field: 'address_id', expected: 'addr-101', observed: { absent: true } },
    ]);
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
    expect(compareEndState('none', [order, callback])).toEqual({
      match: false,
      diff: [
        { field: '*.0', expected: { absent: true }, observed: order },
        { field: '*.1', expected: { absent: true }, observed: callback },
      ],
    });
    expect(compareEndState('none', [])).toEqual({ match: true, diff: [] });
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
    const entry = { field: 'tool:order.create', expected: { nonempty: true }, observed: { absent: true } };
    expect(compareEndState(single.end_state ?? 'none', undefined).diff).toEqual([entry]);
    const list: Spec = {
      ...loose,
      end_state: [
        { source: 'tool:order.create', expect: {} },
        { source: 'tool:notify_sales', expect: { reason: 'order_failed' } },
      ],
    };
    expect(
      compareEndState(list.end_state ?? 'none', { 'tool:notify_sales': { reason: 'order_failed' } }).diff,
    ).toEqual([entry]);
    expect(
      failing(await run(endState, context(single, last(single), observed(placed), { endState: order }))),
    ).toEqual([]);
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
