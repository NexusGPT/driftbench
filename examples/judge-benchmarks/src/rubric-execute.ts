import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { codeEvidence } from './code-evidence';
import { loadBenchmark, type PairItem, splitOf } from './data';

/** Execute every dev code/MBPP item's supplied snippets before using the evidence in a judge. */
async function main(): Promise<void> {
  const benchmark = await loadBenchmark('rubricbench');
  const items = benchmark.items.filter(
    (item) => splitOf('rubricbench', item.id) === 'dev' && ['code', 'mbpp'].includes(item.group),
  ) as PairItem[];
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const rows = [];
  for (const item of items) {
    const reversed = hash(item.a) > hash(item.b);
    const evidence = await codeEvidence({
      question: item.question,
      a: reversed ? item.b : item.a,
      b: reversed ? item.a : item.b,
    });
    rows.push({
      id: item.id,
      domain: item.group,
      attempted: evidence !== undefined,
      evidence: evidence === undefined ? undefined : JSON.parse(evidence.split('\n').slice(1).join('\n')),
    });
    if (rows.length % 5 === 0) console.log(`Code execution coverage ${rows.length}/${items.length}`);
  }
  await writeFile(
    'examples/judge-benchmarks/experiments/rb/code-coverage.json',
    `${JSON.stringify({ items: items.length, rows }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      items: items.length,
      withSnippets: rows.filter((row) => row.attempted).length,
      noSnippets: rows.filter((row) => !row.attempted).length,
    }),
  );
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
