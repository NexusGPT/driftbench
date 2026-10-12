/** DEV-only full escalation and a label-blind cascade, using the unchanged reference3 baseline first. */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { cascadeReasons } from './cascade';
import { contestantById } from './contestants';
import { loadBenchmark, type PairItem, splitOf } from './data';
import { runBenchmark } from './run';
import { type PairResult, scorePairs } from './score';

const out = 'examples/judge-benchmarks/jb-results';
const ledger = process.env.JB_SPEND_LEDGER;
if (!ledger) throw new Error('JB_SPEND_LEDGER is required');
const initial = new Set<string>(JSON.parse(await readFile(`${out}/starting-keys.json`, 'utf8')));
const spent = async () =>
  (await readFile('examples/judge-benchmarks/recordings/judgebench/haiku.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { key: string; costUsd: number })
    .filter((r) => !initial.has(r.key))
    .reduce((n, r) => n + r.costUsd, 0);
const wait = process.env.JB_AFTER;
if (wait) {
  let done = false;
  while (!done) {
    try {
      JSON.parse(await readFile(wait, 'utf8'));
      done = true;
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
const b = await loadBenchmark('judgebench');
const items = b.items.filter((i) => splitOf('judgebench', i.id) === 'dev') as PairItem[];
const base = new Map<string, PairResult>();
const evidence = new Map<string, { reference?: string; ab: string[]; ba: string[] }>();
const baseline = await runBenchmark({
  bench: 'judgebench',
  split: 'dev',
  model: 'haiku',
  contestants: [contestantById('driftbench-reference3')],
  replayOnly: true,
  concurrency: 1,
  onPairResult: (r) => {
    base.set(r.item.id, r);
  },
  onEvidence: (s) => {
    const e = evidence.get(s.item) ?? { ab: [], ba: [] };
    const d = s.details as { text?: string; order?: string; texts?: string[] } | undefined;
    if (s.kind === 'reference') e.reference = d?.text;
    if (s.kind === 'judgements' && d?.order === 'AB') e.ab = d.texts ?? [];
    if (s.kind === 'judgements' && d?.order === 'BA') e.ba = d.texts ?? [];
    evidence.set(s.item, e);
  },
});
if (baseline.stopped || baseline.contestants[0]?.summary.missing || base.size !== items.length)
  throw new Error('A complete recorded reference3 baseline is required.');
const gates = items.map((item) => {
  const e = evidence.get(item.id);
  return {
    id: item.id,
    reasons: cascadeReasons({
      question: item.question,
      a: item.a,
      b: item.b,
      reference: e?.reference,
      ab: e?.ab ?? [],
      ba: e?.ba ?? [],
    }),
  };
});
const selected = new Set(gates.filter((g) => g.reasons.length).map((g) => g.id));
await writeFile(
  `${out}/cascade-gates.json`,
  JSON.stringify(
    {
      threshold: 0.75,
      total: items.length,
      escalated: selected.size,
      share: selected.size / items.length,
      gates,
    },
    null,
    2,
  ),
);
if (process.env.JB_GATE_ONLY === '1') {
  console.log(
    JSON.stringify({ total: items.length, escalated: selected.size, share: selected.size / items.length }),
  );
  process.exit(0);
}
const audit = JSON.parse(await readFile(`${out}/label-audit.json`, 'utf8')) as { excluded: { id: string }[] };
const excluded = new Set(audit.excluded.map((x) => x.id));
const time = () =>
  new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
for (const id of process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['driftbench-reference3-tools', 'driftbench-reference3-tools-format']) {
  const candidate = contestantById(id),
    cap = 7.8 - (await spent());
  const formattedBase = new Map<string, PairResult>();
  const usedBaseline = candidate.answerFormat
    ? await runBenchmark({
        bench: 'judgebench',
        split: 'dev',
        model: 'haiku',
        contestants: [contestantById('driftbench-reference3-format')],
        replayOnly: true,
        concurrency: 1,
        onPairResult: (r) => {
          formattedBase.set(r.item.id, r);
        },
      })
    : baseline;
  if (usedBaseline.stopped) throw new Error('Complete format baseline must be recorded first.');
  if (cap <= 0.05 || Date.now() >= Date.parse('2026-10-13T04:20:00+02:00')) break;
  const results = new Map<string, PairResult>();
  await appendFile(
    ledger,
    `| ${time()} | codex-jb ${id} DEV full escalation before; cascade gates frozen without labels | haiku | pending | ${cap.toFixed(4)} cap | pending | escalates ${selected.size}/${items.length} |\n`,
  );
  const signalFile = `${out}/${id}-signals.jsonl`;
  await writeFile(signalFile, '');
  const full = await runBenchmark({
    bench: 'judgebench',
    split: 'dev',
    model: 'haiku',
    contestants: [candidate],
    concurrency: 1,
    replayOnly: process.env.JB_REPLAY_ONLY === '1' ? true : undefined,
    capUsd: cap,
    maxCallUsd: 0.04,
    deadlineMs: Date.parse('2026-10-13T04:20:00+02:00'),
    onPairResult: (r) => {
      results.set(r.item.id, r);
    },
    onEvidence: async (s) => {
      await appendFile(signalFile, `${JSON.stringify(s)}\n`);
    },
  });
  await writeFile(`${out}/${id}.json`, JSON.stringify(full, null, 2));
  if (
    full.stopped ||
    full.failedCalls ||
    full.contestants[0]?.summary.missing ||
    results.size !== items.length
  ) {
    console.log(JSON.stringify(full));
    break;
  }
  // Price the actual required prompts on the selected cases, replaying exactly the same escalation outputs.
  const selective = await runBenchmark({
    bench: 'judgebench',
    model: 'haiku',
    items: items.filter((i) => selected.has(i.id)),
    criterion: b.criterion,
    contestants: [candidate],
    replayOnly: true,
    concurrency: 1,
  });
  if (selective.stopped) throw new Error(selective.stopped);
  const combined = items.map(
    (item) =>
      (selected.has(item.id) ? results : candidate.answerFormat ? formattedBase : base).get(
        item.id,
      ) as PairResult,
  );
  const audited = combined.filter((r) => !excluded.has(r.item.id));
  const cascadeCost = (usedBaseline.contestants[0]?.costUsd ?? 0) + (selective.contestants[0]?.costUsd ?? 0);
  const result = {
    id: `${id}-cascade`,
    base: 'driftbench-reference3',
    escalation: id,
    n: items.length,
    escalated: selected.size,
    share: selected.size / items.length,
    official: scorePairs('judgebench', combined),
    audited: scorePairs('judgebench', audited),
    costUsd: cascadeCost,
    cost100: (cascadeCost / items.length) * 100,
    fullOfficial: full.contestants[0]?.summary,
    fullAudited: scorePairs(
      'judgebench',
      [...results.values()].filter((r) => !excluded.has(r.item.id)),
    ),
    fullCost100: ((full.contestants[0]?.costUsd ?? 0) / items.length) * 100,
    newSpendUsd: full.newSpendUsd,
  };
  await writeFile(`${out}/${id}-cascade.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await appendFile(
    ledger,
    `| ${time()} | codex-jb ${id} DEV after: full ${(100 * (full.contestants[0]?.summary.value.estimate ?? 0)).toFixed(1)}; cascade ${(100 * result.official.value.estimate).toFixed(1)} percent; escalates ${selected.size}/${items.length} | haiku | ${full.newCalls} | ${cap.toFixed(4)} cap | ${full.newSpendUsd.toFixed(8)} | total ${(await spent()).toFixed(8)} of 8.00 |\n`,
  );
}
