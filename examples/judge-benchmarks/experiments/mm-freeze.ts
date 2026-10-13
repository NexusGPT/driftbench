import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadBenchmark, type PairItem } from '../src/data';
import { scorePairs, type PairResult } from '../src/score';

async function main() {
  const root = 'examples/judge-benchmarks/experiments/mm-results';
  const arg = (key: string) => {
    const i = process.argv.indexOf(`--${key}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const devTag = arg('dev-tag'),
    voteTag = arg('vote-tag');
  if (!devTag || !voteTag) throw new Error('Require current native dev-tag and completed vote-tag');
  const direct = JSON.parse(await readFile(`${root}/${devTag}.json`, 'utf8'));
  const vote = JSON.parse(await readFile(`${root}/${voteTag}.json`, 'utf8'));
  if (
    direct.directCompleted !== 400 ||
    direct.stopped ||
    direct.directSource !== 'current shared prompt' ||
    vote.requested !== 400 ||
    vote.completedChat !== vote.requestedChat ||
    vote.stopped ||
    vote.baseTag !== devTag ||
    vote.contractSha !== direct.contractSha
  )
    throw new Error('Require matched complete native DEV400 and chat vote before freeze');
  const refused = new Set<string>([...direct.providerRefusedIds, ...vote.providerRefusedIds]);
  const benchmark = await loadBenchmark('mmeval');
  const byId = new Map(benchmark.items.filter((i): i is PairItem => i.kind === 'pair').map((i) => [i.id, i]));
  const summary = async (file: string) => {
    const rows = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((s) => JSON.parse(s));
    const results: PairResult[] = rows.map((r) => ({
      item: byId.get(r.id)!,
      games: r.games,
      missing: refused.has(r.id) ? 2 : 0,
      providerRefused: refused.has(r.id),
    }));
    for (const id of refused)
      if (!results.some((r) => r.item.id === id))
        results.push({ item: byId.get(id)!, games: ['tie', 'tie'], missing: 2, providerRefused: true });
    if (results.length !== 400 || new Set(results.map((r) => r.item.id)).size !== 400)
      throw new Error('Frozen selection cohort mismatch');
    return scorePairs('mmeval', results);
  };
  const candidates = [
    {
      name: 'native explicit-winner direct',
      chatSamples: 1,
      cascade: false,
      premises: false,
      summary: await summary(`${root}/${devTag}-direct-decisions.jsonl`),
      costPer100: direct.directCostPer100,
      callsPerItem: direct.phaseCosts.direct.calls / 400,
    },
    {
      name: 'native direct plus chat-only three-sample vote',
      chatSamples: 3,
      cascade: false,
      premises: false,
      summary: await summary(`${root}/${voteTag}-decisions.jsonl`),
      costPer100: vote.costPer100,
      callsPerItem: vote.callsPerItem,
    },
  ].sort((a, b) => {
    const delta = b.summary.value.estimate - a.summary.value.estimate;
    return Math.abs(delta) <= 1e-12 ? a.costPer100 - b.costPer100 : delta;
  });
  const selected = candidates[0]!;
  const sources = [
    'examples/judge-benchmarks/experiments/mm-cascade.ts',
    'examples/judge-benchmarks/experiments/mm-crowd.ts',
    'examples/judge-benchmarks/experiments/mm-vote3.ts',
    'examples/judge-benchmarks/experiments/mm-test-sample.ts',
    'examples/judge-benchmarks/experiments/mm-budget.ts',
    'examples/judge-benchmarks/src/mm-language.ts',
    'examples/judge-benchmarks/src/call.ts',
    'examples/judge-benchmarks/src/data.ts',
    'examples/judge-benchmarks/src/score.ts',
    'packages/judges/src/assessment.ts',
    'packages/judges/src/pairwise.ts',
    'packages/judges/src/prompt.ts',
    'packages/judges/src/contract.ts',
    'packages/judges/src/evidence.ts',
    'packages/judges/src/transcript.ts',
  ];
  const sourceHashes: Record<string, string> = {};
  for (const source of sources)
    sourceHashes[source] = createHash('sha256')
      .update(await readFile(source))
      .digest('hex');
  const config = {
    version: 1,
    cascade: false,
    premises: false,
    chatSamples: selected.chatSamples,
    contractSha: direct.contractSha,
    devTag,
    voteTag,
    frozenAt: new Date().toISOString(),
    contractReviewStatus:
      'The shared winner contract is still under independent re-review at the freeze, per the last review status received from the lead.',
    sourceHashes,
  };
  await writeFile(`${root}/frozen-config.json`, JSON.stringify(config, null, 2) + '\n');
  await writeFile(
    `${root}/freeze-selection.json`,
    JSON.stringify(
      {
        selectionRule:
          'Highest official matched native DEV400 mean; lower cost breaks an exact tie. Same refused-item set for both. Premise extraction was dropped after its measured negative result. Test is unread.',
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
