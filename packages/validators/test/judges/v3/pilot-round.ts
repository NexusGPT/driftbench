/** Internal child: the launcher redirects the judges module before any bank import. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  createLabellerReplay,
  labellerRequestKey,
  labelSetHash,
  scoreLabeller,
} from '@agent-nexus/driftbench-judges';
import { allFailingItems, blindReport } from '../../../src/audit';
import { bankSummary } from '../../../src/bank';
import { runSeeds } from '../../../src/ladder';
import { judgesLadderV3 } from '../../../src/ladders/judges/v3';
import { hiddenSeed, seedSpecs } from '../../../src/seeds';

const [snapshot, output, roundText] = process.argv.slice(2);
assert(snapshot && output && roundText);
const candidate = await import(pathToFileURL(snapshot).href);
const boundScorer = { scoreLabeller, labelSetHash, labellerRequestKey, createLabellerReplay };
for (const name of ['scoreLabeller', 'labelSetHash', 'labellerRequestKey', 'createLabellerReplay'] as const) {
  assert.equal(boundScorer[name], candidate[name], `${name} did not bind to the candidate`);
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const root = process.cwd();
const hidden = hiddenSeed(root);
const sourceHash = digest(readFileSync(snapshot));
const bankFiles = ['bank.ts', 'fixtures.ts', 'index.ts'];
const bankHash = digest(
  bankFiles
    .map((file) => readFileSync(join(root, 'packages/validators/src/ladders/judges/v3', file), 'utf8'))
    .join('\n'),
);
if (Number(roundText) > 0) {
  const baseline = JSON.parse(readFileSync(join(output, 'round-00.summary.json'), 'utf8'));
  assert.equal(bankHash, baseline.bankHash, 'bank changed after the baseline');
  assert.deepEqual(hidden, baseline.hiddenSeed, 'hidden seed changed after the baseline');
}
const seeds = seedSpecs(
  Array.from({ length: 20 }, (_, i) => i + 1),
  hidden,
);
const start = performance.now();
const report = await runSeeds(judgesLadderV3(), seeds, root, { full: true });
assert.equal(digest(readFileSync(snapshot)), sourceHash, 'candidate changed during measurement');
const bank = bankSummary(report);
const failing = allFailingItems(blindReport(report));
const stem = `round-${String(Number(roundText)).padStart(2, '0')}`;
const summary = {
  round: Number(roundText),
  at: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  hiddenSeed: hidden,
  candidateHash: sourceHash,
  bankHash,
  candidateBindingVerified: true,
  durationMinutes: (performance.now() - start) / 60000,
  level: report.level,
  bankSize: bank.size,
  passing: bank.passing,
  score: bank.score,
  failingCauses: bank.failingCauses,
};
writeFileSync(join(output, `${stem}.report.json.gz`), gzipSync(JSON.stringify({ ...report, bank, summary })));
writeFileSync(join(output, `${stem}.summary.json`), JSON.stringify(summary, null, 2));
writeFileSync(
  join(output, `${stem}.feedback.json`),
  JSON.stringify(
    { level: report.level, passing: bank.passing, bankSize: bank.size, failingItems: failing },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    round: summary.round,
    level: summary.level,
    passing: bank.passing,
    bankSize: bank.size,
    feedback: join(output, `${stem}.feedback.json`),
  }),
);
