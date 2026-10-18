import { designEffect, wilson } from '@agent-nexus/driftbench-stats';

/** One run of an estate, with the session it belongs to and whether it passed. */
export interface SessionRun {
  readonly session: string;
  readonly pass: boolean;
}

export interface SessionRateResult {
  /** Passing runs over runs. */
  readonly estimate: number;
  /** The 95 percent Wilson bounds on the effective number of runs. */
  readonly lower: number;
  readonly upper: number;
  readonly sessions: number;
  readonly runs: number;
  /** 1 + (m - 1) rho, m the mean runs per session. */
  readonly designEffect: number;
  /** runs / designEffect: the independent runs the sessions are worth. */
  readonly effectiveRuns: number;
}

/**
 * The pass rate of an estate with the session as the unit (docs/estate.md, section 7). Runs of one session are one
 * cluster, so they are not independent: with m the mean runs per session and rho the correlation of runs inside a
 * session (the pilot's measured value, in [0, 1]), the design effect is 1 + (m - 1) rho, the effective runs are
 * runs / design effect, and the interval is the Wilson interval on round(effective runs) runs with
 * round(rate x that) passes. Throws a RangeError on no runs or a rho outside [0, 1].
 */
export function sessionRate(runs: readonly SessionRun[], options: { rho: number }): SessionRateResult {
  const { rho } = options;
  if (!(rho >= 0 && rho <= 1)) throw new RangeError(`sessionRate: rho must lie in [0, 1], got ${rho}`);
  if (runs.length === 0) throw new RangeError('sessionRate of no runs');
  const sessions = new Set(runs.map((run) => run.session)).size;
  const passes = runs.filter((run) => run.pass).length;
  const estimate = passes / runs.length;
  const de = designEffect(runs.length / sessions, rho);
  const effectiveRuns = runs.length / de;
  const n = Math.max(1, Math.round(effectiveRuns));
  const w = wilson(Math.min(n, Math.round(estimate * n)), n);
  return {
    estimate,
    lower: w.lower,
    upper: w.upper,
    sessions,
    runs: runs.length,
    designEffect: de,
    effectiveRuns,
  };
}
