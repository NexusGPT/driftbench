import { analysePilot, type PilotObservation } from '@driftbench/generate';
import { showNumber } from '../../format';
import type { Item, Measure } from '../../ladder';
import type { SharesDesign } from './designs';
import { generator, normal, salt } from './draw';

/**
 * Level 4 of the statistics validator: the pilot analysis recovers planted variance shares. Each dataset is a
 * balanced pilot (cells, conversations, wordings, repeats) whose pass chance per wording is planted on the logit
 * scale with a random effect per level; the truth is the variance those chances carry in this design, computed
 * here by the balanced nested formula, and a share is recovered when its truth lies inside the bootstrap
 * interval the pilot analysis gives for it.
 */

export const SHARES_RECOVERY = 0.93;

/** The component a missed share points at. */
export const SHARES_COMPONENT = 'packages/generate/src/pilot/analyse.ts';

/** The levels of the pilot model, outermost first, then the residual. */
export const SHARE_LEVELS = ['cell', 'conversation', 'wording', 'repeat'] as const;

/** The pilot analysis the level scores. Tests replace it to plant a fault. */
export type PilotAnalyser = typeof analysePilot;

/** One planted dataset: the observations and the pass chance of each wording, by cell, conversation, wording. */
export type SharesDataset = {
  observations: PilotObservation[];
  chances: number[][][];
  bootstrapSeed: number;
};

/** Draws one dataset of the design from the generator. */
export function plantShares(rng: () => number, design: SharesDesign): SharesDataset {
  const observations: PilotObservation[] = [];
  const chances: number[][][] = [];
  for (let c = 0; c < design.cells; c += 1) {
    const cellEffect = design.logitSd.cell * normal(rng);
    const cell: number[][] = [];
    for (let k = 0; k < design.conversations; k += 1) {
      const conversationEffect = design.logitSd.conversation * normal(rng);
      const conversation: number[] = [];
      for (let w = 0; w < design.wordings; w += 1) {
        const logit =
          design.logitMean + cellEffect + conversationEffect + design.logitSd.wording * normal(rng);
        const chance = 1 / (1 + Math.exp(-logit));
        conversation.push(chance);
        for (let repeat = 0; repeat < design.repeats; repeat += 1) {
          const pass = rng() < chance;
          observations.push({
            cell: `cell-${c}`,
            conversation: `conversation-${k}`,
            wording: w,
            map: 'planted',
            suite: design.conversations,
            specId: `cell-${c}.conversation-${k}.wording-${w}`,
            repeat,
            status: 'completed',
            pass,
            blocks: [pass],
            planted: 1 - chance,
          });
        }
      }
      cell.push(conversation);
    }
    chances.push(cell);
  }
  return { observations, chances, bootstrapSeed: Math.floor(rng() * 4294967296) };
}

/**
 * The planted variance shares of a balanced design, from the pass chance of each wording (constant over its
 * repeats): the nested ANOVA estimates of the chances (wording s_w, conversation s_k - s_w / W, cell
 * s_c - s_k / K, each truncated at 0), and for the repeat level the mean of p (1 - p). Each share is its
 * variance over the sum. Written here, apart from the analysis, so the truth does not share its code.
 */
export function plantedShares(chances: readonly (readonly (readonly number[])[])[]): number[] {
  const C = chances.length;
  const K = chances[0]?.length ?? 0;
  const W = chances[0]?.[0]?.length ?? 0;
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const conversationMeans = chances.map((cell) => cell.map((conversation) => mean(conversation)));
  const cellMeans = conversationMeans.map((cell) => mean(cell));
  const grand = mean(cellMeans);
  let wordingSquares = 0;
  let conversationSquares = 0;
  let noise = 0;
  chances.forEach((cell, c) => {
    cell.forEach((conversation, k) => {
      const m = conversationMeans[c]?.[k] as number;
      conversationSquares += (m - (cellMeans[c] as number)) ** 2;
      for (const p of conversation) {
        wordingSquares += (p - m) ** 2;
        noise += p * (1 - p);
      }
    });
  });
  const cellSquares = cellMeans.reduce((sum, m) => sum + (m - grand) ** 2, 0);
  const sw = wordingSquares / (C * K * (W - 1));
  const sk = conversationSquares / (C * (K - 1));
  const sc = cellSquares / (C - 1);
  const variances = [
    Math.max(0, sc - sk / K),
    Math.max(0, sk - sw / W),
    Math.max(0, sw),
    noise / (C * K * W),
  ];
  const total = variances.reduce((sum, value) => sum + value, 0);
  return variances.map((value) => (total > 0 ? value / total : 0));
}

/**
 * For each of `datasets` planted datasets: the pilot analysis (its defaults: a cluster bootstrap of cells,
 * then conversations, 500 draws), and for each level whether the planted share lies inside the bootstrap
 * interval of its estimate. The observed value is the shares recovered over the shares planted.
 */
export function sharesLevel(
  seed: number,
  design: SharesDesign,
  analyse: PilotAnalyser = analysePilot,
): Measure {
  const items: Item[] = [];
  let recovered = 0;
  let planted = 0;
  for (let dataset = 0; dataset < design.datasets; dataset += 1) {
    const { observations, chances, bootstrapSeed } = plantShares(generator(seed, salt(4, dataset)), design);
    const truth = plantedShares(chances);
    const analysis = analyse(observations, { seed: bootstrapSeed });
    SHARE_LEVELS.forEach((level, index) => {
      planted += 1;
      const found = analysis.pooled.levels.find((summary) => summary.level === level);
      const range = found?.shareInterval;
      const share = truth[index] as number;
      if (range && share >= range.lower - 1e-12 && share <= range.upper + 1e-12) {
        recovered += 1;
        return;
      }
      items.push({
        id: `shares-${dataset + 1}-${level}`,
        component: SHARES_COMPONENT,
        detail: `estimator analysePilot (pooled variance share, cluster bootstrap), seed ${seed}, dataset ${dataset + 1} of ${design.datasets}, level ${level}: truth ${showNumber(share)}, estimate ${found ? showNumber(found.share) : 'missing'}, interval ${range ? `[${showNumber(range.lower)}, ${showNumber(range.upper)}]` : 'missing'}`,
      });
    });
  }
  return { value: recovered / planted, items };
}
