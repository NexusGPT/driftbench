import { canonicalJson, type RunMode, type RunResult, type Verdict } from '@driftbench/core';
import {
  benjaminiHochberg,
  type McNemarResult,
  mcnemar,
  nonInferiority,
  type PairedTable,
  type WilcoxonResult,
  wilcoxonSignedRank,
} from '@driftbench/stats';
import { type CampaignData, groupBy, runPassed, showTarget } from './data';
import type { Estimate, Rate } from './estimate';
import { rate } from './estimate';
import { count } from './format';
import { optional } from './reliability';

/** The verdict families whose failing gating verdict is a gating flag: a safety event, not a quality drop. */
export const DEFAULT_FLAG_FAMILIES = ['safety', 'forbidden', 'pii'] as const;

export type CompareOptions = {
  /** The largest drop in pass rate tolerated, as a proportion (0.02 for 2 points). */
  margin: number;
  /** Two-sided level of every interval and of the all-pass McNemar test. Default 0.05. */
  alpha?: number;
  /** False discovery rate of Benjamini-Hochberg across criteria. Default 0.05. */
  q?: number;
  /** Families whose failing gating verdict is a gating flag. Default safety, forbidden, pii. */
  flagFamilies?: readonly string[];
  /** Compare only these modes. Default: every mode both campaigns ran. */
  modes?: readonly RunMode[];
};

/** One side of a paired unit: the runs of one golden in one mode (one perturbation in P) in one campaign. */
export type UnitSide = {
  runs: number;
  /** Every repeat passes. */
  allPass: boolean;
  /** Mean drifting blocks per run. */
  drift: number;
  /** Per criterion: true when every decided occurrence over every repeat passes. */
  criteria: ReadonlyMap<string, { pass: boolean; gating: boolean }>;
  /** Flag families that fired: a failing gating verdict of the family somewhere in the unit. */
  flags: ReadonlySet<string>;
};

/** One golden in one mode, run by both campaigns. */
export type UnitPair = {
  unit: string;
  specId: string;
  mode: RunMode;
  perturbationId?: string;
  baseline: UnitSide;
  candidate: UnitSide;
};

export type CriterionComparison = {
  criterion: string;
  /** Gating in at least one occurrence. */
  gating: boolean;
  /** Paired units where both campaigns decided the criterion. */
  units: number;
  baselinePass: number;
  candidatePass: number;
  /** Units where the baseline passes and the candidate fails. */
  regressed: number;
  improved: number;
  /** McNemar exact on the discordant units. */
  pValue: number;
  /** Benjamini-Hochberg adjusted p-value across every criterion. */
  adjusted: number;
  /** A regression the false discovery rate control keeps: rejected and more regressed than improved units. */
  significantRegression: boolean;
  /** Baseline rate minus candidate rate, with Newcombe's paired interval. Positive: the candidate is worse. */
  effect: Estimate;
  /** Gating criteria only: the upper bound of the effect is below the margin. */
  nonInferior?: boolean;
};

export type CompareVerdict = 'non-inferior' | 'regressed' | 'unproven';

export type CompareResult = {
  baseline: { campaignId: string; targets: string[] };
  candidate: { campaignId: string; targets: string[] };
  margin: number;
  alpha: number;
  q: number;
  flagFamilies: string[];
  modes: RunMode[];
  pairs: UnitPair[];
  /** Units only one campaign ran, or ran on another spec version. */
  unpaired: Array<{ unit: string; reason: string }>;
  allPass: {
    baseline: Rate;
    candidate: Rate;
    table: PairedTable;
    mcnemar: McNemarResult;
    effect: Estimate;
    nonInferior: boolean;
  };
  drift: {
    baselineMean: number;
    candidateMean: number;
    /** Candidate minus baseline drift per unit: a positive sum of ranks means the candidate drifts more. */
    wilcoxon: WilcoxonResult;
  };
  criteria: CriterionComparison[];
  /** A flag family that fires in a unit for the candidate and not for the baseline. */
  newFlags: Array<{ unit: string; family: string }>;
  verdict: CompareVerdict;
  reasons: string[];
};

/** A criterion is a machine verdict family (tools, must, ledger...) or one judged criterion (judge.<name>). */
export function criterionOf(verdict: Verdict): string {
  return verdict.kind === 'judge' ? verdict.id : verdict.name;
}

/**
 * P4.3: compares a candidate campaign with a baseline campaign on the goldens both ran.
 *
 * The paired unit is one golden in one mode (one perturbation in P): the spec id, at the same hash in both
 * campaigns, else the unit is left unpaired. When a campaign runs the spec on several targets, the target is
 * part of the unit. A unit passes when every repeat passes.
 *
 * - All-pass: McNemar exact on the discordant units; the effect is the baseline rate minus the candidate
 *   rate with Newcombe's paired interval.
 * - Drift: Wilcoxon signed-rank on the mean drift count per unit.
 * - Criteria: per criterion, McNemar on the units where both campaigns decided it; Benjamini-Hochberg across
 *   criteria before a criterion is said to regress.
 * - Verdict: non-inferior when the all-pass effect and every gating criterion's effect have an upper bound
 *   below the margin, and no flag family fires for the candidate where it did not for the baseline.
 *   Otherwise regressed when there is evidence of a drop (a new flag, a criterion the false discovery rate
 *   control keeps, or the all-pass McNemar below alpha with more regressed units), else unproven: the
 *   intervals are wider than the margin.
 */
export function compareCampaigns(
  baseline: CampaignData,
  candidate: CampaignData,
  options: CompareOptions,
): CompareResult {
  const { margin } = options;
  if (!(margin > 0 && margin < 1)) throw new RangeError(`compare: margin must lie in (0, 1), got ${margin}`);
  const alpha = options.alpha ?? 0.05;
  const q = options.q ?? 0.05;
  const flagFamilies = [...(options.flagFamilies ?? DEFAULT_FLAG_FAMILIES)];
  const shared = (['T', 'F', 'P'] as const).filter(
    (mode) =>
      baseline.runs.some((run) => run.mode === mode) && candidate.runs.some((run) => run.mode === mode),
  );
  const modes = options.modes ? shared.filter((mode) => options.modes?.includes(mode)) : [...shared];

  const keep = (run: RunResult) => modes.includes(run.mode);
  const left = unitsOf(baseline.runs.filter(keep), flagFamilies);
  const right = unitsOf(candidate.runs.filter(keep), flagFamilies);
  const pairs: UnitPair[] = [];
  const unpaired: CompareResult['unpaired'] = [];
  for (const [unit, b] of left) {
    const c = right.get(unit);
    if (!c) {
      unpaired.push({ unit, reason: 'baseline only' });
      continue;
    }
    if (b.specHash !== c.specHash) {
      unpaired.push({
        unit,
        reason: `the spec changed between the campaigns: ${b.specHash} and ${c.specHash}`,
      });
      continue;
    }
    pairs.push({
      unit,
      specId: b.specId,
      mode: b.mode,
      ...(b.perturbationId === undefined ? {} : { perturbationId: b.perturbationId }),
      baseline: b.side,
      candidate: c.side,
    });
  }
  for (const unit of right.keys()) if (!left.has(unit)) unpaired.push({ unit, reason: 'candidate only' });
  if (pairs.length === 0) throw new RangeError('compare: the two campaigns share no golden in a shared mode');

  const flagsB = pairs.map((pair) => pair.baseline.allPass);
  const flagsC = pairs.map((pair) => pair.candidate.allPass);
  const all = nonInferiority({
    baseline: flagsB,
    candidate: flagsC,
    margin,
    alpha,
    pairs: pairs.map((pair) => pair.unit),
  });
  const table = tableOf(flagsB, flagsC);
  const allPass = {
    baseline: rate(flagsB.filter(Boolean).length, pairs.length) as Rate,
    candidate: rate(flagsC.filter(Boolean).length, pairs.length) as Rate,
    table,
    mcnemar: mcnemar(table.regressed, table.improved, { exact: true }),
    effect: newcombe(all.effect),
    nonInferior: all.effect.upper < margin,
  };

  const driftB = pairs.map((pair) => pair.baseline.drift);
  const driftC = pairs.map((pair) => pair.candidate.drift);
  const drift = {
    baselineMean: driftB.reduce((a, b) => a + b, 0) / pairs.length,
    candidateMean: driftC.reduce((a, b) => a + b, 0) / pairs.length,
    wilcoxon: wilcoxonSignedRank(driftC, driftB),
  };

  const criteria = criteriaOf(pairs, margin, alpha, q);
  const newFlags = pairs.flatMap((pair) =>
    [...pair.candidate.flags]
      .filter((family) => !pair.baseline.flags.has(family))
      .sort()
      .map((family) => ({ unit: pair.unit, family })),
  );

  const reasons: string[] = [];
  const wide = criteria.filter((entry) => entry.gating && entry.nonInferior === false);
  const allPassDrop = allPass.mcnemar.pValue < alpha && table.regressed > table.improved;
  if (allPassDrop) {
    reasons.push(
      `all-pass dropped: McNemar exact p = ${allPass.mcnemar.pValue.toFixed(4)} below ${alpha}, ${table.regressed} goldens regressed and ${table.improved} improved`,
    );
  }
  for (const entry of criteria.filter((row) => row.significantRegression)) {
    reasons.push(
      `${entry.criterion} regressed: ${entry.regressed} goldens regressed and ${entry.improved} improved, adjusted p = ${entry.adjusted.toFixed(4)} under the false discovery rate ${q}`,
    );
  }
  for (const flag of newFlags) reasons.push(`new gating flag ${flag.family} in ${flag.unit}`);
  if (!allPass.nonInferior) {
    reasons.push(
      `all-pass: the upper bound ${pct(allPass.effect.upper)} of the regression effect is not below the margin ${pct(margin)}`,
    );
  }
  for (const entry of wide) {
    reasons.push(
      `${entry.criterion}: the upper bound ${pct(entry.effect.upper)} is not below the margin, over ${count(entry.units, 'golden')} (${entry.regressed} regressed, ${entry.improved} improved)`,
    );
  }
  const nonInferior = allPass.nonInferior && wide.length === 0 && newFlags.length === 0;
  const evidence =
    newFlags.length > 0 || criteria.some((entry) => entry.significantRegression) || allPassDrop;
  const verdict: CompareVerdict = nonInferior ? 'non-inferior' : evidence ? 'regressed' : 'unproven';
  if (nonInferior) {
    reasons.push(
      `every gating criterion and the all-pass flag have an upper bound below the margin ${pct(margin)}, and no new gating flag`,
    );
  }

  return {
    baseline: { campaignId: baseline.campaign.campaignId, targets: targetsOf(baseline) },
    candidate: { campaignId: candidate.campaign.campaignId, targets: targetsOf(candidate) },
    margin,
    alpha,
    q,
    flagFamilies,
    modes,
    pairs,
    unpaired,
    allPass,
    drift,
    criteria,
    newFlags,
    verdict,
    reasons,
  };
}

function targetsOf(data: CampaignData): string[] {
  return [...new Set(data.runs.map((run) => showTarget(run.target)))];
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)} points`;
}

function tableOf(baseline: readonly boolean[], candidate: readonly boolean[]): PairedTable {
  let bothPass = 0;
  let regressed = 0;
  let improved = 0;
  let bothFail = 0;
  baseline.forEach((b, index) => {
    const c = candidate[index] as boolean;
    if (b && c) bothPass += 1;
    else if (b) regressed += 1;
    else if (c) improved += 1;
    else bothFail += 1;
  });
  return { bothPass, regressed, improved, bothFail };
}

function newcombe(effect: { estimate: number; lower: number; upper: number; n: number }): Estimate {
  return { estimate: effect.estimate, lower: effect.lower, upper: effect.upper, method: 'newcombe', n: effect.n };
}

type UnitEntry = {
  specId: string;
  specHash: string;
  mode: RunMode;
  perturbationId?: string;
  side: UnitSide;
};

/**
 * The units of one campaign: its runs grouped by golden, mode and perturbation, and by target when the
 * campaign runs that golden on more than one target.
 */
export function unitsOf(runs: readonly RunResult[], flagFamilies: readonly string[]): Map<string, UnitEntry> {
  const base = (run: RunResult) =>
    `${run.specId} · ${run.mode}${run.perturbationId === undefined ? '' : ` · ${run.perturbationId}`}`;
  const out = new Map<string, UnitEntry>();
  for (const [name, group] of groupBy(runs, base)) {
    const byTarget = groupBy(group, (run) => canonicalJson(run.target));
    for (const targetRuns of byTarget.values()) {
      const first = targetRuns[0] as RunResult;
      const unit = byTarget.size > 1 ? `${name} · ${showTarget(first.target)}` : name;
      out.set(unit, {
        specId: first.specId,
        specHash: first.specHash,
        mode: first.mode,
        ...optional('perturbationId', first.perturbationId),
        side: sideOf(targetRuns, flagFamilies),
      });
    }
  }
  return out;
}

function sideOf(runs: readonly RunResult[], flagFamilies: readonly string[]): UnitSide {
  const criteria = new Map<string, { pass: boolean; gating: boolean }>();
  const flags = new Set<string>();
  for (const run of runs) {
    for (const block of run.blocks) {
      for (const verdict of block.verdicts) {
        if (verdict.outcome === 'inconclusive') continue;
        const name = criterionOf(verdict);
        const held = criteria.get(name) ?? { pass: true, gating: false };
        criteria.set(name, {
          pass: held.pass && verdict.outcome === 'pass',
          gating: held.gating || verdict.gating,
        });
        if (verdict.gating && verdict.outcome === 'fail' && flagFamilies.includes(verdict.name)) {
          flags.add(verdict.name);
        }
      }
    }
    if (run.endState && !run.endState.match) {
      const held = criteria.get('end_state') ?? { pass: true, gating: true };
      criteria.set('end_state', { pass: false, gating: held.gating });
    }
  }
  return {
    runs: runs.length,
    allPass: runs.every(runPassed),
    drift: runs.reduce((sum, run) => sum + run.succession.driftCount, 0) / runs.length,
    criteria,
    flags,
  };
}

function criteriaOf(pairs: readonly UnitPair[], margin: number, alpha: number, q: number): CriterionComparison[] {
  const names = new Set<string>();
  for (const pair of pairs) {
    for (const name of pair.baseline.criteria.keys()) if (pair.candidate.criteria.has(name)) names.add(name);
  }
  const rows = [...names].sort().map((criterion) => {
    const b: boolean[] = [];
    const c: boolean[] = [];
    let gating = false;
    for (const pair of pairs) {
      const left = pair.baseline.criteria.get(criterion);
      const right = pair.candidate.criteria.get(criterion);
      if (!left || !right) continue;
      b.push(left.pass);
      c.push(right.pass);
      gating = gating || left.gating || right.gating;
    }
    const table = tableOf(b, c);
    const test = mcnemar(table.regressed, table.improved, { exact: true });
    const ni = nonInferiority({ baseline: b, candidate: c, margin, alpha });
    return {
      criterion,
      gating,
      units: b.length,
      baselinePass: table.bothPass + table.regressed,
      candidatePass: table.bothPass + table.improved,
      regressed: table.regressed,
      improved: table.improved,
      pValue: test.pValue,
      effect: newcombe(ni.effect),
      ...(gating ? { nonInferior: ni.effect.upper < margin } : {}),
    };
  });
  const bh = benjaminiHochberg(
    rows.map((row) => row.pValue),
    q,
  );
  return rows
    .map((row, index) => ({
      ...row,
      adjusted: bh.adjusted[index] as number,
      significantRegression: (bh.rejected[index] as boolean) && row.regressed > row.improved,
    }))
    .sort(
      (a, b) =>
        Number(b.significantRegression) - Number(a.significantRegression) ||
        b.regressed - b.improved - (a.regressed - a.improved) ||
        a.adjusted - b.adjusted ||
        a.criterion.localeCompare(b.criterion),
    );
}
