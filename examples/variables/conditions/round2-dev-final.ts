/** DEV-only measurement through the exact configuration intended for the final freeze. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyRecording, feedFromConditions, recordConditions } from '../../../packages/generate/src';
import { type Clause, loadStore, score, textsOf, unitsOf } from './lib';
import { primaryScore, type PlantedRow } from './primary-score';
import { round2Options, round2Systems } from './round2';
import { liveRound2 } from './round2-live';

const here = new URL('.', import.meta.url).pathname;
const output = join(here, 'round2-dev-' + (process.argv[2] ?? 'selected') + '.json');
const budgetFile = process.env.CONDITIONS_BUDGET_FILE;
if (!budgetFile) throw new Error('CONDITIONS_BUDGET_FILE is required');
if (existsSync(output) || existsSync(output + '.receipts.jsonl')) throw new Error('DEV recording already exists');
const units = unitsOf(JSON.parse(readFileSync(join(here, 'dev-clauses.json'), 'utf8')) as Clause[]);
const gold: PlantedRow[] = units.map((u) => {
  const conditions = u.truths.filter((t) => t !== 'none');
  return { id: u.id, kind: conditions.length === 0 ? 'none' : conditions.some((c) => c.value === 'NEW') ? 'new' : 'existing', conditions };
});
const store = loadStore();
const candidates = new Set(store.variables.flatMap((v) => v.values.map((x) => v.id + '/' + x.id)));
const live = liveRound2(budgetFile, output + '.receipts.jsonl', 'DEV:' + process.argv[2]);
const { reader, proposer } = round2Systems(live.judge, live.port, units);
const recording = emptyRecording();
const result = await feedFromConditions({
  store, spans: units, texts: textsOf(units),
  ...recordConditions(recording, reader, proposer), options: round2Options,
});
const measured = primaryScore(gold, result.report.outcomes, candidates);
const evidence = { recording, ...result, score: measured, diagnostics: score(units, result).wrong, ...live.totals() };
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ score: measured, diagnostics: evidence.diagnostics, ...live.totals() }));
