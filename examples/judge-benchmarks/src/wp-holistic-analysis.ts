import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { PairDecision } from './contestants';
import { loadBenchmark, type PairItem, splitOf } from './data';
import { scorePairs } from './score';
import { writingRowKey } from './wp-study';

type Row = {
  rowKey: string;
  id: string;
  group: string;
  label: 'A' | 'B';
  games: PairDecision[];
  rated: PairDecision[];
  excerpt: PairDecision[];
  reconciled: PairDecision[];
  parsed: ({ confidence: number } | null)[];
  missing: number;
  resolutionMissing: number;
  costUsd: number;
  baseCostUsd: number;
};
type Study = {
  variant: string;
  results: Row[];
  stopped?: string;
  costPer100: number;
  reconciledCostPer100: number;
};
const bench = await loadBenchmark('longjudge-wp');
const items = bench.items.filter(
  (i): i is PairItem => i.kind === 'pair' && splitOf(bench.id, i.id) === 'dev',
);
const itemByKey = new Map(items.map((i) => [writingRowKey(i), i]));
const studies: Study[] = [];
for (const variant of ['anchor', 'reader', 'interleaved', 'notes', 'pointwise', 'finepointwise']) {
  try {
    studies.push(
      JSON.parse(
        await readFile(
          fileURLToPath(new URL(`../census/wp-holistic-${variant}-dev.json`, import.meta.url)),
          'utf8',
        ),
      ) as Study,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}
const attach = (r: Row) => {
  const item = itemByKey.get(r.rowKey);
  if (!item || r.label !== item.label) throw new Error(`Unknown or mismatched DEV row ${r.rowKey}`);
  return { ...r, item };
};
// Resample entire instruction-id clusters. This keeps related pairs and both orders together.
const clusteredInterval = (rows: ReturnType<typeof attach>[]) => {
  const clusters = new Map<string, typeof rows>();
  for (const r of rows) clusters.set(r.id, [...(clusters.get(r.id) ?? []), r]);
  const groups = [...clusters.values()];
  let seed = 27491;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const samples = Array.from({ length: 5000 }, () => {
    let k = 0,
      n = 0;
    for (let i = 0; i < groups.length; i++) {
      for (const r of groups[Math.floor(random() * groups.length)] ?? []) {
        for (const g of r.games) {
          k += g === r.label ? 1 : 0;
          n++;
        }
      }
    }
    return k / n;
  }).sort((a, b) => a - b);
  return { lower: samples[125], upper: samples[4874], clusters: groups.length, resamples: samples.length };
};
const summarize = (name: string, raw: Row[], costPer100: number) => {
  const rows = raw.map(attach);
  if (rows.length !== items.length || new Set(rows.map((r) => r.rowKey)).size !== items.length)
    throw new Error(`Incomplete population: ${name}`);
  return {
    name,
    costPer100,
    summary: scorePairs(bench.id, rows),
    clusteredInterval: clusteredInterval(rows),
    byOrder: Object.fromEntries(
      ['en', 'zh'].map((group) => [
        group,
        [0, 1].map((order) => {
          const rr = rows.filter((r) => r.group === group);
          return { n: rr.length, correct: rr.filter((r) => r.games[order] === r.label).length };
        }),
      ]),
    ),
    unresolved: rows.filter((r) => r.games.includes('tie')).length,
    rows: raw.map((r) => ({
      rowKey: r.rowKey,
      id: r.id,
      group: r.group,
      label: r.label,
      games: r.games,
      missing: r.missing,
    })),
  };
};
const candidates = studies
  .filter((s) => !s.stopped)
  .flatMap((s) =>
    (['games', 'rated', 'excerpt', 'reconciled'] as const).map((decoder) =>
      summarize(
        `${s.variant}/${decoder}`,
        s.results.map((r) => ({
          ...r,
          games: r[decoder],
          missing: r.missing + (decoder === 'reconciled' ? r.resolutionMissing : 0),
        })),
        decoder === 'reconciled' ? s.reconciledCostPer100 : s.costPer100,
      ),
    ),
  );
const selected = ['anchor', 'reader', 'interleaved'].map((v) =>
  studies.find((s) => s.variant === v && !s.stopped),
);
if (selected.every((s): s is Study => !!s && s.results.every((r) => r.missing === 0))) {
  const maps = selected.map((s) => new Map(s.results.map((r) => [r.rowKey, r])));
  const common = items.map((item) =>
    maps.map((m) => {
      const row = m.get(writingRowKey(item));
      if (!row) throw new Error('Council population mismatch');
      return row;
    }),
  );
  const vote = (ds: { choice: PairDecision; weight: number }[]): PairDecision => {
    const a = ds.reduce((n, d) => n + (d.choice === 'A' ? d.weight : 0), 0);
    const b = ds.reduce((n, d) => n + (d.choice === 'B' ? d.weight : 0), 0);
    return a === b ? 'tie' : a > b ? 'A' : 'B';
  };
  for (const confidence of [false, true]) {
    const rows = common.map((rr) => {
      const base = rr[0];
      if (!base) throw new Error('Council row missing');
      const games = [0, 1].map((order) =>
        vote(
          rr.map((r) => ({
            choice: r.games[order] ?? 'tie',
            weight: confidence ? r.parsed[order]?.confidence || 1 : 1,
          })),
        ),
      );
      return { ...base, games, missing: 0, baseCostUsd: rr.reduce((n, r) => n + r.baseCostUsd, 0) };
    });
    candidates.push(
      summarize(
        `three-views/${confidence ? 'confidence-vote' : 'equal-vote'}`,
        rows,
        (100 * rows.reduce((n, r) => n + r.baseCostUsd, 0)) / items.length,
      ),
    );
  }
}
candidates.sort((a, b) => b.summary.value.estimate - a.summary.value.estimate || a.costPer100 - b.costPer100);
const out = process.argv[process.argv.indexOf('--out') + 1];
if (!process.argv.includes('--out') || !out) throw new Error('--out required');
await writeFile(out, `${JSON.stringify({ split: 'dev', items: items.length, candidates }, null, 2)}\n`);
console.log(
  JSON.stringify(
    candidates.map(({ rows, ...r }) => r),
    null,
    2,
  ),
);
