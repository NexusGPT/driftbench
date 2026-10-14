/**
 * The long-structured setting on the recorded PR 351 writing TEST: the recorded driftbench pair-ledger
 * verdicts (research/ledger-wp results/decisions.jsonl, Haiku, TEST) with the setting applied in code.
 * No model call.
 *
 *   npx tsx examples/writing-heldout/replay_test.ts <ledger-wp seals/test.json> <ledger-wp results/decisions.jsonl> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { applyLongStructured } from '../../packages/judges/src/long-structured';

const [testPath, decisionsPath, out] = process.argv.slice(2) as [string, string, string];
const items = new Map(JSON.parse(readFileSync(testPath, 'utf8')).map((x: any) => [x.id, x]));
const games: Record<string, string[]> = {};
const rules: Record<string, number> = {};
for (const line of readFileSync(decisionsPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (row.split !== 'test' || row.model !== 'haiku' || row.contestant !== 'pair-ledger') continue;
  const item: any = items.get(row.id);
  const result = applyLongStructured(item.a, item.b, row.details.verdict, item.language);
  const g = result.choice === 'first' ? 'A' : result.choice === 'second' ? 'B' : 'tie';
  games[row.id] = [g, g];
  rules[result.ruleId] = (rules[result.ruleId] ?? 0) + 1;
}
if (Object.keys(games).length !== items.size)
  throw new Error(`replayed ${Object.keys(games).length} of ${items.size}`);
writeFileSync(out, `${JSON.stringify(games)}\n`);
console.log(JSON.stringify(rules));
