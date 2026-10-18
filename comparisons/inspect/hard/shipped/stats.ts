export type Scored = { id: string; label: string; outcome: string };

const choose = (n: number, k: number) => {
  let value = 1;
  for (let i = 1; i <= k; i++) value = (value * (n - k + i)) / i;
  return value;
};
/** Exact two-sided McNemar test on the discordant pairs. */
export function mcnemar(a: Scored[], b: Scored[]) {
  const other = new Map(b.map((r) => [r.id, r]));
  let first = 0;
  let second = 0;
  for (const r of a) {
    const o = other.get(r.id);
    if (!o) throw new Error(`Unpaired case ${r.id}`);
    const x = r.outcome === r.label;
    const y = o.outcome === o.label;
    if (x && !y) first++;
    if (!x && y) second++;
  }
  const n = first + second;
  let tail = 0;
  for (let i = 0; i <= Math.min(first, second); i++) tail += choose(n, i) * 0.5 ** n;
  return { first, second, p: n === 0 ? 1 : Math.min(1, 2 * tail) };
}
