import { sentences } from './src/cut';

type S = { t: string; cat: string };
const pool: S[] = [
  ...[
    'Return every key before you leave.', 'Count the till twice.', 'Never leave the desk unattended.', 'The loan desk opens at nine.',
    'Water the plants on Monday.', 'Lock the archive at closing.', 'Ask which depot when the city is unclear.', 'Send the first notice by email.',
    'Readers may borrow six books at once.', 'Fines are waived for children.', 'Check the book drop twice a day.', 'Stamp the due date inside the cover.',
    'Quiet hours run from two to four.', 'Release a hold on the eighth day.', 'The reserve shelf is behind the desk.', 'Log every overdue notice you send.',
    'Do not lend reference works.', 'Ask a manager before you refund over fifty euros.', 'Photograph damaged parcels at the dock.', 'Restock the bookmarks on Fridays.',
  ].map((t) => ({ t, cat: 'plain' })),
  ...[
    'Dr. Smith signs the loan form.', 'Mr. Jones keeps the archive key.', 'Ask Ms. Lee about the rota.', 'St. Anne Library closes early on Fridays.',
    'Use a red pen, e.g. for corrections.', 'Check the log, i.e. the paper one.', 'The U.S. edition has a different index.', 'Prof. Ito reviews the maps.',
    'Pack boxes, books, etc. before closing.', 'Compare the old rota vs. the new one.',
  ].map((t) => ({ t, cat: 'abbrev' })),
  ...[
    'Version 2.1 replaces version 2.0 on Monday.', 'Cut the cord to 3.5 metres.', 'The code is 4.2.1 in the log.', 'Pay 12.50 euros at the desk.',
  ].map((t) => ({ t, cat: 'number' })),
  ...[
    'iOS readers need the second login.', 'eBay donations go to the sorting table.', 'npm install runs before the first audit.', 'macOS laptops are for staff only.',
  ].map((t) => ({ t, cat: 'lowercase-start' })),
  ...[
    'Run `shelf.audit()` before you leave.', 'Open https://example.org/rota.html and print it.', 'Read [the guide](docs/closing.md) first.', 'Call `loan.close()` after the last reader.',
  ].map((t) => ({ t, cat: 'code-url' })),
  ...[
    'Say "Welcome back."|Then ask for the card.', 'Reply "Stop." when the reader asks twice.', 'The sign reads "Quiet please."|It stays up all day.',
  ].map((t) => ({ t, cat: 'quote' })),
  ...[
    'Wait... then ask again.', 'Is the desk open?|Check the rota.', 'Never lock up alone!', 'See the note (it is below.) before you close.',
  ].map((t) => ({ t, cat: 'punct' })),
];
// Quote items hold an inner sentence boundary by construction; their gold is one boundary at the end of the whole item.
let seed = 20261017;
const rnd = (n: number) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed % n);

type Case = { text: string; gold: Set<number>; cats: string[]; pieces?: number[] };
const cases: Case[] = [];
for (let i = 0; i < 200; i++) {
  const count = 2 + rnd(4);
  const parts = Array.from({ length: count }, () => pool[rnd(pool.length)] as S);
  let text = '';
  const gold = new Set<number>();
  for (const [index, part] of parts.entries()) {
    if (index > 0) text += ' ';
    const pieces = part.t.split('|');
    for (const [k, piece] of pieces.entries()) {
      if (k > 0) text += ' ';
      text += piece;
      gold.add(text.length);
    }
  }
  // Half of the paragraphs are hard wrapped at a space near 50 characters.
  if (i % 2 === 0) {
    const chars = text.split('');
    let col = 0;
    for (let k = 0; k < chars.length; k++) {
      col++;
      if (col > 50 && chars[k] === ' ') {
        chars[k] = '\n';
        col = 0;
      }
    }
    text = chars.join('');
  }
  cases.push({ text, gold, cats: parts.map((p) => p.cat), pieces: parts.map((p) => p.t.split('|').length) });
}

const rawSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const rawEnds = (text: string) => {
  const ends = new Set<number>();
  for (const s of rawSegmenter.segment(text)) {
    const e = s.index + s.segment.trimEnd().length;
    if (text.slice(s.index, s.index + s.segment.length).trim()) ends.add(e);
  }
  return ends;
};
const maskedEnds = (text: string) => new Set(sentences(text, 0, text.length).map(([, e]) => e));

function score(ends: (t: string) => Set<number>) {
  let tp = 0, fp = 0, fn = 0;
  const byCat: Record<string, { fn: number; n: number }> = {};
  const wrongSplitsByCat: Record<string, number> = {};
  for (const c of cases) {
    const pred = ends(c.text);
    const gold = new Set([...c.gold].map((g) => g));
    // Gold positions are from the unwrapped text; wrapping replaces a space by a newline, so the lengths agree.
    let idx = 0;
    const goldList = [...gold];
    const catOf: string[] = [];
    c.cats.forEach((cat, i) => { for (let k = 0; k < (c.pieces?.[i] ?? 1); k++) catOf.push(cat); });
    for (const g of goldList) {
      const cat = catOf[idx++] ?? 'plain';
      byCat[cat] ??= { fn: 0, n: 0 };
      byCat[cat].n++;
      if (pred.has(g)) tp++;
      else { fn++; byCat[cat].fn++; }
    }
    for (const p of pred) if (!gold.has(p)) { fp++; if (process.env.SHOW) console.log('WRONG SPLIT', p, JSON.stringify(c.text), [...c.gold].join(','), [...pred].join(',')); }
  }
  void wrongSplitsByCat;
  const total = tp + fn;
  const predicted = tp + fp;
  return { goldBoundaries: total, predicted, recall: +(tp / total).toFixed(3), precision: +(tp / predicted).toFixed(3), wrongSplits: fp, wrongSplitRate: +(fp / predicted).toFixed(3), missedByCat: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, `${v.fn}/${v.n} missed`])) };
}
console.log('raw Intl.Segmenter   ', JSON.stringify(score(rawEnds)));
console.log('masked + shape merge ', JSON.stringify(score(maskedEnds)));
