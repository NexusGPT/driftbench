// Shared summary for the comparison rows: correct counts per side with Wilson 95% intervals, the sign test over the
// cases where exactly one side is right, and the verdict. Side a is promptfoo, side b is ours.
import { wilson } from '../../packages/stats/src/index';

export type Row = { truth: boolean; a: boolean; b: boolean };

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

export function summarise(name: string, rows: Row[], labels: [string, string] = ['theirs', 'ours']) {
  const n = rows.length;
  const correct = (pick: 'a' | 'b') => rows.filter((row) => row[pick] === row.truth).length;
  const side = (k: number) => ({ correct: k, n, interval: wilson(k, n) });
  const onlyTheirs = rows.filter((row) => row.a === row.truth && row.b !== row.truth).length;
  const onlyOurs = rows.filter((row) => row.b === row.truth && row.a !== row.truth).length;
  const m = onlyTheirs + onlyOurs;
  let p = 1;
  if (m > 0) {
    const k = Math.min(onlyTheirs, onlyOurs);
    let tail = 0;
    for (let i = 0; i <= k; i++) tail += binom(m, i);
    p = Math.min(1, (2 * tail) / 2 ** m);
  }
  const verdict = p < 0.05 ? (onlyOurs > onlyTheirs ? 'ahead' : 'behind') : 'equal';
  return {
    row: name,
    n,
    [labels[0]]: side(correct('a')),
    [labels[1]]: side(correct('b')),
    onlyOurs,
    onlyTheirs,
    signTestP: Number(p.toFixed(4)),
    verdict,
  };
}
