import { readFile, writeFile } from 'node:fs/promises';
import { loadBenchmark, type PairItem } from '../src/data';
const root = 'examples/judge-benchmarks/experiments/mm-results';
const arg = (key: string) => {
  const i = process.argv.indexOf(`--${key}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const directTag = arg('direct-tag') ?? 'native-dev400-c576';
const crowdTag = arg('crowd-tag') ?? 'cascade-dev400-c576';
const out = arg('out') ?? `${root}/chat-label-audit-native-evidence.json`;
const direct = new Map(
  (await readFile(`${root}/${directTag}-direct-decisions.jsonl`, 'utf8'))
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s))
    .map((r) => [r.id, r]),
);
const crowd = (await readFile(`${root}/${crowdTag}-crowd-decisions.jsonl`, 'utf8'))
  .trim()
  .split('\n')
  .map((s) => JSON.parse(s));
const bench = await loadBenchmark('mmeval');
const byId = new Map(bench.items.filter((i): i is PairItem => i.kind === 'pair').map((i) => [i.id, i]));
const score = (r: { games: string[]; label: string }) =>
  r.games.reduce((s, g) => s + (g === r.label ? 1 : g === 'tie' ? 0.5 : 0), 0) / 2;
const rows = crowd
  .filter((r) => r.group === 'chat' && direct.has(r.id) && score(r) < 1 && score(direct.get(r.id)) < 1)
  .map((r) => ({ item: byId.get(r.id), direct: direct.get(r.id), crowd: r }));
const count = [...direct.values()].filter((r) => r.group === 'chat').length;
await writeFile(
  out,
  JSON.stringify(
    {
      directTag,
      crowdTag,
      observedChat: count,
      scope:
        'Conservative intersection: each variant has at least one game not naming the label. Includes split and tied games; neither establishes a label defect.',
      items: rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({ observedChat: count, auditedIntersection: rows.length, ids: rows.map((r) => r.item!.id) }),
);
