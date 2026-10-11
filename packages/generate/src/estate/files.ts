import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { InputIssue } from './inputs';

/** A schema the reader validates with: anything with a zod-like `safeParse`. */
export type YamlSchema<T> = {
  safeParse(raw: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
      };
};

export type ReadYaml<T> = { ok: true; value: T } | { ok: false; issues: InputIssue[] };

/** Reads one YAML file and validates it. Duplicate keys are refused. */
export async function readEstateYaml<T>(path: string, schema: YamlSchema<T>): Promise<ReadYaml<T>> {
  let raw: unknown;
  try {
    raw = parse(await readFile(path, 'utf8'), { uniqueKeys: true });
  } catch (cause) {
    return {
      ok: false,
      issues: [{ path: '', message: cause instanceof Error ? cause.message : String(cause) }],
    };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map((part) => String(part)).join('.'),
      message: issue.message,
    })),
  };
}
