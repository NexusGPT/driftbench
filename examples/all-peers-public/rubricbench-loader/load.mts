import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadBenchmark } from './data.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ids: string[] = JSON.parse(readFileSync(new URL('./test-ids.json', import.meta.url), 'utf8'));
const want = new Set(ids);
const bench = await loadBenchmark('rubricbench');
const all = bench.items;
const test = all.filter((i: any) => want.has(i.id));
console.log(
  JSON.stringify({
    all: all.length,
    test: test.length,
    datasetSha256: sha(JSON.stringify(all)),
    normalizedTestPayloadSha256: sha(JSON.stringify(test)),
    testIdsSha256: sha(JSON.stringify([...ids].sort())),
  }),
);
writeFileSync(process.argv[2], JSON.stringify(test));
