import { isPlainObject } from '@agent-nexus/driftbench-core';

/**
 * Pieces of the OpenAI-compatible chat shape that two adapters read: the http adapter in a chat
 * completion, the nexus adapter in a generation the platform's tracing stored in that shape.
 */

/** The text of a message content: a string, or the text parts of a content list. */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part: unknown) =>
      isPlainObject(part) &&
      typeof part.text === 'string' &&
      (part.type === 'text' || part.type === undefined)
        ? [part.text]
        : [],
    )
    .join('');
}

/** Parse JSON arguments without hiding malformed or missing input behind an empty object. */
export function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  if (value.trim() === '') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
