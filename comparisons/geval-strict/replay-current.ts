/** Free integration check. There is no model invocation path in this script. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJudgeText } from '../../packages/judges/src/assessment';
import type { JudgeRequest } from '../../packages/judges/src/contract';
import { buildPrompt } from '../../packages/judges/src/prompt';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => readFileSync(resolve(here, path), 'utf8');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceHashes = (folder: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(folder, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry): [string, string][] => {
        const path = resolve(folder, entry.name);
        return entry.isDirectory()
          ? Object.entries(sourceHashes(path))
          : [[path.slice(root.length + 1), sha(readFileSync(path, 'utf8'))]];
      }),
  );
type Case = {
  id: string;
  truth: boolean;
  turns: { role: 'user' | 'assistant'; content: string }[];
};
type Call = {
  requestSha256: string;
  phase: string;
  mode: string;
  system: string;
  user: string;
  result: string;
  error?: string;
  chargedUsd: number;
};
const calls: Call[] = read('calls.jsonl')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const cache = new Map(calls.map((call) => [call.requestSha256, call]));
assert.equal(cache.size, calls.length, 'duplicate recording hashes');
const yaml = createRequire(resolve(root, 'packages/core/package.json'))('yaml') as {
  parse: (s: string) => { criterion: JudgeRequest['criterion'] };
};
const { criterion } = yaml.parse(readFileSync(resolve(root, 'examples/criteria/relevancy.yaml'), 'utf8'));
const packageSourceHashes = sourceHashes(resolve(root, 'packages/judges/src'));
const phases = ['tuning', 'heldout'].map((phase) => {
  const freezeFile = `feature-${phase}-freeze.json`;
  const freeze = JSON.parse(read(freezeFile));
  const saved = JSON.parse(read(`feature-${phase}.json`));
  const corpus = read(`../deepeval/hard/sets${phase === 'heldout' ? '-heldout' : ''}.json`);
  assert.equal(sha(corpus), freeze.corpusSha256, `${phase}: changed corpus`);
  const cases: Case[] = JSON.parse(corpus).relevancy;
  assert.equal(cases.length, freeze.cases);
  assert.equal(saved.rows.length, cases.length);
  const policy = 'packages/judges/src/response-relevance.ts';
  assert.equal(packageSourceHashes[policy], freeze.packageSourceHashes[policy], 'changed feature policy');
  const prompts: ReturnType<typeof buildPrompt>[] = [];
  const rows = cases.map((row) => {
    const request: JudgeRequest = {
      criterion,
      assessment: { kind: 'response-relevance' },
      transcript: row.turns.map((turn) => ({
        role: turn.role === 'assistant' ? 'agent' : 'user',
        text: turn.content,
      })),
    };
    const prompt = buildPrompt(request);
    prompts.push(prompt);
    const requestSha256 = sha(JSON.stringify(['haiku', prompt.system, prompt.user]));
    const call = cache.get(requestSha256);
    assert.ok(call, `${phase}: missing exact recording for ${row.id}`);
    assert.equal(call.phase, phase);
    assert.equal(call.mode, 'feature');
    assert.equal(call.system, prompt.system);
    assert.equal(call.user, prompt.user);
    const result = call.error
      ? { unparsed: true, answer: { outcome: 'inconclusive', reasoning: call.error } }
      : parseJudgeText(call.result, request);
    const prediction =
      result.unparsed || result.answer.outcome === 'inconclusive' ? null : result.answer.outcome === 'pass';
    return {
      id: row.id,
      truth: row.truth,
      prediction,
      correct: prediction === row.truth,
      requestSha256,
      result,
      costUsd: call.chargedUsd,
    };
  });
  assert.equal(sha(JSON.stringify(prompts)), freeze.promptsSha256, `${phase}: changed prompts`);
  assert.deepEqual(rows, saved.rows, `${phase}: changed package results`);
  return {
    phase,
    freezeFile,
    freezeSha256: sha(read(freezeFile)),
    corpusSha256: freeze.corpusSha256,
    promptsSha256: freeze.promptsSha256,
    cases: rows.length,
    correct: rows.filter((row) => row.correct).length,
    exactPromptsAndResults: true,
  };
});
const report = {
  verifiedSourceCommit: git('rev-parse', 'HEAD'),
  sourceTreeClean: git('status', '--porcelain', '--', 'packages/judges/src') === '',
  measuredSourceCommit: 'b97fe578',
  recordedArtifactCommit: '9b0bfaaf',
  freshModelCalls: 0,
  additionalSpendUsd: 0,
  featurePolicyUnchanged: true,
  packageSourceHashes,
  phases,
};
assert.ok(report.sourceTreeClean, 'commit package source before checking integration');
writeFileSync(resolve(here, 'post-merge-replay.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, packageSourceHashes: undefined }, null, 2));
