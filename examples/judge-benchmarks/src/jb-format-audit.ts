/** Inspect every dev verdict changed by the general format parser, from the same recorded judgements. */
import { readFile, writeFile } from 'node:fs/promises';
import { promptKey } from './call';
import { contestantById } from './contestants';
import { runBenchmark } from './run';
import { type PairResult, scorePairs } from './score';

const out = 'examples/judge-benchmarks/jb-results';
const base = new Map<string, PairResult>(),
  formatted = new Map<string, PairResult>();
const checks = new Map<string, unknown>();
for (const [id, sink] of [
  ['driftbench-reference3', base],
  ['driftbench-reference3-format', formatted],
] as const) {
  const r = await runBenchmark({
    bench: 'judgebench',
    split: 'dev',
    model: 'haiku',
    contestants: [contestantById(id)],
    replayOnly: true,
    concurrency: 1,
    onPairResult: (x) => {
      sink.set(x.item.id, x);
    },
    onEvidence: (e) => {
      if (e.kind === 'answer-format') checks.set(e.item, e);
    },
  });
  if (r.stopped || r.contestants[0]?.summary.missing)
    throw new Error('Complete format ablation recordings required.');
}
const records = (await readFile('examples/judge-benchmarks/recordings/judgebench/haiku.jsonl', 'utf8'))
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { key: string; text: string; item?: string; order?: string });
const changes = [...formatted.values()]
  .filter((r) => JSON.stringify(r.games) !== JSON.stringify(base.get(r.item.id)?.games))
  .map((r) => {
    const previous = base.get(r.item.id);
    if (!previous) throw new Error('Missing base result.');
    const prompt = contestantById('driftbench-reference3-format').answerFormat?.(r.item.question);
    return {
      item: r.item,
      previous: previous.games,
      formatted: r.games,
      beforeCorrect: scorePairs('judgebench', [previous]).value.estimate === 1,
      afterCorrect: scorePairs('judgebench', [r]).value.estimate === 1,
      check: checks.get(r.item.id),
      reviews: records
        .filter((x) => x.item === r.item.id && x.order?.startsWith('answer-format-review'))
        .map((x) => x.text),
      compiler: prompt ? records.find((x) => x.key === promptKey('haiku', prompt))?.text : undefined,
    };
  });
await writeFile(`${out}/format-changed-items.json`, JSON.stringify(changes, null, 2));
console.log(
  JSON.stringify({
    changed: changes.length,
    gained: changes.filter((x) => !x.beforeCorrect && x.afterCorrect).length,
    lost: changes.filter((x) => x.beforeCorrect && !x.afterCorrect).length,
  }),
);
