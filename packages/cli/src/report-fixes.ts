import { blame } from '@agent-nexus/driftbench-checks';
import type { Diagnosis } from '@agent-nexus/driftbench-core';
import type { CampaignData, ReportFix } from '@agent-nexus/driftbench-report';

/**
 * The fix list of a stored campaign: the fix plan (`diagnostic/fix-plan`) over every diagnosis its blocks hold.
 * A diagnosis moved to a core fix lists the local copies it replaces, as the plan ranks them: the failing blocks
 * of the agent first, then the cheaper fix. A campaign whose blocks hold no diagnosis has no fix list.
 */
export function reportFixes(data: Pick<CampaignData, 'runs'>, n = 10): ReportFix[] {
  const written = data.runs.flatMap((run) =>
    run.blocks.flatMap((block) =>
      ((block as { diagnoses?: readonly Diagnosis[] }).diagnoses ?? []).map((diagnosis) => ({
        runId: run.runId,
        blockIndex: block.index,
        verdictRef: diagnosis.verdictRef,
        diagnosis,
      })),
    ),
  );
  if (written.length === 0) return [];
  const plan = blame.fixPlan(blame.campaignDiagnoses(written), blame.shippedPolicy('policy/placement'), n);
  const ranked = plan.fixes.filter((fix) => fix.blocks > 0);
  return ranked.map((fix) => ({
    fixLocation: fix.fix_location,
    ...(fix.fix_target === undefined ? {} : { fixTarget: fix.fix_target }),
    fixAction: fix.fix_action,
    blocks: fix.blocks,
    agentBlocks: fix.agent_blocks,
    ...(fix.remove_copies.length === 0 ? {} : { removeCopies: fix.remove_copies }),
    ...(fix.superseded_by === undefined ? {} : { supersededBy: fix.superseded_by }),
    confidence: fix.confidence,
    ...(fix.rule_text === undefined ? {} : { ruleText: fix.rule_text }),
  }));
}

/** The scorecard option that carries the fix list; empty when there is none, so a campaign with no diagnosis is unchanged. */
export function fixListOption(data: Pick<CampaignData, 'runs'>): { attribution?: { fixes: ReportFix[] } } {
  const fixes = reportFixes(data);
  return fixes.length > 0 ? { attribution: { fixes } } : {};
}
