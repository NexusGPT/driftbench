/**
 * Finish only failed spans of model-heldout-2.json under the identical reader, prompts and settings.
 * Existing successful outcomes are retained. No expected labels reach either model.
 * Price source (checked 2026-10-21): https://platform.claude.com/docs/en/about-claude/pricing
 * claude-sonnet-5-5 standard/global: $2/M input, $10/M output; no caching used.
 */
import { createHash } from 'node:crypto';
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
import { type Clause, score, textsOf, unitsOf } from './lib';

const here = new URL('.', import.meta.url).pathname;
const read = (name: string) => JSON.parse(readFileSync(join(here, name), 'utf8'));
const partial = read('model-heldout-2.json');
const freeze = read('model-freeze.json');
const output = join(here, 'model-heldout-2-completed.json');
if (existsSync(output) || existsSync(output + '.receipts.json'))
  throw new Error('continuation already started');
for (const [file, hash] of Object.entries(freeze.hashes)) {
  if (file === 'settings') continue;
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (actual !== hash) throw new Error('frozen implementation changed: ' + file);
}
const settings = {
  model: 'claude-sonnet-5-5',
  maxRetries: 0,
  options: { newVariables: false },
  proposer: { scope: 'existing', listing: 'titles' },
};
const canonical = (x: unknown): unknown =>
  x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(
        Object.entries(x)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, v]) => [k, canonical(v)]),
      )
    : x;
const settingsHash = createHash('sha256')
  .update(JSON.stringify(canonical(settings)))
  .digest('hex');
if (settingsHash !== freeze.hashes.settings) throw new Error('frozen settings changed');
const clauses = read('heldout-clauses-2.json') as Clause[];
const units = unitsOf(clauses);
const failed = new Set<string>(
  partial.report.outcomes
    .filter((o: { status: string }) => o.status === 'failed')
    .map((o: { span: string }) => o.span),
);
const remaining = units.filter((unit) => failed.has(unit.id));
if (remaining.length !== 32) throw new Error('expected precisely 32 failed spans');
const receipts: unknown[] = [];
let spentUsd = freeze.totalUsdBeforeContinuation;
let inputTokens = 0;
let outputTokens = 0;
const port = createAnthropicPort({
  env: {
    ANTHROPIC_MODEL: settings.model,
    ANTHROPIC_API_KEY: readFileSync(
      join(homedir(), '.nexus-secrets/anthropic-driftbench.key'),
      'utf8',
    ).trim(),
  },
  maxRetries: settings.maxRetries,
  fetch: async (url, init) => {
    if (spentUsd > 7.95) throw new Error('USD 8 lane cap');
    const response = await fetch(url, init);
    const payload = await response.clone().json();
    const usage = payload.usage;
    if (!response.ok || typeof usage?.input_tokens !== 'number' || typeof usage?.output_tokens !== 'number') {
      spentUsd = 8;
      throw new Error('response missing billable usage; stop');
    }
    if (usage.cache_creation_input_tokens || usage.cache_read_input_tokens) {
      spentUsd = 8;
      throw new Error('unexpected cache pricing; stop');
    }
    inputTokens += usage.input_tokens;
    outputTokens += usage.output_tokens;
    const costUsd = (usage.input_tokens * 2 + usage.output_tokens * 10) / 1e6;
    spentUsd += costUsd;
    receipts.push({ id: payload.id, model: payload.model, usage, costUsd, content: payload.content });
    writeFileSync(
      output + '.receipts.json',
      JSON.stringify({ spentUsd, inputTokens, outputTokens, receipts }, null, 2) + '\n',
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
const continuation = await feedFromConditions({
  store: partial.store,
  spans: remaining.map(({ id, path, quote }) => ({ id, path, quote })),
  texts: textsOf(units),
  ...systems,
  options: settings.options,
});
const finished = new Map(continuation.report.outcomes.map((o) => [o.span, o]));
const outcomes = partial.report.outcomes.map((o: { span: string }) => finished.get(o.span) ?? o);
const report = {
  ...partial.report,
  outcomes,
  proposerCalls: partial.report.proposerCalls + continuation.report.proposerCalls,
};
for (const status of ['matched', 'proposed', 'unsure', 'unmatched', 'refused', 'failed']) {
  report[status] = outcomes.filter((o: { status: string }) => o.status === status).length;
}
const result = { store: continuation.store, report };
const measured = score(units, result);
const evidence = {
  partial: 'model-heldout-2.json',
  continuation: {
    recording,
    report: continuation.report,
    store: continuation.store,
    spans: remaining.map((s) => s.id),
  },
  model: port.model,
  settingsHash,
  hashes: freeze.hashes,
  options: settings.options,
  report,
  store: result.store,
  counts: measured,
  precision: measured.correct / measured.assigned,
  recall: measured.correct / measured.planted,
  receipts: {
    inputTokens,
    outputTokens,
    continuationUsd: spentUsd - freeze.totalUsdBeforeContinuation,
    totalLaneUsd: spentUsd,
  },
};
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(
  JSON.stringify({
    counts: measured,
    precision: evidence.precision,
    recall: evidence.recall,
    failed: report.failed,
    ...evidence.receipts,
  }),
);
