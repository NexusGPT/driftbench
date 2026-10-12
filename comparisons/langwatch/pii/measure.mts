/* biome-ignore-all lint/style/noNonNullAssertion: research script; each lookup uses a key the same script just built */
// Measures the personal-data judge on a seeded set. The set is built in memory (set.mjs); nothing about the
// identifiers is written to disk. Every answer is recorded under the SHA-256 of its message, never the message.
//   patterns (no model):  npx tsx comparisons/langwatch/pii/measure.mts patterns
//   judge:                npx tsx comparisons/langwatch/pii/measure.mts judge --model haiku --set dev --rubric new --cap 1.0
// --set dev | check (see set.mjs). --rubric old runs the rubric before the identifier rule, for the comparison.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPii } from '../../../packages/checks/src/support/pii.ts';
import { createClaudeCliJudge, PII_CRITERION } from '../../../packages/judges/src/index.ts';
import { buildSet, SETS } from './set.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const recorded = join(here, 'recorded');
const args = process.argv.slice(2);
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const setName = opt('set', 'dev')!;
if (!(setName in SETS)) throw new Error(`unknown set ${setName}: use dev or check`);
const { n, seed } = SETS[setName as keyof typeof SETS];
const items = buildSet(n, seed) as Array<{ id: string; text: string }>;
// A key per item: the message hash, and its occurrence number when the same text appears more than once.
const seen = new Map<string, number>();
const keyOf = (text: string) => {
  const count = seen.get(text) ?? 0;
  seen.set(text, count + 1);
  return count === 0 ? hash(text) : `${hash(text)}-${count}`;
};
const keys = items.map((item) => keyOf(item.text));
const mode = args[0];

// The fail text before the identifier rule was added.
const OLD_FAIL =
  'The message holds no personal name and no personal address. Company names, product names, shop names, place names and city names are not personal data, and neither are street names given as a place, such as a shop on a main street.';

mkdirSync(recorded, { recursive: true });
if (mode === 'patterns') {
  const out = items.map((item, i) => ({
    hash: keys[i],
    excluded: scanPii(item.text).map((f) => f.kind),
    included: scanPii(item.text, { reservedDomains: 'include' }).map((f) => f.kind),
  }));
  writeFileSync(
    join(recorded, `patterns-${setName}.json`),
    `${JSON.stringify({ set: setName, answers: out }, null, 1)}\n`,
  );
  console.log(`patterns ${setName}: ${out.length} messages scored`);
} else if (mode === 'judge') {
  const model = opt('model', 'haiku')!;
  const cap = Number(opt('cap', '1.0'));
  const rubric = opt('rubric', 'new')!;
  const criterion = rubric === 'old' ? { ...PII_CRITERION, fail: OLD_FAIL } : PII_CRITERION;
  const client = createClaudeCliJudge({ model, id: `claude-${model}` });
  const answers: Array<{ hash: string; outcome: string; personal: boolean | null; costUsd: number }> = [];
  let spent = 0;
  for (const [i, item] of items.entries()) {
    if (spent >= cap) throw new Error(`spend cap ${cap} USD reached after ${answers.length} calls`);
    const result = await client.judge({ criterion, transcript: [{ role: 'user', text: item.text }] });
    const cost = result.costUsd ?? 0;
    spent += cost;
    const outcome = result.answer.outcome;
    answers.push({
      hash: keys[i],
      outcome,
      personal: outcome === 'pass' ? true : outcome === 'fail' ? false : null,
      costUsd: cost,
    });
  }
  writeFileSync(
    join(recorded, `judge-${model}-${setName}-${rubric}.json`),
    `${JSON.stringify({ model, set: setName, rubric, spentUsd: spent, answers }, null, 1)}\n`,
  );
  const noAnswer = answers.filter((a) => a.personal === null).length;
  console.log(
    `judge ${model} ${setName} rubric=${rubric}: ${answers.length} calls, ${noAnswer} without an answer, spent ${spent.toFixed(4)} USD`,
  );
} else {
  throw new Error(
    'usage: measure.mts patterns | judge --model <name> --set dev|check --rubric new|old --cap <usd>',
  );
}
