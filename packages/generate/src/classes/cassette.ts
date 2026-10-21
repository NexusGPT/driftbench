import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ModelError, type ModelPort, type ModelRequest } from '../model/port';

/**
 * Recorded model answers. Each answer is keyed by the SHA-256 of the family, the model and the request, so a
 * replay returns the answer the same request got when it was recorded and refuses one it never saw. In record
 * mode a missing answer is asked of the live port and kept. One cassette serves every seat of a class (the
 * realiser, the judge, the labellers). The file holds requests and answers, never a key.
 */

export type CassetteEntry = {
  key: string;
  family: string;
  model: string;
  system: string;
  user: string;
  answer: string;
};

export function requestKey(family: string, model: string, request: ModelRequest): string {
  return createHash('sha256')
    .update(JSON.stringify([family, model, request.system, request.user]))
    .digest('hex');
}

export class Cassette {
  /** Calls answered by a live port since the cassette was opened. */
  live = 0;
  private readonly entries: Map<string, CassetteEntry>;

  constructor(entries: readonly CassetteEntry[] = []) {
    this.entries = new Map(entries.map((entry) => [entry.key, entry]));
  }

  /**
   * A port that answers from the cassette. With `inner` (record mode) a request the cassette lacks goes to the
   * live port and is kept; without it, such a request throws a ModelError with the code `exhausted`.
   */
  port(options: { family: string; model: string; inner?: ModelPort }): ModelPort {
    const { family, model, inner } = options;
    return {
      family,
      model,
      complete: async (request: ModelRequest) => {
        const key = requestKey(family, model, request);
        const known = this.entries.get(key);
        if (known) return known.answer;
        if (!inner) {
          throw new ModelError(
            'exhausted',
            `the cassette has no answer for this ${family} ${model} request (key ${key.slice(0, 12)}): record it with --record`,
          );
        }
        const answer = await inner.complete(request);
        this.live += 1;
        this.entries.set(key, { key, family, model, system: request.system, user: request.user, answer });
        return answer;
      },
    };
  }

  /** Every entry, sorted by key so a re-recorded file diffs cleanly. */
  list(): CassetteEntry[] {
    return [...this.entries.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  }
}

/** Reads a cassette file (JSON lines, gzipped when the name ends in .gz); a missing file is an empty cassette. */
export async function readCassette(path: string): Promise<Cassette> {
  let text: string;
  try {
    const bytes = await readFile(path);
    text = (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return new Cassette();
    throw cause;
  }
  return new Cassette(
    text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as CassetteEntry),
  );
}

/** Writes a cassette as JSON lines sorted by key, gzipped (with no timestamp) when the name ends in .gz. */
export async function writeCassette(path: string, cassette: Cassette): Promise<void> {
  const entries = cassette.list();
  const text = entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length > 0 ? '\n' : '');
  await writeFile(path, path.endsWith('.gz') ? gzipSync(text, { level: 9 }) : text);
}
