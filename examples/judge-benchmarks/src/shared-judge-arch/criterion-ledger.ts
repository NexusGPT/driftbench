import { z } from 'zod';
import { inconclusive, type JudgeRequest, type JudgeResult } from './contract';
import { groundEvidence } from './evidence';

export const CriterionLedger = z.strictObject({
  checks: z
    .array(
      z.strictObject({
        requirement: z.string().trim().min(1),
        reasoning: z.string(),
        evidence: z.string().trim().min(1).nullable(),
        met: z.boolean().nullable(),
      }),
    )
    .min(1),
});
export type CriterionLedger = z.infer<typeof CriterionLedger>;

/** No model-emitted verdict is accepted: any unmet requirement fails, unknowns abstain, all met pass. */
export function parseCriterionLedger(value: unknown, request: JudgeRequest, raw: string): JudgeResult {
  const parsed = CriterionLedger.safeParse(value);
  const invalid = (why: string): JudgeResult => ({
    raw,
    unparsed: true,
    answer: inconclusive(`invalid criterion ledger: ${why}`),
  });
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid structure');
  const checks = parsed.data.checks;
  if (new Set(checks.map((check) => check.requirement.toLowerCase())).size !== checks.length)
    return invalid('duplicate requirement');
  for (const check of checks) {
    if (check.met === true && check.evidence === null)
      return invalid('a met requirement needs grounded evidence');
    if (
      check.evidence !== null &&
      !groundEvidence(request, { outcome: 'inconclusive', reasoning: '', evidence: check.evidence }).grounded
    )
      return invalid('the evidence quote is not in the supplied data');
  }
  const outcome = checks.some((check) => check.met === false)
    ? 'fail'
    : checks.some((check) => check.met === null)
      ? 'inconclusive'
      : 'pass';
  return {
    raw,
    checks,
    answer: {
      outcome,
      reasoning: checks.map((check) => `${check.requirement}: ${check.reasoning}`).join('\n'),
      ...(checks.find((check) => check.evidence !== null)?.evidence
        ? { evidence: checks.find((check) => check.evidence !== null)?.evidence as string }
        : {}),
    },
  };
}
