import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promptKey, Recordings } from './call';
import { contestantById, type PairDecision, type Prompt } from './contestants';
import { loadBenchmark, type PairItem, splitOf } from './data';
import { assertWritingTestFreeze } from './wp-eval-scope';
import { pairGames, scorePairs } from './score';
import { majorityPair } from './run';
import { writingRowKey } from './wp-study';

/** Free historical comparator for label auditing. It has no model caller. */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const split = arg('split'),
  out = arg('out');
if (!['dev', 'test'].includes(split ?? '') || !out) throw new Error('--split dev|test and --out required');
if (split === 'test') {
  const freeze = JSON.parse(await readFile(new URL('../census/wp-freeze.json', import.meta.url), 'utf8'));
  await assertWritingTestFreeze(freeze.variant, arg('frozen-sha'));
}
const bench = await loadBenchmark('longjudge-wp');
const items = bench.items.filter(
  (x): x is PairItem => x.kind === 'pair' && splitOf(bench.id, x.id) === split,
);
const recordings = await new Recordings(
  fileURLToPath(new URL('../recordings/longjudge-wp/haiku.jsonl', import.meta.url)),
).load();
const adaptive = contestantById('driftbench-adaptive');
const { route, reference, pair, parsePair } = adaptive;
if (!route || !reference || !pair || !parsePair) throw new Error('Adaptive contract missing');
const costs = new Map<string, number>();
const text = (prompt: Prompt): string | undefined => {
  const record = recordings.get(promptKey('haiku', prompt));
  if (record) costs.set(record.key, record.costUsd);
  return record?.text;
};
const results: {
  rowKey: string;
  id: string;
  group: string;
  label: 'A' | 'B';
  games: PairDecision[];
  missing: number;
}[] = [];
for (const item of items) {
  const routed = text(route(item.question));
  const ref = /^\s*\**\s*YES/i.test(routed ?? '') ? text(reference(item.question)) : undefined;
  let missing = routed === undefined ? 1 : 0;
  if (/^\s*\**\s*YES/i.test(routed ?? '') && ref === undefined) missing += 1;
  const judge = (a: string, b: string) => {
    const prompt = pair({
      question: item.question,
      a,
      b,
      criterion: bench.criterion,
      ...(ref ? { reference: ref } : {}),
    });
    return majorityPair(
      Array.from({ length: 3 }, (_, i) => {
        const answer = text(
          i === 0 ? prompt : { ...prompt, user: `${prompt.user}\n\n(Independent judgement ${i + 1} of 3.)` },
        );
        if (answer === undefined) {
          missing += 1;
          return 'tie';
        }
        return parsePair(answer);
      }),
    );
  };
  const games = pairGames(judge(item.a, item.b), judge(item.b, item.a));
  results.push({
    rowKey: writingRowKey(item),
    id: item.id,
    group: item.group,
    label: item.label,
    games,
    missing,
  });
}
const report = {
  variant: 'historical-adaptive-audit-only',
  split,
  items: items.length,
  newSpendUsd: 0,
  purpose:
    'Existing recordings only, for independent label-audit selection. This is not another tuned TEST run.',
  summary: scorePairs(
    bench.id,
    results.map((r) => ({ ...r, item: items.find((i) => writingRowKey(i) === r.rowKey)! })),
  ),
  costPer100: ([...costs.values()].reduce((s, c) => s + c, 0) / items.length) * 100,
  results,
};
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
