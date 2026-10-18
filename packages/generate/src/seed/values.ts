import { type Assertion, isPlainObject } from '@agent-nexus/driftbench-core';
import type { JsonSchema, ToolSchema } from './map';

/**
 * Concrete values for the partitions the extractor reads from a JSON Schema (extract/tools.ts), the way
 * Schemathesis derives boundary cases from a schema: every value is computed from the schema's own
 * bounds, never written by a model. Strings are runs of `x`; formats use fictional values only.
 */

/** A concrete value, `absent` (the property is left out), or unsupported with the reason. */
export type Concrete =
  | { kind: 'value'; value: unknown }
  | { kind: 'absent' }
  | { kind: 'unsupported'; why: string };

/** Partitions that break the schema: a correct agent never sends them, a tool answer with one is unreadable. */
export const INVALID_PARTITIONS: ReadonlySet<string> = new Set([
  'below-minimum',
  'above-maximum',
  'at-exclusive-minimum',
  'at-exclusive-maximum',
  'below-min-length',
  'above-max-length',
  'malformed',
  'above-max-items',
]);

/** Fictional well-formed and malformed values per string format. */
const FORMATS: Record<string, [wellFormed: string, malformed: string]> = {
  email: ['jo.okafor@example.com', 'jo.okafor.example.com'],
  date: ['2026-01-15', '15/01/2026'],
  'date-time': ['2026-01-15T09:00:00Z', '2026-01-15 at 9'],
  uri: ['https://example.com/a', 'example dot com'],
  url: ['https://example.com/a', 'example dot com'],
  uuid: ['00000000-0000-4000-8000-000000000001', 'not-a-uuid'],
};

/** The concrete value of one partition of a property. */
export function concreteValue(schema: JsonSchema, partition: string, name = 'value'): Concrete {
  const value = (v: unknown): Concrete => ({ kind: 'value', value: v });
  const unsupported = (why: string): Concrete => ({ kind: 'unsupported', why });
  if (partition === 'absent') return { kind: 'absent' };
  if (partition === 'null') return value(null);
  if (partition === 'present') return value(defaultFor(schema, name));
  if (partition === 'true' || partition === 'false') {
    if (typesOf(schema).includes('boolean')) return value(partition === 'true');
  }
  const members = Array.isArray(schema.enum) ? schema.enum : 'const' in schema ? [schema.const] : undefined;
  if (members) {
    const member = members.find((candidate) => slug(candidate) === partition);
    return member === undefined ? unsupported(`no member of the enum is ${partition}`) : value(member);
  }
  const number = (key: string) => (typeof schema[key] === 'number' ? (schema[key] as number) : undefined);
  const step = typesOf(schema).includes('integer') ? 1 : 0.5;
  const numeric: Record<string, () => number | undefined> = {
    'below-minimum': () => sub(number('minimum'), step),
    'at-minimum': () => number('minimum'),
    'above-minimum': () => add(number('minimum'), step),
    'at-exclusive-minimum': () => number('exclusiveMinimum'),
    'above-exclusive-minimum': () => add(number('exclusiveMinimum'), step),
    'below-maximum': () => sub(number('maximum'), step),
    'at-maximum': () => number('maximum'),
    'above-maximum': () => add(number('maximum'), step),
    'below-exclusive-maximum': () => sub(number('exclusiveMaximum'), step),
    'at-exclusive-maximum': () => number('exclusiveMaximum'),
  };
  const bound = numeric[partition];
  if (bound) {
    const found = bound();
    return found === undefined ? unsupported(`the schema states no bound for ${partition}`) : value(found);
  }
  const length: Record<string, () => number | undefined> = {
    'below-min-length': () => sub(number('minLength'), 1),
    'at-min-length': () => number('minLength'),
    'at-max-length': () => number('maxLength'),
    'above-max-length': () => add(number('maxLength'), 1),
  };
  const size = length[partition];
  if (size) {
    const found = size();
    return found === undefined || found < 0
      ? unsupported(`no length for ${partition}`)
      : value('x'.repeat(found));
  }
  if (partition === 'well-formed' || partition === 'malformed') {
    const format = typeof schema.format === 'string' ? FORMATS[schema.format] : undefined;
    if (!format) return unsupported('only the formats email, date, date-time, uri, url and uuid have values');
    return value(partition === 'well-formed' ? format[0] : format[1]);
  }
  const items = isPlainObject(schema.items) ? schema.items : {};
  const item = () => defaultFor(items);
  const maxItems = number('maxItems');
  const arrays: Record<string, () => unknown[] | undefined> = {
    empty: () => [],
    'one-item': () => [item()],
    'several-items': () => [item(), item()],
    'at-max-items': () => (maxItems === undefined ? undefined : Array.from({ length: maxItems }, item)),
    'above-max-items': () =>
      maxItems === undefined ? undefined : Array.from({ length: maxItems + 1 }, item),
  };
  const list = arrays[partition];
  if (list) {
    const found = list();
    return found === undefined ? unsupported(`no item count for ${partition}`) : value(found);
  }
  return unsupported(`no value is known for the partition ${partition}`);
}

/** A valid value of a schema: its first enum member or const, else one of its type, with required properties. */
export function defaultFor(schema: JsonSchema, name = 'value'): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if ('const' in schema) return schema.const;
  const type = typesOf(schema).find((candidate) => candidate !== 'null') ?? 'string';
  switch (type) {
    case 'boolean':
      return true;
    case 'integer':
    case 'number': {
      const minimum = typeof schema.minimum === 'number' ? schema.minimum : undefined;
      const exclusive = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum + 1 : undefined;
      return minimum ?? exclusive ?? 1;
    }
    case 'array':
      return [];
    case 'object': {
      const out: Record<string, unknown> = {};
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      for (const key of required) {
        const property = properties[String(key)];
        out[String(key)] = defaultFor(isPlainObject(property) ? property : {}, String(key));
      }
      return out;
    }
    default: {
      const minLength = typeof schema.minLength === 'number' ? schema.minLength : 1;
      const text = `${name}-1`;
      return text.length >= minLength ? text : text.padEnd(minLength, 'x');
    }
  }
}

/**
 * A tool's answer for a set of output partitions: a valid answer from the schema, then each partition set
 * at its property path (or the property removed for `absent`). Returns the answer and the partitions that
 * have no concrete value.
 */
export function toolAnswer(
  tool: ToolSchema,
  partitions: ReadonlyArray<{
    path: string[];
    schema: JsonSchema;
    partition: string;
    bindings?: readonly string[];
  }>,
): { answer: Record<string, unknown>; unsupported: string[] } {
  const answer = (tool.output ? defaultFor(tool.output) : {}) as Record<string, unknown>;
  const unsupported: string[] = [];
  for (const { path, schema, partition, bindings } of partitions) {
    const concrete =
      bindings === undefined
        ? concreteValue(schema, partition, path[path.length - 1])
        : boundReplyValue(schema, partition, bindings);
    if (concrete.kind === 'unsupported') {
      unsupported.push(`${path.join('.')}.${partition}: ${concrete.why}`);
      continue;
    }
    setAt(answer, path, concrete);
  }
  return { answer, unsupported };
}

/** A reply reads the bound scalar exactly; a partition must not silently replace it with a default. */
function boundReplyValue(schema: JsonSchema, partition: string, bindings: readonly string[]): Concrete {
  const distinct = [...new Set(bindings)];
  if (distinct.length !== 1)
    return {
      kind: 'unsupported',
      why: distinct.length === 0 ? 'no bound reply value' : 'ambiguous bound reply values for this field',
    };
  const text = distinct[0] as string;
  if (partition !== 'present') {
    const concrete = concreteValue(schema, partition);
    if (concrete.kind === 'unsupported') return concrete;
    if (
      concrete.kind !== 'value' ||
      (concrete.value !== null && !['string', 'number', 'boolean'].includes(typeof concrete.value)) ||
      String(concrete.value) !== text
    ) {
      return { kind: 'unsupported', why: `bound reply value does not match the ${partition} partition` };
    }
    return concrete;
  }

  const members = Array.isArray(schema.enum) ? schema.enum : 'const' in schema ? [schema.const] : undefined;
  const types = typesOf(schema);
  const candidates: Array<string | number | boolean | null> = [];
  const permits = (type: string) => types.includes(type) || (types.length === 0 && members !== undefined);
  if (permits('string')) candidates.push(text);
  const numeric = Number(text);
  if (
    Number.isFinite(numeric) &&
    String(numeric) === text &&
    (permits('number') || (permits('integer') && Number.isInteger(numeric)))
  )
    candidates.push(numeric);
  if (permits('boolean') && (text === 'true' || text === 'false')) candidates.push(text === 'true');
  if (permits('null') && text === 'null') candidates.push(null);
  const allowed = candidates.filter((value) => {
    if (members && !members.includes(value)) return false;
    if ('const' in schema && schema.const !== value) return false;
    if (typeof value === 'number') {
      if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
      if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
      if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return false;
      if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return false;
    }
    if (typeof value === 'string') {
      if (typeof schema.minLength === 'number' && [...value].length < schema.minLength) return false;
      if (typeof schema.maxLength === 'number' && [...value].length > schema.maxLength) return false;
    }
    return true;
  });
  if (allowed.length !== 1)
    return {
      kind: 'unsupported',
      why: 'bound reply value must identify one scalar matching the schema type and bounds',
    };
  return { kind: 'value', value: allowed[0] };
}

function setAt(target: Record<string, unknown>, path: string[], concrete: Concrete): void {
  let node = target;
  path.slice(0, -1).forEach((key) => {
    const next = node[key];
    if (!isPlainObject(next)) node[key] = {};
    node = node[key] as Record<string, unknown>;
  });
  const last = path[path.length - 1];
  if (last === undefined) return;
  if (concrete.kind === 'absent') delete node[last];
  else if (concrete.kind === 'value') node[last] = concrete.value;
}

/**
 * The input assertion a valid partition of a top-level argument states: the enum member, the boolean,
 * `present` as non-empty, `absent` as absent, a length as a pattern on the length, a bound as the number.
 * Undefined when the partition is invalid (a correct agent never sends it) or the argument is nested.
 */
export function inputAssertion(path: string[], schema: JsonSchema, partition: string): Assertion | undefined {
  if (path.length !== 1 || INVALID_PARTITIONS.has(partition)) return undefined;
  if (partition === 'absent') return { absent: true };
  if (partition === 'present') return { nonempty: true };
  if (partition === 'at-min-length' || partition === 'at-max-length') {
    const concrete = concreteValue(schema, partition);
    if (concrete.kind !== 'value' || typeof concrete.value !== 'string') return undefined;
    return { regex: `^[\\s\\S]{${concrete.value.length}}$` };
  }
  const concrete = concreteValue(schema, partition);
  if (concrete.kind !== 'value') return undefined;
  const value = concrete.value;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return value;
  }
  return undefined;
}

function typesOf(schema: JsonSchema): string[] {
  const type = schema.type;
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((entry): entry is string => typeof entry === 'string');
  return isPlainObject(schema.properties) ? ['object'] : [];
}

/** The extractor's enum member slug (extract/tools.ts), recomputed. */
function slug(member: unknown): string {
  const text = String(member)
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/-+$/, '');
  return text === '' ? 'value' : text;
}

function add(base: number | undefined, delta: number): number | undefined {
  return base === undefined ? undefined : base + delta;
}

function sub(base: number | undefined, delta: number): number | undefined {
  return base === undefined ? undefined : base - delta;
}
