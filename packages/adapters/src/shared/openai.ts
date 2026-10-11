import { isPlainObject } from '@driftbench/core';

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

/** Tool arguments arrive as JSON text; text that does not parse is kept as it is. */
export function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  if (value.trim() === '') return {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
