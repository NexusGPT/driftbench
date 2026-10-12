import type { JudgeAnswer, JudgeRequest } from './contract';

/** What `groundEvidence` returns: whether the quote is in the data, and the first place that holds it. */
export type Grounding = { readonly grounded: boolean; readonly where?: string };

/** Case, compatibility forms, typographic quotes and runs of white space folded, so a quote survives the way a model copies it. */
function fold(text: string): string {
  return markdownText(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove presentation syntax without collapsing semantic intra-word underscores or arithmetic. */
function markdownText(text: string): string {
  return text
    .replace(/^ {0,3}#{1,6}[\t ]+/gm, '')
    .replace(/^ {0,3}(?:[-+*]|\d+[.)])[\t ]+/gm, '')
    .replace(/(^|[^\p{L}\p{N}_])([*_]{1,3})(?=\S)([\s\S]*?\S)\2(?![\p{L}\p{N}_])/gu, '$1$3')
    .replace(/(`+)([\s\S]*?)\1/g, '$2');
}

/** Role tokens are metadata even when repeated inside a quoted body. */
const withoutRoles = (text: string): string =>
  text.replace(
    /\[(?:user|agent|assistant|system|context|card|tool(?:_call|_result)?)(?:\s+[^\]]*)?\]/giu,
    ' ',
  );
const substantive = (text: string): boolean => /[\p{L}\p{N}]/u.test(withoutRoles(text));

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
  if (!substantive(quote)) return { grounded: false };
  const parts = quote.split(/\s*\.\.\.\s*/).filter(Boolean);
  if (parts.length === 0) return { grounded: false };
  for (const [i, entry] of request.transcript.entries()) {
    const label = fold(`[${entry.role}${entry.tool ? ` ${entry.tool}` : ''}]`);
    const prefixed = quote === label || quote.startsWith(`${label} `);
    const tail = prefixed ? quote.slice(label.length).replace(/⏎/g, ' ') : '';
    if (prefixed ? textContainsQuote(entry.text, tail) : containsParts(entry.text, parts))
      return { grounded: true, where: `transcript.${i}` };
  }
  const places: [string, string][] = [
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
  if (!substantive(hay)) return false;
  return (
    orderedParts(hay, parts) &&
    orderedParts(
      withoutRoles(hay),
      parts
        .map(withoutRoles)
        .map((part) => part.trim())
        .filter(Boolean),
    )
  );
}

function orderedParts(hay: string, parts: readonly string[]): boolean {
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
  return parts.length > 0 && substantive(quote) && containsParts(text, parts);
}
