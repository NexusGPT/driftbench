import type { Observed } from '@driftbench/core';

/** One text segment of a block, with its position among all the block's segments. */
export type TextSegment = { index: number; text: string };

/** The text segments of a block in order, blank ones left out. */
export function textSegments(observed: Observed): TextSegment[] {
  const out: TextSegment[] = [];
  observed.segments.forEach((segment, index) => {
    if (segment.type === 'text' && segment.text.trim() !== '') out.push({ index, text: segment.text });
  });
  return out;
}

/**
 * The customer-visible text the regex and personal-data checks read: the adapter's concatenation in
 * `observed.text`, or the text segments joined by a line break when the adapter left it empty.
 */
export function visibleText(observed: Observed): string {
  if (observed.text !== '') return observed.text;
  return textSegments(observed)
    .map((segment) => segment.text)
    .join('\n');
}

/** A short quote of a text for evidence: one line, cut at `max` characters, in double quotes. */
export function quote(text: string, max = 60): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return JSON.stringify(line.length > max ? `${line.slice(0, max)}...` : line);
}

/** The text around an offset, for evidence on a match: a few words either side. */
export function around(text: string, offset: number, length: number, width = 30): string {
  const start = Math.max(0, offset - width);
  const end = Math.min(text.length, offset + length + width);
  const body = text.slice(start, end).replace(/\s+/g, ' ');
  return JSON.stringify(`${start > 0 ? '...' : ''}${body}${end < text.length ? '...' : ''}`);
}
