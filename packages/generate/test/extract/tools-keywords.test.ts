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

  it('minItems adds below-min-items and at-min-items', () => {
    expect(partitions({ type: 'array', items: { type: 'string' }, minItems: 3 })).toEqual({
      't.x.in.p': ['empty', 'one-item', 'several-items', 'below-min-items', 'at-min-items'],
    });
    expect(partitions({ type: 'array', items: { type: 'string' }, minItems: 0 })).toEqual({
      't.x.in.p': ['empty', 'one-item', 'several-items'],
    });
  });

  it('reads the draft-04 boolean exclusiveMinimum and exclusiveMaximum as exclusive bounds', () => {
    expect(partitions({ type: 'number', minimum: 2, exclusiveMinimum: true })).toEqual({
      't.x.in.p': ['at-exclusive-minimum', 'above-exclusive-minimum'],
    });
    expect(partitions({ type: 'number', maximum: 9, exclusiveMaximum: true })).toEqual({
      't.x.in.p': ['below-exclusive-maximum', 'at-exclusive-maximum'],
    });
    expect(partitions({ type: 'number', minimum: 2, exclusiveMinimum: false })).toEqual({
      't.x.in.p': ['below-minimum', 'at-minimum', 'above-minimum'],
    });
  });

  it('infers the type from the keywords when a property states none', () => {
    expect(partitions({ format: 'email' })).toEqual({ 't.x.in.p': ['well-formed', 'malformed'] });
    expect(partitions({ minimum: 3 })).toEqual({
      't.x.in.p': ['below-minimum', 'at-minimum', 'above-minimum'],
    });
    expect(partitions({ maxItems: 4 })).toEqual({
      't.x.in.p': ['empty', 'one-item', 'several-items', 'at-max-items', 'above-max-items'],
    });
  });

  it('gives null once when an enum of a nullable type already holds it', () => {
    expect(partitions({ type: ['string', 'null'], enum: ['low', 'high', null] })).toEqual({
      't.x.in.p': ['low', 'high', 'null'],
    });
    expect(partitions({ type: ['string', 'null'], enum: ['low', 'high'] })).toEqual({
      't.x.in.p': ['low', 'high', 'null'],
    });
  });

  it('reads a $ref to $defs or to draft-07 definitions', () => {
    expect(
      partitions({ $ref: '#/$defs/Choice' }, true, {
        $defs: { Choice: { type: 'string', enum: ['north', 'south'] } },
      }),
    ).toEqual({
      't.x.in.p': ['north', 'south'],
    });
    expect(
      partitions({ $ref: '#/definitions/Size' }, true, {
        definitions: { Size: { type: 'integer', minimum: 1 } },
      }),
    ).toEqual({
      't.x.in.p': ['below-minimum', 'at-minimum', 'above-minimum'],
    });
  });

  it('contentEncoding gives well-formed and malformed', () => {
    expect(partitions({ type: 'string', contentEncoding: 'base64' })).toEqual({
      't.x.in.p': ['well-formed', 'malformed'],
    });
    expect(partitions({ contentEncoding: 'base64' })).toEqual({ 't.x.in.p': ['well-formed', 'malformed'] });
  });

  it('minProperties and maxProperties give their edges', () => {
    expect(
      partitions({
        type: 'object',
        minProperties: 1,
        maxProperties: 3,
        additionalProperties: { type: 'string' },
      }),
    ).toEqual({
      't.x.in.p': ['below-min-properties', 'at-min-properties', 'at-max-properties', 'above-max-properties'],
    });
  });

  it('reads Gemini function declarations, at the root or inside a tools list', () => {
    const declaration = {
      name: 'findAccount',
      parameters: { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } },
    };
    for (const file of [
      { functionDeclarations: [declaration] },
      { tools: [{ functionDeclarations: [declaration] }] },
    ]) {
      const result = toolsPrepass(stringify(file), 'tools.yaml');
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      expect(result.tools).toEqual(['findAccount']);
      expect(result.dimensions.map((dimension) => dimension.id)).toEqual(['find_account.in.flag']);
    }
  });

  it('an optional property with a default adds at-default before absent; a required one does not', () => {
    expect(partitions({ type: 'integer', minimum: 1, default: 3 }, false)).toEqual({
      't.x.in.p': ['below-minimum', 'at-minimum', 'above-minimum', 'at-default', 'absent'],
    });
    expect(partitions({ type: 'integer', minimum: 1, default: 3 }, true)).toEqual({
      't.x.in.p': ['below-minimum', 'at-minimum', 'above-minimum'],
    });
    expect(partitions({ type: 'integer', minimum: 1 }, false)).toEqual({
      't.x.in.p': ['below-minimum', 'at-minimum', 'above-minimum', 'absent'],
    });
  });

  it('reads the legacy OpenAI functions list', () => {
    const file = {
      functions: [
        {
          name: 'findAccount',
          parameters: { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } },
        },
      ],
    };
    const result = toolsPrepass(stringify(file), 'tools.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.tools).toEqual(['findAccount']);
    expect(result.dimensions.map((dimension) => dimension.id)).toEqual(['find_account.in.flag']);
  });

  it('reads Bedrock tool specs: toolSpec with inputSchema.json', () => {
    const file = {
      tools: [
        {
          toolSpec: {
            name: 'findAccount',
            description: 'x',
            inputSchema: {
              json: { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } },
            },
          },
        },
      ],
    };
    const result = toolsPrepass(stringify(file), 'tools.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.tools).toEqual(['findAccount']);
    expect(result.dimensions.map((dimension) => dimension.id)).toEqual(['find_account.in.flag']);
  });

  it('reads Vercel tools by name with parameters wrapped as jsonSchema', () => {
    const file = {
      tools: {
        findAccount: {
          description: 'x',
          parameters: {
            jsonSchema: { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } },
          },
        },
      },
    };
    const result = toolsPrepass(stringify(file), 'tools.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.dimensions.map((dimension) => dimension.id)).toEqual(['find_account.in.flag']);
  });
});
