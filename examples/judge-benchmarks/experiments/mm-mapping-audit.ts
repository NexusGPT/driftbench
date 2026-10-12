import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Recordings, promptKey } from '../src/call';
import { contestantById, jsonObjects } from '../src/contestants';
import { CRITERIA } from '../src/data';
import { RECORDINGS } from '../src/run';
import { mmDevSets } from './mm-dev';

// Flags explicit contradictory winner statements without consulting the gold labels.
// This conservative text screen requires manual review of the evidence it emits.
export function explicitWinners(reasoning: string): ('A' | 'B')[] {
  const patterns = [
    /(?:Reply\s+)?([AB])\s+(?:is|remains|provides|gives|offers|delivers)\s+(?:(?:clearly|the|a|much|overall|substantially|therefore)\s+)*(?:better|stronger|superior|more\s+(?:accurate|helpful|useful|complete|comprehensive|relevant|concrete|direct|specific|practical|correct|reliable))\b/gi,
    /(?:Reply\s+)?([AB])\s+(?:better|more\s+(?:fully|directly|accurately|completely|clearly))\s+(?:meets|satisfies|addresses|matches|fulfills|fulfils|answers)\b/gi,
    /(?:Reply\s+)?([AB])\s+(?:wins|edges ahead|is superior|is preferable|satisfies the criterion better|better fits)\b/gi,
    /(?:prefer|favor|favour|choose)\s+(?:Reply\s+)?([AB])\b/gi,
  ];
  return [
    ...new Set(
      patterns.flatMap((p) => [...reasoning.matchAll(p)].map((m) => m[1]!.toUpperCase() as 'A' | 'B')),
    ),
  ];
}

async function main() {
  const c = contestantById('driftbench');
  const recordings = await new Recordings(join(RECORDINGS, 'mmeval', 'haiku.jsonl')).load();
  const sets = await mmDevSets(recordings);
  const all = sets.common.flatMap((item) =>
    [
      { a: item.a, b: item.b, order: 'AB' },
      { a: item.b, b: item.a, order: 'BA' },
    ].map(({ a, b, order }) => {
      const prompt = c.pair!({ question: item.question, a, b, criterion: CRITERIA.mmeval });
      const record = recordings.get(promptKey('haiku', prompt))!;
      const json = jsonObjects(record.text)
        .filter((x) => typeof x.reasoning === 'string' && 'outcome' in x)
        .at(-1);
      const reasoning = String(json?.reasoning ?? '');
      const winners = explicitWinners(reasoning);
      const weak = [
        ...reasoning.matchAll(
          /Reply\s+([AB])\s+(?:is|remains)\s+(?:(?:the|a|clearly|much)\s+)*(?:weaker|worse|less\s+(?:helpful|accurate|useful|complete|relevant))\b/gi,
        ),
      ].map((m) => (m[1]!.toUpperCase() === 'A' ? 'B' : 'A'));
      winners.push(...(weak as ('A' | 'B')[]));
      const unique = [...new Set(winners)];
      const parsed = c.parsePair!(record.text);
      return {
        id: item.id,
        group: item.group,
        order,
        key: record.key,
        outcome: json?.outcome,
        parsed,
        reasoning,
        inferred: unique.length === 1 ? unique[0] : undefined,
        contradiction: unique.length === 1 && unique[0] !== parsed,
        text: record.text,
      };
    }),
  );
  await writeFile(
    'examples/judge-benchmarks/experiments/mm-results/mapping-audit-all.jsonl',
    all.map((x) => JSON.stringify(x)).join('\n') + '\n',
  );
  const flags = all.filter((x) => x.contradiction);
  const reviewed = JSON.parse(
    await readFile('examples/judge-benchmarks/experiments/mm-results/mapping-audit-reviewed.json', 'utf8'),
  ) as {
    id: string;
    order: string;
    key: string;
    winner: 'A' | 'B';
  }[];
  const verified = reviewed.map((v) => {
    const row = all.find((r) => r.key === v.key && r.id === v.id && r.order === v.order);
    if (!row || row.parsed === v.winner) throw new Error(`Reviewed evidence changed: ${v.id}/${v.order}`);
    return {
      ...row,
      inferred: v.winner,
      review: 'Manually reviewed reasoning selects the opposite reply to the parsed outcome.',
    };
  });
  await writeFile(
    'examples/judge-benchmarks/experiments/mm-results/mapping-audit-verified.json',
    JSON.stringify(verified, null, 2) + '\n',
  );
  const summary = Object.fromEntries(
    [...new Set(all.map((x) => x.group))].map((g) => {
      const rows = all.filter((r) => r.group === g);
      const mismatches = verified.filter((r) => r.group === g);
      const invalid = rows.filter(
        (r) => r.parsed === 'tie' && !jsonObjects(r.text).some((j) => 'outcome' in j),
      );
      return [
        g,
        {
          items: new Set(rows.map((r) => r.id)).size,
          mappingItems: new Set(mismatches.map((r) => r.id)).size,
          mappingGames: mismatches.length,
          invalidJsonItems: new Set(invalid.map((r) => r.id)).size,
          invalidJsonGames: invalid.length,
        },
      ];
    }),
  );
  await writeFile(
    'examples/judge-benchmarks/experiments/mm-results/mapping-audit-summary.json',
    JSON.stringify(summary, null, 2) + '\n',
  );
  await writeFile(
    'examples/judge-benchmarks/experiments/mm-results/mapping-audit-flags.json',
    JSON.stringify(flags, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        items: sets.common.length,
        flags: flags.length,
        byGroup: Object.fromEntries(
          [...new Set(all.map((x) => x.group))].map((g) => [
            g,
            {
              items: sets.common.filter((x) => x.group === g).length,
              flaggedItems: new Set(flags.filter((x) => x.group === g).map((x) => x.id)).size,
              flaggedGames: flags.filter((x) => x.group === g).length,
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
  for (const f of flags)
    console.log(
      JSON.stringify({
        id: f.id,
        group: f.group,
        order: f.order,
        parsed: f.parsed,
        inferred: f.inferred,
        reasoning: f.reasoning,
      }),
    );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
