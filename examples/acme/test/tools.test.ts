import { describe, expect, it } from 'vitest';
import { createStore } from '../src/store';
import { callTool, type ToolInput, type ToolLabel } from '../src/tools';

function run(label: ToolLabel, input: ToolInput, extra: { seed?: Record<string, unknown> } = {}) {
  const store = createStore();
  return { store, outcome: callTool(label, input, { store, commit: true, ...extra }) };
}

describe('catalog.search', () => {
  it('lists a category, or only the plans an address can get', () => {
    expect(run('catalog.search', { category: 'mobile' }).outcome).toMatchObject({
      ok: true,
      output: { plans: [{ id: 'mobile-s' }, { id: 'mobile-m' }, { id: 'mobile-l' }] },
    });
    const orchard = run('catalog.search', { category: 'home', address_id: 'addr-102' }).outcome;
    expect(
      orchard.ok && (orchard.output as { plans: Array<{ id: string }> }).plans.map((plan) => plan.id),
    ).toEqual(['fiber-300', 'air-5g']);
  });

  it("returns the customer's current plan for a known email, null for an unknown one", () => {
    expect(
      run('catalog.search', { category: 'mobile', customer_email: 'Sam.Rivera@example.com' }).outcome,
    ).toMatchObject({
      ok: true,
      output: { customer: { id: 'cust-001', name: 'Sam Rivera', current_plan_id: 'mobile-s' } },
    });
    expect(
      run('catalog.search', { category: 'mobile', customer_email: 'nobody@example.com' }).outcome,
    ).toMatchObject({
      ok: true,
      output: { customer: null },
    });
  });

  it('refuses an invented parameter and a bad category', () => {
    expect(run('catalog.search', { category: 'mobile', speed: 'fast' }).outcome).toEqual({
      ok: false,
      error: 'unknown parameter: speed',
    });
    expect(run('catalog.search', { category: 'tv' }).outcome).toEqual({
      ok: false,
      error: 'category must be mobile or home',
    });
  });
});

describe('coverage.check', () => {
  it('finds an address with or without the town, and says when it cannot', () => {
    expect(run('coverage.check', { address: '14 Harbor Road, Acmeville' }).outcome).toEqual({
      ok: true,
      output: {
        found: true,
        address_id: 'addr-101',
        address: '14 Harbor Road, Acmeville',
        fiber_mbps: 1000,
        five_g: true,
      },
    });
    expect(run('coverage.check', { address: '3 orchard way' }).outcome).toMatchObject({
      output: { address_id: 'addr-102' },
    });
    expect(run('coverage.check', { address: '1 Unknown Street' }).outcome).toEqual({
      ok: true,
      output: { found: false, address: '1 Unknown Street' },
    });
  });
});

describe('port.check', () => {
  it('reads seeded transfer records over the store', () => {
    const seed = { port_numbers: [{ number: '+12025550150', eligible: true }] };
    expect(run('port.check', { number: '(202) 555-0150' }, { seed }).outcome).toEqual({
      ok: true,
      output: { number: '+12025550150', eligible: true },
    });
    expect(run('port.check', { number: '+1 202 555 0150' }).outcome).toMatchObject({
      output: { eligible: false, reason: 'the number is not active at any carrier' },
    });
    expect(run('port.check', { number: '+1 202 555 0160' }).outcome).toMatchObject({
      output: { eligible: false, reason: 'the number has a transfer lock at its current carrier' },
    });
    expect(run('port.check', { number: '555' }).outcome).toEqual({
      ok: false,
      error: 'number must be a US phone number',
    });
  });
});

describe('order.create', () => {
  const homeOrder = {
    type: 'new',
    plan_id: 'fiber-1000',
    address_id: 'addr-101',
    customer: { name: 'Jo Okafor', email: 'jo.okafor@example.com' },
  };

  it('places an order with an id derived from its content and records the payload', () => {
    const first = run('order.create', homeOrder);
    const again = run('order.create', { ...homeOrder });
    expect(first.outcome).toMatchObject({ ok: true, output: { status: 'pending', plan_id: 'fiber-1000' } });
    expect(first.outcome.ok && (first.outcome.output as { order_id: string }).order_id).toMatch(
      /^ORD-[0-9A-F]{6}$/,
    );
    expect(again.outcome).toEqual(first.outcome);
    expect(first.store.payloads).toEqual([
      { tool: 'order.create', input: homeOrder, output: first.outcome.ok && first.outcome.output },
    ]);
  });

  it('refuses a plan the address cannot get, a locked number and a wrong upgrade', () => {
    expect(run('order.create', { ...homeOrder, address_id: 'addr-103' }).outcome).toEqual({
      ok: false,
      error: 'Acme Fiber 1000 is not available at 88 Summit Avenue, Acmeville',
    });
    const locked = {
      type: 'new',
      plan_id: 'mobile-m',
      customer: homeOrder.customer,
      port_number: '+12025550160',
    };
    expect(run('order.create', locked).outcome).toEqual({
      ok: false,
      error: 'port_number cannot move to Acme',
    });
    expect(
      run('order.create', { type: 'upgrade', customer_id: 'cust-001', plan_id: 'fiber-300' }).outcome,
    ).toEqual({ ok: false, error: 'an upgrade keeps the category of the current plan' });
  });

  it('records nothing when it fails or when it only replays', () => {
    const failed = run('order.create', { ...homeOrder, plan_id: 'tv-max' });
    expect(failed.outcome).toEqual({ ok: false, error: 'unknown plan_id: tv-max' });
    expect(failed.store.payloads).toEqual([]);
    const store = createStore();
    expect(callTool('order.create', homeOrder, { store, commit: false }).ok).toBe(true);
    expect(store.payloads).toEqual([]);
  });
});

describe('notify_sales', () => {
  it('needs a known reason and a way to reach the customer', () => {
    const lead = { reason: 'callback', customer: { phone: '+12025550131' }, summary: 'Wants fiber.' };
    expect(run('notify_sales', lead).outcome).toMatchObject({ ok: true, output: { queued: true } });
    expect(run('notify_sales', { ...lead, reason: 'upsell' }).outcome).toMatchObject({ ok: false });
    expect(run('notify_sales', { ...lead, customer: { name: 'Jo Okafor' } }).outcome).toEqual({
      ok: false,
      error: 'customer needs a phone or an email',
    });
  });
});

describe('overrides', () => {
  it('fails the call on an override error, without running the tool or recording anything', () => {
    const store = createStore();
    const outcome = callTool(
      'order.create',
      { type: 'new', plan_id: 'mobile-s', customer: { name: 'Jo Okafor', email: 'jo.okafor@example.com' } },
      { store, commit: true, override: { error: 'order service unavailable' } },
    );
    expect(outcome).toEqual({ ok: false, error: 'order service unavailable' });
    expect(store.payloads).toEqual([]);
  });

  it('replaces the answer with an override result and still records the submitted payload', () => {
    const store = createStore();
    const input = { reason: 'callback', customer: { phone: '+12025550131' }, summary: 'Stubbed lead.' };
    const outcome = callTool('notify_sales', input, {
      store,
      commit: true,
      override: { result: { ticket_id: 'LEAD-TEST01', queued: true } },
    });
    expect(outcome).toEqual({ ok: true, output: { ticket_id: 'LEAD-TEST01', queued: true } });
    expect(store.payloads).toEqual([
      { tool: 'notify_sales', input, output: { ticket_id: 'LEAD-TEST01', queued: true } },
    ]);
  });
});
