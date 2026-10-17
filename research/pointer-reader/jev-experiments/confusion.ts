import { loadRuns, predictions, goldLabels, score, CLASSES, pct } from './report';
const id = process.argv[2]!;
const run = loadRuns().find((r) => r.runId === id)!;
const decode = (process.argv[3] ?? 'argmax') as 'argmax' | 'priority';
for (const t of [0.3, 0.4, 0.5, 0.6, 0.7]) {
  const s = score(predictions(run, t, undefined, decode), goldLabels);
  console.log(t, pct(s.acc), pct(s.macroF1), CLASSES.map((c) => `${c}:${pct(s.per[c]!.f1)}`).join(' '));
}
const pred = predictions(run, 0.5, undefined, decode);
const m: Record<string, Record<string, number>> = {};
goldLabels.forEach((g, i) => { (m[g] ??= {})[pred[i]!] = ((m[g] ??= {})[pred[i]!] ?? 0) + 1; });
console.log('gold\\pred', CLASSES.join('\t'));
for (const g of CLASSES) console.log(g, CLASSES.map((p) => m[g]?.[p] ?? 0).join('\t'));
