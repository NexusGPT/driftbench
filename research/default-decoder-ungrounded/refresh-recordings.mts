// Replay an additional frozen recording snapshot without making any model calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseJudgeText } from '../../packages/judges/src/assessment.ts';

globalThis.fetch = async () => {
  throw new Error('Offline replay only');
};
const input = process.argv[2];
assert(input, 'Supply the path to a frozen recorded-inputs gzip file');
const bytes = readFileSync(input);
const data = JSON.parse(gunzipSync(bytes).toString());
const rows = data.rows.map((row: any) => {
  const read = (version: 1 | 2) => {
    if (row.transportError) return 'inconclusive';
    const result = parseJudgeText(row.raw, { ...row.request, criterionDecoderVersion: version });
    return result.unparsed ? (row.set.startsWith('bench-') ? 'inconclusive' : null) : result.answer.outcome;
  };
  const before = read(1);
  assert.equal(before, row.baseline, `${row.set}/${row.id}`);
  return { ...row, baseline: before, candidate: read(2) };
});
const summaries = data.summaries.map((summary: any) => {
  if (!summary.total) return summary;
  const set = rows.filter((r: any) => r.set === summary.set);
  return {
    ...summary,
    baselineCorrect: set.filter((r: any) => r.baseline === r.truth).length,
    candidateCorrect: set.filter((r: any) => r.candidate === r.truth).length,
    fixes: set.filter((r: any) => r.baseline !== r.truth && r.candidate === r.truth).length,
    breaks: set.filter((r: any) => r.baseline === r.truth && r.candidate !== r.truth).length,
    changed: set.filter((r: any) => r.baseline !== r.candidate).length,
  };
});
const fixture = {
  ...data,
  rows,
  summaries,
  snapshotSha256: createHash('sha256').update(bytes).digest('hex'),
};
writeFileSync(
  resolve(import.meta.dirname, '../../packages/judges/test/fixtures/criterion-decoder-recordings.json.gz'),
  gzipSync(JSON.stringify(fixture)),
);
const report = {
  measuredAt: new Date().toISOString(),
  packageBase: data.base,
  recordingCommit: data.recordingCommit,
  snapshotSha256: fixture.snapshotSha256,
  modelCalls: 0,
  costUsd: 0,
  sourceHashes: data.hashes,
  summaries,
  rows: rows.map(({ request, raw, ...row }: any) => row),
};
writeFileSync(resolve(import.meta.dirname, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
// Persist break items for investigation before failing the gate.
assert(summaries.every((s: any) => s.breaks === 0 || s.breaks === null));
console.log(
  JSON.stringify(
    summaries.filter((s: any) => s.total),
    null,
    2,
  ),
);
