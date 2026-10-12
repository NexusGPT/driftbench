/**
 * A panel vote weighted by each judge's agreement with the labels (its kappa from calibration), with an abstain on a
 * thin margin.
 *
 * Each vote counts at its judge's weight. A verdict needs more than half of the total weight, which counts the
 * inconclusive votes too, as plain majority does, and a margin of at least `margin` of the total weight between the
 * two sides. With equal weights and the default margin, a three-vote panel decides exactly as plain majority does.
 * Anything else is a split, which never counts as a pass or a fail.
 */

export type PanelVote = { judge: string; outcome: 'pass' | 'fail' | 'inconclusive' };
export type PanelOutcome = 'pass' | 'fail' | 'split';

/** The smallest margin, as a share of the total weight, that decides. Two of three equal votes give 1/3. */
export const DEFAULT_PANEL_MARGIN = 0.3;

export function weightedPanel(
  votes: readonly PanelVote[],
  weights: Readonly<Record<string, number>>,
  margin: number = DEFAULT_PANEL_MARGIN,
): PanelOutcome {
  let total = 0;
  let pass = 0;
  let fail = 0;
  for (const vote of votes) {
    const weight = Math.max(0, weights[vote.judge] ?? 0);
    total += weight;
    if (vote.outcome === 'pass') pass += weight;
    else if (vote.outcome === 'fail') fail += weight;
  }
  if (total === 0) return 'split';
  if (pass > total / 2 && (pass - fail) / total >= margin) return 'pass';
  if (fail > total / 2 && (fail - pass) / total >= margin) return 'fail';
  return 'split';
}
