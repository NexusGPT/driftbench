import { readFile, writeFile } from 'node:fs/promises';
import { resolveReaderFirst } from '../../../packages/judges/src/reader-first';

const report = JSON.parse(await readFile('comparisons/reader-first/results/explore.json', 'utf8'));
if (!report.complete || report.split !== 'dev' || report.completedPairs !== 90)
  throw new Error('Complete DEV required');
const combined = [];
for (const judgeMargin of [2, 3, 4, 5, 6, 8, 10])
  for (const minFailures of [1, 2, 3]) {
    const rows = report.rows.map((row: any) => ({
      ...row,
      result: resolveReaderFirst(row.machine.A, row.machine.B, row.ordered, row.swapped, {
        configuration: 'reader-first',
        judgeMargin,
        minFailures,
      }),
    }));
    const gained = rows
      .filter((r: any) => r.result.choice === r.label && r.result.length !== r.label)
      .map((r: any) => r.id);
    const lost = rows
      .filter((r: any) => r.result.choice !== r.label && r.result.length === r.label)
      .map((r: any) => r.id);
    combined.push({
      judgeMargin,
      minFailures,
      correct: 2 * rows.filter((r: any) => r.result.choice === r.label).length,
      overrides: rows.filter((r: any) => r.result.override).length,
      gained,
      lost,
    });
  }
const features = [];
for (const featureMargin of [1, 2, 3, 4, 5]) {
  const rows = report.rows.map((r: any) => ({
    ...r,
    result: resolveReaderFirst(r.machine.A, r.machine.B, r.ordered, r.swapped, {
      configuration: 'reader-first',
      featureMargin,
    }),
  }));
  features.push({
    featureMargin,
    correct: 2 * rows.filter((r: any) => r.result.features === r.label).length,
    overrides: rows.filter((r: any) => r.result.features !== r.result.length).length,
    gained: rows
      .filter((r: any) => r.result.features === r.label && r.result.length !== r.label)
      .map((r: any) => r.id),
    lost: rows
      .filter((r: any) => r.result.features !== r.label && r.result.length === r.label)
      .map((r: any) => r.id),
  });
}
combined.sort(
  (a, b) =>
    b.correct - a.correct ||
    a.overrides - b.overrides ||
    b.judgeMargin - a.judgeMargin ||
    b.minFailures - a.minFailures,
);
features.sort((a, b) => b.correct - a.correct || b.featureMargin - a.featureMargin);
const output = {
  selectionSplit: 'dev',
  selected: { ...combined[0], featureMargin: features[0]!.featureMargin },
  combined,
  features,
};
await writeFile('comparisons/reader-first/results/dev-search.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
