import { createHash } from 'node:crypto';
import type { Unit } from './cut';

export type Entry = {
  id: string;
  path: string;
  fp: string;
  text: string;
  prefix: string;
  suffix: string;
  section: string;
  idx: number;
};
export type Ctx = { path: string; units: Unit[] };
export type Event = 'unchanged' | 'moved' | 'ambiguous' | 'changed' | 'split' | 'merged' | 'deleted' | 'added';
export type Result = { id: string; event: Event; score?: number; from?: string };

export function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n] ?? 0;
}
const simText = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(Boolean));
const jacc = (a: string, b: string) => {
  const x = words(a), y = words(b);
  let i = 0;
  for (const w of x) if (y.has(w)) i++;
  return x.size + y.size - i === 0 ? 1 : i / (x.size + y.size - i);
};
export const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export function mint(estateKey: string, path: string, fp: string, occurrence: number): string {
  const h = createHash('sha256').update(`${estateKey}\0${path}\0${fp}\0${occurrence}`).digest();
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = '';
  for (const byte of h.subarray(0, 7)) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return out;
}

export function entriesOf(files: Ctx[], estateKey = 'k'): Entry[] {
  const out: Entry[] = [];
  for (const f of files) {
    const seen = new Map<string, number>();
    f.units.forEach((u, idx) => {
      const occ = seen.get(u.fp) ?? 0;
      seen.set(u.fp, occ + 1);
      out.push({
        id: mint(estateKey, f.path, u.fp, occ), path: f.path, fp: u.fp, text: norm(u.text),
        prefix: norm(f.units[idx - 1]?.text ?? '').slice(-32), suffix: norm(f.units[idx + 1]?.text ?? '').slice(0, 32),
        section: u.path.join('>'), idx,
      });
    });
  }
  return out;
}

/** Longest common subsequence of two fingerprint sequences (the unchanged anchors). */
function anchors(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? (dp[i + 1]![j + 1] ?? 0) + 1 : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
  const out: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) i++;
    else j++;
  }
  return out;
}

export type Options = { threshold: number; floor: number; ladder: 'full' | 'diff-only'; textFloor?: number };

/** Maps old entries to new entries. Returns, per OLD id, its event and the matched new entry (if any). */
export function reanchor(old: Entry[], next: Entry[], opts: Options): Map<string, { event: Event; to?: Entry[]; score?: number }> {
  const res = new Map<string, { event: Event; to?: Entry[]; score?: number }>();
  const usedNew = new Set<Entry>();
  const pathsOf = (list: Entry[]) => [...new Set(list.map((e) => e.path))];
  // 1. unchanged: LCS per path
  for (const p of pathsOf(old)) {
    const o = old.filter((e) => e.path === p), n = next.filter((e) => e.path === p);
    for (const [i, j] of anchors(o.map((e) => e.fp), n.map((e) => e.fp))) {
      res.set(o[i]!.id, { event: 'unchanged', to: [n[j]!] });
      usedNew.add(n[j]!);
    }
  }
  const unmatchedOld = () => old.filter((e) => !res.has(e.id));
  const unmatchedNew = () => next.filter((e) => !usedNew.has(e));
  // 2. exact elsewhere (moved / ambiguous)
  for (const o of unmatchedOld()) {
    if (o.text.length < opts.floor) continue;
    const hits = unmatchedNew().filter((n) => n.fp === o.fp);
    if (hits.length === 1) { res.set(o.id, { event: 'moved', to: hits }); usedNew.add(hits[0]!); }
    else if (hits.length > 1) { res.set(o.id, { event: 'ambiguous', to: hits }); for (const h of hits) usedNew.add(h); }
  }
  if (opts.ladder === 'diff-only') {
    for (const o of unmatchedOld()) res.set(o.id, { event: 'deleted' });
    return res;
  }
  // 3. pairwise score of the residue
  const score = (o: Entry, n: Entry) => 0.6 * simText(o.text, n.text) + 0.4 * (0.35 * simText(o.prefix, n.prefix) + 0.35 * simText(o.suffix, n.suffix) + 0.3 * jacc(o.section, n.section));
  const pairs: Array<{ o: Entry; n: Entry; s: number }> = [];
  for (const o of unmatchedOld()) for (const n of unmatchedNew()) {
    if (Math.abs(o.text.length - n.text.length) > Math.max(o.text.length, n.text.length) * 0.8) continue;
    pairs.push({ o, n, s: score(o, n) });
  }
  pairs.sort((a, b) => b.s - a.s);
  const splitMerge = (o: Entry): { event: Event; to: Entry[]; score: number } | undefined => {
    const cands = unmatchedNew().filter((n) => n.path === o.path).sort((a, b) => a.idx - b.idx);
    for (let i = 0; i + 1 < cands.length; i++) {
      const a = cands[i]!, b = cands[i + 1]!;
      if (b.idx !== a.idx + 1) continue;
      const joined = `${a.text} ${b.text}`;
      const sj = simText(o.text, joined);
      const best = Math.max(simText(o.text, a.text), simText(o.text, b.text));
      if (sj > best + 0.1 && sj >= opts.threshold + 0.25) return { event: 'split', to: [a, b], score: sj };
    }
    return undefined;
  };
  for (const o of unmatchedOld()) {
    const sm = splitMerge(o);
    const top = pairs.find((p) => p.o === o && !usedNew.has(p.n));
    if (sm && (!top || sm.score > top.s + 0.05)) {
      res.set(o.id, sm);
      for (const t of sm.to) usedNew.add(t);
    }
  }
  // merged: two adjacent old units whose concatenation matches one new unit
  const oldLeft = unmatchedOld().sort((a, b) => a.path.localeCompare(b.path) || a.idx - b.idx);
  for (let i = 0; i + 1 < oldLeft.length; i++) {
    const a = oldLeft[i]!, b = oldLeft[i + 1]!;
    if (a.path !== b.path || b.idx !== a.idx + 1 || res.has(a.id) || res.has(b.id)) continue;
    const joined = `${a.text} ${b.text}`;
    const cand = unmatchedNew().filter((n) => n.path === a.path).map((n) => ({ n, s: simText(joined, n.text) })).sort((x, y) => y.s - x.s)[0];
    if (cand && cand.s >= opts.threshold + 0.25 && cand.s > Math.max(simText(a.text, cand.n.text), simText(b.text, cand.n.text)) + 0.1) {
      res.set(a.id, { event: 'merged', to: [cand.n], score: cand.s });
      res.set(b.id, { event: 'merged', to: [cand.n], score: cand.s });
      usedNew.add(cand.n);
    }
  }
  for (const p of pairs) {
    if (res.has(p.o.id) || usedNew.has(p.n)) continue;
    if (p.s >= opts.threshold && simText(p.o.text, p.n.text) >= (opts.textFloor ?? 0)) { res.set(p.o.id, { event: 'changed', to: [p.n], score: p.s }); usedNew.add(p.n); }
  }
  for (const o of unmatchedOld()) res.set(o.id, { event: 'deleted' });
  return res;
}
