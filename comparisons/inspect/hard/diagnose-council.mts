import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { labelRequest, loadLabels } from '../../../packages/judges/src/calibration';
import { type Cassette, cassettePlayers, requestKey } from '../../../packages/judges/src/cassette';
import { majority } from '../../../packages/judges/src/council';
import { loadCriteria } from '../../../packages/judges/src/criteria';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cassette = JSON.parse(
  readFileSync(`${root}comparisons/inspect/panel/data/claude-council.cassette.json`, 'utf8'),
) as Cassette;
const players = cassettePlayers(cassette);
const criteria = await loadCriteria(`${root}examples/acme/criteria`);
const labels = await loadLabels(`${root}examples/acme/labels`);
if (criteria.issues.length || labels.issues.length)
  throw new Error(JSON.stringify({ criteria: criteria.issues, labels: labels.issues }));
const items = [];
for (const [name, blocks] of labels.labels) {
  const criterion = criteria.criteria.find((c) => c.def.name === name);
  if (!criterion) throw new Error(`Missing ${name}`);
  for (const block of blocks) {
    const request = labelRequest(criterion, block);
    const votes = [];
    for (const player of players) {
      const request_sha256 = requestKey(request, player);
      const matches = cassette.entries.filter(
        (e) => e.judge === player.id && e.key === request_sha256,
      ).length;
      try {
        const answer = await player.judge(request);
        votes.push({
          judge: player.id,
          request_sha256,
          matches,
          outcome: answer.answer.outcome,
          raw: answer.raw,
          error: null,
        });
      } catch (e) {
        votes.push({
          judge: player.id,
          request_sha256,
          matches,
          outcome: 'inconclusive' as const,
          raw: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const outcome = majority(votes as never);
    items.push({ id: block.id, criterion: name, label: block.label, outcome, request, votes });
  }
}
const unscored = items.filter((i) => i.outcome === 'split');
const summary = {
  date: new Date().toISOString(),
  total: items.length,
  right: items.filter((i) => i.outcome === i.label).length,
  wrong: items.filter((i) => i.outcome !== 'split' && i.outcome !== i.label).length,
  unscored: unscored.length,
  items,
};
writeFileSync(new URL('./council-replay.json', import.meta.url), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, items: undefined, unscoredItems: unscored }, null, 2));
