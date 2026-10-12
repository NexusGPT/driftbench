import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { loadBenchmark, type PairItem } from '../src/data';
import { type PairResult, scorePairs } from '../src/score';
import { fileURLToPath } from 'node:url';

async function main() {
  const root = 'examples/judge-benchmarks/experiments/mm-results';
  const at = process.argv.indexOf('--dev-tag');
  const devTag = at >= 0 ? process.argv[at + 1]! : 'cascade-dev400-repaired';
  const rows = (await readFile(`${root}/${devTag}-rounds.jsonl`, 'utf8'))
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s));
  const direct = rows.find((r) => r.phase === 'batch1-direct');
  const premise = rows.find((r) => r.phase === 'batch1-premise');
  const cascade = rows.find((r) => r.phase === 'batch1-cascade');
  if (
    !direct ||
    !premise ||
    !cascade ||
    cascade.directCompleted !== 400 ||
    cascade.pendingEscalations !== 0 ||
    cascade.stopped ||
    cascade.premiseCompleted !== cascade.directSummary.byGroup.safety.n
  )
    throw new Error('Require a complete fixed DEV400 cascade and matched safety ablation before freezing');
  const benchmark = await loadBenchmark('mmeval');
  const byId = new Map(benchmark.items.filter((i): i is PairItem => i.kind === 'pair').map((i) => [i.id, i]));
  const refused = new Set<string>((rows.at(-1).providerRefusedIds ?? []) as string[]);
  const readRows = async (stage: string) => (await readFile(`${root}/${devTag}-${stage}-decisions.jsonl`, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const directRows = await readRows('direct'), crowdRows = await readRows('crowd'), premiseRows = await readRows('premise');
  const initial = new Map(directRows.map((r) => [r.id, r.games]));
  for (const id of refused) if (!initial.has(id)) initial.set(id, ['tie', 'tie']);
  const summary = (replacement: any[]) => {
    const games = new Map(initial);
    for (const row of replacement) games.set(row.id, row.games);
    return scorePairs('mmeval', [...games].map(([id, games]): PairResult => ({ item: byId.get(id)!, games, missing: refused.has(id) ? 2 : 0, providerRefused: refused.has(id) })));
  };
  const records = (await readFile('examples/judge-benchmarks/recordings/mmeval/haiku.jsonl', 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  const recordMap = new Map(records.map((r) => [r.key, r]));
  const safetyKeys = new Set(directRows.filter((r) => r.group === 'safety' && !refused.has(r.id)).flatMap((r) => r.rawComparisons.map((a: any) => a.key)));
  const replacedCost = [...safetyKeys].reduce((sum, key) => sum + recordMap.get(key).costUsd, 0);
  const candidates = [
    { name: 'explicit-winner direct', cascade: false, premises: false, summary: summary([]), costPer100: direct.directCostPer100, callsPerItem: direct.phaseCosts.direct.calls / 400 },
    { name: 'premise-aware direct', cascade: false, premises: true, summary: summary(premiseRows), costPer100: (direct.phaseCosts.direct.costUsd - replacedCost + premise.phaseCosts.premise.costUsd) / 4, callsPerItem: (direct.phaseCosts.direct.calls - safetyKeys.size + premise.phaseCosts.premise.calls) / 400 },
    { name: 'selective cascade', cascade: true, premises: false, summary: summary(crowdRows), costPer100: cascade.costPer100, callsPerItem: cascade.callsPerItem },
  ].sort((a, b) => b.summary.value.estimate - a.summary.value.estimate || a.costPer100 - b.costPer100);
  const selected = candidates[0]!;
  const sources = [
    'examples/judge-benchmarks/experiments/mm-cascade.ts',
    'examples/judge-benchmarks/experiments/mm-crowd.ts',
    'examples/judge-benchmarks/experiments/mm-test-sample.ts',
    'examples/judge-benchmarks/experiments/mm-budget.ts',
    'examples/judge-benchmarks/src/mm-language.ts',
    'examples/judge-benchmarks/src/call.ts',
    'packages/judges/src/assessment.ts',
    'packages/judges/src/pairwise.ts',
    'packages/judges/src/prompt.ts',
    'packages/judges/src/contract.ts',
    'packages/judges/src/evidence.ts',
  ];
  const sourceHashes: Record<string, string> = {};
  for (const source of sources)
    sourceHashes[source] = createHash('sha256')
      .update(await readFile(source))
      .digest('hex');
  const config = {
    version: 1,
    cascade: selected.cascade,
    premises: selected.premises,
    contractSha: cascade.contractSha,
    devTag,
    frozenAt: new Date().toISOString(),
    contractReviewStatus:
      'The shared winner contract is still under independent re-review at the freeze, per the lead’s latest status.',
    sourceHashes,
  };
  await writeFile(`${root}/frozen-config.json`, JSON.stringify(config, null, 2) + '\n');
  await writeFile(
    `${root}/freeze-selection.json`,
    JSON.stringify(
      {
        selectionRule:
          'Highest fixed DEV400 mean, lower inference cost breaks an exact tie. No test label or output has been read.',
        selected,
        candidates,
        config,
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    JSON.stringify({
      selected: selected.name,
      devScore: selected.summary.value.estimate,
      costPer100: selected.costPer100,
      callsPerItem: selected.callsPerItem,
    }) + '\n',
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
