import { sha } from './cut';
import { canonical, type Labelled } from './labels';

/**
 * The cassette holds every recorded labeler answer. The models cannot be pinned to temperature zero, so
 * determinism lives here: the key is the hash of the whole request, so a changed prompt, set, model, window
 * or labeler misses, and the miss names the field that differs from the nearest entry; with no entry of the same
 * file, window, set and labeler, it names the labeler id of the request.
 */

/** The request as it goes on the wire. `body` is what the provider receives. */
export type Wire = { labeler: string; body: Record<string, unknown> };

/** What a labeler answered, as recorded. A yes or no model records its probabilities, so a threshold can change without a new call. */
export type Recorded = {
  labels?: Labelled[];
  probabilities?: Record<string, number>;
  returnedModel: string;
  stopReason: string;
  /**
   * `too_large`: the endpoint refused the request, and the scan halves the window and asks for each half.
   * `unreadable`: the answer could not be read twice; the failure is recorded so a replay lists the same window.
   */
  refused?: 'too_large' | 'unreadable';
  /** With `refused: 'unreadable'`: why the answer could not be read, so a replay lists the same failed window. */
  error?: string;
  /**
   * With `refused: 'unreadable'` and an answer that was read but refused: the entries of each refused answer (units,
   * label, target), one list per try. Spans and links are left out, so no text a model copied is kept. A replay
   * ignores it; it is there so the cause of a refusal can be read.
   */
  refusedAnswers?: Array<Array<{ units: string; label: string; target?: number }>>;
  /** Labels put on shown lines alone, dropped from the answer after the retry: the line and the label it was given. */
  shownDropped?: Array<{ line: number; label: string }>;
  usage: { input: number; output: number };
};

export type Readable = Record<string, string>;

export type CassetteEntry = { key: string; readable: Readable; answer: Recorded };

/**
 * The key of a request: the wire and everything that identifies the answer besides it (the labeler and its class,
 * the model, the set hash, the prompt and schema versions, the cut, the run). A model the body does not hold, a
 * label's polarity, a second run of the same request all change the key, so a hit is the full match.
 */
export const requestKey = (wire: Wire, readable: Readable): string => sha(canonical({ wire, readable }));

/** Fields kept beside the key, so a miss can say what differs. `part.*` is a hash per top-level key of the request. */
export function readableOf(
  wire: Wire,
  meta: {
    path: string;
    window: string;
    promptVersion: string;
    schemaVersion: string;
    set: string;
    setHash: string;
    model: string;
    cutDigest: string;
    cls: string;
    /** Which of the runs of the same request this is: `1` for a labeler that answers once. */
    run: string;
  },
): Readable {
  const parts = Object.fromEntries(
    Object.entries(wire.body).map(([name, value]) => [`part.${name}`, sha(canonical(value)).slice(0, 12)]),
  );
  return { ...meta, labeler: wire.labeler, ...parts };
}

/** The labeler a miss names: `of the labeler <id> `, or nothing when the miss was raised without one. */
const ofLabeler = (labeler: string | undefined): string =>
  labeler === undefined ? '' : `of the labeler ${labeler} `;

export class CassetteMiss extends Error {
  constructor(
    readonly key: string,
    readonly differs: string[],
    readonly nearest: string | undefined,
    /** The labeler id of the request that missed, as its label set or settings name it. */
    readonly labeler?: string,
    /** With no entry of the same set and labeler, the closest entry of the same file and window, and what differs. */
    readonly closest?: { key: string; differs: string[] },
  ) {
    super(
      nearest
        ? `the cassette has no answer for request ${key.slice(0, 12)}; the nearest entry ${nearest.slice(0, 12)} differs in: ${differs.join(', ')}${
            differs.includes('cutDigest')
              ? `; the cut of the files changed, which a different Node or ICU build can cause (this run: Node ${process.versions.node}, ICU ${process.versions.icu})`
              : ''
          }`
        : `the cassette has no answer for request ${key.slice(0, 12)}, and no entry ${ofLabeler(labeler)}for the same file, window and set`,
    );
    this.name = 'CassetteMiss';
  }
}

export class Cassette {
  readonly entries = new Map<string, CassetteEntry>();
  /** Called with each entry as it is recorded, so a long run can append it to a file and lose nothing if it stops. */
  onPut?: (entry: CassetteEntry) => void;

  static parse(text: string): Cassette {
    const cassette = new Cassette();
    for (const [index, line] of text.split('\n').entries()) {
      if (line.trim() === '') continue;
      let entry: CassetteEntry;
      try {
        entry = JSON.parse(line) as CassetteEntry;
      } catch {
        throw new Error(`the cassette is not JSON lines: line ${index + 1} cannot be read`);
      }
      if (typeof entry.key !== 'string' || !entry.readable || !entry.answer) {
        throw new Error(`the cassette line ${index + 1} is not an entry`);
      }
      cassette.entries.set(entry.key, entry);
    }
    return cassette;
  }

  /** Sorted by key, canonical JSON: the same content is the same bytes. */
  render(): string {
    const lines = [...this.entries.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((entry) => canonical(entry));
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  }

  /** The recorded answer for a request, or the miss with the fields that differ from the nearest entry. */
  get(wire: Wire, readable: Readable): CassetteEntry {
    const key = requestKey(wire, readable);
    const hit = this.entries.get(key);
    const differs = (entry: CassetteEntry): string[] =>
      [...new Set([...Object.keys(readable), ...Object.keys(entry.readable)])]
        .filter((field) => readable[field] !== entry.readable[field])
        .sort();
    // The readable fields beside a key must agree with the request even when the key matches: an entry whose
    // fields were edited, or written for another request, is refused and the fields are named.
    if (hit) {
      const stale = differs(hit);
      if (stale.length === 0) return hit;
      throw new CassetteMiss(key, stale, hit.key, readable.labeler);
    }
    // The nearest entry is one of the same file, window, set and labeler. With none, the closest entry of the same
    // file and window is kept apart: it names the other set or the other labeler, and `nearest` stays empty.
    const sameWindow = [...this.entries.values()].filter(
      (entry) => entry.readable.path === readable.path && entry.readable.window === readable.window,
    );
    const rank = (list: CassetteEntry[]) => list.sort((a, b) => differs(a).length - differs(b).length)[0];
    const nearest = rank(
      sameWindow.filter(
        (entry) => entry.readable.set === readable.set && entry.readable.labeler === readable.labeler,
      ),
    );
    const closest = nearest === undefined ? rank(sameWindow) : undefined;
    throw new CassetteMiss(
      key,
      nearest ? differs(nearest) : [],
      nearest?.key,
      readable.labeler,
      closest ? { key: closest.key, differs: differs(closest) } : undefined,
    );
  }

  put(wire: Wire, readable: Readable, answer: Recorded): CassetteEntry {
    const key = requestKey(wire, readable);
    const entry = { key, readable, answer };
    this.entries.set(key, entry);
    this.onPut?.(entry);
    return entry;
  }
}
