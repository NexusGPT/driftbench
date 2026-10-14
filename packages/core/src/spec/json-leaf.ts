import { z } from 'zod';

/** Recognize only the exact, unrefined recursive union used by z.json(). */
export function isJsonLeaf(schema: z.ZodType): boolean {
  const shape = (value: z.ZodType, type: string, keys: string[]) =>
    value.type === type &&
    Object.keys(value.def).every((key) => key === 'type' || keys.includes(key)) &&
    !(value.def as { checks?: unknown[] }).checks?.length;
  if (!(schema instanceof z.ZodLazy) || !shape(schema, 'lazy', ['getter'])) return false;
  const union = schema.unwrap();
  if (!(union instanceof z.ZodUnion) || !shape(union, 'union', ['options']) || union.options.length !== 6)
    return false;
  const [string, number, boolean, nil, array, record] = union.options as z.ZodType[];
  return (
    !!string &&
    shape(string, 'string', []) &&
    !!number &&
    shape(number, 'number', ['checks']) &&
    !!boolean &&
    shape(boolean, 'boolean', []) &&
    !!nil &&
    shape(nil, 'null', []) &&
    array instanceof z.ZodArray &&
    shape(array, 'array', ['element']) &&
    array.element === schema &&
    record instanceof z.ZodRecord &&
    shape(record, 'record', ['keyType', 'valueType']) &&
    record.keyType instanceof z.ZodType &&
    shape(record.keyType, 'string', []) &&
    record.valueType === schema
  );
}

export const UNSUPPORTED_JSON = Symbol('use original JSON schema');

/** Validate and clone ordinary JSON in one walk; exotic values and all errors use the original schema. */
export function cloneJsonLeaf(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : UNSUPPORTED_JSON;
  if (typeof value !== 'object' || depth > 100) return UNSUPPORTED_JSON;
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
    return UNSUPPORTED_JSON;
  if (array) {
    const out: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor || descriptor.get || descriptor.set) return UNSUPPORTED_JSON;
      const child = cloneJsonLeaf(descriptor.value, depth + 1);
      if (child === UNSUPPORTED_JSON) return UNSUPPORTED_JSON;
      out.push(child);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    // Zod's record check consults constructor even when it is non-enumerable.
    if (key === 'constructor') return UNSUPPORTED_JSON;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return UNSUPPORTED_JSON;
    if (!descriptor.enumerable) continue;
    // z.record(z.string(), ...) rejects enumerable symbol keys and strips __proto__.
    if (typeof key !== 'string' || key === '__proto__' || descriptor.get || descriptor.set)
      return UNSUPPORTED_JSON;
    const child = cloneJsonLeaf(descriptor.value, depth + 1);
    if (child === UNSUPPORTED_JSON) return UNSUPPORTED_JSON;
    out[key] = child;
  }
  return out;
}
