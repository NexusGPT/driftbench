/* biome-ignore-all lint/style/noNonNullAssertion: research script; each lookup uses a key the same script just built */
import { type PanelVote, weightedPanel } from '../../../packages/judges/src/weighted-panel';
import { mulberry32 } from '../../../packages/stats/src/index';

const rng = mulberry32(7);
function scenario(acc: number[], trainN = 600, testN = 2000) {
  const judges = acc.map((_, i) => `j${i}`);
  const draw = (truth: 'pass' | 'fail'): PanelVote[] =>
    judges.map((judge, i) => ({
      judge,
      outcome: rng() < (acc[i] as number) ? truth : truth === 'pass' ? 'fail' : 'pass',
    }));
  const train = Array.from({ length: trainN }, () => {
    const t = rng() < 0.5 ? 'pass' : 'fail';
    return { t, votes: draw(t) };
  });
  const kappa: Record<string, number> = {};
  for (const j of judges) {
    let agree = 0,
      pTrue = 0,
      pPred = 0;
    for (const it of train) {
      const v = it.votes.find((x) => x.judge === j)!;
      if (v.outcome === it.t) agree += 1;
      if (it.t === 'pass') pTrue += 1;
      if (v.outcome === 'pass') pPred += 1;
    }
    const po = agree / trainN;
    const pe = (pTrue / trainN) * (pPred / trainN) + (1 - pTrue / trainN) * (1 - pPred / trainN);
    kappa[j] = Math.max(0, (po - pe) / (1 - pe));
  }
  const equal = Object.fromEntries(judges.map((j) => [j, 1]));
  let plainWrong = 0,
    plainSplit = 0,
    wWrong = 0,
    wSplit = 0;
  for (let i = 0; i < testN; i += 1) {
    const t = rng() < 0.5 ? 'pass' : 'fail';
    const votes = draw(t);
    const p = weightedPanel(votes, equal, 0);
    const w = weightedPanel(votes, kappa);
    if (p === 'split') plainSplit += 1;
    else if (p !== t) plainWrong += 1;
    if (w === 'split') wSplit += 1;
    else if (w !== t) wWrong += 1;
  }
  return {
    accuracy: acc,
    plain: { wrong: plainWrong / testN, split: plainSplit / testN },
    weighted: { wrong: wWrong / testN, split: wSplit / testN },
  };
}
const cases: Record<string, number[]> = {
  'six judges, all 0.9': [0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
  'four at 0.9, two at 0.55': [0.9, 0.9, 0.9, 0.9, 0.55, 0.55],
  'three at 0.9, three at 0.6': [0.9, 0.9, 0.9, 0.6, 0.6, 0.6],
  'two at 0.9, four at 0.5': [0.9, 0.9, 0.5, 0.5, 0.5, 0.5],
};
for (const [name, acc] of Object.entries(cases)) console.log(name.padEnd(30), JSON.stringify(scenario(acc)));
