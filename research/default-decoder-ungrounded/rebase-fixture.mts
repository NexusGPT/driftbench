// Re-read the committed frozen fixture against the current package decoders, without any model calls.
// Use after main changes the strict decoder: the raw answers stay fixed, only the decoded outcomes move.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseJudgeText } from '../../packages/judges/src/assessment.ts';
import type { JudgeRequest } from '../../packages/judges/src/contract.ts';

globalThis.fetch = async () => {
  throw new Error('Offline replay only');
};
const path = resolve(
  import.meta.dirname,
  '../../packages/judges/test/fixtures/criterion-decoder-recordings.json.gz',
);
type Outcome = string | null;
type Row = {
  set: string;
  id: string;
  truth: string;
  request: JudgeRequest;
  raw: string;
  baseline: Outcome;
  candidate: Outcome;
  transportError?: boolean;
};
type Summary = { set: string; total: number; [field: string]: unknown };
const data = JSON.parse(gunzipSync(readFileSync(path)).toString()) as { rows: Row[]; summaries: Summary[] };
const moved: { set: string; id: string; truth: string; was: Outcome; now: Outcome }[] = [];
const rows = data.rows.map((row) => {
  const read = (version: 1 | 2) => {
    if (row.transportError) return 'inconclusive';
    const result = parseJudgeText(row.raw, { ...row.request, criterionDecoderVersion: version });
    return result.unparsed ? (row.set.startsWith('bench-') ? 'inconclusive' : null) : result.answer.outcome;
  };
  const baseline = read(1);
  if (baseline !== row.baseline)
    moved.push({ set: row.set, id: row.id, truth: row.truth, was: row.baseline, now: baseline });
  return { ...row, baseline, candidate: read(2) };
});
const summaries = data.summaries.map((summary) => {
  if (!summary.total) return summary;
  const set = rows.filter((r) => r.set === summary.set);
  return {
    ...summary,
    baselineCorrect: set.filter((r) => r.baseline === r.truth).length,
    candidateCorrect: set.filter((r) => r.candidate === r.truth).length,
    fixes: set.filter((r) => r.baseline !== r.truth && r.candidate === r.truth).length,
    breaks: set.filter((r) => r.baseline === r.truth && r.candidate !== r.truth).length,
    changed: set.filter((r) => r.baseline !== r.candidate).length,
  };
});
const base = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync(path, gzipSync(JSON.stringify({ ...data, base, rows, summaries })));
const resultsPath = resolve(import.meta.dirname, 'results.json');
const previous = JSON.parse(readFileSync(resultsPath, 'utf8'));
const report = {
  ...previous,
  measuredAt: new Date().toISOString(),
  packageBase: base,
  modelCalls: 0,
  costUsd: 0,
  // Keep moves found by earlier runs; a rerun on an already rebased fixture finds none.
  baselineMovedOnMain: [...(previous.baselineMovedOnMain ?? []), ...moved],
  summaries,
  rows: rows.map(({ request, raw, ...row }) => row),
};
writeFileSync(resultsPath, `${JSON.stringify(report, null, 2)}\n`);
assert(summaries.every((s) => s.breaks === 0 || s.breaks === null));
console.log(
  JSON.stringify({ base, moved: moved.length, sets: [...new Set(moved.map((m) => m.set))] }, null, 2),
);
