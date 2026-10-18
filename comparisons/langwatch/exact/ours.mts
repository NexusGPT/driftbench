// Runs driftbench's exact check on heldout.json and records each verdict: npx tsx comparisons/langwatch/exact/ours.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exact } from '../../../packages/checks/src/checks/exact.ts';
import { acme } from '../../../packages/checks/test/support/acme.ts';
import { context, observed, run } from '../../../packages/checks/test/support/context.ts';

const here = dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(readFileSync(join(here, 'heldout.json'), 'utf8')) as Array<{
  id: string;
  reply: string;
  reference: string;
}>;
const spec = acme('acme-new-customer-coverage');
const out: Array<{ id: string; passed: boolean }> = [];
for (const item of items) {
  const verdicts = await run(
    exact,
    context(spec, 1, observed(item.reply), { expect: { exact: item.reference } }),
  );
  out.push({ id: item.id, passed: verdicts[0]?.outcome === 'pass' });
}
writeFileSync(join(here, 'recorded', 'exact-ours.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`ours: ${out.length} verdicts recorded`);
