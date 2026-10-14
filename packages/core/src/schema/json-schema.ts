import { isPlainObject } from '../spec/normalize';

/** The keywords implemented by the deterministic strict schema reader in the checks package. */
const SUPPORTED = new Set([
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'nullable',
  'anyOf',
  'oneOf',
  'allOf',
  // Accepted annotations do not change the reader's validation semantics or dialect.
  'title',
  'description',
  'default',
  'examples',
  '$schema',
  '$id',
  '$comment',
]);

export type SchemaKeywordIssue = { path: (string | number)[]; message: string };

/** Inspect every subschema, even when the value would skip a branch or an optional property. */
export function unsupportedSchemaKeywords(
  schema: unknown,
  path: (string | number)[] = [],
): SchemaKeywordIssue[] {
  if (!isPlainObject(schema)) return [];
  const issues: SchemaKeywordIssue[] = [];
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) {
      issues.push({ path: [...path, key], message: `unsupported JSON Schema keyword "${key}"` });
    }
  }
  if (isPlainObject(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      issues.push(...unsupportedSchemaKeywords(child, [...path, 'properties', key]));
    }
  }
  for (const key of ['items', 'additionalProperties']) {
    const child = schema[key];
    // Tuple items are not implemented by this reader; do not silently accept their schemas.
    if (key === 'items' && Array.isArray(child)) {
      issues.push({ path: [...path, key], message: 'unsupported JSON Schema keyword "items" array form' });
    } else {
      issues.push(...unsupportedSchemaKeywords(child, [...path, key]));
    }
  }
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    const children = schema[key];
    if (Array.isArray(children)) {
      children.forEach((child, index) => {
        issues.push(...unsupportedSchemaKeywords(child, [...path, key, index]));
      });
    }
  }
  return issues;
}

/** A raw schema, an OpenAI-style function's parameters, or an Anthropic-style input_schema. */
export function parameterSchema(definition: unknown): unknown {
  if (!isPlainObject(definition)) return definition;
  if ('type' in definition || 'properties' in definition) return definition;
  if (isPlainObject(definition.parameters)) return definition.parameters;
  if (isPlainObject(definition.input_schema)) return definition.input_schema;
  return definition;
}
