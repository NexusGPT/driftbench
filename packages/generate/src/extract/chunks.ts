/**
 * A long prompt does not fit one answer: the answer lists every rule with a quote and is cut at the model's
 * output limit. A prompt source longer than `CHUNK_THRESHOLD` is read in chunks of `CHUNK_CHARS`, one request per chunk. Each
 * chunk is cut at a line boundary, at a blank line when one lies in the second half of the chunk, so a
 * paragraph stays whole. Sources that are not prompts (an inventory, tool schemas) go in every request.
 */

/** A prompt source up to this many characters goes whole in one request, as a person's prompt does. */
export const CHUNK_THRESHOLD = 40_000;
/** The most characters of one chunk once a prompt source is longer than the threshold. */
export const CHUNK_CHARS = 12_000;

/** The text cut in pieces of at most `max` characters, at line boundaries. A line longer than `max` is its own piece. */
export function chunkText(text: string, max = CHUNK_CHARS, threshold = CHUNK_THRESHOLD): string[] {
  if (text.length <= threshold) return [text];
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = (upTo: number) => {
    chunks.push(current.slice(0, upTo).join('\n'));
    current = current.slice(upTo);
    size = current.reduce((sum, line) => sum + line.length + 1, 0);
  };
  for (const line of lines) {
    if (size + line.length + 1 > max && current.length > 0) {
      // Prefer the last blank line of the second half of the chunk.
      let cut = current.length;
      let seen = 0;
      for (let i = 0; i < current.length; i++) {
        seen += (current[i] as string).length + 1;
        if (current[i]?.trim() === '' && seen >= size / 2) cut = i + 1;
      }
      // A question stays with the line that answers it: the cut moves before it.
      while (cut > 1 && /\?\s*$/.test(current[cut - 1] as string)) cut--;
      flush(cut);
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) chunks.push(current.join('\n'));
  return chunks;
}

/**
 * The lines a chunk needs to be read right, given the text before it: the headings it sits under, and the
 * header of the table it continues. Both are lines of the file, so a quote taken from them is still found.
 */
function contextBefore(lines: readonly string[], start: number, first: string): string[] {
  const stack: Array<{ level: number; line: string }> = [];
  let header: string[] = [];
  for (let i = 0; i < start; i++) {
    const line = lines[i] as string;
    const heading = /^(#{1,6})\s+\S/.exec(line);
    if (heading) {
      const level = (heading[1] as string).length;
      while (stack.length > 0 && (stack[stack.length - 1] as { level: number }).level >= level) stack.pop();
      stack.push({ level, line });
    }
    if (/^\|\s*:?-{2,}/.test(line) && /^\|/.test(lines[i - 1] ?? '')) header = [lines[i - 1] as string, line];
    else if (!/^\|/.test(line) && line.trim() !== '') header = [];
  }
  const own = /^(#{1,6})\s+\S/.exec(first);
  const ownLevel = own ? (own[1] as string).length : 7;
  const out = stack.filter((entry) => entry.level < ownLevel).map((entry) => entry.line);
  const inTable = /^\|/.test(first) && header.length > 0 && first !== header[0];
  return inTable ? [...out, '', ...header] : out;
}

/** A line that says an earlier rule no longer holds: an update, a replacement. */
const UPDATE_LINE =
  /^\s*(update|updated|replaces?|mise à jour|supersedes?)\b.*\b(no longer|replaces?|supersede)/i;
/** The most characters of updates one chunk carries. */
const UPDATES_CHARS = 60_000;

type Source = { kind: string; path: string; text: string };

/**
 * The source sets one section is asked about: a single set when no prompt is long, else one set per chunk
 * position, each holding the whole short sources and one chunk of every long prompt.
 */
export function chunkSources<T extends Source>(
  sources: readonly T[],
  max = CHUNK_CHARS,
  threshold = CHUNK_THRESHOLD,
): T[][] {
  const pieces = sources.map((source) => {
    if (source.kind !== 'prompt') return [source.text];
    const chunks = chunkText(source.text, max, threshold);
    if (chunks.length === 1) return chunks;
    // A chunk after the first carries the headings it sits under and the header of its table.
    const lines = source.text.split('\n');
    let at = 0;
    return chunks
      .map((chunk, index) => {
        const start = at;
        at += chunk.split('\n').length;
        if (index === 0) return chunk;
        const first = chunk.split('\n').find((line) => line.trim() !== '') ?? '';
        const context = contextBefore(lines, start, first);
        return context.length > 0 ? `${context.join('\n')}\n\n${chunk}` : chunk;
      })
      .map((piece, _index, all) => {
        // An update at the end can retire a rule many chunks earlier: every other chunk carries the updates.
        const own = new Set(piece.split('\n'));
        const updates: string[] = [];
        let size = 0;
        for (const line of lines) {
          if (!UPDATE_LINE.test(line) || own.has(line) || size + line.length > UPDATES_CHARS) continue;
          // Only the clause that retires the rule: the replacement itself is read in its own chunk.
          const clause = /^.*?\b(?:no longer|replaces?|supersedes?)\b[^.]*\./i.exec(line)?.[0] ?? line;
          updates.push(clause);
          size += clause.length + 1;
        }
        return updates.length > 0 && all.length > 1 ? `${piece}\n\n${updates.join('\n')}` : piece;
      });
  });
  const rounds = Math.max(1, ...pieces.map((list) => list.length));
  return Array.from({ length: rounds }, (_, round) =>
    sources.flatMap((source, index) => {
      const list = pieces[index] as string[];
      if (list.length === 1)
        return round === 0 || source.kind !== 'prompt' ? [{ ...source, text: list[0] as string }] : [];
      const piece = list[round];
      return piece === undefined ? [] : [{ ...source, text: piece }];
    }),
  );
}
