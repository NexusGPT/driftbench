/**
 * The long-structured setting on the recorded PR 351 writing TEST: the recorded driftbench pair-ledger
 * verdicts (research/ledger-wp results/decisions.jsonl, TEST) with the setting applied in code, per model.
 * No model call. Writes the Haiku games file and the chart data file.
 *
 *   npx tsx examples/writing-heldout/replay_test.ts <ledger-wp seals/test.json> <ledger-wp results/decisions.jsonl>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLongStructured } from '../../packages/judges/src/long-structured';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = ['haiku', 'gpt-6-luna', 'gemini-3.5-flash-lite'];
const [testPath, decisionsPath] = process.argv.slice(2) as [string, string];
const items = new Map<string, any>(JSON.parse(readFileSync(testPath, 'utf8')).map((x: any) => [x.id, x]));
const games = new Map(MODELS.map((m) => [m, {} as Record<string, string[]>]));
const rules = new Map(MODELS.map((m) => [m, {} as Record<string, number>]));
for (const line of readFileSync(decisionsPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (row.split !== 'test' || !MODELS.includes(row.model) || row.contestant !== 'pair-ledger') continue;
  const item = items.get(row.id);
  const result = applyLongStructured(item.a, item.b, row.details.verdict, item.language);
  const g = result.choice === 'first' ? 'A' : result.choice === 'second' ? 'B' : 'tie';
  (games.get(row.model) as Record<string, string[]>)[row.id] = [g, g];
  const r = rules.get(row.model) as Record<string, number>;
  r[result.ruleId] = (r[result.ruleId] ?? 0) + 1;
}
const cells = MODELS.map((model) => {
  const g = games.get(model) as Record<string, string[]>;
  if (Object.keys(g).length !== items.size)
    throw new Error(`${model}: replayed ${Object.keys(g).length} of ${items.size}`);
  const correct = [...items.values()].reduce(
    (n, x) => n + (g[x.id] ?? []).filter((v) => v === x.label).length,
    0,
  );
  return {
    model,
    contestant: 'pair-ledger',
    setting: 'long-structured',
    status: 'complete',
    pairs: items.size,
    correct,
    accuracy: (100 * correct) / (2 * items.size),
    rules: rules.get(model),
  };
});
writeFileSync(
  resolve(HERE, 'results/test/driftbench-long-structured.json'),
  `${JSON.stringify(games.get('haiku'), null, 0)}\n`,
);
writeFileSync(
  resolve(HERE, '../../docs/assets/data/sealed/writing-long-structured.json'),
  `${JSON.stringify({ source: 'examples/writing-heldout/replay_test.ts on research/ledger-wp 110c2fec TEST pair-ledger verdicts; no model call', setting: "judgePairLedger(..., { preference: 'long-structured' })", cells }, null, 2)}\n`,
);
console.log(JSON.stringify(cells.map((c) => [c.model, c.correct, c.accuracy.toFixed(2), c.rules])));
