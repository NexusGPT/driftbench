import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as judges from '@agent-nexus/driftbench-judges';
import { judgesBank, runItem } from '../../../src/ladders/judges/v2';
import { STALE_ITEMS } from './new-contract-items';
import { wrongComponent } from './new-contract-mutants';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const red = readFileSync(new URL('./red-first-proof.txt', import.meta.url), 'utf8');
const bank = new Map(judgesBank().map((item) => [item.id, item]));
const rows = [];
for (const id of STALE_ITEMS) {
  const item = bank.get(id);
  if (!item) throw new Error(`missing bank item ${id}`);
  const current = await runItem(item, 1, ROOT, judges);
  const mismatch = await runItem(item, 1, ROOT, wrongComponent(id));
  const redFirst = red.includes(`× ${id} accepts the documented contract`);
  if (!redFirst || !current.pass || mismatch.pass || !mismatch.detail)
    throw new Error(`proof failed for ${id}: ${JSON.stringify({ redFirst, current, mismatch })}`);
  rows.push({ id, redFirst, current, mismatch });
}
writeFileSync(
  new URL('./contract-proof.json', import.meta.url),
  `${JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      seed: 1,
      items: rows.length,
      rows,
    },
    null,
    2,
  )}\n`,
);
console.log(`${rows.length} red-first tests, ${rows.length} green items, ${rows.length} rejected mismatches`);
