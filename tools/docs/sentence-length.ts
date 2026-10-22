/** A sentence of prose that runs over the word limit, with the line it starts on. */
export type LongSentence = { line: number; words: number; sentence: string };

/** The most words one sentence of the guide or the README may hold. */
export const SENTENCE_LIMIT = 25;

const SPLIT = /(?<=[.!?])\s+(?=[A-Z*`(])|\s·\s/;
const GENERATED = /^<!-- (readme-[a-z-]+):(start|end) -->$/;

/**
 * The sentences of a Markdown page that hold more than `limit` words. Code fences, table rows, headings,
 * lines of HTML and the generated regions of the README are not prose. A code span counts as one word,
 * a link as its text, and a part of a command bullet between two " · " separators as a sentence of its own.
 */
export function longSentences(text: string, limit: number = SENTENCE_LIMIT): LongSentence[] {
  const found: LongSentence[] = [];
  let fenced = false;
  let generated = false;
  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    const marker = GENERATED.exec(line);
    if (marker) generated = marker[2] === 'start';
    if (fenced || generated || marker) continue;
    if (line === '' || /^[|<#]/.test(line)) continue;
    const prose = line
      .replace(/`[^`]*`/g, 'CODE')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^(?:[-*] |\d+\. )/, '');
    for (const sentence of prose.split(SPLIT)) {
      const words = sentence.split(/\s+/).filter((word) => word !== '').length;
      if (words > limit) found.push({ line: index + 1, words, sentence });
    }
  }
  return found;
}
