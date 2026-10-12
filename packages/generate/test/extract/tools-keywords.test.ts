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

  it('reads the tools of an agent configuration under agent.tools', () => {
    const file = {
      agent: {
        name: 'demo',
        tools: [
          {
            name: 'findAccount',
            input_schema: { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } },
          },
        ],
      },
    };
    const result = toolsPrepass(stringify(file), 'tools.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.tools).toEqual(['findAccount']);
    expect(result.dimensions.map((dimension) => dimension.id)).toEqual(['find_account.in.flag']);
  });

  it('reads parameters given as a JSON string', () => {
    const parameters = JSON.stringify({
      type: 'object',
      required: ['flag'],
      properties: { flag: { type: 'boolean' } },
    });
    const result = toolsPrepass(stringify({ tools: [{ name: 'findAccount', parameters }] }), 'tools.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.dimensions.map((dimension) => dimension.id)).toEqual(['find_account.in.flag']);
    expect(result.dimensions[0]?.values.map((value) => value.evidence.quote).every((q) => q.length > 0)).toBe(true);
  });

  it('reads a YAML stream with one tool per document', () => {
    const tool = (name: string) =>
      stringify({
        name,
        input_schema: { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } },
      });
    const result = toolsPrepass(`${tool('findAccount')}---\n${tool('placeOrder')}`, 'tools.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.tools).toEqual(['findAccount', 'placeOrder']);
    expect(result.dimensions.map((dimension) => dimension.id)).toEqual(['find_account.in.flag', 'place_order.in.flag']);
  });

  it('reads JSON with comments and keeps quotes from the original text', () => {
    const text = `// Tool schemas.
{
  "tools": [ // one tool
    {
      "name": "findAccount", /* block */
      "input_schema": { "type": "object", "required": ["flag"], "properties": { "flag": { "type": "boolean" } } }
    }
  ]
}
`;
    const result = toolsPrepass(text, 'tools.jsonc');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.dimensions.map((dimension) => dimension.id)).toEqual(['find_account.in.flag']);
    expect(text).toContain(result.dimensions[0]?.values[0]?.evidence.quote ?? '#');
    const url = toolsPrepass('{"tools":[{"name":"a","input_schema":{"type":"object","properties":{"u":{"type":"string","pattern":"^http://x"}}}}]}', 'tools.json');
    expect(url.ok).toBe(true);
  });

  it('reads JSON lines, one tool per line', () => {
    const line = (name: string) =>
      JSON.stringify({
        name,
        input_schema: { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } },
      });
    const text = `${line('findAccount')}\n${line('placeOrder')}\n`;
    const result = toolsPrepass(text, 'tools.jsonl');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.tools).toEqual(['findAccount', 'placeOrder']);
    expect(text).toContain(result.dimensions[0]?.values[0]?.evidence.quote ?? '#');
  });

  it('reads Cohere parameter_definitions with str, int and bool types and a required flag', () => {
    const file = {
      tools: [
        {
          name: 'findAccount',
          parameter_definitions: {
            status: { type: 'str', required: true },
            urgent: { type: 'bool', required: false },
            count: { type: 'int', required: true },
          },
        },
      ],
    };
    const result = toolsPrepass(stringify(file), 'tools.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const out: Record<string, string[]> = {};
    for (const dimension of result.dimensions) out[dimension.id] = dimension.values.map((v) => v.id.slice(dimension.id.length + 1));
    expect(out).toEqual({
      'find_account.in.urgent': ['true', 'false', 'absent'],
    });
  });

  it('reads Vertex function_declarations in snake case, at the root or inside a tools list', () => {
    const declaration = {
      name: 'findAccount',
      parameters: { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } },
    };
    for (const file of [
      { function_declarations: [declaration] },
      { tools: [{ function_declarations: [declaration] }] },
    ]) {
      const result = toolsPrepass(stringify(file), 'tools.yaml');
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      expect(result.tools).toEqual(['findAccount']);
    }
  });

  it('reads an args mapping of properties with no required list: every argument is optional', () => {
    const file = { tools: [{ name: 'findAccount', args: { urgent: { type: 'boolean' } } }] };
    const result = toolsPrepass(stringify(file), 'tools.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.dimensions.map((d) => [d.id, d.values.map((v) => v.id.slice(d.id.length + 1))])).toEqual([
      ['find_account.in.urgent', ['true', 'false', 'absent']],
    ]);
  });

  it('reads an OpenAPI 3 or Swagger 2 document: one tool per operationId, body as input, 200 as output', () => {
    const input = { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } };
    const output = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
    const three = {
      openapi: '3.0.3',
      paths: {
        '/find': {
          put: {
            operationId: 'findAccount',
            requestBody: { content: { 'application/json': { schema: input } } },
            responses: { '200': { content: { 'application/json': { schema: output } } } },
          },
          post: {
            operationId: 'placeOrder',
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/In' } } } },
            responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Out' } } } } },
          },
        },
      },
      components: { schemas: { In: input, Out: output } },
    };
    const two = {
      swagger: '2.0',
      paths: {
        '/find': {
          post: {
            operationId: 'findAccount',
            parameters: [{ in: 'body', name: 'body', schema: input }],
            responses: { '200': { schema: output } },
          },
        },
      },
    };
    for (const file of [three, two]) {
      const result = toolsPrepass(stringify(JSON.parse(JSON.stringify(file))), 'api.yaml');
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      expect(result.tools[0]).toBe('findAccount');
      expect(result.dimensions.map((d) => d.id).slice(0, 2)).toEqual(['find_account.in.flag', 'find_account.out.ok']);
    }
    const first = toolsPrepass(stringify(JSON.parse(JSON.stringify(three))), 'api.yaml');
    if (!first.ok) throw new Error('x');
    expect(first.tools).toEqual(['findAccount', 'placeOrder']);
    expect(first.dimensions.map((d) => d.id)).toEqual([
      'find_account.in.flag',
      'find_account.out.ok',
      'place_order.in.flag',
      'place_order.out.ok',
    ]);
  });

  it('reads OpenAPI query parameters as the input, each with its schema and required flag', () => {
    const file = {
      openapi: '3.0.3',
      paths: {
        '/find': {
          get: {
            operationId: 'findAccount',
            parameters: [
              { in: 'query', name: 'urgent', required: false, schema: { type: 'boolean' } },
              { in: 'query', name: 'flag', required: true, schema: { type: 'boolean' } },
            ],
            responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } } } } },
          },
        },
      },
    };
    const result = toolsPrepass(stringify(file), 'api.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.dimensions.map((d) => [d.id, d.values.map((v) => v.id.slice(d.id.length + 1))])).toEqual([
      ['find_account.in.urgent', ['true', 'false', 'absent']],
      ['find_account.in.flag', ['true', 'false']],
      ['find_account.out.ok', ['true', 'false']],
    ]);
  });
});
