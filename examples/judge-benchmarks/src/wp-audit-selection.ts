import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadBenchmark, type PairItem, splitOf } from './data';
import { assertWritingTestFreeze } from './wp-eval-scope';
import { writingRowKey } from './wp-study';

type Design = { name: string; family: string; path: string; rowsKey?: string; gamesKey?: string };
type Row = { rowKey: string; games: string[]; [key: string]: unknown };
const arg = (s: string) => {
  const i = process.argv.indexOf(`--${s}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const split = arg('split'),
  config = arg('designs'),
  out = arg('out'),
  prefix = arg('input-prefix');
if (!['dev', 'test'].includes(split ?? '') || !config || !out || !prefix)
  throw new Error('--split dev|test, --designs, --out and --input-prefix required');
if (split === 'test') {
  const manifest = JSON.parse(await readFile(new URL('../census/wp-freeze.json', import.meta.url), 'utf8'));
  await assertWritingTestFreeze(manifest.variant, arg('frozen-sha'));
}
const designs = JSON.parse(await readFile(config, 'utf8')) as Design[];
if (designs.length < 2) throw new Error('Audit selection needs two distinct designs');
const bench = await loadBenchmark('longjudge-wp');
const source = bench.items.filter(
  (x): x is PairItem => x.kind === 'pair' && splitOf(bench.id, x.id) === split,
);
const indexes: { design: Design; byKey: Map<string, Row> }[] = [];
for (const design of designs) {
  const report = JSON.parse(await readFile(design.path, 'utf8'));
  if (report.split !== split) throw new Error(`Design split mismatch: ${design.path}`);
  const rows = report[design.rowsKey ?? 'results'] as Row[];
  if (!Array.isArray(rows)) throw new Error(`Missing measured rows: ${design.path}`);
  indexes.push({ design, byKey: new Map(rows.map((r) => [r.rowKey, r])) });
}
const selected: {
  n: number;
  rowKey: string;
  id: string;
  group: string;
  label: 'A' | 'B';
  judges: { design: string; family: string; games: string[] }[];
  path: string;
  readFully: boolean;
}[] = [];
for (const item of source) {
  const rowKey = writingRowKey(item);
  const judgments = indexes.flatMap(({ design, byKey }) => {
    const row = byKey.get(rowKey);
    const games = row?.[design.gamesKey ?? 'games'];
    return Array.isArray(games) && games.length === 2
      ? [{ design: design.name, family: design.family, games: games as string[] }]
      : [];
  });
  const opposed = judgments.filter((j) => j.games.every((g) => g !== item.label && (g === 'A' || g === 'B')));
  if (new Set(opposed.map((j) => j.family)).size < 2) continue;
  const n = selected.length + 1,
    path = `${prefix}/${String(n).padStart(2, '0')}-${rowKey}.md`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `# ${n}: ${rowKey}\n\n${JSON.stringify({ id: item.id, group: item.group, label: item.label, judgments })}\n\n## Request\n\n${item.question}\n\n## Reply A\n\n${item.a}\n\n## Reply B\n\n${item.b}\n`,
  );
  selected.push({
    n,
    rowKey,
    id: item.id,
    group: item.group,
    label: item.label,
    judges: judgments,
    path,
    readFully: false,
  });
}
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  JSON.stringify(
    {
      split,
      population: source.length,
      selected: selected.length,
      selectionRule:
        'At least two distinct design families oppose the label in both orders, with no ties. Selection does not itself establish a label error.',
      items: selected,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ split, population: source.length, selected: selected.length }, null, 2));
