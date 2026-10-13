/** Offline audit of the experiment. This file makes no provider calls. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { buildPrompt, type JudgeRequest, parseJudgeText } from '../../packages/judges/src/index';

const folder = fileURLToPath(new URL('.', import.meta.url));
const readGzip = (name: string) => gunzipSync(readFileSync(folder + name)).toString('utf8');
export function replayExperiment() {
  const datasets = JSON.parse(readGzip('cases.json.gz'));
  const calls = readGzip('calls.jsonl.gz')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const outcomes = JSON.parse(readFileSync(`${folder}outcomes.json`, 'utf8'));
  const system = readFileSync(`${folder}candidate-system.txt`, 'utf8');
  const answers = new Map(calls.filter((c) => c.event === 'answer').map((c) => [`${c.model}:${c.key}`, c]));
  const submissions = new Map(
    calls.filter((c) => c.event === 'submission').map((c) => [`${c.model}:${c.key}`, c]),
  );
  let checked = 0;
  for (const row of outcomes) {
    const request = datasets[row.set].find((c: { id: string }) => c.id === row.id)?.request as JudgeRequest;
    if (!request) throw new Error(`Missing request: ${row.id}`);
    const key = `${row.model}:${row.key}`;
    const answer = answers.get(key);
    const submission = submissions.get(key);
    if (!answer || !submission) throw new Error(`Missing call: ${row.id}`);
    // The opt-in prompt and the tested default candidate have identical provider-facing bytes.
    const prompt = buildPrompt({ ...request, system });
    if (prompt.system !== submission.prompt.system || prompt.user !== submission.prompt.user)
      throw new Error(`Prompt bytes changed: ${row.id}`);
    const parsed = parseJudgeText(answer.result.raw, request);
    const outcome = parsed.unparsed ? 'inconclusive' : parsed.answer.outcome;
    if (outcome !== row.outcome || (outcome === row.expected) !== row.correct)
      throw new Error(`Verdict changed: ${row.id}`);
    checked++;
  }
  return { checked, liveCalls: 0 };
}
