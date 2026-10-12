import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promptKey, Recordings } from './call';
import { contestantById, type Prompt } from './contestants';
import { loadBenchmark, type PairItem, splitOf } from './data';
import { consensusSolve, finalLine, majoritySolve } from './extras';
import { majorityPair, RECORDINGS } from './run';

const id = process.argv[2] ?? 'driftbench-adaptive';
const c = contestantById(id);
const pairPrompt = c.pair;
const parsePair = c.parsePair;
if (!pairPrompt || !parsePair) throw new Error('a pairwise contestant is required');
const bench = await loadBenchmark('judgebench');
const items = bench.items.filter((i) => splitOf('judgebench', i.id) === 'dev') as PairItem[];
const recordings = await new Recordings(join(RECORDINGS, 'judgebench', 'haiku.jsonl')).load();
const get = (p: Prompt) => recordings.get(promptKey('haiku', p))?.text;
const flip = (d: string) => (d === 'A' ? 'B' : d === 'B' ? 'A' : 'tie');
const rows = items.map((item) => {
  const route = c.route ? get(c.route(item.question)) : 'YES';
  const solves: string[] = [];
  if (c.reference && /^\s*\**\s*YES/i.test(route ?? 'YES')) {
    const p = c.reference(item.question);
    for (let i = 0; i < (c.referenceSamples ?? 1); i++) {
      const text = get(
        i === 0 ? p : { ...p, user: `${p.user}\n\n(Independent solve ${i + 1} of ${c.referenceSamples}.)` },
      );
      if (text) solves.push(text);
    }
  }
  const solved =
    (c.referenceSamples ?? 1) === 1
      ? solves[0]
      : c.referenceConsensus
        ? solves.length === c.referenceSamples
          ? consensusSolve(solves)
          : undefined
        : majoritySolve(solves);
  const reviews: string[] = [];
  if (c.candidateReview) {
    for (const response of [item.a, item.b]) {
      const text = get(c.candidateReview(item.question, response));
      if (text)
        reviews.push(
          `Fallible independent review of the response ending ${JSON.stringify(response.slice(-400))}:\n${text}`,
        );
    }
  }
  const parts = [solved, ...reviews].filter((p): p is string => p !== undefined);
  const reference = parts.length ? parts.join('\n\n') : undefined;
  const judge = (a: string, b: string) => {
    const p = pairPrompt({
      question: item.question,
      a,
      b,
      criterion: bench.criterion,
      ...(reference ? { reference } : {}),
    });
    const texts: string[] = [];
    for (let i = 0; i < (c.samples ?? 1); i++) {
      const text = get(
        i === 0 ? p : { ...p, user: `${p.user}\n\n(Independent judgement ${i + 1} of ${c.samples}.)` },
      );
      if (text) texts.push(text);
    }
    return { texts, votes: texts.map((text) => parsePair(text)) };
  };
  const ab = judge(item.a, item.b),
    ba = judge(item.b, item.a);
  const games = [majorityPair(ab.votes), flip(majorityPair(ba.votes))];
  const correct = games.reduce((n, g) => n + (g === item.label ? 1 : g === flip(item.label) ? -1 : 0), 0) > 0;
  return {
    id: item.id,
    group: item.group,
    label: item.label,
    games,
    correct,
    complete: ab.texts.length === (c.samples ?? 1) && ba.texts.length === (c.samples ?? 1),
    solves: solves.map(finalLine),
    reference: finalLine(reference),
    question: item.question,
    a: item.a,
    b: item.b,
    ab: ab.texts,
    ba: ba.texts,
  };
});
await writeFile(`examples/judge-benchmarks/jb-results/${id}-items.json`, JSON.stringify(rows, null, 2));
const complete = rows.filter((r) => r.complete);
console.log(
  JSON.stringify(
    {
      contestant: id,
      complete: complete.length,
      correct: complete.filter((r) => r.correct).length,
      errors: complete
        .filter((r) => !r.correct)
        .map((r) => ({ id: r.id, group: r.group, games: r.games, label: r.label, solves: r.solves })),
    },
    null,
    2,
  ),
);
