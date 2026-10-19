import type { Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { schemaStrict } from '../src/checks/schema_strict';
import { validateStrict } from '../src/support/schema';
import { acme } from './support/acme';
import { context, observed, outcomes, run, verdict } from './support/context';

/** A strict schema for order.create, as a tool catalog would declare it. */
const orderCreate = {
  type: 'object',
  properties: {
    type: { enum: ['new', 'upgrade'] },
    plan_id: {
      type: 'string',
      enum: ['mobile-s', 'mobile-m', 'mobile-l', 'fiber-300', 'fiber-1000', 'air-5g'],
    },
    customer: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 }, email: { type: 'string', pattern: '@' } },
      required: ['name', 'email'],
    },
    customer_id: { type: 'string' },
    address_id: { type: 'string' },
    port_number: { type: 'string', pattern: '^\\+\\d{8,15}$' },
  },
  required: ['type', 'plan_id'],
};

const porting: Spec = {
  ...acme('acme-number-porting'),
  metadata: { tool_schemas: { 'order.create': orderCreate } },
};
const payload = {
  type: 'new',
  plan_id: 'mobile-m',
  customer: { name: 'Dana Brooks', email: 'dana.brooks@example.com' },
  port_number: '+12025550150',
};
const confirm = (input: unknown, label = 'order.create') =>
  context(porting, 4, observed('Done. Your order ORD-831EE0 is placed.', [{ label, input }]));

describe('schema_strict', () => {
  it('passes block 4 of acme-number-porting: the order.create input fits its strict schema', async () => {
    const verdicts = await run(schemaStrict, confirm(payload));
    expect(outcomes(verdicts)).toEqual({ 'schema_strict.order.create.1': 'pass' });
    expect(verdicts[0]?.evidence).toBe('order.create call 1 (call-1) fits its strict schema');
  });

  it('mutation: an invented coupon parameter fails and is reported as invented', async () => {
    const verdicts = await run(schemaStrict, confirm({ ...payload, coupon: 'FREE' }));
    expect(verdict(verdicts, 'schema_strict.order.create.1')).toMatchObject({
      outcome: 'fail',
      evidence:
        'order.create call 1 (call-1): 1 invented parameter; input.coupon is not in the schema: an invented parameter',
    });
  });

  it('reports invented keys in nested objects, wrong enums, missing required keys and bad patterns', () => {
    const issues = validateStrict(
      { type: 'renew', customer: { name: 'Dana Brooks', email: 'dana', vip: true }, port_number: '0470' },
      orderCreate,
    ).map((issue) => `${issue.path} ${issue.message}`);
    expect(issues).toEqual([
      'input.plan_id is missing',
      'input.type is "renew", expected one of ["new","upgrade"]',
      'input.customer.email is "dana", expected to match /@/',
      'input.customer.vip is not in the schema: an invented parameter',
      'input.port_number is "0470", expected to match /^\\+\\d{8,15}$/',
    ]);
  });

  it('keeps a Unicode-aware pattern Unicode-aware: \\p{L} and an astral character with the unicode flag', () => {
    const letters = { type: 'object', properties: { n: { type: 'string', pattern: '^\\p{L}+$' } } };
    expect(validateStrict({ n: '\u00e9t\u00e9' }, letters)).toEqual([]);
    expect(validateStrict({ n: 'abc' }, letters)).toEqual([]);
    expect(validateStrict({ n: 'a1' }, letters)).toHaveLength(1);
    const one = { type: 'object', properties: { n: { type: 'string', pattern: '^.{1}$' } } };
    expect(validateStrict({ n: '\u{1F600}' }, one)).toEqual([]);
    expect(validateStrict({ n: 'ab' }, one)).toHaveLength(1);
  });

  it('compiles a pattern the unicode flag refuses, such as \\- or \\_, without the flag', () => {
    const phone = { type: 'object', properties: { n: { type: 'string', pattern: '^\\d{3}\\-\\d{4}$' } } };
    expect(validateStrict({ n: '555-0131' }, phone)).toEqual([]);
    expect(validateStrict({ n: '5550131' }, phone)).toHaveLength(1);
    const pair = { type: 'object', properties: { n: { type: 'string', pattern: '^[a-z]\\_[a-z]$' } } };
    expect(validateStrict({ n: 'a_b' }, pair)).toEqual([]);
    expect(validateStrict({ n: 'ab' }, pair)).toHaveLength(1);
  });

  it('reads OpenAI-style functions and is inconclusive, never gating, on a tool with no schema', async () => {
    const wrapped: Spec = {
      ...porting,
      metadata: { tool_schemas: { 'order.create': { name: 'order.create', parameters: orderCreate } } },
    };
    const ctx = context(
      wrapped,
      4,
      observed('Done.', [{ label: 'order.create', input: { ...payload, x: 1 } }]),
    );
    expect(verdict(await run(schemaStrict, ctx), 'schema_strict.order.create.1').outcome).toBe('fail');
    const unknown = await run(schemaStrict, confirm({}, 'notify_sales'));
    expect(unknown[0]).toMatchObject({
      id: 'schema_strict.notify_sales.1',
      outcome: 'inconclusive',
      gating: false,
      evidence: 'notify_sales call 1 (call-1): no schema for notify_sales in metadata.tool_schemas',
    });
  });

  it('does not apply when the spec gives no tool_schemas', () => {
    const plain = acme('acme-number-porting');
    expect(schemaStrict.applies(context(plain, 4, observed('Done.', [{ label: 'order.create' }])))).toBe(
      false,
    );
  });
});
