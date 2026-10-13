import type { JudgeAnswer, JudgeRequest } from './contract';
import { repeatedObjectKey } from './contract';

/** What `groundEvidence` returns: whether the quote is in the data, and the first place that holds it. */
export type Grounding = { readonly grounded: boolean; readonly where?: string };

/** Case, compatibility forms, typographic quotes and runs of white space folded, so a quote survives the way a model copies it. */
function fold(text: string, keepLists = false): string {
  return presentationText(text, keepLists).replace(/\s+/g, ' ').trim();
}

function presentationText(text: string, keepLists: boolean): string {
  return markdownText(text, keepLists)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

/** Remove presentation syntax without collapsing semantic intra-word underscores or arithmetic. */
function markdownText(text: string, keepLists = false): string {
  const headings = text.replace(/^ {0,3}#{1,6}[\t ]+/gm, '');
  return (keepLists ? headings : headings.replace(/^ {0,3}(?:[-+*]|\d+[.)])[\t ]+/gm, ''))
    .replace(/(^|[^\p{L}\p{N}_])([*_]{1,3})(?=\S)([\s\S]*?\S)\2(?![\p{L}\p{N}_])/gu, '$1$3')
    .replace(/(`+)([\s\S]*?)\1/g, '$2');
}

/** Role tokens are metadata even when repeated inside a quoted body. */
const roleToken = /\[(?:user|agent|assistant|system|context|card|tool(?:_call|_result)?)(?:\s+[^\]]*)?\]/giu;
const withoutRoles = (text: string): string => text.replace(roleToken, ' ');
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
  const places = dataPlaces(request);
  for (const [where, text] of places) {
    if (containsParts(text, parts)) return { grounded: true, where };
  }
  return { grounded: false };
}

function containsParts(text: string, parts: readonly string[], keepLists = false): boolean {
  const hay = fold(text, keepLists);
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
  return quoteMatches(text, evidence);
}

function quoteMatches(text: string, evidence: string, keepLists = false): boolean {
  let quote = fold(evidence, keepLists);
  if (/^".*"$/.test(quote)) quote = quote.slice(1, -1).trim();
  const parts = quote.split(/\s*\.\.\.\s*/).filter(Boolean);
  return parts.length > 0 && substantive(quote) && containsParts(text, parts, keepLists);
}

/** Only strict JSON strings or text fields add a decoded view; invalid or duplicate JSON stays raw. */
function jsonTextViews(text: string): string[] {
  const views = [text];
  if (repeatedObjectKey(text) !== undefined) return views;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'string') views.push(value);
    else if (value && typeof value === 'object' && 'text' in value) {
      const content = value.text;
      if (typeof content === 'string') views.push(content);
      else if (Array.isArray(content) && content.every((item) => typeof item === 'string'))
        views.push(content.join('\n'));
    }
  } catch {
    // Reversible decoding never repairs malformed candidate data or guesses its content.
  }
  return views;
}

export function stripReplyLabel(quote: string, winner: 'A' | 'B'): string | undefined {
  const label = /^\s*Reply\s+([AB])\s*:\s*/i.exec(quote);
  if (label && label[1]?.toUpperCase() !== winner) return undefined;
  return (label ? quote.slice(label[0].length) : quote).replace(/⏎/g, '\n');
}

/** Strip compatibility-form role tokens without moving offsets in the original candidate. */
function maskRoleTokens(text: string): string {
  const normalized = text.normalize('NFKC');
  if (normalized === text) return text.replace(roleToken, (label) => ' '.repeat(label.length));
  const offsets: { from: number; to: number }[] = [];
  let from = 0;
  let projected = '';
  for (const character of text) {
    const to = from + character.length;
    const folded = character.normalize('NFKC');
    projected += folded;
    for (let i = 0; i < folded.length; i += 1) offsets.push({ from, to });
    from = to;
  }
  const masked = text.split('');
  for (const match of projected.matchAll(roleToken)) {
    const start = offsets[match.index]?.from;
    const end = offsets[match.index + match[0].length - 1]?.to;
    if (start !== undefined && end !== undefined) masked.fill(' ', start, end);
  }
  return masked.join('');
}

/** Raw literal identity remains valid even when markup folding changes its boundary. */
function literalCandidateQuote(text: string, quote: string): boolean {
  if (!substantive(quote)) return false;
  // Preserve source offsets so metadata letters never count as the quoted substantive span.
  const ownText = maskPresentationMetadata(text);
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) {
    if (/[\p{L}\p{N}]/u.test(ownText.slice(at, at + quote.length))) return true;
  }
  return false;
}

function maskPresentationMetadata(text: string): string {
  return maskRoleTokens(text).replace(/^ {0,3}(?:[-+*]|\d+[.)])[\t ]+/gm, (marker) =>
    ' '.repeat(marker.length),
  );
}

/** Keep folded offsets aligned while excluding metadata letters and list numbers from each match. */
function candidateQuoteHasRealText(text: string, evidence: string, keepLists: boolean): boolean {
  const presented = presentationText(text, keepLists);
  const punctuation = (metadata: string) =>
    metadata.replace(/[\p{L}\p{N}]/gu, (character) => '.'.repeat(character.length));
  const own = presented
    .replace(roleToken, punctuation)
    .replace(/^ {0,3}(?:[-+*]|\d+[.)])[\t ]+/gm, punctuation)
    .replace(/\s+/g, ' ')
    .trim();
  const hay = fold(text, keepLists);
  let quote = fold(evidence, keepLists);
  if (/^".*"$/.test(quote)) quote = quote.slice(1, -1).trim();
  return quote
    .split(/\s*\.\.\.\s*/)
    .filter(Boolean)
    .some((part) => {
      for (let at = findOnWords(hay, part, 0); at >= 0; at = findOnWords(hay, part, at + 1)) {
        if (/[\p{L}\p{N}]/u.test(own.slice(at, at + part.length))) return true;
      }
      return false;
    });
}

/** Winner identity preserves literal matches and adds reversible JSON/presentation views. */
export function candidateContainsQuote(text: string, quote: string): boolean {
  const supplied = quote.replace(/⏎/g, '\n');
  return jsonTextViews(text).some((view) => {
    const source = view.replace(/⏎/g, '\n');
    return (
      literalCandidateQuote(source, supplied) ||
      [false, true].some(
        (keepLists) =>
          quoteMatches(source, supplied, keepLists) && candidateQuoteHasRealText(source, supplied, keepLists),
      )
    );
  });
}

/** A quoted full continuation can repeat the common prefix. Remove that overlap, never source words. */
export function quoteContinuations(passage: string, quote: string): string[] {
  const supplied = passage.replace(/⏎/g, '\n');
  const prefix = quote.replace(/⏎/g, '\n');
  return [false, true].flatMap((keepLists) => {
    const whole = fold(supplied, keepLists);
    const opening = fold(prefix, keepLists);
    if (!substantive(opening) || findOnWords(whole, opening, 0) !== 0) return [];
    const following = whole.slice(opening.length).trim();
    return substantive(following) ? [following] : [];
  });
}

export type EvidenceSpan = { readonly source: string; readonly quote: string };

/** A quote grounds only in the named source; frame metadata never counts as body evidence. */
export function groundEvidenceSpan(request: JudgeRequest, span: EvidenceSpan): Grounding {
  const entryId = /^transcript\.(0|[1-9]\d*)$/.exec(span.source);
  if (entryId) {
    const entry = request.transcript[Number(entryId[1])];
    if (!entry) return { grounded: false };
    const grounded = groundEvidence(
      { criterion: request.criterion, transcript: [entry] },
      { outcome: 'inconclusive', reasoning: '', evidence: span.quote },
    ).grounded;
    return grounded ? { grounded: true, where: span.source } : { grounded: false };
  }
  const place = dataPlaces(request).find(([where]) => where === span.source);
  return place && textContainsQuote(place[1], span.quote)
    ? { grounded: true, where: span.source }
    : { grounded: false };
}

function dataPlaces(request: JudgeRequest): [string, string][] {
  return [
    ...(request.artifact === undefined ? [] : [['artifact', request.artifact] as [string, string]]),
    ...(request.given === undefined ? [] : [['given', JSON.stringify(request.given)] as [string, string]]),
    ...(request.inputs ?? []).map((input): [string, string] => [`input.${input.path}`, input.text]),
    ...(request.reference === undefined ? [] : [['reference', request.reference] as [string, string]]),
  ];
}
