import type { JsonExpect, Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { replyJson } from '../src/checks/reply_json';
import { schemaStrict } from '../src/checks/schema_strict';
import { validateStrict } from '../src/support/schema';
import { context, observed, run } from './support/context';

const spec: Spec = { id: 'schema-test', kind: 'conversation', blocks: [{ when: { user: 'Go' } }] };
const cases: NonNullable<JsonExpect['schema']>[] = [
  { $ref: '#/definitions/item' },
  { not: { type: 'string' } },
  { format: 'email' },
  // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword, not a promise.
  { if: {}, then: {}, else: {} },
  { patternProperties: { '^x': {} } },
  { uniqueItems: true },
  { multipleOf: 2 },
  { items: [{ type: 'string' }] },
  { anyOf: [{}, { properties: { unused: { format: 'email' } } }] },
];

describe('unsupported schemas fail closed at runtime', () => {
  it.each(cases)('returns an inconclusive gating reply verdict for %j', async (schema) => {
    const ctx = context(spec, 0, observed('"invalid"'), { expect: { json: { schema } } });
    const results = await run(replyJson, ctx);
    expect(results.find((entry) => entry.id === 'json.schema')).toMatchObject({
      outcome: 'inconclusive',
      gating: true,
      evidence: expect.stringContaining('unsupported'),
    });
  });

  it('keeps annotations and schema-looking data values valid at runtime', () => {
    expect(
      validateStrict(
        { format: 'value' },
        {
          title: 'Example',
          description: 'Example schema',
          default: { not: true },
          examples: [{ $ref: 'data' }],
          $schema: 'urn:example:dialect',
          $id: 'urn:example:id',
          $comment: 'Annotation',
          const: { format: 'value' },
          enum: [{ format: 'value' }],
          properties: { format: { type: 'string' } },
        },
      ),
    ).toEqual([]);
  });

  it('does not let anyOf or absent properties hide unsupported constraints', () => {
    const issues = validateStrict({}, { anyOf: [{}, { properties: { absent: { format: 'email' } } }] });
    expect(issues).toEqual([expect.objectContaining({ message: expect.stringContaining('format') })]);
  });

  it('returns an inconclusive gating tool verdict when spec parsing was bypassed', async () => {
    const ctx = context(
      { ...spec, metadata: { tool_schemas: { lookup: { multipleOf: 2 } } } },
      0,
      observed('', [{ label: 'lookup', input: 3 }]),
    );
    expect((await run(schemaStrict, ctx))[0]).toMatchObject({
      outcome: 'inconclusive',
      gating: true,
      evidence: expect.stringContaining('multipleOf'),
    });
  });
});
