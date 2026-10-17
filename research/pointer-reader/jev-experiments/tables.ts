// Prints the markdown tables of RESULTS.md. Every number is computed from results/*.json.
import { BLOCKS, byId, LABELS, PRIORITY, predict, UNITS, type RunRec } from './src/arms';
import { goldLabels, linkScore, loadRuns, mean, pct, predictions, score, CLASSES } from './report';

const runs = loadRuns();
const group = (prefix: RegExp) => {
  const m = new Map<string, RunRec[]>();
  for (const r of runs) { if (!prefix.test(r.runId)) continue; const k = r.runId.replace(/-r\d+$/, ''); m.set(k, [...(m.get(k) ?? []), r]); }
  return m;
};
const range = (xs: number[]) => (xs.length > 1 ? `${pct(mean(xs))} (${pct(Math.min(...xs))} to ${pct(Math.max(...xs))})` : pct(xs[0]!));
const tokensIn = (r: RunRec) => r.calls.reduce((a, c) => a + (c.tokIn ?? 0), 0);
const tokensOut = (r: RunRec) => r.calls.reduce((a, c) => a + (c.tokOut ?? 0), 0);
const seqMs = (r: RunRec) => r.calls.reduce((a, c) => a + c.ms, 0);

export function flatTable(title: string, m: Map<string, RunRec[]>, names: Record<string, string> = {}) {
  const lines = [`### ${title}`, '', '| Variant | Runs (files in results/) | Calls per pass | Accuracy, % mean (min to max) | Macro F1, % mean | Invalid or missing answers | Mean ms per call | Sum of call time per pass, s | Tokens in per pass |', '|---|---|---|---|---|---|---|---|---|'];
  for (const [k, rs] of m) {
    const s = rs.map((r) => score(predictions(r, 0.5), goldLabels));
    const miss = rs.reduce((a, r) => a + r.missing, 0), asked = rs.reduce((a, r) => a + r.asked, 0);
    lines.push(`| ${names[k] ?? k} | ${rs.length} (${rs.map((r) => r.runId).join(', ')}) | ${rs[0]!.calls.length} | ${range(s.map((x) => x.acc))} | ${pct(mean(s.map((x) => x.macroF1)))} | ${miss} of ${asked} | ${mean(rs.flatMap((r) => r.calls.map((c) => c.ms))).toFixed(0)} | ${(mean(rs.map(seqMs)) / 1000).toFixed(1)} | ${(mean(rs.map(tokensIn)) / 1000).toFixed(0)}k |`);
  }
  return lines.join('\n');
}

export function sweepTable(title: string, m: Map<string, RunRec[]>, names: Record<string, string> = {}) {
  const ts = [0.3, 0.4, 0.5, 0.6, 0.7];
  const lines = [`### ${title}`, '', '| Variant | ' + ts.map((t) => `acc @${t} / F1 @${t}`).join(' | ') + ' |', '|---|' + ts.map(() => '---').join('|') + '|'];
  for (const [k, rs] of m) {
    lines.push(`| ${names[k] ?? k} | ` + ts.map((t) => { const s = rs.map((r) => score(predictions(r, t), goldLabels)); return `${pct(mean(s.map((x) => x.acc)))} / ${pct(mean(s.map((x) => x.macroF1)))}`; }).join(' | ') + ' |');
  }
  return lines.join('\n');
}

function pairAgree(rs: RunRec[], t: number) {
  const preds = rs.map((r) => predictions(r, t));
  const out: number[] = [], kap: number[] = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    let same = 0;
    for (let u = 0; u < UNITS.length; u++) if (preds[i]![u] === preds[j]![u]) same++;
    const po = same / UNITS.length;
    let pe = 0;
    for (const c of CLASSES) pe += (preds[i]!.filter((x) => x === c).length / UNITS.length) * (preds[j]!.filter((x) => x === c).length / UNITS.length);
    out.push(po); kap.push((po - pe) / (1 - pe));
  }
  return { po: mean(out), kappa: mean(kap) };
}
export function agreeTable(m: Map<string, RunRec[]>, names: Record<string, string> = {}) {
  const lines = ['| Variant | Runs | Same label in two runs, % (mean pair) | Cohen kappa | Question-level yes/no flips between runs, % | Mean absolute probability difference | Accuracy of the mean of the runs, % | Macro F1 of the mean, % |', '|---|---|---|---|---|---|---|---|'];
  for (const [k, rs] of m) {
    if (rs.length < 3 || rs[0]!.arm === 'arm5') continue;
    const a = pairAgree(rs, 0.5);
    let flips = 0, n = 0, diff = 0;
    for (const u of UNITS) for (const l of LABELS) {
      const ps = rs.map((r) => r.probs[u.g]?.[l]).filter((x): x is number => x !== undefined);
      if (ps.length < rs.length) continue;
      n++;
      if (ps.some((p) => p >= 0.5) && ps.some((p) => p < 0.5)) flips++;
      diff += Math.max(...ps) - Math.min(...ps);
    }
    const avg: RunRec = { ...rs[0]!, probs: Object.fromEntries(UNITS.map((u) => [u.g, Object.fromEntries(Object.keys(rs[0]!.probs[u.g] ?? {}).map((l) => [l, mean(rs.map((r) => r.probs[u.g]?.[l] ?? 0))]))])) };
    const s = score(predictions(avg, 0.5), goldLabels);
    lines.push(`| ${names[k] ?? k} | ${rs.length} | ${pct(a.po)} | ${a.kappa.toFixed(3)} | ${pct(flips / n)} | ${(diff / n).toFixed(3)} | ${pct(s.acc)} | ${pct(s.macroF1)} |`);
  }
  return lines.join('\n');
}

export function perClass(rs: RunRec[]) {
  const s = rs.map((r) => score(predictions(r, 0.5), goldLabels));
  return '| Class | Gold units | Precision, % | Recall, % | F1, % |\n|---|---|---|---|---|\n' + CLASSES.map((c) => `| ${c} | ${goldLabels.filter((g) => g === c).length} | ${pct(mean(s.map((x) => x.per[c]!.p)))} | ${pct(mean(s.map((x) => x.per[c]!.r)))} | ${pct(mean(s.map((x) => x.per[c]!.f1)))} |`).join('\n');
}

export function decodeTable(rs: RunRec[]) {
  const ts = [0.3, 0.4, 0.5, 0.6, 0.7];
  const rows = (['argmax', 'priority'] as const).map((d) => `| ${d === 'argmax' ? 'highest probability above the threshold' : 'first above the threshold in the order ' + PRIORITY.join(' > ')} | ` + ts.map((t) => { const s = rs.map((r) => score(predictions(r, t, undefined, d), goldLabels)); return `${pct(mean(s.map((x) => x.acc)))} / ${pct(mean(s.map((x) => x.macroF1)))}`; }).join(' | ') + ' |');
  return '| Decoding rule | ' + ts.map((t) => `acc @${t} / F1 @${t}`).join(' | ') + ' |\n|---|' + ts.map(() => '---').join('|') + '|\n' + rows.join('\n');
}

export function linkTables(links: Map<string, RunRec[]>, labelRuns: RunRec[]) {
  const ts = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const lines = ['| Variant | Calls per block | Calls for 20 blocks | ' + ts.map((t) => `P / R @${t}`).join(' | ') + ' |', '|---|---|---|' + ts.map(() => '---').join('|') + '|'];
  const F: string[] = ['| Variant | ' + ts.map((t) => `F1 @${t}`).join(' | ') + ' |', '|---|' + ts.map(() => '---').join('|') + '|'];
  for (const [k, rs] of links) {
    const per = rs[0]!.calls.length / BLOCKS.length;
    const sc = (t: number) => rs.map((r) => linkScore(r, t));
    lines.push(`| ${k} | ${per} | ${rs[0]!.calls.length} | ` + ts.map((t) => `${pct(mean(sc(t).map((x) => x.p)))} / ${pct(mean(sc(t).map((x) => x.r)))}`).join(' | ') + ' |');
    F.push(`| ${k} | ` + ts.map((t) => pct(mean(sc(t).map((x) => x.f1)))).join(' | ') + ' |');
  }
  // Label first, then link: keep only the units the labeller (run k of the labelling arm) marks as instructions.
  const allRuns = links.get('a5-link-all-all') ?? [];
  const lf = ['', '| Label first, then link | Labelling runs | Candidates kept (runs 1, 2, 3) | Calls, 20 blocks | ' + ts.map((t) => `P / R @${t}`).join(' | ') + ' |', '|---|---|---|---|' + ts.map(() => '---').join('|') + '|'];
  const lfF = ['', '| Label first, then link | ' + ts.map((t) => `F1 @${t}`).join(' | ') + ' |', '|---|' + ts.map(() => '---').join('|') + '|'];
  const filters: Record<string, (r: RunRec, g: number) => boolean> = {
    'predicted class is rule, prohibition or gate (threshold 0.5)': (r, g) => ['rule', 'prohibition', 'gate'].includes(predict(r.probs[g], 0.5)),
    'any of rule, prohibition, gate has probability 0.5 or more': (r, g) => ['rule', 'prohibition', 'gate'].some((l) => (r.probs[g]?.[l] ?? 0) >= 0.5),
  };
  for (const [name, keepFn] of Object.entries(filters)) {
    const filtered = allRuns.map((r, i) => {
      const lr = labelRuns[i]!;
      const keep = new Set(UNITS.filter((u) => keepFn(lr, u.g)).map((u) => u.g));
      const probs = Object.fromEntries(Object.entries(r.probs).filter(([g]) => keep.has(Number(g))));
      return { run: { ...r, probs } as RunRec, kept: keep.size, id: lr.runId };
    });
    const sc2 = (t: number) => filtered.map((f) => linkScore(f.run, t));
    lf.push(`| ${name} | ${filtered.map((f) => f.id).join(', ')} | ${filtered.map((f) => f.kept).join(', ')} | ${labelRuns[0]!.calls.length} labelling + 20 linking | ` + ts.map((t) => `${pct(mean(sc2(t).map((x) => x.p)))} / ${pct(mean(sc2(t).map((x) => x.r)))}`).join(' | ') + ' |');
    lfF.push(`| ${name} | ` + ts.map((t) => pct(mean(sc2(t).map((x) => x.f1)))).join(' | ') + ' |');
  }
  // Missed and wrong links at 0.5 for the best variant
  return [lines.join('\n'), '', F.join('\n'), lf.join('\n'), lfF.join('\n')].join('\n');
}

export function missedLinks(rs: RunRec[], t: number) {
  const rows: string[] = [];
  for (const b of BLOCKS) {
    const truth = new Set(b.units.map((id) => byId.get(id)!.g));
    const fn = [...truth].filter((g) => rs.every((r) => (r.probs[g]?.[b.id] ?? 0) < t));
    const fp = UNITS.filter((u) => !truth.has(u.g) && rs.every((r) => (r.probs[u.g]?.[b.id] ?? 0) >= t));
    rows.push(`| ${b.id} ${b.name} | ${truth.size} | ${fn.map((g) => `[${g}]`).join(' ') || 'none'} | ${fp.length ? fp.map((u) => `[${u.g}] ${u.label}`).join('; ') : 'none'} |`);
  }
  return '| Block | True links | Missed in all runs | Wrong in all runs |\n|---|---|---|---|\n' + rows.join('\n');
}

if (process.argv[1]?.endsWith('tables.ts')) {
  const arm0 = group(/^a1a-w20-r\d$|^a1a-w20-defs2-r\d$/);
  console.log(flatTable('Arm 0: the two wordings of the five definitions (window of 20 units, 100 questions per call)', arm0, { 'a1a-w20': 'design-doc wording (v1)', 'a1a-w20-defs2': 'exclusive wording (v2)' }));
  console.log(flatTable('Arm 1: batch shape (exclusive wording)', group(/^a1a-w20-defs2-r\d$|^a1b-single-r\d$/), { 'a1a-w20-defs2': 'window of 20 units (100 questions)', 'a1b-single': 'one unit per call (5 questions)' }));
  console.log(flatTable('Arm 2: id form in the state and in the question (window of 20 units)', group(/^a1a-w20-defs2-r\d$|^a2-/), { 'a1a-w20-defs2': '[12] bracket', 'a2-bare': '12 (bare number)', 'a2-tag': '<s12>', 'a2-ledger': 'ledger id k7m2q9x4ab', 'a2-quote': 'unit text quoted in the question' }));
  console.log(flatTable('Arm 3: questions per call (5 labels per unit)', group(/^a3-/), Object.fromEntries([25,50,100,150,250,400,600,1000,1250].map((q) => [`a3-q${q}`, `${q} questions (${q / 5} units)`]))));
  console.log(sweepTable('Arm 3: threshold sweep per size', group(/^a3-/), Object.fromEntries([25,50,100,150,250,400,600,1000,1250].map((q) => [`a3-q${q}`, `${q} questions`]))));
  console.log(flatTable('Arm 4: flat labels against a two-level tree', group(/^a4-tree-r\d$|^a1a-w20-defs2-r\d$/), { 'a1a-w20-defs2': 'flat, 5 questions per unit', 'a4-tree': 'two-level tree' }));
  console.log('');console.log(sweepTable('Threshold sweep for arms 0 to 4 (window of 20 units)', group(/^a1a-w20-defs2|^a1a-w20-r|^a1b|^a2-|^a4-/)));
  console.log('### How the labels are read from the probabilities (window of 20 units, exclusive wording, 3 runs)\n');
  console.log(decodeTable(group(/^a1a-w20-defs2-r\d$/).get('a1a-w20-defs2')!));
  console.log('### Per class, best arm (150 questions per call, 3 runs, threshold 0.5)\n');
  console.log(perClass(group(/^a3-q150-r\d$/).get('a3-q150')!));
  const l = group(/^a5-/);
  console.log('### Arm 5: linking (one question per unit and block, 3 runs each, 20 blocks, 37 true links)\n');
  console.log(linkTables(l, group(/^a3-q150-r\d$/).get('a3-q150')!));
  console.log('\n### Arm 5: links missed or wrong in all 3 runs at 0.5 (one call per block, all 395 units)\n');
  console.log(missedLinks(l.get('a5-link-all-all')!, 0.5));
  console.log('\n### Arm 6: run-to-run agreement (3 runs of each arm, threshold 0.5)\n');
  console.log(agreeTable(group(/^a1a-w20-defs2|^a1a-w20-r|^a1b|^a2-|^a4-|^a3-q150-r|^a3-q250-r/)));
}
