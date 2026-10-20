import { createHash } from 'node:crypto';
import type { PointerAdapter } from './bank/types.js';

/**
 * An honest ledger, for the bank's own tests: identity follows the whole unit. An unchanged unit keeps its
 * identity by exact text (same file first); a changed unit follows the most similar unmatched earlier unit when
 * the similarity reaches the floor; anything else is new. It reads no position, no key word and no expectation.
 * It answers only the `ledger` operation, so it proves the ledger items are satisfiable, nothing else.
 */
const FLOOR = 0.6;

const similarity = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] as number;
      row[j] = Math.min(above + 1, (row[j - 1] as number) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - (row[b.length] as number) / Math.max(a.length, b.length, 1);
};

const mint = (text: string): string =>
  Array.from(
    createHash('sha256').update(text).digest().subarray(0, 10),
    (x) => 'abcdefghijklmnopqrstuvwxyz234567'[x & 31],
  ).join('');

type Entry = { id: string; path: string; quote: string; status: 'live' | 'deleted' };
type Scan = { estateKey: string; files: { path: string; units: { text: string }[] }[] };

export const honestLedger: PointerAdapter = {
  execute({ operation, input }) {
    if (operation !== 'ledger') return null;
    const x = input as unknown as { independent?: boolean; scans: Scan[] };
    let previous: Entry[] = [];
    return x.scans.map((scan) => {
      const used = new Set<Entry>();
      const occurrences = new Map<string, number>();
      const live: (Entry | undefined)[] = [];
      const want: { path: string; text: string; slot: number }[] = [];
      for (const file of scan.files)
        for (const unit of file.units) {
          const slot = live.length;
          const pool = x.independent ? [] : previous.filter((e) => e.status === 'live' && !used.has(e));
          const exact =
            pool.find((e) => e.quote === unit.text && e.path === file.path) ??
            pool.find((e) => e.quote === unit.text);
          if (exact) {
            used.add(exact);
            live.push({ id: exact.id, path: file.path, quote: unit.text, status: 'live' });
          } else {
            live.push(undefined);
            want.push({ path: file.path, text: unit.text, slot });
          }
        }
      // Changed units take the most similar unmatched earlier unit above the floor, best pairs first.
      const pairs: { score: number; slot: number; old: Entry }[] = [];
      for (const w of want)
        for (const old of previous)
          if (!x.independent && old.status === 'live' && !used.has(old)) {
            const score = similarity(old.quote, w.text);
            if (score >= FLOOR) pairs.push({ score, slot: w.slot, old });
          }
      pairs.sort((a, b) => b.score - a.score);
      for (const pair of pairs) {
        if (live[pair.slot] || used.has(pair.old)) continue;
        const w = want.find((c) => c.slot === pair.slot) as { path: string; text: string };
        used.add(pair.old);
        live[pair.slot] = { id: pair.old.id, path: w.path, quote: w.text, status: 'live' };
      }
      for (const w of want)
        if (!live[w.slot]) {
          const key = JSON.stringify([scan.estateKey, w.path, w.text]);
          const at = occurrences.get(key) ?? 0;
          occurrences.set(key, at + 1);
          live[w.slot] = {
            id: mint(JSON.stringify([key, at])),
            path: w.path,
            quote: w.text,
            status: 'live',
          };
        }
      const out = [...(live as Entry[])];
      if (!x.independent) {
        for (const old of previous) {
          if (old.status === 'deleted') out.push(old);
          else if (!used.has(old)) out.push({ ...old, status: 'deleted' });
        }
      }
      previous = structuredClone(out);
      return { entries: out };
    });
  },
};
