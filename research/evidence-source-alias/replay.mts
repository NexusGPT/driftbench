import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseJudgeText } from '../../packages/judges/src/assessment.ts';
import { requestKey } from '../../packages/judges/src/cassette.ts';

globalThis.fetch = async () => {
  throw new Error('No network in recorded replay');
};
const root = resolve(import.meta.dirname, '../..');
const source = resolve(root, 'packages/judges/src');
const output = resolve(import.meta.dirname, 'generated');
mkdirSync(output, { recursive: true });
const base = '54b0f9046da2171314d742bcdbfa743f7fd53206';
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const hashes: Record<string, string> = {};
for (const file of ['assessment', 'criterion-ledger', 'evidence']) {
  const original = execFileSync('git', ['show', `${base}:packages/judges/src/${file}.ts`], {
    cwd: root,
    encoding: 'utf8',
  });
  hashes[`base/${file}.ts`] = sha(original);
  const text = original
    .replace(
      /from '(\.\/[^']+)'/g,
      (_, name) =>
        `from '${pathToFileURL(resolve(['./criterion-ledger', './evidence'].includes(name) ? output : source, `${name}.ts`)).href}'`,
    )
    .replace(
      "from 'zod'",
      `from '${pathToFileURL(createRequire(resolve(source, 'contract.ts')).resolve('zod')).href}'`,
    );
  writeFileSync(resolve(output, `${file}.ts`), text);
}
const { parseJudgeText: baseline } = await import(pathToFileURL(resolve(output, 'assessment.ts')).href);
const donor = resolve(root, 'packages/judges/test/fixtures/criterion-decoder-recordings.json.gz');
const donorBytes = readFileSync(donor);
hashes['decoder-pr/criterion-decoder-recordings.json.gz'] = sha(donorBytes);
const donorData = JSON.parse(gunzipSync(donorBytes).toString());
const inputs: any[] = donorData.rows.filter((row: any) => !row.set.startsWith('bench-current/'));
const summaries: any[] = donorData.summaries.filter((s: any) => !s.set.startsWith('bench-current/'));
// Pin a committed recording set, never a concurrently changing benchmark worktree.
const recordingCommit = execFileSync('git', ['rev-parse', process.argv[2] ?? 'origin/feat/bench-frame'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const recordedFiles = new Set(
  execFileSync('git', ['ls-tree', '-r', '--name-only', recordingCommit, 'benchmarks'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n'),
);
function read(path: string) {
  const bytes = execFileSync('git', ['show', `${recordingCommit}:${path}`], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });
  hashes[`bench-frame/${path}`] = sha(bytes);
  return JSON.parse(bytes.toString());
}
const registry = read('benchmarks/manifest.json');
assert.equal(registry.slices.length, 14);
assert.equal(
  registry.slices.reduce((sum: number, slice: any) => sum + slice.n, 0),
  1798,
);
for (const slice of registry.slices) {
  const cases = read(`${slice.path}/cases.spec.json`).metadata.bench;
  assert.equal(cases.length, slice.n);
  for (const model of registry.models) {
    const set = `bench-current/${slice.name}/${model.id}`;
    const path = `benchmarks/cassettes/${slice.name}@${slice.version}/${model.id}.json`;
    if (!recordedFiles.has(path)) {
      assert.equal(model.id, 'gemini-3.8-flash', `Missing required recording ${set}`);
      summaries.push({
        set,
        total: 0,
        planned: slice.n,
        status: 'dropped by the owner',
        fixes: null,
        breaks: null,
      });
      continue;
    }
    const cassette = read(path);
    const evidence = read(`benchmarks/evidence/${slice.name}@${slice.version}/${model.id}.json`);
    const stamp = evidence.report ?? evidence;
    assert.equal(stamp.datasetHash, slice.hash);
    assert.equal(stamp.fingerprint, '398673b792c1');
    assert.equal(stamp.n, slice.n);
    assert.equal(cassette.entries.length, slice.n);
    assert.equal(stamp.results.length, slice.n);
    assert.equal(evidence.cassetteSha256, hashes[`bench-frame/${path}`]);
    const outcomes = new Map<string, any>(stamp.results.map((result: any) => [result.id, result]));
    assert.equal(outcomes.size, slice.n);
    const judge = cassette.judges.find((r: any) => r.id === model.id);
    assert(judge, `Missing judge ${set}`);
    const byKey = new Map<string, any[]>();
    for (const item of cases) {
      // These recordings predate decoder version 2; the key uses strict version 1.
      const key = requestKey({ ...item.request, criterionDecoderVersion: 1 }, judge, stamp.fingerprint);
      byKey.set(key, [...(byKey.get(key) ?? []), item]);
    }
    for (const entry of cassette.entries) {
      const item = byKey.get(entry.key)?.shift();
      assert(item, `Missing request ${set}/${entry.key}`);
      assert.equal(outcomes.get(item.id)?.expected, item.expected);
      inputs.push({
        set,
        id: item.id,
        truth: item.expected,
        request: item.request,
        raw: entry.raw,
        recordedOutcome: outcomes.get(item.id).outcome,
        transportError: entry.error !== undefined || entry.note === 'bench:transport-unparsed',
      });
    }
    assert([...byKey.values()].every((items) => items.length === 0));
    summaries.push({
      set,
      total: cassette.entries.length,
      planned: slice.n,
      status: 'recorded',
      recordedFingerprint: stamp.fingerprint,
      recordedCorrect: stamp.correct,
    });
  }
}
function verdict(result: any, set: string) {
  return result.unparsed ? (set.startsWith('bench-') ? 'inconclusive' : null) : result.answer.outcome;
}
const rows = inputs.map((row) => {
  // Isolate aliasing even if the independent decoder PR later merges into main.
  const request = { ...row.request, criterionDecoderVersion: 1 as const };
  const before = row.transportError ? 'inconclusive' : verdict(baseline(row.raw, request), row.set);
  const after = row.transportError ? 'inconclusive' : verdict(parseJudgeText(row.raw, request), row.set);
  if (row.baseline !== undefined) assert.equal(before, row.baseline, `${row.set}/${row.id}`);
  if (row.recordedOutcome !== undefined) assert.equal(before, row.recordedOutcome, `${row.set}/${row.id}`);
  return { ...row, baseline: before, candidate: after };
});
const measured = summaries.map((summary) => {
  if (!summary.total) return summary;
  const setRows = rows.filter((row) => row.set === summary.set);
  assert.equal(setRows.length, summary.total);
  if (summary.recordedCorrect !== undefined)
    assert.equal(setRows.filter((row) => row.baseline === row.truth).length, summary.recordedCorrect);
  return {
    set: summary.set,
    total: setRows.length,
    planned: summary.planned ?? setRows.length,
    status: summary.status ?? 'recorded',
    recordedFingerprint: summary.recordedFingerprint,
    baselineCorrect: setRows.filter((row) => row.baseline === row.truth).length,
    candidateCorrect: setRows.filter((row) => row.candidate === row.truth).length,
    fixes: setRows.filter((row) => row.baseline !== row.truth && row.candidate === row.truth).length,
    breaks: setRows.filter((row) => row.baseline === row.truth && row.candidate !== row.truth).length,
    changed: setRows.filter((row) => row.baseline !== row.candidate).length,
    transportErrors: setRows.filter((row) => row.transportError).length,
  };
});
const report = {
  measuredAt: new Date().toISOString(),
  base,
  recordingCommit,
  modelCalls: 0,
  costUsd: 0,
  hashes,
  summaries: measured,
  rows: rows.map(({ request, raw, ...row }) => row),
};
writeFileSync(resolve(import.meta.dirname, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(
  resolve(source, '../test/fixtures/evidence-source-alias-recordings.json.gz'),
  gzipSync(
    JSON.stringify({
      base,
      recordingCommit,
      hashes,
      summaries: measured,
      rows,
    }),
  ),
);
// Persist break items for investigation before failing the gate.
assert(measured.every((s) => s.breaks === 0 || s.breaks === null));
console.log(
  JSON.stringify(
    measured.filter((s) => s.total),
    null,
    2,
  ),
);
