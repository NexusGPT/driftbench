import { deepEqual, unsupportedSchemaKeywords } from '@agent-nexus/driftbench-core';
import { isRecord, show } from './values';

export { parameterSchema } from '@agent-nexus/driftbench-core';

/**
 * A strict JSON Schema reader for tool inputs. It understands type (one or a list), enum, const,
 * properties, required, additionalProperties, items, minItems, maxItems, minLength, maxLength, pattern,
 * minimum, maximum, exclusiveMinimum, exclusiveMaximum, nullable, anyOf, oneOf and allOf; other keywords
 * are rejected before inspecting the value, except harmless annotations. Strict means an object schema
 * that declares `properties` refuses any other key unless `additionalProperties` allows it: a key the
 * schema does not declare is an invented parameter.
 */

export type SchemaIssue = {
  path: string;
  message: string;
  invented: boolean;
  schemaError?: boolean;
};

export function validateStrict(value: unknown, schema: unknown, path = 'input'): SchemaIssue[] {
  const unsupported = unsupportedSchemaKeywords(schema);
  if (unsupported.length > 0) {
    return unsupported.map((entry) => ({
      path: ['schema', ...entry.path].join('.'),
      message: entry.message,
      invented: false,
      schemaError: true,
    }));
  }
  return validateValue(value, schema, path);
}

function validateValue(value: unknown, schema: unknown, path: string): SchemaIssue[] {
  if (schema === true || schema === undefined) return [];
  if (schema === false) return [issue(path, 'is not allowed by the schema')];
  if (!isRecord(schema)) return [];
  const issues: SchemaIssue[] = [];

  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) issues.push(...validateValue(value, part, path));
  }
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const options = schema[keyword];
    if (!Array.isArray(options) || options.length === 0) continue;
    const results = options.map((option) => validateValue(value, option, path));
    const passing = results.filter((result) => result.length === 0).length;
    if (keyword === 'oneOf' && passing > 1) {
      issues.push(issue(path, `matches ${passing} of the oneOf alternatives, expected exactly one`));
    } else if (passing === 0) {
      const closest = results.reduce((best, result) => (result.length < best.length ? result : best));
      issues.push(issue(path, `matches none of the ${options.length} ${keyword} alternatives`), ...closest);
    }
  }

  if (value === null && schema.nullable === true) return issues;
  const types = typesOf(schema.type);
  if (types.length > 0 && !types.some((type) => hasType(value, type))) {
    issues.push(issue(path, `is ${kindOf(value)}, expected ${types.join(' or ')}`));
    return issues;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEqual(value, option))) {
    issues.push(issue(path, `is ${show(value)}, expected one of ${show(schema.enum)}`));
  }
  if ('const' in schema && !deepEqual(value, schema.const)) {
    issues.push(issue(path, `is ${show(value)}, expected ${show(schema.const)}`));
  }
  if (typeof value === 'string') issues.push(...stringIssues(value, schema, path));
  if (typeof value === 'number') issues.push(...numberIssues(value, schema, path));
  if (Array.isArray(value)) issues.push(...arrayIssues(value, schema, path));
  if (isRecord(value)) issues.push(...objectIssues(value, schema, path));
  return issues;
}

function objectIssues(value: Record<string, unknown>, schema: Record<string, unknown>, path: string) {
  const issues: SchemaIssue[] = [];
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key === 'string' && value[key] === undefined)
      issues.push(issue(`${path}.${key}`, 'is missing'));
  }
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    const declared = properties?.[key];
    if (declared !== undefined) {
      issues.push(...validateValue(item, declared, `${path}.${key}`));
    } else if (properties !== undefined || schema.additionalProperties !== undefined) {
      const extra = schema.additionalProperties;
      if (extra === true || isRecord(extra)) {
        issues.push(...validateValue(item, extra, `${path}.${key}`));
      } else {
        issues.push({
          path: `${path}.${key}`,
          message: 'is not in the schema: an invented parameter',
          invented: true,
        });
      }
    }
  }
  return issues;
}

function stringIssues(value: string, schema: Record<string, unknown>, path: string): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    issues.push(issue(path, `is ${value.length} characters long, at least ${schema.minLength} expected`));
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    issues.push(issue(path, `is ${value.length} characters long, at most ${schema.maxLength} expected`));
  }
  if (typeof schema.pattern === 'string') {
    let matches = true;
    try {
      matches = new RegExp(schema.pattern, 'u').test(value);
    } catch {
      issues.push(issue(path, `has a schema pattern that does not compile: /${schema.pattern}/`));
    }
    if (!matches) issues.push(issue(path, `is ${show(value)}, expected to match /${schema.pattern}/`));
  }
  return issues;
}

function numberIssues(value: number, schema: Record<string, unknown>, path: string): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const bound = (key: string, fails: (limit: number) => boolean, words: string) => {
    const limit = schema[key];
    if (typeof limit === 'number' && fails(limit))
      issues.push(issue(path, `is ${value}, ${words} ${limit} expected`));
  };
  bound('minimum', (limit) => value < limit, 'at least');
  bound('maximum', (limit) => value > limit, 'at most');
  bound('exclusiveMinimum', (limit) => value <= limit, 'more than');
  bound('exclusiveMaximum', (limit) => value >= limit, 'less than');
  return issues;
}

function arrayIssues(value: unknown[], schema: Record<string, unknown>, path: string): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    issues.push(issue(path, `has ${value.length} items, at least ${schema.minItems} expected`));
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    issues.push(issue(path, `has ${value.length} items, at most ${schema.maxItems} expected`));
  }
  if (schema.items !== undefined && !Array.isArray(schema.items)) {
    value.forEach((item, index) => {
      issues.push(...validateValue(item, schema.items, `${path}[${index}]`));
    });
  }
  return issues;
}

function typesOf(type: unknown): string[] {
  if (typeof type === 'string') return [type];
  return Array.isArray(type) ? type.filter((item): item is string => typeof item === 'string') : [];
}

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function kindOf(value: unknown): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (isRecord(value)) return 'an object';
  return `a ${typeof value} ${show(value)}`;
}

function issue(path: string, message: string): SchemaIssue {
  return { path, message, invented: false };
}
