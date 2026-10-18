/* biome-ignore-all lint/style/noNonNullAssertion: research script; each lookup uses a key the same script just built */
// Wrong verdicts on the borderline blocks: plain majority of the three recorded models against the kappa-weighted
// abstaining panel. Weights are kappa from the clean twelve-criterion council (not from these labels), so the
// borderline set is a fresh test. Reads recorded-haiku.json, recorded-sonnet.json and recorded-opus.json.
// Usage: npx tsx comparisons/inspect/council-borderline/compare.mts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { majority } from '../../../packages/judges/src/council';
import { type PanelVote, weightedPanel } from '../../../packages/judges/src/weighted-panel';

const models = ['haiku', 'sonnet', 'opus'] as const;
const recorded = Object.fromEntries(
  models.map((m) => [
    m,
    JSON.parse(readFileSync(fileURLToPath(new URL(`./recorded-${m}.json`, import.meta.url)), 'utf8')) as {
      rows: Array<{ id: string; label: 'pass' | 'fail'; outcome: string }>;
    },
  ]),
);
const kappa = { 'claude-haiku': 0.9475100942126514, 'claude-sonnet': 1, 'claude-opus': 1 };
const idMap = new Map(models.map((m) => [m, `claude-${m}`]));
const ids = recorded.haiku?.rows.map((r) => r.id);

type Tally = { right: number; wrong: number; split: number };
const tally = (): Tally => ({ right: 0, wrong: 0, split: 0 });
const plain = tally();
const weighted = tally();
const single: Record<string, Tally> = Object.fromEntries(models.map((m) => [m, tally()]));
const wrongIds: Record<string, string[]> = { plain: [], weighted: [] };

for (const id of ids) {
  const label = recorded.haiku?.rows.find((r) => r.id === id)?.label;
  const votes: PanelVote[] = models.map((m) => ({
    judge: idMap.get(m) ?? m,
    outcome: (recorded[m]?.rows.find((r) => r.id === id)?.outcome ?? 'inconclusive') as PanelVote['outcome'],
  }));
  const p = majority(votes as never);
  const pv = p === 'pass' || p === 'fail' ? p : 'split';
  const wv = weightedPanel(votes, kappa);
  for (const [t, v, name] of [
    [plain, pv, 'plain'],
    [weighted, wv, 'weighted'],
  ] as const) {
    if (v === 'split') t.split += 1;
    else if (v === label) t.right += 1;
    else {
      t.wrong += 1;
      wrongIds[name].push(id);
    }
  }
  for (const m of models) {
    const o = votes.find((x) => x.judge === idMap.get(m))?.outcome;
    const t = single[m];
    if (!t) throw new Error(`no tally for ${m}`);
    if (o === 'inconclusive') t.split += 1;
    else if (o === label) t.right += 1;
    else t.wrong += 1;
  }
}
console.log(
  JSON.stringify(
    {
      blocks: ids.length,
      plainMajority: plain,
      weightedAbstain: weighted,
      singleModel: single,
      wrongOn: wrongIds,
    },
    null,
    2,
  ),
);
