import { fileURLToPath } from 'node:url';
import { promptKey, Recordings } from './call';
import { loadBenchmark, splitOf } from './data';
import { pairGames, scorePairs } from './score';
import { criterionVote, parseWriting, writingBrief, writingCriteria } from './wp';

const bench = await loadBenchmark('longjudge-wp');
const recordings = await new Recordings(
  fileURLToPath(new URL('../recordings/longjudge-wp/haiku.jsonl', import.meta.url)),
).load();
const results = [];
for (const item of bench.items) {
  if (item.kind !== 'pair' || splitOf(bench.id, item.id) !== 'dev') continue;
  const brief = recordings.get(promptKey('haiku', writingBrief(item.question)))?.text;
  if (!brief) continue;
  const ab = recordings.get(
    promptKey('haiku', writingCriteria({ question: item.question, a: item.a, b: item.b, brief })),
  );
  const ba = recordings.get(
    promptKey('haiku', writingCriteria({ question: item.question, a: item.b, b: item.a, brief })),
  );
  if (!ab || !ba) continue;
  const parsed = [parseWriting(ab.text), parseWriting(ba.text)];
  results.push({
    item,
    games: pairGames(parsed[0]?.winner ?? 'tie', parsed[1]?.winner ?? 'tie'),
    voted: pairGames(criterionVote(parsed[0]), criterionVote(parsed[1])),
    missing: parsed.filter((p) => !p).length,
  });
}
console.log(
  JSON.stringify(
    {
      completePairs: results.length,
      partialOnly: true,
      summary: scorePairs(bench.id, results),
      voted: scorePairs(
        bench.id,
        results.map((r) => ({ ...r, games: r.voted })),
      ),
    },
    null,
    2,
  ),
);
