import { analysePilot, type PilotObservation } from '@agent-nexus/driftbench-generate';
import { showNumber } from '../../format';
import type { Item, Measure } from '../../ladder';
import type { SharesDesign } from './designs';
import { generator, salt } from './draw';
import {
  plantShares,
  SHARE_LEVELS,
  SHARES_COMPONENT,
  SHARES_LEVEL_MISSES,
  SHARES_NESTED_MISSES,
  SHARES_RECOVERY,
  SHARES_STREAM,
  type SharesDataset,
} from './plant-shares';

export {
  plantShares,
  SHARE_LEVELS,
  SHARES_COMPONENT,
  SHARES_LEVEL_MISSES,
  SHARES_NESTED_MISSES,
  SHARES_RECOVERY,
  SHARES_STREAM,
  type SharesDataset,
};

/**
 * Level 4 of the statistics validator: the pilot analysis recovers planted variance shares. Each dataset is a
 * balanced pilot (cells, conversations, wordings, repeats) whose pass chance per wording is planted on the logit
 * scale with a random effect per level; the truth is the variance those chances carry in this design, computed
 * here by the balanced nested formula, and a share is recovered when its truth lies inside the bootstrap
 * interval the pilot analysis gives for it.
 */

/** The pilot analysis the level scores. Tests replace it to plant a fault. */
export type PilotAnalyser = typeof analysePilot;

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
  stream = 0,
): Measure {
  const items: Item[] = [];
  let recovered = 0;
  let planted = 0;
  for (let dataset = 0; dataset < design.datasets; dataset += 1) {
    const { observations, chances, bootstrapSeed } = plantShares(
      generator(seed, salt(4, SHARES_STREAM * stream + dataset)),
      design,
    );
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
