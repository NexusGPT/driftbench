import { readFile, writeFile } from 'node:fs/promises';
import { loadBenchmark, type PairItem, splitOf, stratifiedSample } from './data';
import { writingAccuracy, writingInterval, type WritingMeasuredRow } from './wp-final-analysis';
import { writingRowKey } from './wp-study';

type Report = {
  variant: string;
  selectedVariant?: string;
  split: string;
  items: number;
  pilot?: boolean;
  stopped?: string;
  costPer100: number;
  results: (WritingMeasuredRow & { costUsd: number; baseCostUsd?: number })[];
};
const values = (s: string) => process.argv.flatMap((x, i) => (x === `--${s}` ? [process.argv[i + 1]!] : []));
const baselinePath = values('baseline')[0],
  out = values('out')[0];
const candidatePaths = values('candidate');
if (!baselinePath || !out || !candidatePaths.length)
  throw new Error('--baseline, --candidate and --out required');
const bench = await loadBenchmark('longjudge-wp');
const full = bench.items.filter((x): x is PairItem => x.kind === 'pair' && splitOf(bench.id, x.id) === 'dev');
const pilot = new Set(stratifiedSample(full, 10, 'wp-cost-pilot').map(writingRowKey));
const source = new Map(full.map((x) => [writingRowKey(x), x]));
const pilotIds = new Set(full.filter((x) => pilot.has(writingRowKey(x))).map((x) => x.id));
const validationIds = new Set(full.filter((x) => !pilot.has(writingRowKey(x))).map((x) => x.id));
const measure = async (path: string) => {
  const report = JSON.parse(await readFile(path, 'utf8')) as Report;
  if (
    report.split !== 'dev' ||
    report.pilot ||
    report.stopped ||
    report.items !== 90 ||
    report.results.length !== 90
  )
    throw new Error(`Expected complete full DEV report: ${path}`);
  const keys = new Set(report.results.map((x) => x.rowKey));
  if (keys.size !== source.size || report.results.some((x) => x.label !== source.get(x.rowKey)?.label))
    throw new Error(`DEV rows or labels do not match the actual source: ${path}`);
  const describe = (rows: typeof report.results) => ({
    ...writingAccuracy(rows),
    perOrder: [0, 1].map((i) => writingAccuracy(rows.map((r) => ({ ...r, games: [r.games[i] ?? 'tie'] })))),
    byGroup: Object.fromEntries(
      [...new Set(rows.map((x) => x.group))].map((g) => [
        g,
        writingAccuracy(rows.filter((x) => x.group === g)),
      ]),
    ),
    interval95: writingInterval(rows),
  });
  return {
    path,
    variant: report.selectedVariant ?? report.variant,
    costPer100: report.costPer100,
    full90: describe(report.results),
    tunedPilot10: describe(report.results.filter((r) => pilot.has(r.rowKey))),
    validation80: describe(report.results.filter((r) => !pilot.has(r.rowKey))),
  };
};
const baseline = await measure(baselinePath),
  candidates = [];
for (const path of candidatePaths) candidates.push(await measure(path));
const ranked = [baseline, ...candidates].sort(
  (a, b) => b.validation80.accuracy - a.validation80.accuracy || a.costPer100 - b.costPer100,
);
const report = {
  split: 'dev',
  pilotRowKeys: [...pilot],
  partition: {
    pilotPairs: 10,
    validationPairs: 80,
    pilotPromptIds: pilotIds.size,
    validationPromptIds: validationIds.size,
    sharedPromptIds: [...pilotIds].filter((id) => validationIds.has(id)).length,
  },
  rule: 'Freeze selection uses accuracy on the 80 pairs outside the ten-pair tuning pilot; exact ties prefer lower full-recipe cost. The 80 are DEV, not an untouched TEST set.',
  costScope:
    'Cost per 100 is the complete 90-pair recipe, including shared request extraction where applicable.',
  baseline,
  candidates,
  selection: {
    variant: ranked[0]!.variant,
    path: ranked[0]!.path,
    validationAccuracy: ranked[0]!.validation80.accuracy,
  },
};
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
