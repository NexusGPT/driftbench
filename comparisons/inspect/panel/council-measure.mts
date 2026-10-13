// Panel majority against a calibrated, abstaining weighted panel on the recorded Claude council.
// Each labelled block is replayed through the recorded judges (no model call). Labels are ground truth.
// Weights come from kappa on the first half of the criteria; the rules are scored on the other half.
// Usage: CASSETTE=<path to claude-council.cassette.json> npx tsx comparisons/inspect/panel/council-measure.mts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { labelRequest, loadLabels } from '../../../packages/judges/src/calibration';
import { type Cassette, cassettePlayers } from '../../../packages/judges/src/cassette';
import { majority } from '../../../packages/judges/src/council';
import { loadCriteria } from '../../../packages/judges/src/criteria';
import { type PanelVote, weightedPanel } from '../../../packages/judges/src/weighted-panel';

const CASSETTE =
  process.env.CASSETTE ?? fileURLToPath(new URL('./data/claude-council.cassette.json', import.meta.url));
const cassette = JSON.parse(readFileSync(CASSETTE, 'utf8')) as Cassette;
const criteriaDir = fileURLToPath(new URL('../../../examples/acme/criteria', import.meta.url));
const labelsDir = fileURLToPath(new URL('../../../examples/acme/labels', import.meta.url));
const loaded = await loadCriteria(criteriaDir);
const labels = await loadLabels(labelsDir);
const byName = new Map(loaded.criteria.map((c) => [c.def.name, c]));
const players = cassettePlayers(cassette);
const ids = players.map((p) => p.id);

type Item = { criterion: string; truth: 'pass' | 'fail'; votes: PanelVote[] };
const items: Item[] = [];
for (const [name, blocks] of labels.labels) {
  const crit = byName.get(name);
  if (!crit) continue;
  for (const block of blocks) {
    const request = labelRequest(crit, block);
    const votes: PanelVote[] = [];
    for (const player of players) {
      try {
        const result = await player.judge(request);
        votes.push({ judge: player.id, outcome: result.answer.outcome });
      } catch {
        votes.push({ judge: player.id, outcome: 'inconclusive' });
      }
    }
    items.push({ criterion: name, truth: block.label, votes });
  }
}

const names = [...new Set(items.map((i) => i.criterion))].sort();
// SPLIT=all fits and scores on the same twelve criteria (weights are then in-sample); the default holds out the second half.
const train = new Set(process.env.SPLIT === 'all' ? names : names.slice(0, Math.ceil(names.length / 2)));
const trainItems = items.filter((i) => train.has(i.criterion));
const testItems = process.env.SPLIT === 'all' ? items : items.filter((i) => !train.has(i.criterion));

const kappa: Record<string, number> = {};
for (const id of ids) {
  let n = 0,
    agree = 0,
    pTrue = 0,
    pPred = 0;
  for (const it of trainItems) {
    const v = it.votes.find((x) => x.judge === id);
    if (!v || v.outcome === 'inconclusive') continue;
    n += 1;
    if (v.outcome === it.truth) agree += 1;
    if (it.truth === 'pass') pTrue += 1;
    if (v.outcome === 'pass') pPred += 1;
  }
  const po = n ? agree / n : 0;
  const pe = n ? (pTrue / n) * (pPred / n) + ((n - pTrue) / n) * ((n - pPred) / n) : 0;
  kappa[id] = pe === 1 ? 0 : Math.max(0, (po - pe) / (1 - pe));
}

function score(rule: (votes: PanelVote[]) => 'pass' | 'fail' | 'split') {
  let right = 0,
    wrong = 0,
    split = 0;
  for (const it of testItems) {
    const out = rule(it.votes);
    if (out === 'split') split += 1;
    else if (out === it.truth) right += 1;
    else wrong += 1;
  }
  return { items: testItems.length, right, wrong, split };
}
const plain = score((v) => {
  const out = majority(v as never);
  return out === 'pass' || out === 'fail' ? out : 'split';
});
const weighted = score((v) => weightedPanel(v, kappa));
const single = Object.fromEntries(
  ids.map((id) => [
    id,
    score((v) => {
      const x = v.find((y) => y.judge === id)?.outcome;
      return x === 'pass' || x === 'fail' ? x : 'split';
    }),
  ]),
);
console.log(
  JSON.stringify(
    {
      criteria: names.length,
      train: train.size,
      items: items.length,
      kappa,
      plainMajority: plain,
      weightedAbstain: weighted,
      singleJudge: single,
    },
    null,
    2,
  ),
);
