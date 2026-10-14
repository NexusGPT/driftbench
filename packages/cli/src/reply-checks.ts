import type { ReplyChecks } from '@agent-nexus/driftbench-users';

/** The reply checks of several injections, added up. */
export type ReplyChecksTotal = {
  total: number;
  applied: number;
  /** Not applicable because the spec states no stage there. */
  noStage: number;
  /** Not applicable because the spec states a stage the check is not tied to. */
  otherStage: number;
};

export function totalOf(all: readonly ReplyChecks[]): ReplyChecksTotal {
  const sum: ReplyChecksTotal = { total: 0, applied: 0, noStage: 0, otherStage: 0 };
  for (const entry of all) {
    sum.total += entry.total;
    sum.applied += entry.applied;
    for (const skipped of entry.notApplicable) {
      if (skipped.reason === 'no stage') sum.noStage += 1;
      else sum.otherStage += 1;
    }
  }
  return sum;
}

/** The summary line, or undefined when every reply check applied. */
export function summaryLine(sum: ReplyChecksTotal): string | undefined {
  const skipped = sum.noStage + sum.otherStage;
  if (skipped === 0) return undefined;
  const why =
    sum.noStage > 0 && sum.otherStage > 0
      ? `${sum.noStage} no stage, ${sum.otherStage} tied to another stage`
      : sum.noStage > 0
        ? 'no stage'
        : 'tied to another stage';
  return `Reply checks: ${sum.applied} of ${sum.total} applied, ${skipped} not applicable (${why}).`;
}

/** The one warning for checks dropped for want of a stage: names the pack and the stages it ties checks to. */
export function noStageWarning(
  sum: ReplyChecksTotal,
  all: readonly ReplyChecks[],
  pack: string,
  specId: string,
  blocks: readonly number[],
): string | undefined {
  if (sum.noStage === 0) return undefined;
  const stages = [
    ...new Set(all.flatMap((entry) => entry.notApplicable.flatMap((skipped) => skipped.at_stage))),
  ].sort();
  const where = [...new Set(blocks)].sort((a, b) => a - b).join(', ');
  return `Warning: ${pack} ties ${sum.noStage} reply ${sum.noStage === 1 ? 'check' : 'checks'} to the stages ${stages.join(', ')}, but ${specId} states no stage before block ${where}. ${sum.noStage === 1 ? 'It was' : 'They were'} not applied, so this result is not a full pass.`;
}
