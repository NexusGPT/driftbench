import type { PilotObservation } from '@agent-nexus/driftbench-generate';
import type { SharesDesign } from './designs';
import { normal } from './draw';

/**
 * The planted data of the pilot-share level, apart from the level (shares.ts), which imports the pilot analysis of the
 * generate package and so, through it, the statistics package under test. The bank's reproducibility items plant data
 * from here and load nothing of the package.
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
