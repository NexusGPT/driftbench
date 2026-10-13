import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { contestantById } from './contestants';
import { loadBenchmark, splitOf, type PairItem } from './data';
import { readRecordingRows } from './recording-files';
import { runBenchmark } from './run';
import type { PairResult } from './score';
import { pairedStatistics } from './rubric-ledger-stats';

const directory = 'examples/judge-benchmarks/experiments/ledger-rb';
const frozenDirectory = 'examples/judge-benchmarks/experiments/rb';
const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');

async function main() {
  if (process.argv.includes('--help')) {
    console.log('pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-replay.ts');
    console.log('Free replay only. Downloads public dataset into this worktree; never calls a model.');
    return;
  }
  process.env.DRIFTBENCH_BENCH_CACHE = resolve('.cache/ledger-rb/data');
  await mkdir(directory, { recursive: true });
  const all = (await loadBenchmark('rubricbench')).items as PairItem[];
  const test = all.filter((item) => splitOf('rubricbench', item.id) === 'test');
  if (test.length !== 790) throw new Error(`Expected 790 test pairs, received ${test.length}`);
  const original = JSON.parse(await readFile(join(frozenDirectory, 'official-test-sample434.json'), 'utf8'));
  const wanted = new Set<string>(original.fallbackIds);
  const sample = test.filter((item) => wanted.has(item.id));
  if (sample.length !== 434 || wanted.size !== 434) throw new Error('Sample membership changed');
  const contestants = [contestantById('driftbench-rb-binary-canonical-executed'), contestantById('promptfoo')];
  const perItem = new Map<string, Map<string, PairResult>>();
  const run = await runBenchmark({ bench: 'rubricbench', model: 'haiku', split: 'test', items: sample,
    contestants, concurrency: 1, replayOnly: 'lenient',
    onPairResult: (id, row) => {
      if (!perItem.has(id)) perItem.set(id, new Map());
      perItem.get(id)!.set(row.item.id, row);
    } });
  if (run.newCalls || run.newSpendUsd || run.stopped) throw new Error('Free replay invariant failed');
  const rows = sample.map((item) => {
    const ours = perItem.get(contestants[0]!.id)!.get(item.id)!;
    const peer = perItem.get('promptfoo')!.get(item.id)!;
    return { id: item.id, group: item.group, label: item.label,
      ours: ours.games.map((g) => g === item.label), peer: peer.games.map((g) => g === item.label),
      oursDecisions: ours.games, peerDecisions: peer.games, oursMissing: ours.missing, peerMissing: peer.missing };
  });
  const statistics = pairedStatistics(rows);
  if (statistics.ours.correct !== 724 || statistics.peer.correct !== 691)
    throw new Error(`Original results fail reproduction: ${statistics.ours.correct}/868 versus ${statistics.peer.correct}/868`);
  const recordings = await readRecordingRows('examples/judge-benchmarks/recordings/rubricbench/haiku.jsonl');
  const priorIds = [...new Set(recordings.flatMap((r) => r.item?.startsWith('rubric_eval_') ? [r.item] : []))].sort();
  const ids = test.map((item) => item.id).sort();
  const seals = { status: 'pool sealed; contestant and dialect freeze pending core PR',
    sourceBranch: 'origin/codex/rb-judge', sourceCommit: '8c1d1ca707d6505028a4e0db80c937dd6cfaef71',
    disclosure: 'previously evaluated split', pairs: ids.length, games: ids.length * 2,
    testIdsSha256: sha(JSON.stringify(ids)), datasetSha256: sha(JSON.stringify(all)),
    normalizedTestPayloadSha256: sha(JSON.stringify(test)), previousRecordedIdsSha256: sha(JSON.stringify(priorIds)),
    previouslyRecordedTestPairs: ids.filter((id) => priorIds.includes(id)).length,
    sampleIdsSha256: sha(JSON.stringify([...wanted].sort())),
    models: { haiku: 'pending core contract', 'gpt-6-luna': 'pending core contract and model/price verification',
      'gemini-3.8-flash': 'pending billing; no calls authorized while blocked' },
    capUsd: 20, newModelCalls: 0, newSpendUsd: 0,
    requiredBeforePaid: ['core dossier naming pushed contract PR', 'model ids and prices verified',
      'fixtures and validity plan committed', 'source/dialect/reasoning freeze committed',
      '20-item development pilot per model with projected full spend inside cap', 'validity gates pass'],
    sourceHashes: {} as Record<string, string>, recordingHashes: {} as Record<string, string> };
  // Once selected, the corpus cannot silently change during a later replay.
  try {
    const existing = JSON.parse(await readFile(join(directory, 'pool-seal.json'), 'utf8'));
    for (const key of ['testIdsSha256', 'datasetSha256', 'normalizedTestPayloadSha256', 'sampleIdsSha256'] as const)
      if (existing[key] !== seals[key]) throw new Error(`Sealed input changed: ${key}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const name of ['rubric-ledger-replay.ts', 'rubric-ledger-plan.ts', 'rubric-ledger-stats.ts', 'rubric-atomic.ts', 'rubric-items.ts',
    'code-evidence.ts', 'contestants.ts', 'data.ts', 'run.ts', 'call.ts', 'json.ts'])
    seals.sourceHashes[name] = sha(await readFile(`examples/judge-benchmarks/src/${name}`));
  for (const name of (await readdir('examples/judge-benchmarks/recordings/rubricbench')).sort())
    seals.recordingHashes[name] = sha(await readFile(`examples/judge-benchmarks/recordings/rubricbench/${name}`));
  const write = async (name: string, value: unknown) =>
    writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
  await write('sample434-replay.json', { run, statistics, missing: {
    ours: rows.reduce((n, r) => n + r.oursMissing, 0), peer: rows.reduce((n, r) => n + r.peerMissing, 0) } });
  await write('sample434-decisions.json', rows);
  await write('test-ids.json', ids);
  await write('previous-recorded-ids.json', priorIds);
  await write('pool-seal.json', seals);
  console.log(JSON.stringify({ statistics, newCalls: run.newCalls, newSpendUsd: run.newSpendUsd, seals }, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
