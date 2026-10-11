import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { toolsPrepass } from '../../src/extract';

/**
 * JSON Schema keywords the tool pre-pass reads, one test per keyword, each written from an item of the map
 * validator's bank (packages/validators/src/ladders/map/bank/families/schema.ts) before the keyword was read.
 */

/** The partitions of one property of one tool, without the dimension prefix. */
function partitions(property: Record<string, unknown>, required = true, extra: Record<string, unknown> = {}) {
  const schema = { type: 'object', required: required ? ['p'] : [], properties: { p: property }, ...extra };
  const result = toolsPrepass(stringify({ tools: [{ name: 't.x', input_schema: schema }] }), 'tools.yaml');
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const out: Record<string, string[]> = {};
  for (const dimension of result.dimensions)
    out[dimension.id] = dimension.values.map((value) => value.id.slice(dimension.id.length + 1));
  return out;
}

describe('JSON Schema keywords in the tool pre-pass', () => {
  it('multipleOf gives multiple and not-multiple', () => {
    expect(partitions({ type: 'integer', multipleOf: 5 })).toEqual({
      't.x.in.p': ['multiple', 'not-multiple'],
    });
    expect(partitions({ type: 'integer', minimum: 0, multipleOf: 5 })).toEqual({
      't.x.in.p': ['below-minimum', 'at-minimum', 'above-minimum', 'multiple', 'not-multiple'],
    });
  });

  it('uniqueItems adds duplicate-items to the array partitions', () => {
    expect(partitions({ type: 'array', items: { type: 'string' }, uniqueItems: true })).toEqual({
      't.x.in.p': ['empty', 'one-item', 'several-items', 'duplicate-items'],
    });
    expect(partitions({ type: 'array', items: { type: 'string' }, uniqueItems: false })).toEqual({
      't.x.in.p': ['empty', 'one-item', 'several-items'],
    });
  });
});
