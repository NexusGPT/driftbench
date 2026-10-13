import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const donor = resolve(
  root,
  '../default-decoder-ungrounded/packages/judges/test/fixtures/criterion-decoder-recordings.json.gz',
);
const donorBytes = readFileSync(donor);
hashes['decoder-pr/criterion-decoder-recordings.json.gz'] = sha(donorBytes);
const donorData = JSON.parse(gunzipSync(donorBytes).toString());
const inputs: any[] = donorData.rows.filter((row: any) => !row.set.startsWith('bench-current/'));
const summaries: any[] = donorData.summaries.filter((s: any) => !s.set.startsWith('bench-current/'));
const bench = resolve(root, '../bench-frame');
function read(path: string) {
  const bytes = readFileSync(path);
  hashes[path.replace(`${bench}/`, 'bench-frame/')] = sha(bytes);
  return JSON.parse(bytes.toString());
}
const registry = read(resolve(bench, 'benchmarks/manifest.json'));
for (const slice of registry.slices) {
  const cases = read(resolve(bench, slice.path, 'cases.spec.json')).metadata.bench;
  for (const model of registry.models) {
    const set = `bench-current/${slice.name}/${model.id}`;
    const path = resolve(bench, 'benchmarks/cassettes', `${slice.name}@${slice.version}`, `${model.id}.json`);
    const partial = !existsSync(path);
    const selected = partial ? `${path}.partial.json` : path;
    if (!existsSync(selected)) {
      summaries.push({ set, total: 0, planned: slice.n, status: 'not recorded', fixes: null, breaks: null });
      continue;
    }
    const cassette = read(selected);
    const evidence = read(
      resolve(
        bench,
        'benchmarks/evidence',
        `${slice.name}@${slice.version}`,
        `${model.id}.json${partial ? '.partial.json' : ''}`,
      ),
    );
    const stamp = evidence.report ?? evidence;
    assert.equal(stamp.datasetHash, slice.hash);
    if (!partial) assert.equal(evidence.cassetteSha256, sha(readFileSync(selected)));
    const judge = cassette.judges.find((r: any) => r.id === model.id);
    const byKey = new Map<string, any[]>();
    for (const item of cases) {
      const key = requestKey(item.request, judge, stamp.fingerprint);
      byKey.set(key, [...(byKey.get(key) ?? []), item]);
    }
    for (const entry of cassette.entries) {
      const item = byKey.get(entry.key)?.shift();
      assert(item, `Missing request ${set}/${entry.key}`);
      inputs.push({
        set,
        id: item.id,
        truth: item.expected,
        request: item.request,
        raw: entry.raw,
        transportError: entry.error !== undefined || entry.note === 'bench:transport-unparsed',
      });
    }
    summaries.push({
      set,
      total: cassette.entries.length,
      planned: slice.n,
      status: partial ? 'partial recording' : 'recorded',
      recordedFingerprint: stamp.fingerprint,
    });
  }
}
function verdict(result: any, set: string) {
  return result.unparsed ? (set.startsWith('bench-') ? 'inconclusive' : null) : result.answer.outcome;
}
const rows = inputs.map((row) => {
  const before = row.transportError ? 'inconclusive' : verdict(baseline(row.raw, row.request), row.set);
  const after = row.transportError ? 'inconclusive' : verdict(parseJudgeText(row.raw, row.request), row.set);
  if (row.baseline !== undefined) assert.equal(before, row.baseline, `${row.set}/${row.id}`);
  return { ...row, baseline: before, candidate: after };
});
const measured = summaries.map((summary) => {
  if (!summary.total) return summary;
  const setRows = rows.filter((row) => row.set === summary.set);
  assert.equal(setRows.length, summary.total);
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
assert(measured.every((s) => s.breaks === 0 || s.breaks === null));
const report = {
  measuredAt: new Date().toISOString(),
  base,
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
      hashes,
      summaries: measured,
      rows,
    }),
  ),
);
console.log(
  JSON.stringify(
    measured.filter((s) => s.total),
    null,
    2,
  ),
);
