import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAnswerText, repairAnswerText } from '@driftbench/judges';
import { promptKey, Recordings } from '../src/call';
import { contestantById, jsonObjects } from '../src/contestants';
import { CRITERIA } from '../src/data';
import { RECORDINGS } from '../src/run';
import { mmDevSets, replayPair } from './mm-dev';

const out = 'examples/judge-benchmarks/experiments/mm-results';
const recordings = await new Recordings(join(RECORDINGS, 'mmeval', 'haiku.jsonl')).load();
const sets = await mmDevSets(recordings);
const shipped = contestantById('driftbench');
const rerun = process.argv.includes('--repair-recorded');
type RepairEvidence = {
  id: string; group: string; label: 'A' | 'B'; order: 'AB' | 'BA'; key: string;
  original: string; repairedText: string; changed: boolean;
  repaired: ReturnType<typeof parseAnswerText>; winner: 'A' | 'B' | 'tie'; correct: boolean | null;
};
const invalid: RepairEvidence[] = rerun
  ? (JSON.parse(await readFile(join(out, 'near-json-repair-evidence.json'), 'utf8')) as RepairEvidence[]).map(
      (row) => {
        const original = String(row.original);
        const repairedText = repairAnswerText(original);
        const repaired = parseAnswerText(repairedText);
        const winner =
          repaired.unparsed || repaired.answer.outcome === 'inconclusive'
            ? 'tie'
            : repaired.answer.outcome === 'pass'
              ? 'A'
              : 'B';
        const originalWinner = row.order === 'AB' || winner === 'tie' ? winner : winner === 'A' ? 'B' : 'A';
        return {
          ...row,
          repairedText,
          changed: repairedText !== original,
          repaired,
          winner,
          correct: winner === 'tie' ? null : originalWinner === row.label,
        };
      },
    )
  : sets.common.flatMap((item) =>
      (['AB', 'BA'] as const).flatMap((order) => {
        const a = order === 'AB' ? item.a : item.b;
        const b = order === 'AB' ? item.b : item.a;
        const record = recordings.get(
          promptKey('haiku', shipped.pair!({ question: item.question, a, b, criterion: CRITERIA.mmeval })),
        )!;
        if (shipped.parsePair!(record.text) !== 'tie' || jsonObjects(record.text).some((j) => 'outcome' in j))
          return [];
        // Use the package's approved repair, before extracting an object. No value or verdict is guessed.
        const repairedText = repairAnswerText(record.text);
        const repaired = parseAnswerText(repairedText);
        const winner =
          repaired.unparsed || repaired.answer.outcome === 'inconclusive'
            ? 'tie'
            : repaired.answer.outcome === 'pass'
              ? 'A'
              : 'B';
        const originalWinner = order === 'AB' || winner === 'tie' ? winner : winner === 'A' ? 'B' : 'A';
        return [
          {
            id: item.id,
            group: item.group,
            label: item.label,
            order,
            key: record.key,
            original: record.text,
            repairedText,
            changed: repairedText !== record.text,
            repaired,
            winner,
            correct: winner === 'tie' ? null : originalWinner === item.label,
          },
        ];
      }),
    );
const count = (rows: typeof invalid) => ({
  items: new Set(rows.map((r) => r.id)).size,
  games: rows.length,
  parseableGames: rows.filter((r) => !r.repaired.unparsed).length,
  correctGames: rows.filter((r) => r.correct === true).length,
  wrongGames: rows.filter((r) => r.correct === false).length,
  unparseableGames: rows.filter((r) => r.repaired.unparsed).length,
  unresolvedItems: new Set(rows.filter((r) => r.repaired.unparsed).map((r) => r.id)).size,
});
const suffix = rerun ? '-shared' : '';
await writeFile(
  join(out, `near-json-repair${suffix}-evidence.json`),
  JSON.stringify(invalid, null, 2) + '\n',
);
await writeFile(
  join(out, `near-json-repair${suffix}-summary.json`),
  JSON.stringify(
    {
      total: count(invalid),
      byGroup: Object.fromEntries(
        ['reasoning', 'chat', 'linguistics', 'language mixing', 'safety'].map((g) => [
          g,
          count(invalid.filter((r) => r.group === g)),
        ]),
      ),
      newSpendUsd: 0,
      method:
        'Existing @driftbench/judges repairAnswerText, then parseAnswerText. No model call or outcome recovery by regex.',
    },
    null,
    2,
  ) + '\n',
);

if (rerun) {
  console.log(JSON.stringify({ repair: count(invalid) }, null, 2));
  process.exit(0);
}
const direct = contestantById('driftbench-mm-direct-contract');
const chat = sets.pilot
  .filter((i) => i.group === 'chat')
  .flatMap((item) => {
    const decision = replayPair(item, direct, recordings);
    if (decision.score === 1) return [];
    return [
      {
        item,
        decision,
        judgeOutputs: decision.keys.map((key) => (key ? recordings.get(key) : undefined)),
      },
    ];
  });
await writeFile(join(out, 'chat-miss-evidence.json'), JSON.stringify(chat, null, 2) + '\n');
console.log(JSON.stringify({ repair: count(invalid), chatMisses: chat.length }, null, 2));
