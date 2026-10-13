/* biome-ignore-all lint/style/noNonNullAssertion: research script; each lookup uses a key the script just built */
// Measures the injection detector on set.json: the pattern rules (no model) and the judge (one model per run).
//   npx tsx comparisons/langwatch/injection/measure.mts patterns
//   npx tsx comparisons/langwatch/injection/measure.mts judge --model haiku --cap 0.5
// Records are keyed by message hash in recorded/. Scoring makes no model call (score.py).
// The competitor's classifiers (an Azure jailbreak model and an OpenAI moderation model) need provider keys and are not run here.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attackRules } from '../../../packages/checks/src/checks/injection.ts';
import { createClaudeCliJudge, judgeAttack } from '../../../packages/judges/src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(readFileSync(join(here, 'set.json'), 'utf8')) as Array<{
  id: string;
  text: string;
  truth: string;
}>;
const args = process.argv.slice(2);
const mode = args[0];
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

if (mode === 'patterns') {
  const out = items.map((item) => ({ hash: hash(item.text), rules: attackRules(item.text) }));
  writeFileSync(join(here, 'recorded', 'patterns.json'), `${JSON.stringify({ answers: out }, null, 1)}\n`);
  console.log(`patterns: ${out.length} messages scored`);
} else if (mode === 'judge') {
  const model = opt('model', 'haiku')!;
  const cap = Number(opt('cap', '0.5'));
  const base = createClaudeCliJudge({ model, id: `claude-${model}` });
  let spent = 0;
  const client = {
    ...base,
    async judge(request: Parameters<typeof base.judge>[0]) {
      const result = await base.judge(request);
      spent += result.costUsd ?? 0;
      return result;
    },
  };
  const answers: Array<{ hash: string; verdict: string; costUsd: number }> = [];
  for (const item of items) {
    if (spent >= cap) throw new Error(`spend cap ${cap} USD reached after ${answers.length} calls`);
    const before = spent;
    const verdict = await judgeAttack(client, item.text);
    answers.push({ hash: hash(item.text), verdict, costUsd: spent - before });
  }
  writeFileSync(
    join(here, 'recorded', `judge-${model}.json`),
    `${JSON.stringify({ model, spentUsd: spent, answers }, null, 1)}\n`,
  );
  const unanswered = answers.filter((a) => a.verdict === 'inconclusive').length;
  console.log(
    `judge ${model}: ${answers.length} calls, ${unanswered} inconclusive, spent ${spent.toFixed(4)} USD`,
  );
} else {
  throw new Error('usage: measure.mts patterns | judge --model <name> --cap <usd>');
}
