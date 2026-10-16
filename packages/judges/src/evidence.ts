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

/** The spelling of an empty JSON object or array, white space aside; undefined for any other text. */
function emptyContainer(text: string): '{}' | '[]' | undefined {
  const compact = text.replace(/\s+/g, '');
  return compact === '{}' || compact === '[]' ? compact : undefined;
}

/**
 * An empty object or array holds no letter or digit, so no substantive quote can come from it. Its exact
 * copy is grounded only in a source whose whole text is that same empty container: nothing else is copied.
 */
const quotesWholeEmptySource = (text: string, quote: string): boolean => {
  const empty = emptyContainer(quote);
  return empty !== undefined && empty === emptyContainer(text);
};

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
 * One exception holds no letter or digit: `{}` or `[]` quoted from a place whose whole text is that empty container.
 * `where` names the first place: transcript entries in order, then the artifact, then the Given.
 */
export function groundEvidence(request: JudgeRequest, answer: JudgeAnswer): Grounding {
  let quote = fold(answer.evidence ?? '');
  if (emptyContainer(quote)) {
    for (const [i, entry] of request.transcript.entries())
      if (quotesWholeEmptySource(entry.text, quote)) return { grounded: true, where: `transcript.${i}` };
    const whole = dataPlaces(request).find(([, text]) => quotesWholeEmptySource(text, quote));
    return whole ? { grounded: true, where: whole[0] } : { grounded: false };
  }
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

type CandidateView = {
  readonly text: string;
  readonly literalOwnText?: string;
  readonly normalizationBodies?: readonly string[];
  readonly normalize: boolean;
};

/** Only strict JSON strings or text fields add a decoded view; invalid or duplicate JSON stays raw. */
function jsonTextViews(text: string): CandidateView[] {
  const views: CandidateView[] = [{ text, normalize: true }];
  const duplicate = repeatedObjectKey(text);
  try {
    const value: unknown = JSON.parse(text);
    // Serialized escapes and keys cannot supply substance. Raw identity uses decoded character
    // provenance; normalization uses the decoded text rather than the JSON spelling.
    views[0] = { text, ...jsonLiteralProjection(text), normalize: true };
    if (duplicate !== undefined) return views;
    if (typeof value === 'string') views.push({ text: value, normalize: true });
    else if (value && typeof value === 'object' && 'text' in value) {
      const content = value.text;
      if (typeof content === 'string') views.push({ text: content, normalize: true });
      else if (Array.isArray(content) && content.every((item) => typeof item === 'string'))
        views.push({ text: content.join('\n'), normalize: true });
    }
  } catch {
    // Reversible decoding never repairs malformed candidate data or guesses its content.
  }
  return views;
}

/** Map decoded, non-metadata letters and digits back onto their complete raw JSON spellings. */
function jsonLiteralProjection(text: string): {
  literalOwnText: string;
  normalizationBodies: readonly string[];
} {
  const value: unknown = JSON.parse(text);
  const textWrapper =
    value !== null &&
    typeof value === 'object' &&
    'text' in value &&
    (typeof value.text === 'string' ||
      (Array.isArray(value.text) && value.text.every((item) => typeof item === 'string')));
  const own = maskPresentationMetadata(text).split('');
  const outside = text.split('');
  const bodies: string[] = [];
  type Origin = { from: number; to: number };
  const strings: {
    start: number;
    end: number;
    decoded: string;
    offsets: Origin[];
    key: boolean;
    bodyIndex?: number;
  }[] = [];
  const paint = (decoded: string, offsets: readonly (Origin | undefined)[]) => {
    const body = maskPresentationMetadata(decoded.replace(/⏎/g, '\n'));
    for (const letter of body.matchAll(/[\p{L}\p{N}]/gu)) {
      const from = offsets[letter.index]?.from;
      const to = offsets[letter.index + letter[0].length - 1]?.to;
      if (from !== undefined && to !== undefined) own.fill('x', from, to);
    }
  };
  // The caller has already validated the whole JSON. This lexer visits its complete string tokens.
  for (const token of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"/g)) {
    const start = token.index;
    const end = start + token[0].length;
    own.fill(' ', start, end);
    outside.fill(' ', start, end);
    const key = /^\s*:/.test(text.slice(end));
    const decoded: string = JSON.parse(token[0]);
    const offsets: Origin[] = [];
    for (let at = start + 1; at < end - 1; ) {
      const length = text[at] === '\\' ? (text[at + 1] === 'u' ? 6 : 2) : 1;
      offsets.push({ from: at, to: at + length });
      at += length;
    }
    const record = { start, end, decoded, offsets, key };
    if (textWrapper && key) strings.push(record);
    else {
      strings.push({ ...record, bodyIndex: bodies.length });
      bodies.push(decoded.replace(/⏎/g, '\n'));
      paint(decoded, offsets);
    }
  }
  const syntax = outside.join('');
  if (
    textWrapper &&
    value &&
    typeof value === 'object' &&
    'text' in value &&
    Array.isArray(value.text) &&
    repeatedObjectKey(text) === undefined
  ) {
    const depthAt = (at: number) =>
      [...syntax.slice(0, at)].reduce(
        (depth, ch) => depth + ('{['.includes(ch) ? 1 : '}]'.includes(ch) ? -1 : 0),
        0,
      );
    const field = strings.find(
      (token) => token.key && token.decoded === 'text' && depthAt(token.start) === 1,
    );
    if (field) {
      const prefix = /^\s*:\s*/.exec(text.slice(field.end));
      const start = field.end + (prefix?.[0].length ?? 0);
      const end = syntax.indexOf(']', start);
      const payload = strings.filter((token) => token.start > start && token.end <= end);
      if (payload.length === value.text.length) {
        const offsets: (Origin | undefined)[] = [];
        for (const [i, token] of payload.entries()) {
          if (i) offsets.push(undefined);
          offsets.push(...token.offsets);
          own.fill(' ', token.start, token.end);
        }
        const decoded = payload.map((token) => token.decoded).join('\n');
        paint(decoded, offsets);
        for (const token of [...payload].reverse())
          if (token.bodyIndex !== undefined) bodies.splice(token.bodyIndex, 1);
        bodies.push(decoded.replace(/⏎/g, '\n'));
      }
    }
  }
  // Keep numeric/boolean/null source spellings intact; JSON number coercion cannot round a quote.
  for (const value of outside
    .join('')
    .matchAll(/true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g))
    bodies.push(value[0]);
  return { literalOwnText: own.join(''), normalizationBodies: bodies };
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
function literalCandidateQuote(
  text: string,
  quote: string,
  ownText = maskPresentationMetadata(text),
): boolean {
  if (!substantive(quote)) return false;
  // Preserve source offsets so metadata letters never count as the quoted substantive span.
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
function candidateQuoteHasRealText(
  text: string,
  evidence: string,
  keepLists: boolean,
  normalizationBodies?: readonly string[],
): boolean {
  const presented = presentationText(text, keepLists);
  const punctuation = (metadata: string) =>
    metadata.replace(/[\p{L}\p{N}]/gu, (character) => '.'.repeat(character.length));
  let own = presented
    .replace(roleToken, punctuation)
    .replace(/^ {0,3}(?:[-+*]|\d+[.)])[\t ]+/gm, punctuation)
    .replace(/\s+/g, ' ')
    .trim();
  const hay = fold(text, keepLists);
  if (normalizationBodies !== undefined) {
    try {
      JSON.parse(hay);
      own = jsonLiteralProjection(hay).literalOwnText;
    } catch {
      // Presentation folding can make a serialized string syntactically invalid. Retain a match
      // only when its quoted content also occurs in an actual decoded value, never a wrapper key.
      return normalizationBodies.some(
        (body) =>
          literalCandidateQuote(body, evidence) ||
          (quoteMatches(body, evidence, keepLists) && candidateQuoteHasRealText(body, evidence, keepLists)),
      );
    }
  }
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
  // Decode JSON before folding renderer marks. A separator and its newline occupy one code unit.
  const supplied = quote.replace(/⏎/g, '\n');
  return jsonTextViews(text).some((view) => {
    const source = view.text.replace(/⏎/g, '\n');
    return (
      literalCandidateQuote(source, supplied, view.literalOwnText) ||
      (view.normalize &&
        [false, true].some(
          (keepLists) =>
            quoteMatches(source, supplied, keepLists) &&
            candidateQuoteHasRealText(source, supplied, keepLists, view.normalizationBodies),
        ))
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

/** Additional span grounding enabled by decoder 3; historical decoders omit these options. */
export type SpanGrounding = {
  readonly symbolQuotes?: boolean;
  readonly inputSpellings?: boolean;
  readonly toolNames?: boolean;
};

/** The fewest non-space characters a quote without any letter or digit needs. */
const MIN_SYMBOL_QUOTE = 3;

/** Compatibility forms, typographic quotes and runs of white space folded; case and markup are kept. */
const symbolFold = (text: string): string =>
  text.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/**
 * A quote of symbols alone, such as a run of closing brackets, holds no letter or digit, so the word search
 * never grounds it. With `symbolQuotes` it grounds when its exact folded text occurs in the source it names,
 * with at least three non-space characters. The source is never swapped for another one.
 */
function quotesSymbols(text: string, quote: string): boolean {
  const folded = symbolFold(quote);
  return (
    !/[\p{L}\p{N}]/u.test(folded) &&
    folded.replace(/\s/g, '').length >= MIN_SYMBOL_QUOTE &&
    symbolFold(text).includes(folded)
  );
}

/** The text a span names, and the place it is reported as: a transcript entry, a data place or the sole input. */
function namedSource(request: JudgeRequest, source: string): { text: string; where: string } | undefined {
  const entryId = /^transcript\.(0|[1-9]\d*)$/.exec(source);
  if (entryId) {
    const entry = request.transcript[Number(entryId[1])];
    return entry && { text: entry.text, where: source };
  }
  const place = dataPlaces(request).find(([where]) => where === source);
  if (place) return { text: place[1], where: source };
  const input = request.inputs?.length === 1 ? request.inputs[0] : undefined;
  if (input && (source === input.path || ['reference', 'given', 'artifact'].includes(source)))
    return { text: input.text, where: `input.${input.path}` };
  return undefined;
}

/**
 * The input a source label spells another way than `input.<path>`: `input/<path>`, `input_data/<path>`,
 * `input <path>`, `input. <path>` or `input<path>` name the input with exactly that path, among any number of
 * inputs. A bare `input`, `inputs` or `input_data` names the sole input. Otherwise the label names no input,
 * and no input is guessed.
 */
function spelledInput(request: JudgeRequest, label: string): string | undefined {
  const inputs = request.inputs ?? [];
  if (dataPlaces(request).some(([where]) => where === label)) return undefined;
  const spelling = /^inputs?(?:_data)?(?:\s*[/.:<\s]\s*(.*?)>?)?$/i.exec(label.trim());
  if (!spelling) return undefined;
  const path = spelling[1]?.trim();
  const named = path ? inputs.filter((input) => input.path === path) : inputs;
  return named.length === 1 ? `input.${named[0]?.path}` : undefined;
}

/** A tool event's supplied name is evidence of that event, never of another transcript entry. */
function quotesToolName(tool: string, quote: string): boolean {
  const name = fold(tool);
  const given = fold(quote);
  const unquote = (value: string): string =>
    value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]
      ? value.slice(1, -1).trim()
      : value;
  // Only the field wrapper and a matching outer quote pair are presentation. Quotes and
  // colons inside the supplied identifier remain data, including names such as order.o'reilly.
  const frame = /^(?:tool|"tool"|'tool')\s*:\s*(.*)$/.exec(given);
  return (
    name.length > 0 &&
    (given === name || unquote(given) === name || (frame !== null && unquote(frame[1] ?? '') === name))
  );
}

/** A quote grounds only in its named source; toolNames also admits a tool event's exact name. */
export function groundEvidenceSpan(
  request: JudgeRequest,
  span: EvidenceSpan,
  options: SpanGrounding = {},
): Grounding {
  const spelled = options.inputSpellings ? spelledInput(request, span.source) : undefined;
  const source = spelled ?? span.source;
  const grounding = groundSpanWords(request, { ...span, source }, options.toolNames);
  if (grounding.grounded || !options.symbolQuotes) return grounding;
  const named = namedSource(request, source);
  return named && quotesSymbols(named.text, span.quote) ? { grounded: true, where: named.where } : grounding;
}

function groundSpanWords(request: JudgeRequest, span: EvidenceSpan, toolNames = false): Grounding {
  const entryId = /^transcript\.(0|[1-9]\d*)$/.exec(span.source);
  if (entryId) {
    const entry = request.transcript[Number(entryId[1])];
    if (!entry) return { grounded: false };
    if (
      toolNames &&
      (entry.role === 'tool_call' || entry.role === 'tool_result') &&
      entry.tool &&
      quotesToolName(entry.tool, span.quote)
    )
      return { grounded: true, where: span.source };
    const grounded = groundEvidence(
      { criterion: request.criterion, transcript: [entry] },
      { outcome: 'inconclusive', reasoning: '', evidence: span.quote },
    ).grounded;
    return grounded ? { grounded: true, where: span.source } : { grounded: false };
  }
  const place = dataPlaces(request).find(([where]) => where === span.source);
  if (place)
    return quotesWholeEmptySource(place[1], span.quote) || textContainsQuote(place[1], span.quote)
      ? { grounded: true, where: span.source }
      : { grounded: false };
  // A bare input path or absent generic source can name the sole declared input.
  // Never guess among inputs or replace a supplied canonical source with another source.
  const input = request.inputs?.length === 1 ? request.inputs[0] : undefined;
  if (
    input &&
    (span.source === input.path || ['reference', 'given', 'artifact'].includes(span.source)) &&
    (quotesWholeEmptySource(input.text, span.quote) || textContainsQuote(input.text, span.quote))
  )
    return { grounded: true, where: `input.${input.path}` };
  return { grounded: false };
}

function dataPlaces(request: JudgeRequest): [string, string][] {
  return [
    ...(request.artifact === undefined ? [] : [['artifact', request.artifact] as [string, string]]),
    ...(request.given === undefined ? [] : [['given', JSON.stringify(request.given)] as [string, string]]),
    ...(request.inputs ?? []).map((input): [string, string] => [`input.${input.path}`, input.text]),
    ...(request.reference === undefined ? [] : [['reference', request.reference] as [string, string]]),
  ];
}
