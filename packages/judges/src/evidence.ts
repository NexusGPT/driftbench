import type { JudgeAnswer, JudgeRequest } from './contract';
import { renderEntry } from './transcript';

/** What `groundEvidence` returns: whether the quote is in the data, and the first place that holds it. */
export type Grounding = { readonly grounded: boolean; readonly where?: string };

/** Case, compatibility forms, typographic quotes and runs of white space folded, so a quote survives the way a model copies it. */
function fold(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** The first index at or after `from` where `needle` stands on word boundaries, or -1. */
function findOnWords(hay: string, needle: string, from: number): number {
  for (let i = hay.indexOf(needle, from); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const startsInWord = isWordChar(hay[i - 1]) && isWordChar(needle[0]);
    const endsInWord = isWordChar(hay[i + needle.length]) && isWordChar(needle[needle.length - 1]);
    if (!startsInWord && !endsInWord) return i;
  }
  return -1;
}

/**
 * Checks that a judge's `evidence` quotes the data. After folding, and after one pair of surrounding quotes is
 * stripped, the quote must be found on word boundaries inside one data place: a transcript entry
 * (`transcript.<index>`), the artifact (`artifact`) or the Given (`given`, as JSON). The parts of a quote split by
 * "..." are found in order in one place. The rubric, a tool name, an absent or an empty quote are never grounded.
 * `where` names the first place: transcript entries in order, then the artifact, then the Given.
 */
export function groundEvidence(request: JudgeRequest, answer: JudgeAnswer): Grounding {
  let quote = fold(answer.evidence ?? '');
  if (/^".*"$/.test(quote)) quote = quote.slice(1, -1).trim();
  if (quote === '') return { grounded: false };
  const parts = quote.split(/\s*\.\.\.\s*/).filter(Boolean);
  if (parts.length === 0) return { grounded: false };
  const places: [string, string][] = [
    ...request.transcript.flatMap((entry, i): [string, string][] => {
      const label = fold(`[${entry.role}${entry.tool ? ` ${entry.tool}` : ''}]`);
      const tail = quote.startsWith(`${label} `)
        ? quote
            .slice(label.length)
            .replace(/\s*\.\.\.\s*/g, '')
            .trim()
        : '';
      return [
        [`transcript.${i}`, entry.text],
        ...(tail
          ? [
              [
                `transcript.${i}`,
                request.answerContract === 'legacy'
                  ? `[${entry.role}${entry.tool ? ` ${entry.tool}` : ''}] ${entry.text}`
                  : renderEntry(entry),
              ] as [string, string],
            ]
          : []),
      ];
    }),
    ...(request.artifact === undefined ? [] : [['artifact', request.artifact] as [string, string]]),
    ...(request.given === undefined ? [] : [['given', JSON.stringify(request.given)] as [string, string]]),
    ...(request.inputs ?? []).map((input): [string, string] => [`input.${input.path}`, input.text]),
    ...(request.reference === undefined ? [] : [['reference', request.reference] as [string, string]]),
  ];
  for (const [where, text] of places) {
    if (containsParts(text, parts)) return { grounded: true, where };
  }
  return { grounded: false };
}

function containsParts(text: string, parts: readonly string[]): boolean {
  const hay = fold(text);
  let from = 0;
  for (const part of parts) {
    const at = findOnWords(hay, part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

/** Presence only: every supplied quote segment occurs in order in one text, on word boundaries. */
export function textContainsQuote(text: string, evidence: string): boolean {
  let quote = fold(evidence);
  if (/^".*"$/.test(quote)) quote = quote.slice(1, -1).trim();
  const parts = quote.split(/\s*\.\.\.\s*/).filter(Boolean);
  return parts.length > 0 && containsParts(text, parts);
}
