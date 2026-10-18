import { z } from 'zod';
import { inconclusive, type JudgeRequest, type JudgeResult } from './contract';
import { groundEvidence } from './evidence';

export type CriterionRequirement = { readonly id: string; readonly requirement: string };

/** The caller owns the requirement set; an unsplit criterion is one complete requirement. */
export function requirementsFor(request: JudgeRequest): readonly CriterionRequirement[] {
  const requirements = request.requirements ?? [
    { id: request.criterion.name, requirement: request.criterion.rubric },
  ];
  if (
    !Array.isArray(requirements) ||
    requirements.some((r) => !r || typeof r.id !== 'string' || typeof r.requirement !== 'string')
  )
    throw new RangeError('criterion requirement ids and definitions must be strings');
  const normalized = requirements.map((r) => ({ id: r.id.trim(), requirement: r.requirement.trim() }));
  if (
    !normalized.length ||
    normalized.some((r) => !r.id || !r.requirement) ||
    new Set(normalized.map((r) => r.id)).size !== normalized.length
  )
    throw new RangeError('criterion requirements need unique nonempty ids and nonempty definitions');
  return normalized;
}

export const CriterionLedger = z.strictObject({
  checks: z
    .array(
      z.strictObject({
        id: z.string().trim().min(1),
        reasoning: z.string(),
        evidence: z.string().trim().min(1).nullable(),
        met: z.boolean().nullable(),
      }),
    )
    .min(1),
});
export type CriterionLedger = z.infer<typeof CriterionLedger>;

/** Every requested id must be present once. Unknown ids are ignored and retained as diagnostics. */
export function parseCriterionLedger(value: unknown, request: JudgeRequest, raw: string): JudgeResult {
  const expected = requirementsFor(request);
  const names = new Set(expected.map((r) => r.id));
  const ignoredRequirementIds: string[] = [];
  let known = value;
  if (value !== null && typeof value === 'object' && 'checks' in value && Array.isArray(value.checks)) {
    const checks = value.checks.filter((row: unknown) => {
      if (
        row !== null &&
        typeof row === 'object' &&
        'id' in row &&
        typeof row.id === 'string' &&
        !names.has(row.id.trim())
      ) {
        ignoredRequirementIds.push(row.id.trim());
        return false;
      }
      return true;
    });
    known = { ...value, checks };
  }
  const diagnostics = ignoredRequirementIds.length ? { ignoredRequirementIds } : {};
  const invalid = (why: string): JudgeResult => ({
    raw,
    unparsed: true,
    ...diagnostics,
    answer: inconclusive(`invalid criterion ledger: ${why}`),
  });
  const parsed = CriterionLedger.safeParse(known);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid structure');
  const checks = parsed.data.checks;
  if (new Set(checks.map((check) => check.id)).size !== checks.length)
    return invalid('duplicate requirement id');
  const missing = expected.filter((r) => !checks.some((check) => check.id === r.id)).map((r) => r.id);
  if (missing.length) return invalid(`missing requirement ids: ${missing.join(', ')}`);
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
    ...diagnostics,
    answer: {
      outcome,
      reasoning: expected
        .map((r) => `${r.requirement}: ${checks.find((check) => check.id === r.id)?.reasoning}`)
        .join('\n'),
      ...(checks.find((check) => check.evidence !== null)?.evidence
        ? { evidence: checks.find((check) => check.evidence !== null)?.evidence as string }
        : {}),
    },
  };
}
