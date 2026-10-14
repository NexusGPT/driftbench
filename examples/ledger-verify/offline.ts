import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promptKey } from '../judge-benchmarks/src/call';
import { contestantById } from '../judge-benchmarks/src/contestants';
import { pythonOutput } from '../judge-benchmarks/src/extras';
import { runBenchmark } from '../judge-benchmarks/src/run';
import { schemaFor } from './schemas';

const base = 'examples/ledger-verify';
const seal = JSON.parse(await readFile(`${base}/evidence/seal.json`, 'utf8'));
const amendment = JSON.parse(await readFile(`${base}/evidence/execution-amendment.json`, 'utf8'));
for (const [path, hash] of Object.entries(seal.sourceHashes)) {
  assert.equal(
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
    amendment.sourceHashes[path] ?? hash,
    path,
  );
}
for (const [path, hash] of Object.entries(seal.evidenceHashes)) {
  assert.equal(
    createHash('sha256')
      .update(await readFile(`${base}/evidence/${path}`))
      .digest('hex'),
    hash,
    path,
  );
}
const ours = contestantById('driftbench-verify-uncertainty-cascade');
const peer = contestantById('promptfoo');
assert.equal(ours.referencePaths?.length, 2);
assert.equal(ours.fullReferenceAnswers, true);
assert(ours.postPoint?.when({ pass: true }, ['Assuming the unstated premise.']));
assert(!ours.postPoint?.when({ pass: false }, ['Assuming the unstated premise.']));
assert(!ours.postPoint?.when({ pass: true }, ['Do not invent unstated requests.']));
assert.equal(ours.responseExtractor?.local('Compute 1+1.', 'Final answer: 2'), '2');
const input = { question: 'Compute 1+1.', response: '2', criterion: 'The final answer is correct.' };
assert.deepEqual(peer.parsePoint?.('{"reason":"2 is correct","pass":true,"score":1}'), {
  pass: true,
  score: 1,
});
assert.deepEqual(peer.parsePoint?.('nonsense'), {});
assert.equal(ours.parsePoint?.('A check. {"pass":false,"reason":"wrong"}').pass, false);
assert(!Object.hasOwn(ours.point?.(input), 'correct'));
assert.deepEqual(schemaFor(peer.point?.(input).system)?.required, ['reason', 'pass', 'score']);
assert.deepEqual(schemaFor(ours.point?.(input).system)?.required, ['pass', 'reason']);
assert.deepEqual(schemaFor(ours.responseExtractor?.prompt(input.question, input.response).system)?.required, [
  'final_answer',
  'quote',
]);
for (const path of ours.referencePaths!)
  assert.equal(schemaFor(path.prompt(input.question).system), undefined);
assert.equal(schemaFor(ours.codeCheck?.write(input.question, input.response).system), undefined);

// All command paths below are strict replay. A missing answer must stop before process execution.
const recordingDir = `${base}/offline-recordings`;
await mkdir(`${recordingDir}/longjudge-verify`, { recursive: true });
const prompt = peer.point?.(input);
await writeFile(
  `${recordingDir}/longjudge-verify/offline.jsonl`,
  `${JSON.stringify({
    key: promptKey('offline', prompt),
    model: 'offline',
    text: '{"pass":true,"score":1}',
    costUsd: 0,
    bench: 'longjudge-verify',
    contestant: 'promptfoo',
    item: 'fixture',
    order: 'single',
  })}\n`,
);
const report = await runBenchmark({
  bench: 'longjudge-verify',
  model: 'offline',
  contestants: [peer],
  items: [
    {
      kind: 'point',
      id: 'fixture',
      question: input.question,
      response: input.response,
      correct: true,
      group: 'test',
    },
  ],
  criterion: input.criterion,
  replayOnly: true,
  recordingsDir: recordingDir,
  command: '/nonexistent-no-paid-command',
  includeDecisions: true,
  concurrency: 6,
});
assert.equal(report.newCalls, 0);
assert.equal(report.replayed, 1);
assert.equal(report.contestants[0]?.decisions?.[0]?.pass, true);
const miss = await runBenchmark({
  bench: 'longjudge-verify',
  model: 'offline',
  contestants: [peer],
  items: [
    {
      kind: 'point',
      id: 'unrecorded',
      question: 'not in cassette',
      response: '3',
      correct: false,
      group: 'test',
    },
  ],
  replayOnly: true,
  recordingsDir: recordingDir,
  command: '/nonexistent-no-paid-command',
  includeDecisions: true,
});
assert.equal(miss.newCalls, 0);
assert.match(miss.stopped!, /no recording/);
const executed = await pythonOutput('print(6*7)', 'python3', true);
assert.equal(executed, '42', 'Restricted execution must work on the owner host');
const result = {
  sourceAndPoolHashes: 'PASS',
  frozenCascadeRoutes: 'PASS',
  pointParser: 'PASS',
  strictReplay: 'PASS',
  missingReplayFailsClosed: 'PASS',
  restrictedPython: 'PASS',
  pointwiseSchemasAndPlainSolves: 'PASS',
  newModelCalls: 0,
  at: new Date().toISOString(),
};
// A rerun with identical results keeps the committed timestamp, so the tree stays clean.
const previous = await readFile(`${base}/evidence/offline-checks.json`, 'utf8').then(
  JSON.parse,
  () => undefined,
);
if (previous && JSON.stringify({ ...previous, at: '' }) === JSON.stringify({ ...result, at: '' }))
  result.at = previous.at;
await writeFile(`${base}/evidence/offline-checks.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
