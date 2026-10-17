import { loadRuns, predictions, goldLabels, score, mean, pct } from './report';
const groups = new Map<string, ReturnType<typeof loadRuns>>();
for (const r of loadRuns()) { if (r.arm === 'arm5' || r.arm === 'cap') continue; const k = r.runId.replace(/-r\d+$/, ''); groups.set(k, [...(groups.get(k) ?? []), r]); }
for (const [k, rs] of groups) {
  const s = rs.map((r) => score(predictions(r, 0.5), goldLabels));
  console.log(k.padEnd(24), rs.length, 'acc', pct(mean(s.map((x) => x.acc))), 'F1', pct(mean(s.map((x) => x.macroF1))));
}
