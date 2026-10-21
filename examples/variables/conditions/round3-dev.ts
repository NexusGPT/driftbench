/** Live DEV only. The original and independently authored extension use separate seed stores. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyRecording, feedFromConditions, recordConditions } from '../../../packages/generate/src';
import { type Clause, loadStore, score, textsOf, unitsOf } from './lib';
import { type PlantedRow, primaryScore, type ScoredOutcome } from './primary-score';
import { round2Options, round2Systems } from './round2';
import { liveRound2 } from './round2-live';

const here = new URL('.', import.meta.url).pathname;
const tag = process.argv[2] ?? 'baseline';
const threshold = Number(process.argv[3] ?? 0.5);
if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 0.95) throw new Error('invalid DEV threshold');
const output = join(here, 'round3-dev-' + tag + '.json');
const budgetFile = process.env.CONDITIONS_BUDGET_FILE;
if (!budgetFile) throw new Error('CONDITIONS_BUDGET_FILE is required');
if (existsSync(output) || existsSync(output + '.receipts.jsonl')) throw new Error('DEV experiment exists');
const live = liveRound2(budgetFile, output + '.receipts.jsonl', 'DEV-round3:' + tag);
const batches = [];
const gold: PlantedRow[] = [];
const outcomes: ScoredOutcome[] = [];
const seed = loadStore();
const known = new Set(seed.variables.flatMap((v) => v.values.map((x) => v.id + '/' + x.id)));
for (const file of ['dev-clauses.json', 'round3-dev-clauses.json']) {
  const units = unitsOf(JSON.parse(readFileSync(join(here, file), 'utf8')) as Clause[]);
  const spans = units.map(({ id, path, quote }) => ({ id, path, quote }));
  const texts = textsOf(units);
  const { reader, proposer } = round2Systems(live.judge, live.port, spans);
  const recording = emptyRecording();
  const options = { ...round2Options, decide: { yesAt: threshold, noAt: threshold } };
  const result = await feedFromConditions({
    store: seed, spans, texts,
    ...recordConditions(recording, reader, proposer), options,
  });
  for (const unit of units) {
    const conditions = unit.truths.filter((t) => t !== 'none');
    gold.push({ id: unit.id, kind: conditions.length === 0 ? 'none' : conditions.some((c) => c.value === 'NEW') ? 'new' : 'existing', conditions });
  }
  outcomes.push(...result.report.outcomes);
  batches.push({ file, spans, texts: Object.fromEntries(texts), initialStore: seed, recording, ...result,
    diagnostics: score(units, result).wrong });
}
const measured = primaryScore(gold, outcomes, known);
const evidence = { tag, threshold, batches, score: measured, ...live.totals() };
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ tag, threshold, score: measured, diagnostics: batches.map((b) => ({ file: b.file, wrong: b.diagnostics })), ...live.totals() }));
