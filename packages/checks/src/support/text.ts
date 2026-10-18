import type { Observed } from '@agent-nexus/driftbench-core';

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

/**
 * The span of the text closest to a needle: the substring with the fewest single-character edits (insert, delete,
 * replace) from the needle. Returns its offsets and the edit count. Used on a failing literal, so the evidence can
 * name what the reply has where the needle was looked for.
 */
export function closestSpan(
  text: string,
  needle: string,
): { start: number; end: number; distance: number } | undefined {
  const m = needle.length;
  const n = text.length;
  if (m === 0 || n === 0) return undefined;
  let prev: number[] = Array.from({ length: n + 1 }, () => 0);
  let prevStart: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = new Array(n + 1).fill(i);
    const curStart: number[] = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      const sub = (prev[j - 1] ?? 0) + (needle[i - 1] === text[j - 1] ? 0 : 1);
      const skipNeedle = (prev[j] ?? 0) + 1;
      const skipText = (cur[j - 1] ?? 0) + 1;
      if (sub <= skipNeedle && sub <= skipText) {
        cur[j] = sub;
        curStart[j] = prevStart[j - 1] ?? 0;
      } else if (skipNeedle <= skipText) {
        cur[j] = skipNeedle;
        curStart[j] = prevStart[j] ?? 0;
      } else {
        cur[j] = skipText;
        curStart[j] = curStart[j - 1] ?? 0;
      }
    }
    prev = cur;
    prevStart = curStart;
  }
  let best = 0;
  for (let j = 1; j <= n; j++) if ((prev[j] ?? 0) < (prev[best] ?? 0)) best = j;
  return { start: prevStart[best] ?? 0, end: best, distance: prev[best] ?? 0 };
}
