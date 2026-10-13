import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promptKey, Recordings } from '../src/call';
import { contestantById } from '../src/contestants';
import { CRITERIA, loadBenchmark, type PairItem } from '../src/data';
import { scorePairs, type PairResult } from '../src/score';
import { replayPair } from './mm-dev';
import { stratifiedInterval } from './mm-test-sample';

async function main() {
  const arg = (key: string) => {
    const i = process.argv.indexOf(`--${key}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const input = arg('input'),
    out = arg('out'),
    manifestPath = arg('manifest');
  if (!input || !out || !manifestPath) throw new Error('Require input, out and manifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const declared = manifest.items ?? manifest.batches[0];
  const declaredIds = new Set<string>(declared.map((r: { id: string }) => r.id));
  const bench = await loadBenchmark('mmeval');
  const byId = new Map(bench.items.filter((i): i is PairItem => i.kind === 'pair').map((i) => [i.id, i]));
  const rows = (await readFile(input, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const ours = new Map<string, PairResult>();
  for (const row of rows) {
    if (!declaredIds.has(row.id) || ours.has(row.id)) throw new Error('Duplicate or undeclared decision');
    ours.set(row.id, { item: byId.get(row.id)!, games: row.games, missing: 0 });
  }
  const refused = new Set<string>();
  if (arg('refusals'))
    for (const line of (await readFile(arg('refusals')!, 'utf8')).trim().split('\n').filter(Boolean)) {
      const id = JSON.parse(line).id;
      if (!declaredIds.has(id)) throw new Error('Refusal outside declared cohort');
      refused.add(id);
      ours.set(id, { item: byId.get(id)!, games: ['tie', 'tie'], missing: 2, providerRefused: true });
    }
  if (ours.size !== declaredIds.size) throw new Error('Compare only completed declared cohorts');
  const recordings = await new Recordings('examples/judge-benchmarks/recordings/mmeval/haiku.jsonl').load();
  const ids = ['driftbench', 'deepeval', 'promptfoo'];
  const pairs = [...ours.values()].map((r) => ({
    ours: r,
    baselines: ids.map((id) => replayPair(r.item, contestantById(id), recordings)),
  }));
  const covered = pairs.filter((r) => r.baselines.every((b) => b.complete));
  if (!covered.length) throw new Error('No common recorded coverage');
  const variants = [
    {
      name: arg('ours-name') ?? 'stored result on the same cohort',
      rows: covered.map((r) => ({ ...r.ours, providerRefused: refused.has(r.ours.item.id) })),
      costUsd: null as number | null,
      calls: null as number | null,
    },
    ...ids.map((name, index) => {
      const keys = new Set(covered.flatMap((r) => r.baselines[index]!.keys.filter((k): k is string => !!k)));
      const setup = contestantById(name).setup?.pair?.(CRITERIA.mmeval);
      if (setup) {
        const key = promptKey('haiku', setup);
        if (!recordings.get(key)) throw new Error('Missing baseline setup');
        keys.add(key);
      }
      return {
        name,
        rows: covered.map(
          (r): PairResult => ({
            item: r.ours.item,
            games: r.baselines[index]!.games,
            missing: 0,
            providerRefused: refused.has(r.ours.item.id),
          }),
        ),
        costUsd: [...keys].reduce((s, k) => s + recordings.get(k)!.costUsd, 0),
        calls: keys.size,
      };
    }),
  ];
  const report = {
    label: 'common recorded comparison inside the declared sample',
    input,
    manifestPath,
    declaredItems: declaredIds.size,
    commonItems: covered.length,
    providerRefusedIds: [...refused].filter((id) => covered.some((r) => r.ours.item.id === id)),
    variants: variants.map((v) => ({
      name: v.name,
      costPer100: v.costUsd === null ? null : (v.costUsd * 100) / covered.length,
      callsPerItem: v.calls === null ? null : v.calls / covered.length,
      official: scorePairs('mmeval', v.rows),
      interval95: stratifiedInterval(v.rows),
      excluded: scorePairs(
        'mmeval',
        v.rows.filter((r) => !r.providerRefused),
      ),
    })),
    time: new Date().toISOString(),
    newSpendUsd: 0,
  };
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(
    JSON.stringify({
      commonItems: covered.length,
      declaredItems: declaredIds.size,
      scores: report.variants.map((v) => ({ name: v.name, score: v.official.value.estimate })),
    }) + '\n',
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
