import type { z } from 'zod';

/** A schema issue of a map or plan file: its code, the dotted path to the field and a readable message. */
export type SchemaIssue = { code: `SCHEMA_${string}`; path: string; message: string };

/** A zod issue in the words a map or plan file reports it: unknown keys named, a missing field called missing. */
export function fromZod(zodIssue: z.core.$ZodIssue): SchemaIssue {
  let message = zodIssue.message;
  if (zodIssue.code === 'unrecognized_keys')
    message = `unknown key${zodIssue.keys.length > 1 ? 's' : ''}: ${zodIssue.keys.join(', ')}`;
  else if (zodIssue.code === 'invalid_type') message = message.replace(/received undefined$/, 'missing');
  return {
    code: `SCHEMA_${zodIssue.code.toUpperCase()}`,
    path: zodIssue.path.map(String).join('.'),
    message,
  };
}

/** An error's message for a one-line report: its first three lines, joined. */
export function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message.split('\n').slice(0, 3).join(' ').trim();
  return String(cause);
}
