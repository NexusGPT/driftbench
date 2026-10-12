/* biome-ignore-all lint/style/noNonNullAssertion: research script; each lookup uses a key the same script just built */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requestKey } from '../../../packages/judges/src/cassette';
import { parseAnswerText } from '../../../packages/judges/src/contract';
import { fixtureRequest, loadCriteria } from '../../../packages/judges/src/criteria';
import { type PanelVote, weightedPanel } from '../../../packages/judges/src/weighted-panel';

const CRIT = fileURLToPath(new URL('../../../examples/acme/criteria', import.meta.url));
const cassette = JSON.parse(readFileSync(`${CRIT}/calibration/cassette.json`, 'utf8'));
const loaded = await loadCriteria(CRIT);
const criteria = loaded.criteria.map((c) => c.def.name).sort();
const byName = new Map(loaded.criteria.map((c) => [c.def.name, c]));
const judges = [...new Set(cassette.entries.map((e: { judge: string }) => e.judge))].sort() as string[];

type Item = { criterion: string; truth: 'pass' | 'fail'; votes: PanelVote[] };
const items: Item[] = [];
for (const name of criteria) {
  const crit = byName.get(name)!;
  for (const which of ['pass', 'fail'] as const) {
    const key = requestKey(fixtureRequest(crit, which) as never);
    const perJudge = judges.map((j) =>
      cassette.entries.filter((e: { judge: string; key: string }) => e.judge === j && e.key === key),
    );
    const repeats = Math.max(0, ...perJudge.map((l) => l.length));
    for (let r = 0; r < repeats; r += 1) {
      const votes: PanelVote[] = judges.flatMap((j, i) => {
        const entry = perJudge[i]?.[r];
        return entry
          ? [
              {
                judge: j,
                outcome: (entry.answer?.outcome ??
                  parseAnswerText(entry.raw).answer.outcome) as PanelVote['outcome'],
              },
            ]
          : [];
      });
      items.push({ criterion: name, truth: which, votes });
    }
  }
}
const half = Math.ceil(criteria.length / 2);
const train = new Set(criteria.slice(0, half));
const trainItems = items.filter((i) => train.has(i.criterion));
const testItems = items.filter((i) => !train.has(i.criterion));

// Cohen's kappa of each judge against the fixture truth, on the training criteria; inconclusive answers are left out.
const kappa: Record<string, number> = {};
const report: Record<string, string> = {};
for (const j of judges) {
  let n = 0,
    agree = 0,
    pTrue = 0,
    pPred = 0;
  for (const it of trainItems) {
    const v = it.votes.find((x) => x.judge === j);
    if (!v || v.outcome === 'inconclusive') continue;
    n += 1;
    if (v.outcome === it.truth) agree += 1;
    if (it.truth === 'pass') pTrue += 1;
    if (v.outcome === 'pass') pPred += 1;
  }
  const po = n ? agree / n : 0;
  const pe = n ? (pTrue / n) * (pPred / n) + ((n - pTrue) / n) * ((n - pPred) / n) : 0;
  kappa[j] = pe === 1 ? 0 : (po - pe) / (1 - pe);
  report[j] = `kappa ${kappa[j].toFixed(3)} on ${n} train answers`;
}
const equal = Object.fromEntries(judges.map((j) => [j, 1]));
const weights = Object.fromEntries(judges.map((j) => [j, Math.max(0, kappa[j]!)]));

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
const plain = score((v) => weightedPanel(v, equal, 0));
const weighted = score((v) => weightedPanel(v, weights));
console.log(
  JSON.stringify({ judges: report, weights, plainMajority: plain, weightedAbstain: weighted }, null, 2),
);
