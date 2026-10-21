/**
 * Single final run only. Hashes and rules must already be public in the PR.
 * The answer file is opened only by scoreFrozen after all reader outcomes are saved.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyRecording, feedFromConditions, recordConditions } from '../../../packages/generate/src';
import { loadStore } from './lib';
import { round2Options, round2Systems } from './round2';
import { hash, liveRound2 } from './round2-live';
import { scoreFrozen } from './score-frozen';

const [clauseFile, answerFile, output, budgetFile, prNumber] = process.argv.slice(2);
if (!clauseFile || !answerFile || !output || !budgetFile || !prNumber || !/^\d+$/.test(prNumber)) {
  throw new Error('required: clauses answers output budget PR-number');
}
const root = resolve(new URL('../../..', import.meta.url).pathname);
const freezeBytes = readFileSync(new URL('./round2-freeze.json', import.meta.url));
const freeze = JSON.parse(freezeBytes.toString('utf8')) as {
  clausesHash: string;
  answersHash: string;
  readerHash: string;
  files: Record<string, string>;
};
function frozenHashes() {
  const hashes = Object.fromEntries(
    Object.keys(freeze.files).map((file) => [file, hash(readFileSync(resolve(root, file)))]),
  );
  for (const [file, expected] of Object.entries(freeze.files)) {
    if (hashes[file] !== expected) throw new Error('frozen source changed: ' + file);
  }
  return hashes;
}
const hashesBefore = frozenHashes();
if (existsSync(output) || existsSync(output + '.started.json') || existsSync(output + '.receipts.jsonl')) {
  throw new Error('the final run was already started; no second measurement');
}
const localHead = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const response = await fetch('https://api.github.com/repos/NexusGPT/driftbench/pulls/' + prNumber);
if (!response.ok) throw new Error('cannot obtain independent pre-registration timestamp');
const registration = await response.json();
if (
  registration.head.sha !== localHead ||
  !registration.body.includes(freeze.clausesHash) ||
  !registration.body.includes(freeze.answersHash) ||
  !registration.body.includes(freeze.readerHash) ||
  !registration.body.includes(
    'A planted condition counts as found when the variable is right AND the decision is right.',
  )
) {
  throw new Error('PR does not pre-register this head, hashes and primary rule');
}
const started = {
  runId: 'sol-lane-varstore:frozen3:' + localHead,
  head: localHead,
  freezeHash: hash(freezeBytes),
  pr: registration.html_url,
  registrationUpdatedAt: registration.updated_at,
  githubDate: response.headers.get('date'),
  bodyHash: hash(registration.body),
  localStartedAt: new Date().toISOString(),
};
writeFileSync(output + '.started.json', JSON.stringify(started, null, 2) + '\n', { flag: 'wx' });
// FIRST access to the blind clauses, after public pre-registration and a durable one-run lock.
const clauseBytes = readFileSync(clauseFile);
if (hash(clauseBytes) !== freeze.clausesHash) throw new Error('clause hash differs from pre-registration');
const spans = JSON.parse(clauseBytes.toString('utf8')) as Array<{ id: string; path: string; quote: string }>;
if (
  !Array.isArray(spans) ||
  spans.length !== 73 ||
  new Set(spans.map((s) => s.id)).size !== spans.length ||
  spans.some(
    (s) =>
      typeof s.id !== 'string' ||
      typeof s.path !== 'string' ||
      typeof s.quote !== 'string' ||
      s.path.startsWith('/') ||
      s.path.includes('..') ||
      s.path.includes('\\'),
  )
) {
  throw new Error('invalid fictional span inventory');
}
// Only supplied fictional strings are used; no path from the blind input is opened.
const texts = new Map<string, string>();
for (const span of spans) texts.set(span.path, (texts.get(span.path) ?? '') + span.quote + '\n');
const initialStore = loadStore();
const live = liveRound2(budgetFile, output + '.receipts.jsonl', started.runId);
const systems = round2Systems(live.judge, live.port, spans);
const recording = emptyRecording();
const result = await feedFromConditions({
  store: initialStore,
  spans,
  texts,
  ...recordConditions(recording, systems.reader, systems.proposer),
  options: round2Options,
});
const evidence = {
  ...started,
  spans,
  texts: Object.fromEntries(texts),
  initialStore,
  recording,
  ...result,
  readerTotals: live.totals(),
  hashesBefore,
  hashesAfter: frozenHashes(),
};
// Outcomes and recording are durable before the sealed scorer is allowed to read the key.
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
const totals = await scoreFrozen(
  answerFile,
  freeze.answersHash,
  spans.map((s) => s.id),
  result.report.outcomes,
  initialStore,
  result.store,
  live.secondaryJudge,
);
const summary = {
  runId: started.runId,
  ...totals,
  ...live.totals(),
  hashesAfterScoring: frozenHashes(),
};
writeFileSync(output + '.totals.json', JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(summary));
