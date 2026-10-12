import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pairwiseRequest, parseJudgeText } from '@driftbench/judges';
import { CRITERIA, loadBenchmark, type PairItem } from '../src/data';
import { pairGames, type PairResult, scorePairs } from '../src/score';
import type { Recorded } from '../src/call';

async function main() {
  const arg = (key: string) => {
    const i = process.argv.indexOf(`--${key}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const path = arg('input'),
    sha = arg('contract-sha');
  if (!path || !sha) throw new Error('Require input and contract-sha');
  const rows = (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s));
  const records = (await readFile('examples/judge-benchmarks/recordings/mmeval/haiku.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s) as Recorded);
  const bench = await loadBenchmark('mmeval');
  const items = new Map(bench.items.filter((i): i is PairItem => i.kind === 'pair').map((i) => [i.id, i]));
  const results: PairResult[] = [],
    evidence: unknown[] = [];
  let changed = 0,
    unparsed = 0,
    blank = 0,
    ambiguous = 0;
  for (const row of rows) {
    const item = items.get(row.id);
    if (!item) throw new Error(`Unknown item ${row.id}`);
    const candidates =
      row.rawComparisons ??
      records
        .filter(
          (r) =>
            r.contestant === 'driftbench-mm-crowd' && r.item === row.id && r.order?.startsWith('compare'),
        )
        .map((r, index) => ({ ...r, order: index === 0 ? 'AB' : 'BA' }));
    if (!candidates.length) throw new Error(`No raw comparison evidence for ${row.id}`);
    const parsed = ['AB', 'BA'].map((order) => {
      const last = candidates.filter((r: { order: string }) => r.order === order).at(-1);
      if (!last) throw new Error(`Missing ${order} for ${row.id}`);
      const a = order === 'AB' ? item.a : item.b,
        b = order === 'AB' ? item.b : item.a;
      const request = pairwiseRequest(
        { name: 'benchmark', rubric: CRITERIA.mmeval },
        [{ role: 'user', text: item.question }],
        a,
        b,
      );
      const value = parseJudgeText(last.text, request);
      if (value.unparsed) unparsed++;
      let quote: unknown;
      try {
        quote = JSON.parse(last.text).winnerQuote;
      } catch {
        quote = undefined;
      }
      if (typeof quote === 'string') {
        const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
        const q = norm(quote);
        if (!q) blank++;
        else if (norm(a).startsWith(q) && norm(b).startsWith(q)) ambiguous++;
      }
      return { order, key: last.key, rawText: last.text, ...value };
    });
    const decisions = parsed.map((p) =>
      p.unparsed ? 'tie' : p.answer.outcome === 'pass' ? 'A' : p.answer.outcome === 'fail' ? 'B' : 'tie',
    ) as ('A' | 'B' | 'tie')[];
    const games = pairGames(decisions[0]!, decisions[1]!);
    if (JSON.stringify(games) !== JSON.stringify(row.games)) changed++;
    results.push({ item, games, missing: 0 });
    evidence.push({ id: item.id, group: item.group, oldGames: row.games, games, parsed });
  }
  const report = {
    input: path,
    contractSha: sha,
    items: results.length,
    changedItems: changed,
    unparsedGames: unparsed,
    blankQuotes: blank,
    ambiguousQuotes: ambiguous,
    summary: scorePairs('mmeval', results),
    time: new Date().toISOString(),
  };
  await writeFile(path.replace(/\.jsonl$/, '-rescore.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(
    path.replace(/\.jsonl$/, '-rescore-evidence.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify(report) + '\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
