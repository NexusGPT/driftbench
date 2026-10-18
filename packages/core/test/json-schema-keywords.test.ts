import { Expect, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

const unsupported = {
  $ref: '#/definitions/item',
  not: { type: 'string' },
  format: 'email',
  if: { type: 'string' },
  // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a promise.
  then: { minLength: 4 },
  else: { type: 'number' },
  patternProperties: { '^x': { type: 'string' } },
  uniqueItems: true,
  multipleOf: 2,
  unknownKeyword: true,
};
const base = { id: 'schema-test', kind: 'conversation', blocks: [{ when: { user: 'Go' } }] };

describe('JSON Schema keyword validation', () => {
  it.each(Object.entries(unsupported))('rejects %s in reply schemas at parse time', (keyword, value) => {
    const result = Expect.safeParse({ json: { schema: { [keyword]: value } } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain(keyword);
  });

  it.each(['direct', 'parameters', 'input_schema'])(
    'rejects nested keywords in %s tool schemas',
    (wrapper) => {
      const schema = { properties: { optional: { format: 'email' } } };
      const tool = wrapper === 'direct' ? schema : { [wrapper]: schema };
      const result = Spec.safeParse({ ...base, metadata: { tool_schemas: { lookup: tool } } });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.message).toContain('format');
    },
  );

  it.each([
    { properties: { unused: { not: {} } } },
    { items: { not: {} } },
    { additionalProperties: { not: {} } },
    { anyOf: [{}, { not: {} }] },
    { oneOf: [{}, { not: {} }] },
    { allOf: [{ not: {} }] },
  ])('rejects unsupported keywords in every schema position: %j', (schema) => {
    const result = Expect.safeParse({ json: { schema } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('not');
  });

  it('rejects unsupported tuple items instead of ignoring their schemas', () => {
    const result = Expect.safeParse({ json: { schema: { items: [{ type: 'string' }] } } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('items');
  });

  it('accepts harmless annotations and arbitrary data keys inside const, enum and properties', () => {
    const schema = {
      title: 'Example',
      description: 'Example schema',
      default: { format: 'data' },
      examples: [{ not: 'data' }],
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'urn:example:test',
      $comment: 'No validation effect',
      type: 'object',
      properties: { format: { const: { not: true } }, not: { enum: [{ $ref: 'data' }] } },
    };
    expect(Expect.safeParse({ json: { schema } }).success).toBe(true);
  });
});
