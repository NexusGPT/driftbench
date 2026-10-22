import { analysePilot, type PilotObservation } from '@agent-nexus/driftbench-generate';
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

/** Datasets of one stream draw from salts `SHARES_STREAM * stream + dataset`, so two designs never share draws. */
export const SHARES_STREAM = 1000;

/**
 * The bars of the share recovery, set by the false failures of the correct analysis and the faults they must catch.
 *
 * Measured 2026-10-14 on 89b41779f, seeds 1 to 164, 32 datasets per seed (5248 datasets of the committed design):
 * a correct analysis misses 4 cell, 184 conversation, 71 wording and 12 repeat shares (0.0008, 0.0351, 0.0135,
 * 0.0023 per dataset); one dataset misses 0, 1 or 2 shares with chance 0.9497, 0.0490 and 0.0013. With 8 datasets,
 * no bar keeps both: at most 2 misses of 32 and 2 of 8 per level fails a correct analysis on about 1.1e-2 of the
 * seeds (the hidden seed 305826193 of main 4dc61151 gave 29 of 32), and the best bars under 1e-4 catch the
 * residual over N on 0.85 of the seeds and the swap below on 0.43, against 0.97 and 0.58 at the earlier bars
 * (datasets resampled from the planted runs). The design now draws 20 datasets. At most 7 misses of 80 (0.9125), and per level at
 * most 2 (cell), 5 (conversation), 4 (wording) and 2 (repeat) of 20, fail a correct analysis on 1.2e-5, 5.0e-7,
 * 4.7e-5, 5.9e-6 and 1.3e-5 of the seeds: 7.9e-5 in all, and none of the 164.
 *
 * Planted faults on the first 40 seeds, caught with 20 datasets at these bars and with 8 at the earlier ones: no
 * residual subtracted from the levels above it, 40 and 40; the residual mean square over N instead of its degrees
 * of freedom, 40 and 39; the cell and conversation shares swapped, 25 and 22. Not subtracting the nested lower
 * levels, 2 and 0: the nested design below catches it.
 */
export const SHARES_RECOVERY = 1 - 7 / 80;

/** At most this many of the committed design's 20 datasets may miss the planted share of each level. */
export const SHARES_LEVEL_MISSES: Readonly<Record<(typeof SHARE_LEVELS)[number], number>> = {
  cell: 2,
  conversation: 5,
  wording: 4,
  repeat: 2,
};

/**
 * At most this many of the nested design's 5 datasets may miss the planted conversation share. Measured on 1386
 * datasets of that design: a correct analysis misses it on 9 (0.0065), so 3 misses of 5 come on 2.7e-6 of the
 * seeds; an analysis that leaves the lower levels' variance in a level's mean square misses it on 75 of 80
 * (0.938), so it passes on about 2e-3 of the seeds.
 */
export const SHARES_NESTED_MISSES = 2;

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
