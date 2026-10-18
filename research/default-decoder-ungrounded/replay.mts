// Offline experiment only. Package sources and recorded answers are never changed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parseJudgeText as production } from '../../packages/judges/src/assessment.ts';
import { requestKey } from '../../packages/judges/src/cassette.ts';
import { TranscriptEntry } from '../../packages/judges/src/contract.ts';
import { groundEvidenceSpan } from '../../packages/judges/src/evidence.ts';
import { escapeData } from '../../packages/judges/src/prompt.ts';

globalThis.fetch = async () => {
  throw new Error('Network is forbidden in this offline replay');
};
const root = resolve(import.meta.dirname, '../..');
const output = resolve(import.meta.dirname, 'generated');
mkdirSync(output, { recursive: true });
const source = resolve(root, 'packages/judges/src');
const from = '73939d09686bd7d214acc6dfcc74b831d1ed991d';
const hashes: Record<string, string> = {};
function sha(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function blob(path: string) {
  const text = execFileSync('git', ['show', `${from}:${path}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  hashes[path] = sha(text);
  return text;
}
function imports(text: string) {
  return text
    .replace(
      /from '(\.\/[^']+)'/g,
      (_, path) => `from '${pathToFileURL(resolve(source, `${path}.ts`)).href}'`,
    )
    .replace(
      "from 'zod'",
      `from '${pathToFileURL(createRequire(resolve(source, 'criterion-ledger.ts')).resolve('zod')).href}'`,
    );
}
const baseCommit = '2c4982ca599b479c6c36b947352c51aac21bbebc';
function baseSource(file: string) {
  return execFileSync('git', ['show', `${baseCommit}:packages/judges/src/${file}`], {
    cwd: root,
    encoding: 'utf8',
  });
}
const ledgerSource = baseSource('criterion-ledger.ts');
const reject = "      return invalid('the evidence quote is not in the supplied data');";
assert.equal(ledgerSource.split(reject).length, 2);
// Only the string rejection changes. Original nulls, invalid spans and malformed rows stay strict.
const simulatedLedger = imports(ledgerSource)
  .replace(
    '  for (const check of checks) {',
    '  let evidenceUnverified = 0;\n  for (const check of checks) {',
  )
  .replace(
    reject,
    `    {
      if (typeof check.evidence !== 'string')
        return invalid('the evidence quote is not in the supplied data');
      check.evidence = null;
      Object.assign(check, { grounded: false });
      evidenceUnverified++;
    }`,
  )
  .replace('    checks,\n', '    checks,\n    ...(evidenceUnverified ? { evidenceUnverified } : {}),\n');
writeFileSync(resolve(output, 'criterion-ledger.ts'), simulatedLedger);
const assessmentSource = baseSource('assessment.ts');
writeFileSync(
  resolve(output, 'assessment.ts'),
  imports(assessmentSource).replace(
    pathToFileURL(resolve(source, 'criterion-ledger.ts')).href,
    pathToFileURL(resolve(output, 'criterion-ledger.ts')).href,
  ),
);
const { parseJudgeText: candidate } = await import(pathToFileURL(resolve(output, 'assessment.ts')).href);
writeFileSync(resolve(output, 'strict-ledger.ts'), imports(ledgerSource));
writeFileSync(
  resolve(output, 'strict-assessment.ts'),
  imports(assessmentSource).replace(
    pathToFileURL(resolve(source, 'criterion-ledger.ts')).href,
    pathToFileURL(resolve(output, 'strict-ledger.ts')).href,
  ),
);
const { parseJudgeText: baseline } = await import(
  pathToFileURL(resolve(output, 'strict-assessment.ts')).href
);

const calls = new Map(
  blob('comparisons/langwatch/hard/recorded/calls.jsonl')
    .trim()
    .split('\n')
    .map((line) => {
      const row = JSON.parse(line);
      return [row.request_sha256, row];
    }),
);
const summaries: any[] = [];
const rows: any[] = [];
function prediction(result: any) {
  return result.unparsed ? null : result.answer.outcome;
}
function summarize(set: string, results: any[], extra = {}) {
  return {
    set,
    total: results.length,
    historicalCorrect: results.filter((r) => r.historical === r.truth).length,
    baselineCorrect: results.filter((r) => r.baseline === r.truth).length,
    candidateCorrect: results.filter((r) => r.candidate === r.truth).length,
    fixes: results.filter((r) => r.baseline !== r.truth && r.candidate === r.truth).length,
    breaks: results.filter((r) => r.baseline === r.truth && r.candidate !== r.truth).length,
    changed: results.filter((r) => r.baseline !== r.candidate).length,
    historicalDifferences: results.filter((r) => r.historical !== r.baseline).length,
    ...extra,
  };
}
function localJson(path: string) {
  const text = readFileSync(path, 'utf8');
  hashes[
    path
      .replace(`${root}/`, '')
      .replace(`${process.env.BENCH_FRAME ?? resolve(root, '../bench-frame')}/`, 'bench-frame/')
  ] = sha(text);
  return JSON.parse(text);
}
for (const [set, fixturePath, recordingPath] of [
  ['long', 'longtrace-v2/hard.json', 'recorded/longtrace-v2-pr115.json'],
  ['short', 'judges-entries-v2.json', 'recorded/adapter-v2-pr115.json'],
]) {
  const fixtures = JSON.parse(blob(`comparisons/langwatch/hard/${fixturePath}`));
  const recorded = JSON.parse(blob(`comparisons/langwatch/hard/${recordingPath}`));
  assert.equal(recorded.complete, true);
  const byId = new Map(fixtures.map((item: any) => [item.id, item]));
  const results: any[] = [];
  for (const answer of recorded.answers) {
    const item: any = byId.get(answer.id);
    assert(item);
    assert.equal(item.adapterVersion, 2);
    for (const [index, rubric] of item.criteria.entries()) {
      const call: any = calls.get(answer.request_sha256s[index]);
      assert(call && !call.failed && call.text);
      assert.equal(call.schema, undefined);
      const flags = [
        '-p',
        '--output-format',
        'json',
        '--model',
        'haiku',
        '--system-prompt',
        call.system,
        '--tools',
        '',
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--max-turns',
        '1',
        '--max-budget-usd',
        '0.03',
      ];
      assert.equal(sha(JSON.stringify({ flags, user: call.user })), call.request_sha256);
      const request = {
        criterion: { name: `requirement_${index + 1}`, rubric, scope: 'conversation' as const },
        transcript: [
          { role: 'context' as const, text: item.scenario },
          ...item.entries.map((entry: any) => TranscriptEntry.parse(entry)),
        ],
      };
      const framed = JSON.parse(
        call.user.match(/<transcript_data>\s*([\s\S]*?)\s*<\/transcript_data>/)?.[1] ?? 'null',
      );
      assert(framed, 'Frozen request must contain transcript data');
      assert.deepEqual(
        framed.map(({ entry: _entry, ...rest }: any, position: number) => {
          assert.equal(_entry, position);
          return rest;
        }),
        JSON.parse(escapeData(JSON.stringify(request.transcript))),
      );
      assert(call.user.includes(rubric));
      const before = baseline(call.text, request);
      const after = candidate(call.text, request);
      const row = {
        set,
        id: item.id,
        index,
        truth: item.truth[index],
        historical: answer.predictions[index],
        baseline: prediction(before),
        candidate: prediction(after),
        requestSha256: call.request_sha256,
        rawSha256: sha(call.text),
        evidenceUnverified: after.evidenceUnverified ?? 0,
        before,
        after,
        request,
        raw: call.text,
      };
      results.push(row);
      rows.push(row);
    }
  }
  assert.equal(results.length, 240);
  summaries.push({
    set,
    total: results.length,
    historicalCorrect: results.filter((r) => r.historical === r.truth).length,
    baselineCorrect: results.filter((r) => r.baseline === r.truth).length,
    candidateCorrect: results.filter((r) => r.candidate === r.truth).length,
    fixes: results.filter((r) => r.baseline !== r.truth && r.candidate === r.truth).length,
    breaks: results.filter((r) => r.baseline === r.truth && r.candidate !== r.truth).length,
    changed: results.filter((r) => r.baseline !== r.candidate).length,
    historicalDifferences: results.filter((r) => r.historical !== r.baseline).length,
    misses: results
      .filter((r) => r.candidate !== r.truth)
      .map((r) => ({ id: r.id, index: r.index, truth: r.truth, prediction: r.candidate })),
  });
}
const fixtures = resolve(source, '../test/fixtures');
for (const [set, requestsName, cassetteName] of [
  ['pointwise-regressions', 'pointwise-regression-requests.json', 'pointwise-regressions.cassette.json'],
  ['pointwise-framed', 'pointwise-framed-requests.json', 'pointwise-framed.cassette.json'],
  ['multi-span', 'multi-span-requests.json', 'multi-span.cassette.json'],
]) {
  const inputs = localJson(resolve(fixtures, requestsName));
  const cassette = localJson(resolve(fixtures, cassetteName));
  const results = cassette.entries.map((entry: any) => {
    const item = inputs.cases.find(
      (r: any) => entry.note === r.case_id || entry.note.startsWith(`${r.case_id} `),
    );
    assert(item);
    const before = baseline(entry.raw, item.request);
    const after = candidate(entry.raw, item.request);
    return {
      set,
      id: entry.note,
      truth: item.expected,
      historical: prediction(before),
      baseline: prediction(before),
      candidate: prediction(after),
      before,
      after,
      request: item.request,
      raw: entry.raw,
    };
  });
  rows.push(...results);
  summaries.push(summarize(set, results));
}
{
  const set = 'rendered-evidence';
  const results = localJson(resolve(fixtures, 'rendered-evidence-recordings.json')).map((item: any) => {
    const before = baseline(item.raw, item.request);
    const after = candidate(item.raw, item.request);
    return {
      set,
      id: item.id,
      truth: item.expected,
      historical: prediction(before),
      baseline: prediction(before),
      candidate: prediction(after),
      before,
      after,
      request: item.request,
      raw: item.raw,
    };
  });
  rows.push(...results);
  summaries.push(summarize(set, results));
}
// Read archived bench inputs only. No process or write runs in the other worktree.
// BENCH_FRAME is a checkout of the recording commit; the archived recordings are committed beside this script.
const benchRoot = resolve(process.env.BENCH_FRAME ?? resolve(root, '../bench-frame'));
const archivedRoot = resolve(import.meta.dirname, 'inputs/pre-main-recordings');
const registry = localJson(resolve(benchRoot, 'benchmarks/manifest.json'));
for (const cohort of ['archived', 'current'])
  for (const slice of registry.slices) {
    const cases = localJson(resolve(benchRoot, slice.path, 'cases.spec.json')).metadata.bench;
    for (const model of registry.models) {
      const set = `bench-${cohort}/${slice.name}/${model.id}`;
      const folder = cohort === 'archived' ? archivedRoot : resolve(benchRoot, 'benchmarks');
      const cassettePath = resolve(folder, 'cassettes', `${slice.name}@${slice.version}`, `${model.id}.json`);
      const partial = !existsSync(cassettePath);
      const path = partial ? `${cassettePath}.partial.json` : cassettePath;
      if (!existsSync(path)) {
        summaries.push({
          set,
          status: model.id === 'gemini-3.8-flash' ? 'dropped by the owner' : 'not recorded',
          planned: slice.n,
          total: 0,
          fixes: null,
          breaks: null,
        });
        continue;
      }
      const cassette = localJson(path);
      const evidence = localJson(
        resolve(
          folder,
          'evidence',
          `${slice.name}@${slice.version}`,
          `${model.id}.json${partial ? '.partial.json' : ''}`,
        ),
      );
      const stamp = evidence.report ?? evidence;
      assert.equal(stamp.datasetHash, slice.hash);
      if (!partial) assert.equal(evidence.cassetteSha256, sha(readFileSync(path, 'utf8')));
      const judge = cassette.judges.find((r: any) => r.id === model.id);
      const byKey = new Map<string, any[]>();
      for (const item of cases) {
        const key = requestKey({ ...item.request, criterionDecoderVersion: 1 }, judge, stamp.fingerprint);
        byKey.set(key, [...(byKey.get(key) ?? []), item]);
      }
      const results = cassette.entries.map((entry: any) => {
        const item = byKey.get(entry.key)?.shift();
        assert(item, `No request for ${set}/${entry.key}`);
        const blocked = entry.error !== undefined || entry.note === 'bench:transport-unparsed';
        const before = blocked ? undefined : baseline(entry.raw, item.request);
        const after = blocked ? undefined : candidate(entry.raw, item.request);
        const original = evidence.report?.results.find((r: any) => r.id === item.id)?.outcome;
        return {
          set,
          id: item.id,
          truth: item.expected,
          historical: original ?? (before ? (prediction(before) ?? 'inconclusive') : 'inconclusive'),
          baseline: before ? (prediction(before) ?? 'inconclusive') : 'inconclusive',
          candidate: after ? (prediction(after) ?? 'inconclusive') : 'inconclusive',
          transportError: blocked,
          before,
          after,
          request: item.request,
          raw: entry.raw,
        };
      });
      rows.push(...results);
      summaries.push(
        summarize(set, results, {
          status: partial ? 'partial recording' : 'recorded',
          planned: slice.n,
          transportErrors: results.filter((r: any) => r.transportError).length,
          recordedFingerprint: stamp.fingerprint,
        }),
      );
    }
  }
// Separate experiment requested by the owner. This is not part of the package patch.
// Resolve bare input paths and reference/given/artifact aliases only to a unique declared input.
// Never override a populated canonical source or use the expected label in resolution.
const aliasRows: any[] = [];
for (const row of rows.filter((r) => r.set === 'bench-current/hard-factuality/haiku')) {
  const value = JSON.parse(row.raw);
  const changes: any[] = [];
  for (const check of value.checks ?? [])
    for (const span of Array.isArray(check.evidence) ? check.evidence : []) {
      if (row.request.inputs?.length !== 1) continue;
      if (groundEvidenceSpan(row.request, span).grounded) continue;
      if (
        (span.source === 'reference' && row.request.reference !== undefined) ||
        (span.source === 'given' && row.request.given !== undefined) ||
        (span.source === 'artifact' && row.request.artifact !== undefined)
      )
        continue;
      const inputs = row.request.inputs ?? [];
      let matches = inputs.filter((input: any) => input.path === span.source);
      if (!matches.length && ['reference', 'given', 'artifact'].includes(span.source) && inputs.length === 1)
        matches = inputs;
      if (matches.length !== 1) continue;
      const source = `input.${matches[0].path}`;
      if (!groundEvidenceSpan(row.request, { ...span, source }).grounded) continue;
      changes.push({ from: span.source, to: source });
      span.source = source;
    }
  const result = candidate(JSON.stringify(value), row.request);
  aliasRows.push({
    set: 'variant/source-alias/hard-factuality/haiku',
    id: row.id,
    truth: row.truth,
    baseline: row.baseline,
    historical: row.historical,
    candidate: prediction(result) ?? 'inconclusive',
    changes,
  });
}
const variants = aliasRows.length ? [summarize('variant/source-alias/hard-factuality/haiku', aliasRows)] : [];
for (const row of rows) {
  if (row.transportError) continue;
  assert.deepEqual(
    production(row.raw, { ...row.request, criterionDecoderVersion: 2 }),
    row.after,
    `Public decoder differs from simulation: ${row.set}/${row.id}`,
  );
  assert.deepEqual(
    production(row.raw, { ...row.request, criterionDecoderVersion: 1 }),
    row.before,
    `Strict compatibility differs: ${row.set}/${row.id}`,
  );
}
writeFileSync(
  resolve(fixtures, 'criterion-decoder-recordings.json.gz'),
  gzipSync(
    JSON.stringify({
      sourceCommit: from,
      baseCommit,
      sourceHashes: hashes,
      summaries,
      rows: rows.map(
        ({
          set,
          id,
          truth,
          request,
          raw,
          baseline,
          candidate,
          transportError,
          requestSha256,
          rawSha256,
        }) => ({
          set,
          id,
          truth,
          request,
          raw,
          baseline,
          candidate,
          transportError,
          requestSha256,
          rawSha256,
        }),
      ),
    }),
  ),
);
const report = {
  measuredAt: new Date().toISOString(),
  sourceCommit: from,
  packageCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  modelCalls: 0,
  costUsd: 0,
  sourceHashes: hashes,
  packageSourceHashes: { ledger: sha(ledgerSource), assessment: sha(assessmentSource) },
  candidateSourceHash: sha(simulatedLedger),
  summaries,
  variants,
  aliasRows,
  rows: rows.map(({ request, raw, before, after, ...row }) => ({
    ...row,
    evidenceUnverified: after?.evidenceUnverified ?? 0,
  })),
};
writeFileSync(resolve(import.meta.dirname, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(summaries, null, 2));
console.log(JSON.stringify(variants, null, 2));
