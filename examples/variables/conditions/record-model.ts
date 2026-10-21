/**
 * Model-bound recording, never a local test. Develop with dev-clauses.json; record the sealed batch once.
 * Usage: pnpm exec tsx examples/variables/conditions/record-model.ts <clauses.json> <output.json>
 * Truth labels are used only by score(), after all model calls have finished. Neither system receives them.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createAnthropicPort,
  createConditionReader,
  createModelProposer,
  emptyRecording,
  feedFromConditions,
  recordConditions,
} from '../../../packages/generate/src';
import { type Clause, loadStore, score, textsOf, unitsOf } from './lib';

const [input, output] = process.argv.slice(2);
if (!input || !output || existsSync(output) || existsSync(`${output}.receipts.json`)) {
  throw new Error('give input and a NEW recording output');
}
const allClauses = JSON.parse(readFileSync(input, 'utf8')) as Clause[];
const clauses = process.env.PROBE_FIRST === '1' ? allClauses.slice(0, 1) : allClauses;
const units = unitsOf(clauses);
const texts = textsOf(units);
const receipts: unknown[] = [];
const spentBefore = Number(process.env.SPENT_BEFORE ?? 0);
if (!Number.isFinite(spentBefore) || spentBefore < 0 || spentBefore > 8) {
  throw new Error('SPENT_BEFORE must be a finite lane spend from 0 to 8');
}
let capCharge = spentBefore;
let reportedUsd = 0;
let missingCost = 0;
const key = readFileSync(join(homedir(), '.nexus-secrets/anthropic-driftbench.key'), 'utf8').trim();
const port = createAnthropicPort({
  env: { ANTHROPIC_API_KEY: key, ANTHROPIC_MODEL: 'claude-sonnet-5-5' },
  maxRetries: 0,
  fetch: async (url, init) => {
    // Sonnet 5.5 list prices, checked 2026-10-21:
    // https://platform.claude.com/docs/en/about-claude/pricing ($2/M input, $10/M output).
    if (capCharge > 7.95) throw new Error('live budget reserve exhausted');
    const response = await fetch(url, init);
    const payload = await response.clone().json();
    const usage = payload.usage ?? {};
    const cost = payload.cost_usd ?? payload.total_cost_usd ?? usage.cost_usd ?? usage.total_cost_usd;
    const tokens =
      (Number(usage.input_tokens ?? 0) * 2) / 1e6 + (Number(usage.output_tokens ?? 0) * 10) / 1e6;
    if (typeof cost === 'number') reportedUsd += cost;
    else missingCost++;
    capCharge += typeof cost === 'number' ? cost : tokens;
    receipts.push({
      id: payload.id,
      model: payload.model,
      usage,
      costUsd: cost ?? null,
      content: payload.content,
    });
    writeFileSync(
      output + '.receipts.json',
      JSON.stringify({ reportedUsd, missingCost, capCharge, receipts }, null, 2) + '\n',
    );
    return response;
  },
});
const recording = emptyRecording();
const systems = recordConditions(
  recording,
  createConditionReader(port),
  createModelProposer(port, {
    scope: 'existing',
    listing: 'titles',
  }),
);
const result = await feedFromConditions({
  store: loadStore(),
  spans: units.map(({ id, path, quote }) => ({ id, path, quote })),
  texts,
  ...systems,
  options: { newVariables: false },
});
const measured = score(units, result);
const evidence = {
  recording,
  model: port.model,
  options: { newVariables: false },
  counts: measured,
  precision: measured.correct / measured.assigned,
  recall: measured.correct / measured.planted,
  report: result.report,
  store: result.store,
  receipts: { reportedUsd, missingCost, capCharge },
};
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(
  JSON.stringify({
    counts: measured,
    precision: evidence.precision,
    recall: evidence.recall,
    failed: result.report.failed,
    ...evidence.receipts,
  }),
);
