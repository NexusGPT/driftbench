/** High-precision mismatch flags on DEV only; does not repair verdicts or call a model. */
import { readFile, writeFile } from 'node:fs/promises';
import { jsonObjects, parseCorrectnessLedger, parseDirectWinner } from './contestants';
import { loadBenchmark, splitOf } from './data';

const bench = await loadBenchmark('judgebench');
const dev = new Set(bench.items.filter((i) => splitOf('judgebench', i.id) === 'dev').map((i) => i.id));
const records = (await readFile('examples/judge-benchmarks/recordings/judgebench/haiku.jsonl', 'utf8'))
  .trim()
  .split('\n')
  .map(
    (line) =>
      JSON.parse(line) as { key: string; contestant?: string; item?: string; order?: string; text: string },
  );
const flags: {
  key: string;
  contestant?: string;
  item?: string;
  order?: string;
  text: string;
  reasoning: string;
  outcome: unknown;
  inferred: string | undefined;
  mapped: string;
}[] = [];
let examined = 0;
let directExamined = 0;
const directDifferences: { item: string; order?: string; named: string; computed: string; text: string }[] =
  [];
for (const row of records) {
  if (!row.item || !dev.has(row.item) || !/^AB|^BA/.test(row.order ?? '')) continue;
  if (row.contestant?.startsWith('driftbench-direct')) {
    directExamined++;
    const named = parseDirectWinner(row.text),
      computed = parseCorrectnessLedger(row.text);
    if (named !== computed)
      directDifferences.push({ item: row.item, order: row.order, named, computed, text: row.text });
  }
  const value = jsonObjects(row.text)
    .filter((x) => typeof x.outcome === 'string' && typeof x.reasoning === 'string')
    .at(-1);
  if (!value || !['pass', 'fail'].includes(String(value.outcome))) continue;
  examined++;
  const reasoning = String(value.reasoning);
  const named = new Set<string>();
  const patterns = [
    /(?:reply|candidate|response)\s+([AB])(?:'s)?\s+(?:final answer\s+|answer\s+)?(?:is|remains|provides|gives|offers)\s+(?:(?:clearly|the|a|much|overall|therefore)\s+)*(?:better|correct|superior|more\s+(?:accurate|complete|correct|reliable))\b/gi,
    /(?:reply|candidate|response)\s+([AB])\s+(?:wins|is preferable|satisfies the criterion better|better fits|better meets)\b/gi,
    /(?:prefer|choose|select|favor|favour)\s+(?:reply|candidate|response)\s+([AB])\b/gi,
  ];
  for (const pattern of patterns)
    for (const m of reasoning.matchAll(pattern)) {
      const phrase = m[0].toLowerCase();
      if (/incorrect|not correct|not better|less correct/.test(phrase)) continue;
      const tail = reasoning.slice((m.index ?? 0) + m[0].length);
      if (/^\s+(?:outputs?|on (?:the )?(?:examples|small))/i.test(tail)) continue;
      if (m[1]) named.add(m[1].toUpperCase());
    }
  if (named.size !== 1) continue;
  const inferred = [...named][0];
  const mapped = value.outcome === 'pass' ? 'A' : 'B';
  if (inferred !== mapped) flags.push({ ...row, reasoning, outcome: value.outcome, inferred, mapped });
}
const result = {
  examined,
  flaggedCalls: flags.length,
  flaggedItems: new Set(flags.map((f) => f.item)).size,
  byContestant: Object.fromEntries(
    [...new Set(flags.map((f) => f.contestant ?? 'unknown'))].map((c) => [
      c,
      flags.filter((f) => f.contestant === c).length,
    ]),
  ),
  directExamined,
  directLedgerDifferences: directDifferences.length,
  directDifferenceItems: new Set(directDifferences.map((r) => r.item)).size,
};
await writeFile(
  'examples/judge-benchmarks/jb-results/direct-ledger-differences.json',
  JSON.stringify(directDifferences, null, 2),
);
await writeFile(
  'examples/judge-benchmarks/jb-results/mapping-audit-flags.json',
  JSON.stringify(flags, null, 2),
);
await writeFile(
  'examples/judge-benchmarks/jb-results/mapping-audit-summary.json',
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
