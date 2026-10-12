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
    output = arg('output') ?? path?.replace(/\.jsonl$/, '-rescore'),
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
  const before: PairResult[] = [];
  const byClass: Record<string, { beforeUnparsed: number; afterUnparsed: number }> = {};
  const refused = new Set<string>();
  if (arg('refusals')) for (const line of (await readFile(arg('refusals')!, 'utf8')).trim().split('\n')) refused.add(JSON.parse(line).id);
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
    if (item.a === item.b && candidates.length === 2) { candidates[0].order = 'AB'; candidates[1].order = 'BA'; }
    if (!candidates.length) throw new Error(`No raw comparison evidence for ${row.id}`);
    const counts = byClass[item.group] ??= { beforeUnparsed: 0, afterUnparsed: 0 };
    const parsed = ['AB', 'BA'].map((order) => {
      const attempts = candidates.filter((r: { order: string }) => r.order === order);
      if (!attempts.length) throw new Error(`Missing ${order} for ${row.id}`);
      if (attempts.at(-1).unparsed) counts.beforeUnparsed++;
      const a = order === 'AB' ? item.a : item.b,
        b = order === 'AB' ? item.b : item.a;
      const request = pairwiseRequest(
        { name: 'benchmark', rubric: CRITERIA.mmeval },
        [{ role: 'user', text: item.question }],
        a,
        b,
      );
      const replay = attempts.map((r: { text: string; key: string }) => ({ record: r, value: parseJudgeText(r.text, request) }));
      const chosen = replay.find((r: { value: { unparsed?: boolean } }) => !r.value.unparsed) ?? replay.at(-1)!;
      const last = chosen.record, value = chosen.value;
      if (value.unparsed) { unparsed++; counts.afterUnparsed++; }
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
    results.push({ item, games, missing: refused.has(item.id) ? 2 : 0, providerRefused: refused.has(item.id) });
    before.push({ item, games: row.games, missing: refused.has(item.id) ? 2 : 0, providerRefused: refused.has(item.id) });
    evidence.push({ id: item.id, group: item.group, oldGames: row.games, games, parsed });
  }
  if (arg('manifest')) {
    const manifest = JSON.parse(await readFile(arg('manifest')!, 'utf8'));
    const ids = manifest.batches[0].map((r: { id: string }) => r.id);
    for (const id of ids) if (!results.some((r) => r.item.id === id)) {
      if (!refused.has(id)) throw new Error(`Missing stored item ${id}`);
      const item = items.get(id)!;
      const row: PairResult = { item, games: ['tie', 'tie'], missing: 2, providerRefused: true };
      results.push(row); before.push(row);
    }
    if (results.length !== ids.length) throw new Error('Replay cohort mismatch');
  }
  const report = {
    input: path,
    contractSha: sha,
    items: results.length,
    changedItems: changed,
    unparsedGames: unparsed,
    blankQuotes: blank,
    ambiguousQuotes: ambiguous,
    before: scorePairs('mmeval', before),
    byClass,
    providerRefusedIds: [...refused],
    excludedSummary: scorePairs('mmeval', results.filter((r) => !refused.has(r.item.id))),
    summary: scorePairs('mmeval', results),
    time: new Date().toISOString(),
  };
  await writeFile(`${output}.json`, JSON.stringify(report, null, 2) + '\n');
  await writeFile(
    `${output}-evidence.json`,
    JSON.stringify(evidence, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify(report) + '\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
