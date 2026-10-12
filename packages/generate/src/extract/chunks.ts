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
      flush(cut);
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) chunks.push(current.join('\n'));
  return chunks;
}

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
  const pieces = sources.map((source) =>
    source.kind === 'prompt' ? chunkText(source.text, max, threshold) : [source.text],
  );
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
