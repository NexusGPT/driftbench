import { stringify } from 'yaml';
import type { Draw } from '../../spec';
import {
  BANK_COMPONENTS,
  blockOf,
  drawFor,
  inventoryCode,
  inventorySource,
  MEMBER_POOL,
  miniInventory,
  TOOL_POOL,
} from '../common';
import type { CodeEntry, Parts } from '../facts';
import { mapItem } from '../run';
import { type BankItem, levelOf, type Tier } from '../types';

/**
 * Family schema-keywords: one item per JSON Schema keyword or form a tool argument can state. The generator
 * draws a tool, a direction and the keyword's numbers and names from the seed; the oracle lists the
 * partitions the tool pre-pass must propose, by its documented contract (packages/generate/src/extract/
 * tools.ts) and, for keywords that contract does not cover yet, by the convention each item's title states.
 * The convention keeps the pre-pass's id scheme: `<tool>.<in|out>.<path>` for the dimension and
 * `<dimension>.<partition>` for each value.
 */

type Expected = Array<{ path: string[]; partitions: string[] }>;
type Case = {
  slug: string;
  /** The one change that makes the item pass; `tools:<slug>` when absent. */
  cause?: string;
  tier: Tier;
  title: string;
  /** The properties of the schema, their required list, extra keys of the object, and the expected dims. */
  make(
    draw: Draw,
    name: string,
  ): {
    properties: Record<string, unknown>;
    required: string[];
    extra?: Record<string, unknown>;
    expected: Expected;
    /** Per partition, the YAML key whose whole block (after the property's own line) the quote must be. */
    quotes?: Record<string, string | { key: string; after: string }>;
    /** Per partition, text its title must hold. */
    titles?: Record<string, string>;
  };
  /** The tool name as written, and its slug in the dimension ids, when not drawn from the pool. */
  tool?: { name: string; slug: string };
  /** The parts of the proposal the item compares (all of them when absent). */
  parts?: Parts;
};

const range = (draw: Draw) => draw.int(1, 9);
const members = (draw: Draw) => [...draw.pick(MEMBER_POOL)];
const ARRAY = ['empty', 'one-item', 'several-items'];
const MIN = ['below-minimum', 'at-minimum', 'above-minimum'];
const MAX = ['below-maximum', 'at-maximum', 'above-maximum'];

/** One required property with this schema and these partitions. */
const one =
  (
    schema: (draw: Draw) => Record<string, unknown>,
    partitions: (schema: Record<string, unknown>) => string[],
  ) =>
  (draw: Draw, name: string) => {
    const made = schema(draw);
    return {
      properties: { [name]: made },
      required: [name],
      expected: [{ path: [name], partitions: partitions(made) }],
    };
  };

export const SCHEMA_CASES: readonly Case[] = [
  // The contract the pre-pass documents today.
  {
    slug: 'enum',
    tier: 1,
    title: 'an enum gives one value per member',
    make: one(
      (d) => ({ type: 'string', enum: members(d) }),
      (s) => s.enum as string[],
    ),
  },
  {
    slug: 'enum-integers',
    tier: 1,
    title: 'an enum of integers gives one value per member',
    make: one(
      (d) => ({ type: 'integer', enum: [range(d), range(d) + 10, range(d) + 20] }),
      (s) => (s.enum as number[]).map(String),
    ),
  },
  {
    slug: 'boolean',
    tier: 1,
    title: 'a boolean gives true and false',
    make: one(
      () => ({ type: 'boolean' }),
      () => ['true', 'false'],
    ),
  },
  {
    slug: 'minimum',
    tier: 1,
    title: 'a minimum gives below, at and above it',
    make: one(
      (d) => ({ type: 'integer', minimum: range(d) }),
      () => MIN,
    ),
  },
  {
    slug: 'maximum',
    tier: 1,
    title: 'a maximum gives below, at and above it',
    make: one(
      (d) => ({ type: 'integer', maximum: range(d) + 50 }),
      () => MAX,
    ),
  },
  {
    slug: 'exclusive-minimum',
    tier: 1,
    title: 'a numeric exclusiveMinimum gives at and above it',
    make: one(
      (d) => ({ type: 'number', exclusiveMinimum: range(d) }),
      () => ['at-exclusive-minimum', 'above-exclusive-minimum'],
    ),
  },
  {
    slug: 'exclusive-maximum',
    tier: 1,
    title: 'a numeric exclusiveMaximum gives below and at it',
    make: one(
      (d) => ({ type: 'number', exclusiveMaximum: range(d) + 50 }),
      () => ['below-exclusive-maximum', 'at-exclusive-maximum'],
    ),
  },
  {
    slug: 'min-length',
    tier: 1,
    title: 'a minLength above zero gives below and at it',
    make: one(
      (d) => ({ type: 'string', minLength: range(d) }),
      () => ['below-min-length', 'at-min-length'],
    ),
  },
  {
    slug: 'max-length',
    tier: 1,
    title: 'a maxLength gives at and above it',
    make: one(
      (d) => ({ type: 'string', maxLength: range(d) + 20 }),
      () => ['at-max-length', 'above-max-length'],
    ),
  },
  {
    slug: 'format',
    tier: 1,
    title: 'a format gives well-formed and malformed',
    make: one(
      (d) => ({ type: 'string', format: d.pick(['email', 'date', 'uri', 'uuid', 'date-time']) }),
      () => ['well-formed', 'malformed'],
    ),
  },
  {
    slug: 'pattern',
    tier: 1,
    title: 'a pattern gives well-formed and malformed',
    make: one(
      () => ({ type: 'string', pattern: '^[A-Z]{2}[0-9]{4}$' }),
      () => ['well-formed', 'malformed'],
    ),
  },
  {
    slug: 'array',
    tier: 1,
    title: 'an array gives empty, one item and several items',
    make: one(
      () => ({ type: 'array', items: { type: 'string' } }),
      () => ARRAY,
    ),
  },
  {
    slug: 'max-items',
    tier: 1,
    title: 'maxItems adds at and above it',
    make: one(
      (d) => ({ type: 'array', items: { type: 'string' }, maxItems: range(d) + 2 }),
      () => [...ARRAY, 'at-max-items', 'above-max-items'],
    ),
  },
  {
    slug: 'const',
    tier: 1,
    title: 'a const gives its one value',
    make: one(
      (d) => ({ type: 'string', const: d.pick(['fixed', 'standard', 'v2']) }),
      (s) => [String(s.const)],
    ),
  },
  {
    slug: 'nullable',
    tier: 2,
    title: 'nullable true adds null',
    make: one(
      (d) => ({ type: 'integer', minimum: range(d), nullable: true }),
      () => [...MIN, 'null'],
    ),
  },
  {
    slug: 'type-null',
    tier: 2,
    title: 'a type list with null adds null after the members',
    make: one(
      (d) => ({ type: ['string', 'null'], enum: [...members(d), null] }),
      (s) => [...(s.enum as Array<string | null>).map((m) => String(m))],
    ),
  },
  {
    slug: 'optional-open',
    tier: 1,
    title: 'an optional property the schema leaves open gives present and absent',
    make: (_d, name) => ({
      properties: { [name]: { type: 'string' } },
      required: [],
      expected: [{ path: [name], partitions: ['present', 'absent'] }],
    }),
  },
  {
    slug: 'nested',
    tier: 2,
    title: 'a property of a nested object is followed one level down',
    make: (d, name) => ({
      properties: {
        [name]: {
          type: 'object',
          required: ['kind'],
          properties: { kind: { type: 'string', enum: members(d) } },
        },
      },
      required: [name],
      expected: [],
    }),
  },
  {
    slug: 'nullable-object',
    tier: 2,
    title: 'an object or null gives present and null',
    make: (_d, name) => ({
      properties: {
        [name]: { type: ['object', 'null'], properties: { flag: { type: 'boolean' } }, required: ['flag'] },
      },
      required: [name],
      expected: [
        { path: [name], partitions: ['present', 'null'] },
        { path: [name, 'flag'], partitions: ['true', 'false'] },
      ],
    }),
  },
  {
    slug: 'two-types',
    tier: 2,
    title: 'a type list of integer and string gives both kinds of partition',
    make: one(
      (d) => ({ type: ['integer', 'string'], minimum: range(d), maxLength: 30 }),
      () => [...MIN, 'at-max-length', 'above-max-length'],
    ),
  },

  // Keywords the pre-pass does not read yet: the convention is in each title.
  {
    slug: 'multiple-of',
    tier: 2,
    title: 'multipleOf gives multiple and not-multiple',
    make: one(
      (d) => ({ type: 'integer', multipleOf: d.pick([5, 10, 25]) }),
      () => ['multiple', 'not-multiple'],
    ),
  },
  {
    slug: 'unique-items',
    tier: 2,
    title: 'uniqueItems adds duplicate-items to the array partitions',
    make: one(
      () => ({ type: 'array', items: { type: 'string' }, uniqueItems: true }),
      () => [...ARRAY, 'duplicate-items'],
    ),
  },
  {
    slug: 'min-items',
    tier: 2,
    title: 'minItems adds below-min-items and at-min-items',
    make: one(
      (d) => ({ type: 'array', items: { type: 'string' }, minItems: range(d) + 1 }),
      () => [...ARRAY, 'below-min-items', 'at-min-items'],
    ),
  },
  {
    slug: 'min-max-properties',
    tier: 3,
    title:
      'minProperties and maxProperties give below-min-properties, at-min-properties, at-max-properties, above-max-properties',
    make: one(
      (d) => ({
        type: 'object',
        minProperties: 1,
        maxProperties: range(d) + 2,
        additionalProperties: { type: 'string' },
      }),
      () => ['below-min-properties', 'at-min-properties', 'at-max-properties', 'above-max-properties'],
    ),
  },
  {
    slug: 'exclusive-minimum-boolean',
    tier: 2,
    title: 'draft-04 exclusiveMinimum true with minimum gives at and above the exclusive minimum',
    make: one(
      (d) => ({ type: 'number', minimum: range(d), exclusiveMinimum: true }),
      () => ['at-exclusive-minimum', 'above-exclusive-minimum'],
    ),
  },
  {
    slug: 'exclusive-maximum-boolean',
    tier: 2,
    title: 'draft-04 exclusiveMaximum true with maximum gives below and at the exclusive maximum',
    make: one(
      (d) => ({ type: 'number', maximum: range(d) + 50, exclusiveMaximum: true }),
      () => ['below-exclusive-maximum', 'at-exclusive-maximum'],
    ),
  },
  {
    slug: 'format-without-type',
    tier: 2,
    title: 'a format with no type is a string: well-formed and malformed',
    make: one(
      (d) => ({ format: d.pick(['email', 'date', 'uri']) }),
      () => ['well-formed', 'malformed'],
    ),
  },
  {
    slug: 'minimum-without-type',
    tier: 2,
    title: 'a minimum with no type is a number: below, at and above it',
    make: one(
      (d) => ({ minimum: range(d) }),
      () => MIN,
    ),
  },
  {
    slug: 'content-encoding',
    tier: 3,
    title: 'contentEncoding base64 gives well-formed and malformed',
    make: one(
      () => ({ type: 'string', contentEncoding: 'base64' }),
      () => ['well-formed', 'malformed'],
    ),
  },
  {
    slug: 'one-of',
    tier: 3,
    title: 'oneOf gives one value per branch, variant-<title> or variant-<n>',
    make: one(
      (d) => ({
        oneOf: [
          { title: 'by-email', type: 'string', format: 'email' },
          { title: 'by-code', type: 'string', pattern: `^[0-9]{${range(d) + 3}}$` },
        ],
      }),
      () => ['variant-by-email', 'variant-by-code'],
    ),
  },
  {
    slug: 'any-of',
    tier: 3,
    title: 'anyOf gives one value per branch, variant-<n> when untitled',
    make: one(
      () => ({ anyOf: [{ type: 'integer' }, { type: 'string', format: 'date' }] }),
      () => ['variant-1', 'variant-2'],
    ),
  },
  {
    slug: 'any-of-null',
    tier: 3,
    title: 'anyOf of a type and null (an optional field from Pydantic) gives the type partitions and null',
    make: one(
      (d) => ({ anyOf: [{ type: 'integer', minimum: range(d) }, { type: 'null' }] }),
      () => [...MIN, 'null'],
    ),
  },
  {
    slug: 'all-of',
    tier: 3,
    title: 'allOf merges its members: the partitions of each',
    make: one(
      (d) => ({ allOf: [{ type: 'integer', minimum: range(d) }, { maximum: range(d) + 50 }] }),
      () => [...MIN, ...MAX],
    ),
  },
  {
    slug: 'ref-defs',
    tier: 3,
    title: 'a $ref to $defs reads the referenced schema',
    make: (d, name) => ({
      properties: { [name]: { $ref: '#/$defs/Choice' } },
      required: [name],
      extra: { $defs: { Choice: { type: 'string', enum: ['north', 'south', d.pick(['east', 'west'])] } } },
      expected: [],
    }),
  },
  {
    slug: 'ref-definitions',
    tier: 3,
    title: 'a $ref to draft-07 definitions reads the referenced schema',
    make: (d, name) => ({
      properties: { [name]: { $ref: '#/definitions/Size' } },
      required: [name],
      extra: { definitions: { Size: { type: 'integer', minimum: range(d) } } },
      expected: [],
    }),
  },
  {
    slug: 'depth-three',
    tier: 3,
    title: 'objects are followed three levels down',
    make: (d, name) => ({
      properties: {
        [name]: {
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
                  properties: { level: { type: 'string', enum: members(d) } },
                },
              },
            },
          },
        },
      },
      required: [name],
      expected: [],
    }),
  },
  {
    slug: 'array-of-objects',
    tier: 3,
    title: 'the properties of array items are followed as <array>.item.<property>',
    make: (d, name) => ({
      properties: {
        [name]: {
          type: 'array',
          items: {
            type: 'object',
            required: ['kind'],
            properties: { kind: { type: 'string', enum: members(d) } },
          },
        },
      },
      required: [name],
      expected: [],
    }),
  },
  {
    slug: 'array-items-enum',
    tier: 3,
    title: 'an enum on array items gives <array>.item with one value per member',
    make: (d, name) => ({
      properties: { [name]: { type: 'array', items: { type: 'string', enum: members(d) } } },
      required: [name],
      expected: [],
    }),
  },
  {
    slug: 'prefix-items',
    tier: 4,
    title: 'prefixItems give one dimension per position, <array>.0 and <array>.1',
    make: (d, name) => ({
      properties: {
        [name]: { type: 'array', prefixItems: [{ type: 'string', enum: members(d) }, { type: 'boolean' }] },
      },
      required: [name],
      expected: [],
    }),
  },
  {
    slug: 'contains',
    tier: 4,
    title: 'contains gives has-match and no-match on top of the array partitions',
    make: one(
      (d) => ({ type: 'array', items: { type: 'string' }, contains: { const: d.pick(['urgent', 'vip']) } }),
      () => [...ARRAY, 'has-match', 'no-match'],
    ),
  },
  {
    slug: 'dependent-required',
    tier: 4,
    title: 'dependentRequired gives present-without-<other> on the property that needs the other',
    make: (_d, name) => ({
      properties: { [name]: { type: 'string', format: 'email' }, confirm: { type: 'boolean' } },
      required: [],
      extra: { dependentRequired: { [name]: ['confirm'] } },
      expected: [
        { path: [name], partitions: ['well-formed', 'malformed', 'absent', 'present-without-confirm'] },
        { path: ['confirm'], partitions: ['true', 'false', 'absent'] },
      ],
    }),
  },
  {
    slug: 'dependencies',
    tier: 4,
    title: 'draft-07 dependencies (array form) gives present-without-<other>',
    make: (_d, name) => {
      // The other property is never the drawn one: two properties of one name are one key in YAML.
      const other = name === 'reason' ? 'detail' : 'reason';
      return {
        properties: { [name]: { type: 'string', format: 'date' }, [other]: { type: 'string', minLength: 1 } },
        required: [],
        extra: { dependencies: { [name]: [other] } },
        expected: [
          { path: [name], partitions: ['well-formed', 'malformed', 'absent', `present-without-${other}`] },
          { path: [other], partitions: ['below-min-length', 'at-min-length', 'absent'] },
        ],
      };
    },
  },
  {
    slug: 'if-then-else',
    tier: 4,
    title: 'if, then and else give the dimension <tool>.<side>.if with then and else',
    make: (d, name) => ({
      properties: { [name]: { type: 'string', enum: members(d) }, extra_note: { type: 'string' } },
      required: [name],
      // Built from entries: a literal key named then reads as a thenable to the linter.
      extra: Object.fromEntries([
        ['if', { properties: { [name]: { const: 'high' } } }],
        ['then', { required: ['extra_note'] }],
        ['else', {}],
      ]),
      expected: [],
    }),
  },
  {
    slug: 'not',
    tier: 4,
    title: 'not with an enum gives excluded and allowed',
    make: one(
      (d) => ({ type: 'string', not: { enum: [d.pick(['admin', 'root'])] } }),
      () => ['excluded', 'allowed'],
    ),
  },
  {
    slug: 'closed-object',
    tier: 4,
    title: 'additionalProperties false on an input gives <tool>.in.unknown-key with sent',
    make: (_d, name) => ({
      properties: { [name]: { type: 'boolean' } },
      required: [name],
      extra: { additionalProperties: false },
      expected: [],
    }),
  },
  {
    slug: 'additional-properties-schema',
    tier: 4,
    title: 'additionalProperties with a schema gives <tool>.<side>.extra-key with typed and mistyped',
    make: (_d, name) => ({
      properties: { [name]: { type: 'boolean' } },
      required: [name],
      extra: { additionalProperties: { type: 'integer' } },
      expected: [],
    }),
  },
  {
    slug: 'pattern-properties',
    tier: 5,
    title: 'patternProperties give <tool>.<side>.pattern-key with matching and mistyped',
    make: (_d, name) => ({
      properties: { [name]: { type: 'boolean' } },
      required: [name],
      extra: { patternProperties: { '^x_': { type: 'integer' } } },
      expected: [],
    }),
  },
  {
    slug: 'discriminator',
    tier: 5,
    title: 'an OpenAPI discriminator gives one value per mapping key',
    make: one(
      () => ({
        oneOf: [{ $ref: '#/$defs/Card' }, { $ref: '#/$defs/Transfer' }],
        discriminator: {
          propertyName: 'method',
          mapping: { card: '#/$defs/Card', transfer: '#/$defs/Transfer' },
        },
      }),
      () => ['variant-card', 'variant-transfer'],
    ),
  },
  {
    slug: 'recursive-ref',
    tier: 5,
    title: 'a recursive $ref stops after one level: <prop>.item.<child> once',
    make: (d, name) => ({
      properties: { [name]: { $ref: '#/$defs/Node' } },
      required: [name],
      extra: {
        $defs: {
          Node: {
            type: 'object',
            required: ['label'],
            properties: {
              label: { type: 'string', enum: members(d) },
              children: { type: 'array', items: { $ref: '#/$defs/Node' } },
            },
          },
        },
      },
      expected: [],
    }),
  },
  // More keywords and forms (the hardness extension): each its own change in the pre-pass.
  {
    slug: 'unevaluated-properties',
    tier: 4,
    title: 'unevaluatedProperties false gives <tool>.<side>.unknown-key with sent, like a closed object',
    make: (_d, name) => ({
      properties: { [name]: { type: 'boolean' } },
      required: [name],
      extra: { unevaluatedProperties: false },
      expected: [
        { path: [name], partitions: ['true', 'false'] },
        { path: ['unknown-key'], partitions: ['sent'] },
      ],
    }),
  },
  {
    slug: 'unevaluated-items',
    tier: 4,
    title: 'unevaluatedItems false on a tuple adds extra-item; the tuple still gives its position <array>.0',
    make: (_d, name) => ({
      properties: { [name]: { type: 'array', prefixItems: [{ type: 'boolean' }], unevaluatedItems: false } },
      required: [name],
      expected: [
        { path: [name], partitions: [...ARRAY, 'extra-item'] },
        { path: [name, '0'], partitions: ['true', 'false'] },
      ],
    }),
  },
  {
    slug: 'min-contains',
    tier: 4,
    title: 'minContains with contains adds below-min-contains and at-min-contains',
    make: one(
      (d) => ({
        type: 'array',
        items: { type: 'string' },
        contains: { const: 'vip' },
        minContains: range(d) + 1,
      }),
      () => [...ARRAY, 'has-match', 'no-match', 'below-min-contains', 'at-min-contains'],
    ),
  },
  {
    slug: 'property-names',
    tier: 4,
    title: 'propertyNames with a pattern gives <prop> values well-formed-key and malformed-key',
    make: one(
      () => ({
        type: 'object',
        additionalProperties: { type: 'string' },
        propertyNames: { pattern: '^[a-z]+$' },
      }),
      () => ['well-formed-key', 'malformed-key'],
    ),
  },
  {
    slug: 'dependent-schemas',
    tier: 4,
    title: 'dependentSchemas that require another property give present-without-<other>',
    make: (_d, name) => ({
      properties: { [name]: { type: 'string', format: 'email' }, confirm: { type: 'boolean' } },
      required: [],
      extra: { dependentSchemas: { [name]: { required: ['confirm'] } } },
      expected: [
        { path: [name], partitions: ['well-formed', 'malformed', 'absent', 'present-without-confirm'] },
        { path: ['confirm'], partitions: ['true', 'false', 'absent'] },
      ],
    }),
  },
  {
    slug: 'read-only-input',
    tier: 3,
    title:
      'a readOnly property gives no dimension in an input (a caller never sends it) and its partitions in an output',
    make: (d, name) => ({
      properties: {
        [name]: { type: 'string', enum: members(d) },
        created_at: { type: 'string', format: 'date-time', readOnly: true },
      },
      required: [name],
      expected: [],
    }),
  },
  {
    slug: 'write-only-output',
    tier: 3,
    title:
      'a writeOnly property gives no dimension in an output (a tool never returns it) and its partitions in an input',
    make: (d, name) => ({
      properties: {
        [name]: { type: 'string', enum: members(d) },
        secret_code: { type: 'string', pattern: '^[0-9]{4}$', writeOnly: true },
      },
      required: [name],
      expected: [],
    }),
  },
  {
    slug: 'deprecated-property',
    tier: 3,
    title: 'a deprecated property gives no dimension: a generator does not exercise it',
    make: (d, name) => ({
      properties: {
        [name]: { type: 'string', enum: members(d) },
        old_code: { type: 'boolean', deprecated: true },
      },
      required: [name],
      expected: [],
    }),
  },
  {
    slug: 'default',
    tier: 3,
    title: 'an optional property with a default adds at-default before absent',
    make: (d, name) => ({
      properties: { [name]: { type: 'integer', minimum: 1, default: range(d) + 1 } },
      required: [],
      expected: [{ path: [name], partitions: [...MIN, 'at-default', 'absent'] }],
    }),
  },
  {
    slug: 'const-object',
    tier: 3,
    title: 'a const that is an object gives the one value fixed',
    make: one(
      () => ({ type: 'object', const: { mode: 'test' } }),
      () => ['fixed'],
    ),
  },
  {
    slug: 'enum-objects',
    tier: 3,
    title: 'an enum of objects gives member-1, member-2 and so on',
    make: one(
      () => ({ type: 'object', enum: [{ size: 1 }, { size: 2 }, { size: 3 }] }),
      () => ['member-1', 'member-2', 'member-3'],
    ),
  },
  {
    slug: 'tuple-items-draft-04',
    tier: 4,
    title: 'draft-04 items given as a list are positions <array>.0 and <array>.1',
    make: (d, name) => {
      const list = members(d);
      return {
        properties: {
          [name]: { type: 'array', items: [{ type: 'string', enum: list }, { type: 'boolean' }] },
        },
        required: [name],
        expected: [
          { path: [name], partitions: ARRAY },
          { path: [name, '0'], partitions: list },
          { path: [name, '1'], partitions: ['true', 'false'] },
        ],
      };
    },
  },
  {
    slug: 'additional-items',
    tier: 4,
    title:
      'additionalItems false after a tuple adds extra-item; the tuple still gives its position <array>.0',
    make: (_d, name) => ({
      properties: { [name]: { type: 'array', items: [{ type: 'boolean' }], additionalItems: false } },
      required: [name],
      expected: [
        { path: [name], partitions: [...ARRAY, 'extra-item'] },
        { path: [name, '0'], partitions: ['true', 'false'] },
      ],
    }),
  },
  {
    slug: 'ref-with-siblings',
    tier: 4,
    title: 'keywords beside a $ref apply with it (2020-12): the referenced partitions and the sibling bound',
    make: (_d, name) => ({
      properties: { [name]: { $ref: '#/$defs/Count', maximum: 50 } },
      required: [name],
      extra: { $defs: { Count: { type: 'integer', minimum: 1 } } },
      expected: [{ path: [name], partitions: [...MIN, ...MAX] }],
    }),
  },
  {
    slug: 'ref-deep-pointer',
    tier: 4,
    title: 'a $ref pointing inside a definition (#/$defs/Order/properties/status) reads that schema',
    make: (d, name) => {
      const list = members(d);
      return {
        properties: { [name]: { $ref: '#/$defs/Order/properties/status' } },
        required: [name],
        extra: {
          $defs: { Order: { type: 'object', properties: { status: { type: 'string', enum: list } } } },
        },
        expected: [{ path: [name], partitions: list }],
      };
    },
  },
  {
    slug: 'ref-anchor',
    tier: 5,
    title: 'a $ref to a $anchor (#Status) reads the anchored schema',
    make: (d, name) => {
      const list = members(d);
      return {
        properties: { [name]: { $ref: '#Status' } },
        required: [name],
        extra: { $defs: { S: { $anchor: 'Status', type: 'string', enum: list } } },
        expected: [{ path: [name], partitions: list }],
      };
    },
  },
  {
    slug: 'one-of-consts',
    tier: 3,
    title: 'oneOf of consts reads like an enum: one value per const',
    make: one(
      () => ({
        oneOf: [
          { const: 'north', title: 'North' },
          { const: 'south', title: 'South' },
        ],
      }),
      () => ['north', 'south'],
    ),
  },
  {
    slug: 'x-nullable',
    tier: 3,
    title: 'the Swagger 2 vendor key x-nullable true adds null',
    make: one(
      (d) => ({ type: 'integer', minimum: range(d), 'x-nullable': true }),
      () => [...MIN, 'null'],
    ),
  },
  {
    slug: 'items-ref',
    tier: 4,
    title: 'array items given as a $ref give <array>.item with the referenced enum',
    make: (d, name) => {
      const list = members(d);
      return {
        properties: { [name]: { type: 'array', items: { $ref: '#/$defs/Tag' } } },
        required: [name],
        extra: { $defs: { Tag: { type: 'string', enum: list } } },
        expected: [
          { path: [name], partitions: ARRAY },
          { path: [name, 'item'], partitions: list },
        ],
      };
    },
  },
  {
    slug: 'one-of-object-children',
    tier: 5,
    title: 'oneOf of objects gives variant values and each variant property as <prop>.<variant>.<child>',
    make: (_d, name) => ({
      properties: {
        [name]: {
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
        },
      },
      required: [name],
      expected: [
        { path: [name], partitions: ['variant-card', 'variant-transfer'] },
        { path: [name, 'card', 'last_four'], partitions: ['well-formed', 'malformed'] },
        { path: [name, 'transfer', 'urgent'], partitions: ['true', 'false'] },
      ],
    }),
  },
  {
    slug: 'all-of-required',
    tier: 4,
    title: 'a required list inside an allOf member makes its property required: no absent value',
    make: (d, name) => ({
      properties: { [name]: { type: 'string', enum: members(d) } },
      required: [],
      extra: { allOf: [{ required: [name] }] },
      expected: [],
    }),
  },

  {
    slug: 'content-media-type',
    tier: 3,
    title: 'contentMediaType application/json gives well-formed and malformed',
    make: one(
      () => ({ type: 'string', contentMediaType: 'application/json' }),
      () => ['well-formed', 'malformed'],
    ),
  },
  {
    slug: 'format-int32',
    tier: 3,
    title:
      'format int32 with no bounds gives the edges of a 32-bit integer: at-int32-max and above-int32-max',
    make: one(
      () => ({ type: 'integer', format: 'int32' }),
      () => ['at-int32-max', 'above-int32-max'],
    ),
  },
  {
    slug: 'nested-two-levels',
    tier: 2,
    title: 'a property two objects down (<prop>.<child>.<grandchild>) is followed',
    make: (d, name) => {
      const list = members(d);
      return {
        properties: {
          [name]: {
            type: 'object',
            required: ['inner'],
            properties: {
              inner: {
                type: 'object',
                required: ['kind'],
                properties: { kind: { type: 'string', enum: list } },
              },
            },
          },
        },
        required: [name],
        expected: [{ path: [name, 'inner', 'kind'], partitions: list }],
      };
    },
  },
  {
    slug: 'empty-slug-member',
    tier: 3,
    title: 'an enum member with no letter or digit (such as !!!) gives the value id value',
    make: one(
      () => ({ type: 'string', enum: ['open', '!!!'] }),
      () => ['open', 'value'],
    ),
  },
  {
    slug: 'long-pattern',
    tier: 4,
    title:
      'a property whose pattern line is over 1000 characters gives well-formed and malformed, each quoting a passage of the file within the 1000-character limit, with a valid proposal',
    make: one(
      () => ({
        type: 'string',
        pattern: `^(${Array.from({ length: 160 }, (_, i) => `code${i}`).join('|')})$`,
      }),
      () => ['well-formed', 'malformed'],
    ),
  },
  {
    slug: 'long-bounds',
    tier: 2,
    title:
      'a property longer than 300 characters with a minimum and a maximum: each minimum value quotes the minimum line, each maximum value the maximum line',
    make: quoting(
      one(
        (d) => ({
          type: 'integer',
          description:
            `${'A fictional amount the map validator writes, long enough that its whole property is not one quote. '.repeat(4)}`.trim(),
          minimum: range(d),
          maximum: range(d) + 20,
        }),
        () => [...MIN, ...MAX],
      ),
      Object.fromEntries([...MIN.map((p) => [p, 'minimum']), ...MAX.map((p) => [p, 'maximum'])]),
    ),
  },
  {
    slug: 'min-items-title',
    tier: 2,
    title:
      'the empty value of an array with a minItems of N and a different maxItems says "below its minItems N" in its title',
    parts: { values: false, produced: false, constraints: false, relations: false },
    make: (draw, name) => {
      const minItems = range(draw) + 1;
      return {
        properties: {
          [name]: { type: 'array', items: { type: 'string' }, minItems, maxItems: minItems + 5 },
        },
        required: [name],
        expected: [{ path: [name], partitions: ['empty'] }],
        titles: { empty: `below its minItems ${minItems}` },
      };
    },
  },
  {
    slug: 'camel-digit-tool',
    tier: 2,
    title:
      'a tool named checkV2Slot gives dimension ids under check_v2_slot: a digit before a capital splits too',
    tool: { name: 'checkV2Slot', slug: 'check_v2_slot' },
    make: one(
      (d) => ({ type: 'string', enum: members(d) }),
      (s) => (s.enum as string[]).map(String),
    ),
  },
  {
    slug: 'punctuated-members',
    tier: 2,
    title:
      'enum members ending in punctuation (high!, low?) give the value ids high and low, with no trailing dash',
    make: one(
      () => ({ type: 'string', enum: ['high!', 'low?'] }),
      () => ['high', 'low'],
    ),
  },
  ...LONG_QUOTE_CASES(),
];

/** Enum members whose enum block is over 1000 characters. */
const longMembers = (draw: Draw, form: 'short' | 'long' | 'integer' | 'spaced'): Array<string | number> => {
  const base = draw.pick(['plan', 'zone', 'route', 'shelf']);
  switch (form) {
    case 'short':
      return Array.from({ length: 130 }, (_, i) => `${base}-${String(i + 1).padStart(3, '0')}`);
    case 'long':
      return Array.from(
        { length: 12 },
        (_, i) => `${base}-${i + 1}-${'with-a-long-fictional-label-'.repeat(4)}end`,
      );
    case 'integer': {
      const step = draw.int(1, 3);
      return Array.from({ length: 260 }, (_, i) => 1000 + i * step);
    }
    case 'spaced':
      return Array.from({ length: 110 }, (_, i) => `${base} ${String(i + 1).padStart(3, '0')}`);
  }
};
const slugOf = (member: string | number) => String(member).replace(/[^A-Za-z0-9_.-]+/g, '-');
const all = (partitions: readonly string[], key: string, after: string) =>
  Object.fromEntries(partitions.map((partition) => [partition, { key, after }]));

/**
 * Whole quotes over 1000 characters in every place a tool schema states an enum, and a long pattern beside
 * short keywords. A value of a long property quotes its keyword's whole block; a quote cut at any length is
 * not that block. One change makes them all pass: a quote may be as long as the block it stands for.
 */
function LONG_QUOTE_CASES(): Case[] {
  const cause = 'tools:whole-long-quote';
  const top = (
    slug: string,
    form: Parameters<typeof longMembers>[1],
    title: string,
    tier: Tier = 3,
  ): Case => ({
    slug,
    tier,
    cause,
    title,
    make: (draw, name) => {
      const list = longMembers(draw, form);
      const partitions = list.map(slugOf);
      return {
        properties: { [name]: { type: typeof list[0] === 'number' ? 'integer' : 'string', enum: list } },
        required: [name],
        expected: [{ path: [name], partitions }],
        quotes: all(partitions, 'enum', `${name}:`),
      };
    },
  });
  return [
    top(
      'long-enum-short-members',
      'short',
      'an enum of 130 short members (over 1000 characters): each value quotes the whole enum block',
    ),
    top(
      'long-enum-long-members',
      'long',
      'an enum of 12 members over 100 characters each: each value quotes the whole enum block',
    ),
    top(
      'long-enum-integers',
      'integer',
      'an integer enum of 260 members: each value quotes the whole enum block',
    ),
    top(
      'long-enum-spaced',
      'spaced',
      'an enum of 110 members with spaces: values slugged, each quoting the whole enum block',
    ),
    {
      slug: 'long-enum-nested',
      tier: 3,
      cause,
      title: 'an enum over 1000 characters one object down: each value quotes the whole enum block',
      make: (draw, name) => {
        const list = longMembers(draw, 'short').map(String);
        return {
          properties: {
            [name]: {
              type: 'object',
              required: ['kind'],
              properties: { kind: { type: 'string', enum: list } },
            },
          },
          required: [name],
          expected: [{ path: [name, 'kind'], partitions: list }],
          quotes: all(list, 'enum', 'kind:'),
        };
      },
    },
    {
      slug: 'long-enum-described',
      tier: 3,
      cause,
      title:
        'a long description beside an enum over 1000 characters: each value quotes the enum block, not the description',
      make: (draw, name) => {
        const list = longMembers(draw, 'short').map(String);
        return {
          properties: {
            [name]: {
              type: 'string',
              description: 'A fictional field the map validator writes. '.repeat(10).trim(),
              enum: list,
            },
          },
          required: [name],
          expected: [{ path: [name], partitions: list }],
          quotes: all(list, 'enum', `${name}:`),
        };
      },
    },
    {
      slug: 'long-enum-two-properties',
      tier: 3,
      cause,
      title: 'two properties with enums over 1000 characters: each value quotes its own enum block',
      make: (draw, name) => {
        const first = longMembers(draw, 'short').map(String);
        const second = first.map((member) => `${member}-b`);
        const other = `${name}_b`;
        return {
          properties: { [name]: { type: 'string', enum: first }, [other]: { type: 'string', enum: second } },
          required: [name, other],
          expected: [
            { path: [name], partitions: first },
            { path: [other], partitions: second },
          ],
          quotes: { ...all(first, 'enum', `${name}:`), ...all(second, 'enum', `${other}:`) },
        };
      },
    },
    {
      slug: 'long-pattern-with-lengths',
      tier: 3,
      cause,
      title:
        'a pattern over 1000 characters beside minLength and maxLength: the pattern values quote the whole pattern line, the length values their own lines',
      make: (draw, name) => {
        const min = draw.int(2, 4);
        const max = min + draw.int(5, 9);
        const lengths = ['below-min-length', 'at-min-length', 'at-max-length', 'above-max-length'];
        return {
          properties: {
            [name]: {
              type: 'string',
              minLength: min,
              maxLength: max,
              pattern: `^(${Array.from({ length: 170 }, (_, i) => `ref${i}`).join('|')})$`,
            },
          },
          required: [name],
          expected: [{ path: [name], partitions: [...lengths, 'well-formed', 'malformed'] }],
          quotes: {
            ...all(['well-formed', 'malformed'], 'pattern', `${name}:`),
            'below-min-length': { key: 'minLength', after: `${name}:` },
            'at-min-length': { key: 'minLength', after: `${name}:` },
            'at-max-length': { key: 'maxLength', after: `${name}:` },
            'above-max-length': { key: 'maxLength', after: `${name}:` },
          },
        };
      },
    },
  ];
}

/** A case whose partitions must quote the block of the given key. */
function quoting(make: Case['make'], quotes: Record<string, string>): Case['make'] {
  return (draw, name) => ({ ...make(draw, name), quotes });
}

/** The enum at a path of keys inside a schema object. */
function enumAt(root: unknown, ...keys: string[]): string[] {
  let node: unknown = root;
  for (const key of keys) node = (node as Record<string, unknown> | undefined)?.[key];
  const members = (node as { enum?: unknown } | undefined)?.enum;
  if (!Array.isArray(members)) throw new Error(`no enum at ${keys.join('.')}`);
  return members.map(String);
}

/** The expected dimensions of the cases whose `expected` is filled from the drawn schema. */
function derivedExpected(
  slug: string,
  name: string,
  made: ReturnType<Case['make']>,
  side: 'in' | 'out',
): Expected {
  if (made.expected.length > 0) return made.expected;
  const property = made.properties[name] as Record<string, unknown>;
  switch (slug) {
    case 'nested': {
      return [{ path: [name, 'kind'], partitions: enumAt(property, 'properties', 'kind') }];
    }
    case 'ref-defs':
      return [{ path: [name], partitions: enumAt(made.extra, '$defs', 'Choice') }];
    case 'ref-definitions':
      return [{ path: [name], partitions: MIN }];
    case 'depth-three': {
      const level = enumAt(property, 'properties', 'inner', 'properties', 'core', 'properties', 'level');
      return [{ path: [name, 'inner', 'core', 'level'], partitions: level }];
    }
    case 'array-of-objects': {
      return [
        { path: [name], partitions: ARRAY },
        { path: [name, 'item', 'kind'], partitions: enumAt(property, 'items', 'properties', 'kind') },
      ];
    }
    case 'array-items-enum':
      return [
        { path: [name], partitions: ARRAY },
        { path: [name, 'item'], partitions: (property.items as { enum: string[] }).enum },
      ];
    case 'prefix-items': {
      const prefix = property.prefixItems as Array<Record<string, unknown>>;
      return [
        { path: [name], partitions: ARRAY },
        { path: [name, '0'], partitions: prefix[0]?.enum as string[] },
        { path: [name, '1'], partitions: ['true', 'false'] },
      ];
    }
    case 'if-then-else':
      return [
        { path: [name], partitions: property.enum as string[] },
        { path: ['extra_note'], partitions: ['present', 'absent'] },
        { path: ['if'], partitions: ['then', 'else'] },
      ];
    case 'closed-object':
      return side === 'in'
        ? [
            { path: [name], partitions: ['true', 'false'] },
            { path: ['unknown-key'], partitions: ['sent'] },
          ]
        : [{ path: [name], partitions: ['true', 'false'] }];
    case 'additional-properties-schema':
      return [
        { path: [name], partitions: ['true', 'false'] },
        { path: ['extra-key'], partitions: ['typed', 'mistyped'] },
      ];
    case 'pattern-properties':
      return [
        { path: [name], partitions: ['true', 'false'] },
        { path: ['pattern-key'], partitions: ['matching', 'mistyped'] },
      ];
    case 'recursive-ref': {
      const label = enumAt(made.extra, '$defs', 'Node', 'properties', 'label');
      return [
        { path: [name, 'label'], partitions: label },
        { path: [name, 'children'], partitions: [...ARRAY, 'absent'] },
        { path: [name, 'children', 'item', 'label'], partitions: label },
      ];
    }
    case 'read-only-input':
      return [
        { path: [name], partitions: property.enum as string[] },
        ...(side === 'out' ? [{ path: ['created_at'], partitions: ['well-formed', 'malformed'] }] : []),
      ];
    case 'write-only-output':
      return [
        { path: [name], partitions: property.enum as string[] },
        ...(side === 'in' ? [{ path: ['secret_code'], partitions: ['well-formed', 'malformed'] }] : []),
      ];
    case 'deprecated-property':
    case 'all-of-required':
      return [{ path: [name], partitions: property.enum as string[] }];
    default:
      throw new Error(`no expectation for ${slug}`);
  }
}

/** Builds the tools file of a case and the code entries the pre-pass must give. */
export function schemaCase(item: Case, seed: number) {
  const draw = drawFor(seed, `schema-keywords.${item.slug}`);
  const drawnTool = draw.pick(TOOL_POOL);
  const tool = item.tool?.slug ?? drawnTool;
  const side: 'in' | 'out' = draw.chance(0.5) ? 'in' : 'out';
  const name = draw.pick(['status', 'amount', 'note', 'tier', 'count', 'reason', 'slot', 'owner']);
  const made = item.make(draw, name);
  const schema = {
    type: 'object',
    required: made.required,
    properties: made.properties,
    ...(made.extra ?? {}),
  };
  const toolEntry = {
    name: item.tool?.name ?? tool,
    description: 'A fictional tool of the map validator.',
    [side === 'in' ? 'input_schema' : 'output_schema']: schema,
  };
  const text = `# Tool schemas written by the map validator. Every name is fictional.\n${stringify({ tools: [toolEntry] }, { lineWidth: 0 })}`;
  const inventory = miniInventory(draw);
  const code: CodeEntry[] = [...inventoryCode(inventory)];
  for (const dimension of derivedExpected(item.slug, name, made, side)) {
    const id = [tool, side, ...dimension.path].join('.');
    for (const partition of dimension.partitions) {
      const key = made.quotes?.[partition];
      const title = made.titles?.[partition];
      code.push({
        type: 'value',
        dimension: id,
        kind: 'data',
        value: `${id}.${partition}`,
        role: 'detail',
        ...(key
          ? {
              quote:
                typeof key === 'string'
                  ? blockOf(text, key, `${name}:`)
                  : blockOf(text, key.key, `${name}:`, key.after),
            }
          : {}),
        ...(title ? { titleIncludes: title } : {}),
      });
    }
  }
  return {
    sources: [inventorySource(inventory), { kind: 'tools' as const, path: 'tools.yaml', text }],
    code,
  };
}

/** Keywords one change fixes together. */
const SHARED_CAUSE: Record<string, string> = {
  'exclusive-minimum-boolean': 'tools:draft-04-exclusive-bounds',
  'exclusive-maximum-boolean': 'tools:draft-04-exclusive-bounds',
  'format-without-type': 'tools:type-from-keywords',
  'minimum-without-type': 'tools:type-from-keywords',
  'ref-defs': 'tools:local-ref',
  'ref-definitions': 'tools:local-ref',
};

export function schemaItems(): BankItem[] {
  return SCHEMA_CASES.map((item) =>
    mapItem({
      id: `schema-keywords.${item.slug}`,
      family: 'schema-keywords',
      tier: item.tier,
      level: levelOf('structured'),
      component: BANK_COMPONENTS.tools,
      title: item.title,
      cause: item.cause ?? SHARED_CAUSE[item.slug] ?? `tools:${item.slug}`,
      build: (seed) => {
        const built = schemaCase(item, seed);
        return {
          case: { label: item.slug, sources: built.sources, planted: [] },
          code: built.code,
          parts: item.parts ?? { values: true, produced: true, constraints: true, relations: true },
        };
      },
    }),
  );
}
