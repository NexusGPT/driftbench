import type { RunResult } from '@agent-nexus/driftbench-core';
import type { CampaignDiagnosis } from './fixplan';
import type { StepOutput } from './steps';
import type { Confidence, Disposition } from './types';

/** F5 supplies runs, never a second list of diagnoses. Only complete blame outputs enter recurrence. */
export function campaignDiagnoses(runs: readonly RunResult[]): CampaignDiagnosis[] {
  return runs.flatMap((run) =>
    run.blocks.flatMap((block) =>
      (
        (block as typeof block & { diagnoses?: Array<StepOutput & { diagnostic?: string }> }).diagnoses ?? []
      ).flatMap((one) => {
        const item = one.evidence?.item;
        const home = one.evidence?.home;
        if (
          !one.verdictRef ||
          !one.rule ||
          !one.fixLocation ||
          !one.fixAction ||
          !one.placement ||
          !Array.isArray(one.fault) ||
          !Array.isArray(one.fixForms) ||
          typeof item !== 'string' ||
          typeof home !== 'string' ||
          !['agent', 'shared', 'setup', 'excluded', 'credited', 'unassigned'].includes(
            one.disposition ?? '',
          ) ||
          !['static', 'undecided', 'confirmed'].includes(one.confidence ?? '')
        )
          return [];
        return [
          {
            block: `${run.runId}:${block.index}`,
            diagnostic: one.diagnostic ?? 'diagnostic/code-agent-liability',
            verdict_ref: one.verdictRef,
            rule: one.rule,
            ...(one.by === undefined ? {} : { by: one.by }),
            ...(one.inherits === undefined ? {} : { inherits: one.inherits }),
            fault: one.fault,
            disposition: one.disposition as Disposition,
            fix_location: one.fixLocation,
            ...(one.fixTarget === undefined ? {} : { fix_target: one.fixTarget }),
            fix_action: one.fixAction,
            fix_forms: one.fixForms,
            placement: one.placement,
            evidence: one.evidence ?? {},
            confidence: one.confidence as Confidence,
            flags: one.flags ?? [],
            ...(one.removeCopies === undefined ? {} : { remove_copies: one.removeCopies }),
            item,
            home,
            ...(typeof one.evidence?.act === 'string' ? { act: one.evidence.act } : {}),
          },
        ];
      }),
    ),
  );
}
