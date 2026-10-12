import type { JudgeAnswer, JudgeRequest } from './contract';

/**
 * Evidence grounding: a judge's `evidence` must quote the data. A quote is grounded when, after folding case,
 * Unicode compatibility forms, typographic quotes and runs of white space, and after stripping one pair of
 * surrounding quotes, it is found on word boundaries inside one data place: a transcript entry, the artifact or
 * the Given. A quote with an ellipsis is grounded when each part is found, in order, in the same place. The
 * criterion and tool names are not data places. `where` names the first place that holds the quote.
 */

export type Grounding = { grounded: boolean; where?: string };

function fold(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Where `needle` first occurs in `hay` from `from`, on word boundaries; -1 when it does not. */
function indexOnWords(hay: string, needle: string, from: number): number {
  const word = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  for (let i = hay.indexOf(needle, from); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const startsWord = !(word(hay[i - 1]) && word(needle[0]));
    const endsWord = !(word(hay[i + needle.length]) && word(needle[needle.length - 1]));
    if (startsWord && endsWord) return i;
  }
  return -1;
}

function holdsInOrder(hay: string, parts: readonly string[]): boolean {
  let from = 0;
  for (const part of parts) {
    const at = indexOnWords(hay, part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

/** Grounds an answer's evidence quote in the data of its request. */
export function groundEvidence(request: JudgeRequest, answer: JudgeAnswer): Grounding {
  let quote = fold(answer.evidence ?? '');
  if (/^".*"$/.test(quote)) quote = quote.slice(1, -1).trim();
  if (quote === '') return { grounded: false };
  const parts = quote.split(/\s*\.\.\.\s*/).filter((part) => part !== '');
  const places: [string, string][] = [
    ...request.transcript.map((entry, index): [string, string] => [`transcript.${index}`, entry.text]),
  ];
  if (request.artifact !== undefined) places.push(['artifact', request.artifact]);
  if (request.given !== undefined) places.push(['given', JSON.stringify(request.given)]);
  for (const [where, text] of places) {
    if (holdsInOrder(fold(text), parts)) return { grounded: true, where };
  }
  return { grounded: false };
}
