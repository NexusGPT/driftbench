import { describe, expect, it } from 'vitest';
import {
  concreteValue,
  defaultFor,
  INVALID_PARTITIONS,
  inputAssertion,
  toolAnswer,
} from '../../src/seed/values';

const value = (v: unknown) => ({ kind: 'value', value: v });

describe('concreteValue', () => {
  it('derives numeric boundaries from the schema bounds', () => {
    const fiber = { type: 'integer', minimum: 0, maximum: 1000 };
    expect(concreteValue(fiber, 'below-minimum')).toEqual(value(-1));
    expect(concreteValue(fiber, 'at-minimum')).toEqual(value(0));
    expect(concreteValue(fiber, 'above-minimum')).toEqual(value(1));
    expect(concreteValue(fiber, 'below-maximum')).toEqual(value(999));
    expect(concreteValue(fiber, 'at-maximum')).toEqual(value(1000));
    expect(concreteValue(fiber, 'above-maximum')).toEqual(value(1001));
    const price = { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10 };
    expect(concreteValue(price, 'at-exclusive-minimum')).toEqual(value(0));
    expect(concreteValue(price, 'above-exclusive-minimum')).toEqual(value(0.5));
    expect(concreteValue(price, 'below-exclusive-maximum')).toEqual(value(9.5));
    expect(concreteValue(price, 'at-exclusive-maximum')).toEqual(value(10));
  });

  it('derives empty, shortest, longest and too long strings from the length bounds', () => {
    const name = { type: 'string', minLength: 2, maxLength: 4 };
    expect(concreteValue(name, 'below-min-length')).toEqual(value('x'));
    expect(concreteValue(name, 'at-min-length')).toEqual(value('xx'));
    expect(concreteValue(name, 'at-max-length')).toEqual(value('xxxx'));
    expect(concreteValue(name, 'above-max-length')).toEqual(value('xxxxx'));
    expect(concreteValue({ type: 'string', minLength: 1 }, 'below-min-length')).toEqual(value(''));
  });

  it('gives a well-formed and a malformed value for known formats, fictional only', () => {
    expect(concreteValue({ type: 'string', format: 'email' }, 'well-formed')).toEqual(
      value('jo.okafor@example.com'),
    );
    expect(concreteValue({ type: 'string', format: 'email' }, 'malformed')).toEqual(
      value('jo.okafor.example.com'),
    );
    expect(concreteValue({ type: 'string', pattern: '^A' }, 'well-formed').kind).toBe('unsupported');
  });

  it('reads enum members, booleans, nulls, absence and array sizes', () => {
    expect(concreteValue({ type: 'string', enum: ['mobile', 'home'] }, 'home')).toEqual(value('home'));
    expect(concreteValue({ type: 'string', enum: ['new customer'] }, 'new-customer')).toEqual(
      value('new customer'),
    );
    expect(concreteValue({ type: 'boolean' }, 'false')).toEqual(value(false));
    expect(concreteValue({ type: ['object', 'null'] }, 'null')).toEqual(value(null));
    expect(concreteValue({ type: 'string' }, 'absent')).toEqual({ kind: 'absent' });
    const plans = {
      type: 'array',
      maxItems: 2,
      items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    };
    expect(concreteValue(plans, 'empty')).toEqual(value([]));
    expect(concreteValue(plans, 'one-item')).toEqual(value([{ id: 'id-1' }]));
    expect(concreteValue(plans, 'at-max-items')).toEqual(value([{ id: 'id-1' }, { id: 'id-1' }]));
    expect((concreteValue(plans, 'above-max-items') as { value: unknown[] }).value).toHaveLength(3);
  });
});

describe('toolAnswer', () => {
  const coverage = {
    name: 'coverage.check',
    slug: 'coverage.check',
    output: {
      type: 'object',
      required: ['found', 'address'],
      properties: {
        found: { type: 'boolean' },
        address: { type: 'string' },
        fiber_mbps: { type: 'integer', minimum: 0 },
      },
    },
  };

  it('starts from a valid answer and sets each partition, removing the absent ones', () => {
    const { answer, unsupported } = toolAnswer(coverage, [
      { path: ['found'], schema: { type: 'boolean' }, partition: 'false' },
      { path: ['fiber_mbps'], schema: { type: 'integer', minimum: 0 }, partition: 'absent' },
    ]);
    expect(answer).toEqual({ found: false, address: 'address-1' });
    expect(unsupported).toEqual([]);
  });

  it('writes an out-of-schema value when the partition asks for one', () => {
    const { answer } = toolAnswer(coverage, [
      { path: ['fiber_mbps'], schema: { type: 'integer', minimum: 0 }, partition: 'below-minimum' },
    ]);
    expect(answer.fiber_mbps).toBe(-1);
  });
});

describe('inputAssertion', () => {
  it('asserts valid top-level partitions and nothing for invalid or nested ones', () => {
    expect(inputAssertion(['category'], { type: 'string', enum: ['mobile', 'home'] }, 'mobile')).toBe(
      'mobile',
    );
    expect(inputAssertion(['address_id'], { type: 'string' }, 'absent')).toEqual({ absent: true });
    expect(inputAssertion(['address_id'], { type: 'string' }, 'present')).toEqual({ nonempty: true });
    expect(inputAssertion(['address'], { type: 'string', minLength: 1 }, 'at-min-length')).toEqual({
      regex: '^[\\s\\S]{1}$',
    });
    expect(inputAssertion(['address'], { type: 'string', minLength: 1 }, 'below-min-length')).toBeUndefined();
    expect(inputAssertion(['customer', 'email'], { type: 'string' }, 'present')).toBeUndefined();
  });

  it('lists every partition that breaks the schema as invalid', () => {
    for (const partition of [
      'below-minimum',
      'above-maximum',
      'below-min-length',
      'above-max-length',
      'malformed',
    ]) {
      expect(INVALID_PARTITIONS.has(partition)).toBe(true);
    }
    for (const partition of ['at-minimum', 'at-min-length', 'well-formed', 'present', 'absent']) {
      expect(INVALID_PARTITIONS.has(partition)).toBe(false);
    }
  });
});

describe('defaultFor', () => {
  it('fills the required properties of an object with typed values', () => {
    expect(
      defaultFor({
        type: 'object',
        required: ['id', 'n', 'ok', 'kind'],
        properties: {
          id: { type: 'string' },
          n: { type: 'integer', minimum: 3 },
          ok: { type: 'boolean' },
          kind: { enum: ['a', 'b'] },
          extra: { type: 'string' },
        },
      }),
    ).toEqual({ id: 'id-1', n: 3, ok: true, kind: 'a' });
  });
});
