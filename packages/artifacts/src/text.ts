import { countHolds, describeCount, invalid, parseCount, textList } from './args';
import { clip, type Equality, listed } from './assertion';
import type { TextCheck } from './document';

/** Decodes file bytes as text: UTF-8 by default, UTF-16 when the file starts with its byte order mark. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Collapses every run of white space to one space and trims: rendering splits lines and runs at will. */
export function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Equality for the text of a document (a heading, a slide title, a table cell): white space collapsed on
 * both sides; a spec number or boolean reads as its text, so a heading 2026 matches `2026`.
 */
export const textEqual: Equality = (expected, found) => {
  if (typeof found !== 'string') return expected === found;
  if (typeof expected === 'string') return squash(expected) === squash(found);
  if (typeof expected === 'number' || typeof expected === 'boolean')
    return String(expected) === squash(found);
  return false;
};

/** The number of lines; a final line break does not open another line, and an empty text has none. */
export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split(/\r\n|\r|\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

function quoted(text: string): string {
  return JSON.stringify(clip(text, 80));
}

function around(haystack: string, at: number, length: number): string {
  const start = Math.max(0, at - 30);
  const end = Math.min(haystack.length, at + length + 30);
  return `${start > 0 ? '...' : ''}${haystack.slice(start, end)}${end < haystack.length ? '...' : ''}`;
}

/** Texts that must appear. White space is collapsed on both sides before the comparison. */
export const contains: TextCheck = {
  reads: 'text',
  usage: 'contains: "text" or contains: ["text", ...]',
  run(arg, text) {
    const needles = textList(arg, 'text');
    const haystack = squash(text);
    const missing = needles.filter((needle) => !haystack.includes(squash(needle)));
    if (missing.length === 0) return { ok: true, evidence: `found ${listed(needles.map(quoted))}` };
    const preview = haystack.length === 0 ? 'the text is empty' : `the text starts ${quoted(haystack)}`;
    return {
      ok: false,
      evidence: `missing ${listed(missing.map(quoted))} (${needles.length - missing.length} of ${needles.length} found); ${preview}`,
    };
  },
};

/** Texts that must not appear. White space is collapsed on both sides before the comparison. */
export const notContains: TextCheck = {
  reads: 'text',
  usage: 'not_contains: "text" or not_contains: ["text", ...]',
  run(arg, text) {
    const needles = textList(arg, 'text');
    const haystack = squash(text);
    const hits = needles.flatMap((needle) => {
      const at = haystack.indexOf(squash(needle));
      return at === -1 ? [] : [`${quoted(needle)} in ${quoted(around(haystack, at, squash(needle).length))}`];
    });
    if (hits.length === 0) return { ok: true, evidence: `none of ${listed(needles.map(quoted))} found` };
    return { ok: false, evidence: `found ${listed(hits, 5)}` };
  },
};

/** Patterns that must match the text as rendered, compiled with the m flag. */
export const regex: TextCheck = {
  reads: 'text',
  usage: 'regex: "pattern" or regex: ["pattern", ...]',
  run(arg, text) {
    const patterns = textList(arg, 'pattern').map((source) => {
      try {
        return new RegExp(source, 'm');
      } catch (cause) {
        return invalid(`has an invalid pattern: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    });
    const results = patterns.map((pattern) => ({ pattern, match: pattern.exec(text) }));
    const misses = results.filter((result) => result.match === null);
    if (misses.length === 0) {
      return {
        ok: true,
        evidence: listed(
          results.map((result) => `/${result.pattern.source}/ matched ${quoted(result.match?.[0] ?? '')}`),
        ),
      };
    }
    return {
      ok: false,
      evidence: `no match for ${listed(misses.map((miss) => `/${miss.pattern.source}/`))} in ${text.length} characters`,
    };
  },
};

/** The number of lines of a text or code file. */
export const lines: TextCheck = {
  reads: 'text',
  usage: 'lines: 12 or lines: { min: 1, max: 200 }',
  run(arg, text) {
    const count = parseCount(arg, 'a line count');
    const found = lineCount(text);
    const ok = countHolds(count, found);
    return { ok, evidence: `${found} lines${ok ? '' : `, expected ${describeCount(count)}`}` };
  },
};

/** The checks every kind answers on its rendered text. */
export const TEXT_CHECKS = { contains, not_contains: notContains, regex } as const;
