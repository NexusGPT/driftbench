import { describe, expect, it } from 'vitest';
import { Spec } from '../src/schema/spec';
import { parseSpecSchema } from '../src/spec/compiled-schema';

const base = {
  id: 'schema-parity',
  kind: 'conversation',
  blocks: [{ when: { user: 'hello' }, expect: { stage: 'done' } }],
};

function same(input: unknown): void {
  const reference = Spec.safeParse(input);
  const compiled = parseSpecSchema(input);
  expect(compiled.success).toBe(reference.success);
  if (reference.success && compiled.success) expect(compiled.data).toEqual(reference.data);
  else if (!reference.success && !compiled.success)
    expect(compiled.error.issues).toEqual(reference.error.issues);
}

describe('compiled spec parsing', () => {
  it('preserves full errors, unknown fields, unions and refinements', () => {
    for (const value of [undefined, null, '', 0, true, [], {}, Infinity, { exact: 2 }, { regex: '[' }]) {
      for (const key of ['id', 'kind', 'blocks', 'given', 'metadata', 'criteria', 'rules', 'end_state'])
        same({ ...base, [key]: value });
      same({
        ...base,
        blocks: [
          { when: { user: 'hello', extra: true }, expect: { tools: [{ label: 'tool', count: value }] } },
        ],
      });
      same({
        ...base,
        blocks: [
          { when: { user: 'hello' }, expect: { tools: [{ label: 'tool', input: { field: value } }] } },
        ],
      });
    }
    same({ ...base, metadata: { tool_schemas: { tool: { input: { type: 'object', unsupported: true } } } } });
  });

  it('keeps deeply nested JSON on the original parser and returns fresh parsed containers', () => {
    let json: unknown = 'leaf';
    for (let depth = 0; depth < 50; depth += 1) json = { child: json };
    const input = { ...base, given: { world: { tools: { tool: { result: json } } } } };
    same(input);
    const first = parseSpecSchema(base);
    const second = parseSpecSchema(base);
    if (!first.success || !second.success) throw new Error('fixture must parse');
    const firstBlock = first.data.blocks[0];
    if (!firstBlock) throw new Error('fixture needs a block');
    firstBlock.when = { user: 'changed' };
    expect(second.data.blocks[0]?.when).toEqual({ user: 'hello' });
    expect(base.blocks[0]?.when).toEqual({ user: 'hello' });
  });
});
