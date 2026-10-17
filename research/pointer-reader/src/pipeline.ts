import { Cassette, MissError } from './cassette';
import { cut, type Unit } from './cut';
import { buildRequest, canonical, type LabelSet, type Request, setHash, type Window } from './labelset';
import { entriesOf } from './ledger';

export type Labeler = {
  id: string;
  model: string;
  calls: number;
  label(request: Request): { labels: Array<{ units: string; label: string; target?: number }> };
};
export type Mode = 'record-missing' | 'ci';

/** Heading-bounded windows (a window ends where the next top-level heading starts), also capped by unit count. */
export function windowsOf(path: string, units: Unit[], size = 40): Window[] {
  const windows: Window[] = [];
  let cur: Unit[] = [];
  const flush = () => {
    if (cur.length) {
      windows.push({
        id: `${path}#${windows.length + 1}`,
        path,
        headingPath: cur[0]?.path ?? [],
        units: cur.map((u, i) => ({ n: i + 1, text: u.text })),
      });
      cur = [];
    }
  };
  for (const u of units) {
    if (u.container === 'heading' && cur.length && u.path.length === 0) flush();
    cur.push(u);
    if (cur.length >= size) flush();
  }
  flush();
  return windows;
}

export function expand(units: string): number[] {
  const m = /^(\d+)(?:-(\d+))?$/.exec(units);
  if (!m) throw new Error(`bad units ${units}`);
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export type Scan = { ledger: string; calls: number; labelled: number; unlabeled: number; refused: string[] };

/** Cut, window, label each (file, set) window through the cassette, and write the canonical ledger. */
export function scan(
  files: Map<string, string>,
  sets: LabelSet[],
  cassette: Cassette,
  labeler: Labeler | undefined,
  mode: Mode,
  estateKey = 'k',
  replayModel = 'fake-labeler-1',
): Scan {
  const cuts = [...files]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, text]) => ({ path, ...cut(text) }));
  const entries = entriesOf(
    cuts.map((c) => ({ path: c.path, units: c.units })),
    estateKey,
  );
  const byPathIdx = new Map(entries.map((e) => [`${e.path}\0${e.idx}`, e]));
  const labels = new Map<string, Record<string, { label: string; setHash: string }>>();
  const refused: string[] = [];
  let unlabeled = 0;
  let labelled = 0;
  const before = labeler?.calls ?? 0;
  for (const c of cuts) {
    let offset = 0;
    for (const w of windowsOf(c.path, c.units)) {
      for (const set of sets) {
        const req = buildRequest(set, w, labeler?.model ?? replayModel);
        let entry: ReturnType<Cassette['get']>;
        try {
          entry = cassette.get(req, c.digest);
        } catch (e) {
          if (!(e instanceof MissError) || mode === 'ci' || !labeler) throw e;
          cassette.put(req, c.digest, labeler.label(req));
          entry = cassette.get(req, c.digest);
        }
        const seen = new Set<number>();
        const allowed = new Set(req.output.enum);
        for (const l of entry.answer.labels) {
          if (!allowed.has(l.label)) {
            refused.push(`${w.id}: label ${l.label} not in set ${set.set}`);
            continue;
          }
          for (const n of expand(l.units)) {
            if (n < 1 || n > w.units.length || seen.has(n)) {
              refused.push(`${w.id}: unit ${n} out of window or repeated`);
              continue;
            }
            seen.add(n);
            const e = byPathIdx.get(`${c.path}\0${offset + n - 1}`);
            if (!e) continue;
            const rec = labels.get(e.id) ?? {};
            if (l.label !== 'none') {
              rec[set.set] = { label: l.label, setHash: setHash(set) };
              labelled++;
            }
            labels.set(e.id, rec);
          }
        }
        for (let n = 1; n <= w.units.length; n++) if (!seen.has(n)) unlabeled++;
      }
      offset += w.units.length;
    }
  }
  const out = entries.map((e) => ({
    id: e.id,
    path: e.path,
    section: e.section,
    fp: e.fp,
    labels: labels.get(e.id) ?? {},
  }));
  const ledger =
    `${canonical({ version: 1, cutDigests: Object.fromEntries(cuts.map((c) => [c.path, c.digest.slice(0, 16)])), units: out })}\n`;
  return { ledger, calls: (labeler?.calls ?? 0) - before, labelled, unlabeled, refused };
}
