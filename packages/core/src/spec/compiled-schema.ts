import { z } from 'zod';
import { Spec } from '../schema/spec';
import { cloneJsonLeaf, isJsonLeaf, UNSUPPORTED_JSON } from './json-leaf';

/**
 * Compile the existing schema, retaining the runtime parser at recursive JSON leaves. Zod's compiler
 * cannot compile a recursive schema as a whole. All leaf checks still run; any failed fast parse uses
 * the original Spec to produce its exact issues. The exported schema is never changed.
 */
function withRuntimeLeaves(schema: z.ZodType, memo = new Map<z.ZodType, z.ZodType>()): z.ZodType {
  const known = memo.get(schema);
  if (known) return known;
  // Break an unexpected direct schema cycle conservatively; compile() then retains the runtime path.
  memo.set(schema, schema);
  if (schema.type === 'lazy') {
    const json = isJsonLeaf(schema);
    const leaf = z.unknown().transform((input, ctx) => {
      if (json) {
        const copied = cloneJsonLeaf(input);
        if (copied !== UNSUPPORTED_JSON) return copied;
      }
      const parsed = schema.safeParse(input);
      if (parsed.success) return parsed.data;
      ctx.addIssue({ code: 'custom', message: 'Use the original schema issues' });
      return z.NEVER;
    });
    memo.set(schema, leaf);
    return leaf;
  }
  const rewrite = (value: unknown): unknown => {
    if (value instanceof z.ZodType) return withRuntimeLeaves(value, memo);
    if (Array.isArray(value)) return value.map(rewrite);
    if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
    return value;
  };
  const clone = z.clone(schema, rewrite(schema.def) as typeof schema.def);
  memo.set(schema, clone);
  return clone;
}

const compiled = z.compile(withRuntimeLeaves(Spec)) as typeof Spec;

export function parseSpecSchema(input: unknown): ReturnType<typeof Spec.safeParse> {
  const parsed = compiled.safeParse(input);
  return parsed.success ? parsed : Spec.safeParse(input);
}
