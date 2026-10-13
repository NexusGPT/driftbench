import { describe, expect, it } from 'vitest';
import { Proposal } from '../../src/extract/proposal';
import { type JsonSchema, prepareMap } from '../../src/seed/map';
import { graphSeeder, worldFor } from '../../src/seed/seeders';
import { ZED_TOOLS, zedProposal } from '../enumerate/support';

const by = {
  produced_by: 'code' as const,
  approved: true,
  evidence: { source: 'prompt.md', quote: 'Report the returned amount.' },
};

function prepared(
  schema: JsonSchema = { type: 'number', minimum: 1 },
  partition = 'present',
  slots: Record<string, string> = { amount: '24' },
  phraseAmount?: string,
) {
  const proposal = zedProposal();
  const dimension = 'lookup.out.amount';
  const value = `${dimension}.${partition}`;
  proposal.dimensions.push({
    id: dimension,
    title: 'Returned amount',
    kind: 'data',
    role: 'detail',
    produced_by: 'code',
    approved: true,
    values: [{ id: value, title: 'The selected amount', ...by }],
  });
  proposal.relations = [
    {
      kind: 'path',
      id: 'balance-amount',
      flow: 'balance',
      stages: ['greet', 'verify'],
      when: { [dimension]: [value] },
      ...by,
    },
    {
      kind: 'uses_tool',
      subject: { dimension: 'flow', value: 'balance' },
      tool: 'lookup',
      stage: 'greet',
      to: 'verify',
      input: { account: '4' },
      ...by,
    },
    { kind: 'binds', subject: { dimension, value }, slots, ...by },
    {
      kind: 'states',
      subject: { dimension: 'flow', value: 'balance' },
      stage: 'greet',
      to: 'verify',
      must: ['Amount is {amount}'],
      must_not: ['Amount is not {amount}'],
      ...by,
    },
  ];
  if (phraseAmount !== undefined) {
    const phrase = proposal.phrases.find((entry) => entry.value === 'greet-to-verify');
    if (!phrase) throw new Error('missing opening phrase');
    phrase.binds = { amount: phraseAmount };
  }
  const tools = structuredClone(ZED_TOOLS);
  tools[0] = {
    ...tools[0],
    name: 'lookup',
    slug: 'lookup',
    output: {
      type: 'object',
      required: ['found', 'amount'],
      properties: { found: { type: 'boolean' }, amount: schema },
    },
  };
  return prepareMap(Proposal.parse(proposal), { tools });
}

const context = { seed: 1, t: 2, max: 5 };

describe('tool values bound by reply assertions', () => {
  it('injects the exact bound number and detects the old schema-default mutation', () => {
    const result = graphSeeder(prepared(), context);
    expect(result.drafts).toHaveLength(1);
    const draft = result.drafts[0];
    expect(draft?.world?.tools?.lookup?.result).toEqual({ found: true, amount: 24 });
    expect(draft?.blocks[0]?.must).toEqual(['Amount is 24']);
    expect(draft?.blocks[0]?.must_not).toEqual(['Amount is not 24']);
    const required = new RegExp(draft?.blocks[0]?.must?.[0] ?? 'missing');
    expect(required.test('Amount is 24')).toBe(true);
    expect(required.test('Amount is 1')).toBe(false);
  });

  it('preserves legacy partition defaults when binding injection is not requested', () => {
    const map = prepared();
    const dimension = map.space.dimensions.findIndex((entry) => entry.id === 'lookup.out.amount');
    const value = map.space.dimensions[dimension]?.index.get('lookup.out.amount.present');
    if (value === undefined) throw new Error('missing output partition');
    expect(worldFor(map, [[dimension, value]]).world?.tools?.lookup?.result).toEqual({
      found: true,
      amount: 1,
    });
  });

  it.each([
    [{ type: 'string' }, 'present', '24', '24'],
    [{ type: 'boolean' }, 'present', 'false', false],
    [{ type: 'integer', minimum: 1 }, 'present', '24', 24],
    [{ type: ['number', 'null'] }, 'present', 'null', null],
    [{ enum: ['standard', 'premium'] }, 'present', 'premium', 'premium'],
    [{ type: 'boolean' }, 'false', 'false', false],
    [{ type: 'string', enum: ['standard', 'premium'] }, 'premium', 'premium', 'premium'],
    [{ type: 'number', minimum: 1 }, 'at-minimum', '1', 1],
  ] as const)('keeps the scalar type and partition for %j / %s', (schema, partition, binding, value) => {
    const result = graphSeeder(prepared(schema, partition, { amount: binding }), context);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.world?.tools?.lookup?.result).toEqual({ found: true, amount: value });
  });

  it.each([
    [{ type: 'boolean' }, 'false', 'true'],
    [{ type: 'string', enum: ['standard', 'premium'] }, 'premium', 'standard'],
    [{ type: 'number', minimum: 1 }, 'at-minimum', '24'],
  ] as const)('refuses a binding that contradicts %j / %s', (schema, partition, binding) => {
    const result = graphSeeder(prepared(schema, partition, { amount: binding }), context);
    expect(result.drafts).toHaveLength(0);
    expect(result.summary.unwalked?.[0]?.reasons.join(' ')).toContain(
      `bound reply value does not match the ${partition} partition`,
    );
  });

  it.each([
    [{ type: 'number', minimum: 25 }, '24'],
    [{ type: 'number', maximum: 23 }, '24'],
    [{ type: 'number', exclusiveMinimum: 24 }, '24'],
    [{ type: 'number', exclusiveMaximum: 24 }, '24'],
    [{ type: 'integer' }, '24.5'],
    [{ type: 'number' }, '24.0'],
    [{ type: 'number' }, 'Infinity'],
    [{ type: ['number', 'string'] }, '24'],
  ] as const)('refuses ambiguous or invalid present scalars for %j', (schema, binding) => {
    const result = graphSeeder(prepared(schema, 'present', { amount: binding }), context);
    expect(result.drafts).toHaveLength(0);
    expect(result.summary.unwalked?.[0]?.reasons.join(' ')).toContain('schema type and bounds');
  });

  it('refuses different bindings for one output field', () => {
    const result = graphSeeder(prepared(undefined, 'present', { amount: '24', alternate: '25' }), context);
    expect(result.drafts).toHaveLength(0);
    expect(result.summary.unwalked?.[0]?.reasons.join(' ')).toContain('ambiguous bound reply values');
  });

  it('allows multiple names that bind the same output value', () => {
    const result = graphSeeder(prepared(undefined, 'present', { amount: '24', alternate: '24' }), context);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.world?.tools?.lookup?.result).toEqual({ found: true, amount: 24 });
  });

  it('refuses a phrase that changes an output-bound slot', () => {
    const result = graphSeeder(prepared(undefined, 'present', { amount: '24' }, '25'), context);
    expect(result.drafts).toHaveLength(0);
    expect(result.summary.unwalked?.[0]?.reasons.join(' ')).toMatch(/overwrote|changed|overrid/);
  });
});
