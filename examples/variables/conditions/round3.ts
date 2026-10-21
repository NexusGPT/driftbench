import { round2Options, round2Systems } from './round2';

/** DEV baseline; a selected profile is frozen here before any frozen4 access. */
export const ROUND3_THRESHOLD = 0.5;
export const round3Options = {
  ...round2Options,
  decide: { yesAt: ROUND3_THRESHOLD, noAt: ROUND3_THRESHOLD },
};
export const round3Systems = round2Systems;
