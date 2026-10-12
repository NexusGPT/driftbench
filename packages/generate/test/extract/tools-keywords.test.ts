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
    expect(result.dimensions[0]?.values.map((value) => value.evidence.quote).every((q) => q.length > 0)).toBe(
      true,
    );
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
    expect(result.dimensions.map((dimension) => dimension.id)).toEqual([
      'find_account.in.flag',
      'place_order.in.flag',
    ]);
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
    const url = toolsPrepass(
      '{"tools":[{"name":"a","input_schema":{"type":"object","properties":{"u":{"type":"string","pattern":"^http://x"}}}}]}',
      'tools.json',
    );
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
    for (const dimension of result.dimensions)
      out[dimension.id] = dimension.values.map((v) => v.id.slice(dimension.id.length + 1));
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
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Out' } } } },
            },
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
      expect(result.dimensions.map((d) => d.id).slice(0, 2)).toEqual([
        'find_account.in.flag',
        'find_account.out.ok',
      ]);
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
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
                  },
                },
              },
            },
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

  it('reads legacy XML tool descriptions: every parameter is optional', () => {
    const text = `<tools>
<tool_description>
  <tool_name>findAccount</tool_name>
  <parameters>
    <parameter><name>status</name><type>string</type></parameter>
    <parameter><name>urgent</name><type>boolean</type></parameter>
  </parameters>
</tool_description>
</tools>
`;
    const result = toolsPrepass(text, 'tools.xml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.tools).toEqual(['findAccount']);
    expect(result.dimensions.map((d) => [d.id, d.values.map((v) => v.id.slice(d.id.length + 1))])).toEqual([
      ['find_account.in.status', ['present', 'absent']],
      ['find_account.in.urgent', ['true', 'false', 'absent']],
    ]);
    for (const dimension of result.dimensions)
      for (const value of dimension.values) expect(text).toContain(value.evidence.quote);
  });

  it('reads TOML tools and quotes lines of the TOML file', () => {
    const text = `# tools
[[tools]]
name = "findAccount"

[tools.input_schema]
type = "object"
required = ["status"]

[tools.input_schema.properties.status]
type = "string"
enum = ["open", "closed"]

[tools.input_schema.properties.urgent]
type = "boolean"
`;
    const result = toolsPrepass(text, 'tools.toml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.tools).toEqual(['findAccount']);
    expect(result.dimensions.map((d) => [d.id, d.values.map((v) => v.id.slice(d.id.length + 1))])).toEqual([
      ['find_account.in.status', ['open', 'closed']],
      ['find_account.in.urgent', ['true', 'false', 'absent']],
    ]);
    for (const dimension of result.dimensions)
      for (const value of dimension.values) expect(text).toContain(value.evidence.quote);
  });

  it('keeps a quote of a very long pattern within 1000 characters, as a passage of the file', () => {
    const pattern = `^(${Array.from({ length: 160 }, (_, i) => `code${i}`).join('|')})$`;
    const text = stringify(
      {
        tools: [
          {
            name: 't.x',
            input_schema: { type: 'object', required: ['p'], properties: { p: { type: 'string', pattern } } },
          },
        ],
      },
      { lineWidth: 0 },
    );
    const result = toolsPrepass(text, 'tools.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    for (const value of result.dimensions[0]?.values ?? []) {
      expect(value.evidence.quote.length).toBeLessThanOrEqual(1000);
      expect(text).toContain(value.evidence.quote);
    }
  });

  it('turns a dot in a property name into an underscore: one field, not a path', () => {
    const read = (name: string) => {
      const schema = {
        type: 'object',
        required: [name],
        properties: { [name]: { type: 'string', format: 'uri' } },
      };
      const result = toolsPrepass(
        stringify({ tools: [{ name: 't.x', input_schema: schema }] }),
        'tools.yaml',
      );
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return result.dimensions.map((d) => d.id);
    };
    expect(read('user.email')).toEqual(['t.x.in.user_email']);
  });

  it('oneOf and anyOf give a value per branch, a const branch its const, a null branch null; allOf merges', () => {
    expect(
      partitions({
        oneOf: [
          { title: 'by-email', type: 'string', format: 'email' },
          { title: 'by-code', type: 'string', pattern: '^x$' },
        ],
      }),
    ).toEqual({ 't.x.in.p': ['variant-by-email', 'variant-by-code'] });
    expect(partitions({ anyOf: [{ type: 'integer' }, { type: 'string', format: 'date' }] })).toEqual({
      't.x.in.p': ['variant-1', 'variant-2'],
    });
    expect(partitions({ anyOf: [{ type: 'integer', minimum: 2 }, { type: 'null' }] })).toEqual({
      't.x.in.p': ['below-minimum', 'at-minimum', 'above-minimum', 'null'],
    });
    expect(partitions({ oneOf: [{ const: 'north', title: 'North' }, { const: 'south' }] })).toEqual({
      't.x.in.p': ['north', 'south'],
    });
    expect(partitions({ allOf: [{ type: 'integer', minimum: 2 }, { maximum: 9 }] })).toEqual({
      't.x.in.p': [
        'below-minimum',
        'at-minimum',
        'above-minimum',
        'below-maximum',
        'at-maximum',
        'above-maximum',
      ],
    });
  });

  it('a discriminator mapping names the variants of a oneOf of $refs', () => {
    const schema = {
      type: 'object',
      required: ['p'],
      properties: {
        p: {
          oneOf: [{ $ref: '#/$defs/Card' }, { $ref: '#/$defs/Transfer' }],
          discriminator: {
            propertyName: 'method',
            mapping: { card: '#/$defs/Card', transfer: '#/$defs/Transfer' },
          },
        },
      },
      $defs: { Card: { type: 'object' }, Transfer: { type: 'object' } },
    };
    const result = toolsPrepass(stringify({ tools: [{ name: 't.x', input_schema: schema }] }), 'tools.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.dimensions[0]?.values.map((v) => v.id)).toEqual([
      't.x.in.p.variant-card',
      't.x.in.p.variant-transfer',
    ]);
  });

  it('a required list inside an allOf member makes its property required', () => {
    expect(partitions({ type: 'string', enum: ['a', 'b'] }, false, { allOf: [{ required: ['p'] }] })).toEqual(
      {
        't.x.in.p': ['a', 'b'],
      },
    );
  });

  it('follows objects three levels down, array items as <array>.item and tuples as <array>.<position>', () => {
    const deep = {
      type: 'object',
      required: ['inner'],
      properties: {
        inner: {
          type: 'object',
          required: ['core'],
          properties: {
            core: {
              type: 'object',
              required: ['level'],
              properties: { level: { type: 'string', enum: ['a', 'b'] } },
            },
          },
        },
      },
    };
    expect(Object.keys(partitions(deep))).toEqual(['t.x.in.p.inner.core.level']);
    expect(partitions({ type: 'array', items: { type: 'string', enum: ['a', 'b'] } })).toEqual({
      't.x.in.p': ['empty', 'one-item', 'several-items'],
      't.x.in.p.item': ['a', 'b'],
    });
    expect(
      partitions({
        type: 'array',
        items: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['a'] } } },
      }),
    ).toEqual({ 't.x.in.p': ['empty', 'one-item', 'several-items'], 't.x.in.p.item.kind': ['a'] });
    expect(
      partitions({ type: 'array', prefixItems: [{ type: 'string', enum: ['a', 'b'] }, { type: 'boolean' }] }),
    ).toEqual({
      't.x.in.p': ['empty', 'one-item', 'several-items'],
      't.x.in.p.0': ['a', 'b'],
      't.x.in.p.1': ['true', 'false'],
    });
    expect(
      partitions({ type: 'array', items: [{ type: 'string', enum: ['a'] }, { type: 'boolean' }] }),
    ).toEqual({
      't.x.in.p': ['empty', 'one-item', 'several-items'],
      't.x.in.p.0': ['a'],
      't.x.in.p.1': ['true', 'false'],
    });
  });

  it('follows an items $ref, and a recursive $ref once', () => {
    const read = (properties: Record<string, unknown>, defs: Record<string, unknown>) => {
      const schema = { type: 'object', required: ['p'], properties, $defs: defs };
      const result = toolsPrepass(
        stringify({ tools: [{ name: 't.x', input_schema: schema }] }),
        'tools.yaml',
      );
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return Object.fromEntries(
        result.dimensions.map((d) => [d.id, d.values.map((v) => v.id.slice(d.id.length + 1))]),
      );
    };
    expect(
      read(
        { p: { type: 'array', items: { $ref: '#/$defs/Tag' } } },
        { Tag: { type: 'string', enum: ['a', 'b'] } },
      ),
    ).toEqual({
      't.x.in.p': ['empty', 'one-item', 'several-items'],
      't.x.in.p.item': ['a', 'b'],
    });
    const node = {
      type: 'object',
      required: ['label'],
      properties: {
        label: { type: 'string', enum: ['a'] },
        children: { type: 'array', items: { $ref: '#/$defs/Node' } },
      },
    };
    expect(read({ p: { $ref: '#/$defs/Node' } }, { Node: node })).toEqual({
      't.x.in.p.label': ['a'],
      't.x.in.p.children': ['empty', 'one-item', 'several-items', 'absent'],
      't.x.in.p.children.item.label': ['a'],
    });
  });

  it('reads object consts and enums, contains, not, propertyNames, contentMediaType, int32 and x-nullable', () => {
    const only = (property: Record<string, unknown>) => Object.values(partitions(property))[0];
    expect(only({ type: 'object', const: { mode: 'test' } })).toEqual(['fixed']);
    expect(only({ type: 'object', enum: [{ size: 1 }, { size: 2 }] })).toEqual(['member-1', 'member-2']);
    expect(only({ type: 'string', contentMediaType: 'application/json' })).toEqual([
      'well-formed',
      'malformed',
    ]);
    expect(only({ type: 'integer', format: 'int32' })).toEqual(['at-int32-max', 'above-int32-max']);
    expect(only({ type: 'integer', minimum: 1, 'x-nullable': true })).toEqual([
      'below-minimum',
      'at-minimum',
      'above-minimum',
      'null',
    ]);
    expect(only({ type: 'string', not: { enum: ['admin'] } })).toEqual(['excluded', 'allowed']);
    expect(
      only({
        type: 'object',
        additionalProperties: { type: 'string' },
        propertyNames: { pattern: '^[a-z]+$' },
      }),
    ).toEqual(['well-formed-key', 'malformed-key']);
    expect(only({ type: 'array', items: { type: 'string' }, contains: { const: 'vip' } })).toEqual([
      'empty',
      'one-item',
      'several-items',
      'has-match',
      'no-match',
    ]);
    expect(
      only({ type: 'array', items: { type: 'string' }, contains: { const: 'vip' }, minContains: 3 }),
    ).toEqual([
      'empty',
      'one-item',
      'several-items',
      'has-match',
      'no-match',
      'below-min-contains',
      'at-min-contains',
    ]);
  });

  it('unevaluatedProperties false, additionalProperties with a schema and patternProperties add a case each', () => {
    const base = { type: 'object', required: ['p'], properties: { p: { type: 'boolean' } } };
    const read = (
      extra: Record<string, unknown>,
      side: 'input_schema' | 'output_schema' = 'input_schema',
    ) => {
      const result = toolsPrepass(
        stringify({ tools: [{ name: 't.x', [side]: { ...base, ...extra } }] }),
        'tools.yaml',
      );
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return result.dimensions.slice(1).map((d) => [d.id, d.values.map((v) => v.id.slice(d.id.length + 1))]);
    };
    expect(read({ unevaluatedProperties: false })).toEqual([['t.x.in.unknown-key', ['sent']]]);
    expect(read({ unevaluatedProperties: false }, 'output_schema')).toEqual([
      ['t.x.out.unknown-key', ['sent']],
    ]);
    expect(read({ additionalProperties: { type: 'integer' } })).toEqual([
      ['t.x.in.extra-key', ['typed', 'mistyped']],
    ]);
    expect(read({ patternProperties: { '^x_': { type: 'integer' } } })).toEqual([
      ['t.x.in.pattern-key', ['matching', 'mistyped']],
    ]);
    expect(read({ additionalProperties: true })).toEqual([]);
  });

  it('dependentRequired, dependencies and dependentSchemas give present-without-<other>', () => {
    const properties = { p: { type: 'string', format: 'email' }, confirm: { type: 'boolean' } };
    for (const extra of [
      { dependentRequired: { p: ['confirm'] } },
      { dependencies: { p: ['confirm'] } },
      { dependentSchemas: { p: { required: ['confirm'] } } },
    ]) {
      const schema = { type: 'object', required: [], properties, ...extra };
      const result = toolsPrepass(
        stringify({ tools: [{ name: 't.x', input_schema: schema }] }),
        'tools.yaml',
      );
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      expect(result.dimensions[0]?.values.map((v) => v.id.slice('t.x.in.p.'.length))).toEqual([
        'well-formed',
        'malformed',
        'absent',
        'present-without-confirm',
      ]);
      expect(result.dimensions[1]?.values.length).toBe(3);
    }
  });

  it('leaves out a readOnly property of an input, a writeOnly property of an output and a deprecated property', () => {
    const properties = {
      p: { type: 'boolean' },
      made: { type: 'string', format: 'date-time', readOnly: true },
      secret: { type: 'string', pattern: '^[0-9]{4}$', writeOnly: true },
      old: { type: 'boolean', deprecated: true },
    };
    const read = (side: 'input_schema' | 'output_schema') => {
      const schema = { type: 'object', required: ['p'], properties };
      const result = toolsPrepass(stringify({ tools: [{ name: 't.x', [side]: schema }] }), 'tools.yaml');
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return result.dimensions.map((d) => d.id);
    };
    expect(read('input_schema')).toEqual(['t.x.in.p', 't.x.in.secret']);
    expect(read('output_schema')).toEqual(['t.x.out.p', 't.x.out.made']);
  });

  it('a readOnly output and a writeOnly input are always there: no absent case', () => {
    const read = (side: 'input_schema' | 'output_schema', flag: 'readOnly' | 'writeOnly') => {
      const schema = {
        type: 'object',
        required: [],
        properties: { q: { type: 'string', format: 'date-time', [flag]: true } },
      };
      const result = toolsPrepass(stringify({ tools: [{ name: 't.x', [side]: schema }] }), 'tools.yaml');
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return result.dimensions.map((d) => d.values.map((v) => v.id.slice(d.id.length + 1)));
    };
    expect(read('output_schema', 'readOnly')).toEqual([['well-formed', 'malformed']]);
    expect(read('input_schema', 'writeOnly')).toEqual([['well-formed', 'malformed']]);
    expect(read('input_schema', 'readOnly')).toEqual([]);
  });

  it('if, then and else give the dimension if with then and else', () => {
    const schema = {
      type: 'object',
      required: ['p'],
      properties: { p: { type: 'string', enum: ['high', 'low'] }, extra_note: { type: 'string' } },
      if: { properties: { p: { const: 'high' } } },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword
      then: { required: ['extra_note'] },
      else: {},
    };
    const result = toolsPrepass(stringify({ tools: [{ name: 't.x', input_schema: schema }] }), 'tools.yaml');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.dimensions.map((d) => [d.id, d.values.map((v) => v.id.slice(d.id.length + 1))])).toEqual([
      ['t.x.in.p', ['high', 'low']],
      ['t.x.in.extra_note', ['present', 'absent']],
      ['t.x.in.if', ['then', 'else']],
    ]);
    const { else: _else, ...noElse } = schema;
    const only = toolsPrepass(stringify({ tools: [{ name: 't.x', input_schema: noElse }] }), 'tools.yaml');
    if (!only.ok) throw new Error('x');
    expect(only.dimensions.at(-1)?.values.map((v) => v.id.slice('t.x.in.if.'.length))).toEqual([
      'then',
      'else',
    ]);
  });

  it('keywords beside a $ref apply with it, and a $ref to an $anchor reads the anchored schema', () => {
    const read = (property: Record<string, unknown>, defs: Record<string, unknown>) => {
      const schema = { type: 'object', required: ['p'], properties: { p: property }, $defs: defs };
      const result = toolsPrepass(
        stringify({ tools: [{ name: 't.x', input_schema: schema }] }),
        'tools.yaml',
      );
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return result.dimensions[0]?.values.map((v) => v.id.slice('t.x.in.p.'.length));
    };
    expect(read({ $ref: '#/$defs/Count', maximum: 50 }, { Count: { type: 'integer', minimum: 1 } })).toEqual([
      'below-minimum',
      'at-minimum',
      'above-minimum',
      'below-maximum',
      'at-maximum',
      'above-maximum',
    ]);
    expect(read({ $ref: '#Status' }, { S: { $anchor: 'Status', type: 'string', enum: ['a', 'b'] } })).toEqual(
      ['a', 'b'],
    );
  });

  it('oneOf of objects gives the variants and each variant property as <prop>.<variant>.<child>', () => {
    const property = {
      oneOf: [
        {
          title: 'card',
          type: 'object',
          required: ['last_four'],
          properties: { last_four: { type: 'string', pattern: '^[0-9]{4}$' } },
        },
        {
          title: 'transfer',
          type: 'object',
          required: ['urgent'],
          properties: { urgent: { type: 'boolean' } },
        },
      ],
    };
    expect(partitions(property)).toEqual({
      't.x.in.p': ['variant-card', 'variant-transfer'],
      't.x.in.p.card.last_four': ['well-formed', 'malformed'],
      't.x.in.p.transfer.urgent': ['true', 'false'],
    });
  });

  it('additionalProperties false on an input gives unknown-key with sent; on an output it gives none', () => {
    const schema = (extra: Record<string, unknown>) => ({
      type: 'object',
      required: ['p'],
      properties: { p: { type: 'boolean' } },
      ...extra,
    });
    const read = (side: 'input_schema' | 'output_schema', extra: Record<string, unknown>) => {
      const result = toolsPrepass(
        stringify({ tools: [{ name: 't.x', [side]: schema(extra) }] }),
        'tools.yaml',
      );
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return result.dimensions.map((d) => d.values.map((v) => v.id));
    };
    expect(read('input_schema', { additionalProperties: false })).toEqual([
      ['t.x.in.p.true', 't.x.in.p.false'],
      ['t.x.in.unknown-key.sent'],
    ]);
    expect(read('output_schema', { additionalProperties: false })).toEqual([
      ['t.x.out.p.true', 't.x.out.p.false'],
    ]);
    expect(read('input_schema', { additionalProperties: true })).toEqual([
      ['t.x.in.p.true', 't.x.in.p.false'],
    ]);
  });

  it('unevaluatedItems false or additionalItems false on a tuple adds extra-item and keeps the positions', () => {
    for (const closed of [
      { unevaluatedItems: false, prefixItems: [{ type: 'boolean' }] },
      { additionalItems: false, items: [{ type: 'boolean' }] },
    ]) {
      expect(partitions({ type: 'array', ...closed })).toEqual({
        't.x.in.p': ['empty', 'one-item', 'several-items', 'extra-item'],
        't.x.in.p.0': ['true', 'false'],
      });
    }
  });
});
