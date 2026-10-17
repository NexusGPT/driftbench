import { sha } from './cut';
import { canonical, type Request } from './labelset';

export type Entry = {
  key: string;
  readable: {
    path: string;
    window: string;
    promptVersion: string;
    schemaVersion: string;
    set: string;
    setHash: string;
    model: string;
    cutDigest: string;
    'part.model': string;
    'part.system': string;
    'part.user': string;
    'part.output': string;
    'part.maxTokens': string;
    'part.thinking': string;
  };
  answer: { labels: Array<{ units: string; label: string; target?: number }> };
  returnedModel: string;
  stopReason: string;
  usage: { input: number; output: number };
};

export const requestKey = (r: Request): string =>
  sha(
    canonical({
      model: r.model,
      system: r.system,
      user: r.user,
      output: r.output,
      maxTokens: r.maxTokens,
      thinking: r.thinking,
    }),
  );
export const readableOf = (r: Request, cutDigest: string): Entry['readable'] => ({
  path: r.meta.path,
  window: r.meta.window,
  promptVersion: r.meta.promptVersion,
  schemaVersion: r.meta.schemaVersion,
  set: r.meta.set,
  setHash: r.meta.setHash,
  model: r.model,
  cutDigest,
  'part.model': sha(canonical(r.model)).slice(0, 12),
  'part.system': sha(canonical(r.system)).slice(0, 12),
  'part.user': sha(canonical(r.user)).slice(0, 12),
  'part.output': sha(canonical(r.output)).slice(0, 12),
  'part.maxTokens': sha(canonical(r.maxTokens)).slice(0, 12),
  'part.thinking': sha(canonical(r.thinking)).slice(0, 12),
});

export class MissError extends Error {
  constructor(
    readonly key: string,
    readonly differs: string[],
    nearest?: string,
  ) {
    super(
      `cassette miss for ${key.slice(0, 12)}${nearest ? ` (nearest ${nearest.slice(0, 12)}; differs in: ${differs.join(', ')})` : ' (no entry for this path, window and set)'}`,
    );
  }
}

export class Cassette {
  entries = new Map<string, Entry>();
  load(jsonl: string) {
    for (const line of jsonl.split('\n').filter(Boolean)) {
      const e = JSON.parse(line) as Entry;
      this.entries.set(e.key, e);
    }
    return this;
  }
  /** Canonical, sorted by key: byte-identical for the same content. */
  dump(): string {
    return (
      [...this.entries.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((e) => canonical(e))
        .join('\n') + '\n'
    );
  }
  get(r: Request, cutDigest: string): Entry {
    const key = requestKey(r);
    const hit = this.entries.get(key);
    if (hit) {
      // The key covers the request; the cut digest guards the cutter: same request text, different cut.
      if (hit.readable.cutDigest !== cutDigest) throw new MissError(key, ['cutDigest'], key);
      return hit;
    }
    const want = readableOf(r, cutDigest);
    const near = [...this.entries.values()].filter(
      (e) => e.readable.path === want.path && e.readable.window === want.window && e.readable.set === want.set,
    );
    if (!near.length) throw new MissError(key, []);
    const diffs = (e: Entry) =>
      (Object.keys(want) as Array<keyof Entry['readable']>).filter((k) => e.readable[k] !== want[k]);
    const best = near.sort((a, b) => diffs(a).length - diffs(b).length)[0]!;
    const d = diffs(best);
    throw new MissError(key, d, best.key);
  }
  put(r: Request, cutDigest: string, answer: Entry['answer']) {
    const key = requestKey(r);
    this.entries.set(key, {
      key,
      readable: readableOf(r, cutDigest),
      answer,
      returnedModel: r.model,
      stopReason: 'end_turn',
      usage: { input: Math.ceil(r.user.length / 4), output: 40 },
    });
  }
}
