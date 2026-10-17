import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { C6, evaluate, pct, U, type Dec } from './src/dec2';
import { dir } from './src/arms';
for (const r of [1, 2, 3]) {
  const h = JSON.parse(readFileSync(join(dir, 'results2', `haiku-r${r}.json`), 'utf8')) as { labels: Record<number, string> };
  const decs: Dec[] = U.map((u) => ({ pred: (h.labels[u.g] ?? 'none') as C6, conf: 1, vec: {} as never }));
  for (const [s, f] of [['all', () => true], ['dev', (u: (typeof U)[0]) => u.split === 'dev'], ['test', (u: (typeof U)[0]) => u.split === 'test'], ['uncontested', (u: (typeof U)[0]) => !u.contested]] as const) {
    const ix = U.map((u, i) => i).filter((i) => f(U[i]!));
    const e = evaluate(ix.map((i) => U[i]!), ix.map((i) => decs[i]!));
    console.log(`haiku r${r} ${s}: n ${e.n} acc ${pct(e.acc)} F1 ${pct(e.macroF1)}`);
    if (s === 'all' && r === 1) { console.log(C6.join('\t')); C6.forEach((c, i) => console.log(c.padEnd(11), e.conf[i]!.join('\t'))); }
  }
}
