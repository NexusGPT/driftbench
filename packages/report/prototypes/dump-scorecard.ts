/**
 * Writes the scorecard of a stored campaign as JSON, for the redesign prototypes beside this file.
 *
 *   pnpm exec tsx packages/report/prototypes/dump-scorecard.ts --store <db> --campaign <id> \
 *     --baseline <id> --margin 15 --out <file.json>
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '@agent-nexus/driftbench-store';
import { loadCampaign } from '../src/data';
import { buildScorecard } from '../src/scorecard';

const { values } = parseArgs({
  options: {
    store: { type: 'string' },
    campaign: { type: 'string' },
    baseline: { type: 'string' },
    margin: { type: 'string', default: '15' },
    out: { type: 'string' },
  },
});
if (!values.store || !values.campaign || !values.out) {
  process.stderr.write('Give --store, --campaign and --out.\n');
  process.exit(2);
}
const store = openStore(resolve(values.store));
try {
  const data = await loadCampaign(store, values.campaign);
  const baseline = values.baseline ? await loadCampaign(store, values.baseline) : undefined;
  const card = buildScorecard(data, {
    margin: Number(values.margin) / 100,
    ...(baseline ? { baseline } : {}),
  });
  // Maps inside the compare pairs do not survive JSON.stringify: turn them into plain objects.
  const json = JSON.stringify(
    card,
    (_key, value) =>
      value instanceof Map ? Object.fromEntries(value) : value instanceof Set ? [...value] : value,
    2,
  );
  await writeFile(resolve(values.out), json);
  process.stdout.write(`Wrote ${values.out} (${json.length} characters).\n`);
} finally {
  await store.close();
}
