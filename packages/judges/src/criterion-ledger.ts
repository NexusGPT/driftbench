import { z } from 'zod';
import { inconclusive, type JudgeRequest, type JudgeResult } from './contract';
import { groundEvidence, groundEvidenceSpan } from './evidence';

export type CriterionRequirement = { readonly id: string; readonly requirement: string };
/**
 * Decoder identity is separate from the model-facing prompt. Version 2 is the default: an ungrounded
 * string quote is dropped and the check keeps its met value. Version 1 is the strict decoder, selectable
 * by name: any ungrounded quote voids the ledger. A version 1 recording keeps its key under version 1.
 * Version 2 also grounds a span quote of symbols alone in the exact source it names (see groundEvidenceSpan).
 */
export const CRITERION_DECODER_VERSION = 2;
export type CriterionDecoderVersion = 1 | 2;

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

const evidenceSpan = z.strictObject({
  source: z.string().trim().min(1),
  quote: z.string().trim().min(1),
});

export const CriterionLedger = z.strictObject({
  checks: z
    .array(
      z.strictObject({
        id: z.string().trim().min(1),
        reasoning: z.string(),
        evidence: z.union([z.string().trim().min(1), z.array(evidenceSpan).min(1), z.null()]),
        met: z.boolean().nullable(),
      }),
    )
    .min(1),
});
export type CriterionLedger = z.infer<typeof CriterionLedger>;
/** Grounding diagnostics are decoder output, never fields requested from the model. */
export type CriterionCheck = CriterionLedger['checks'][number] & { readonly grounded?: false };

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
  const checks: CriterionCheck[] = parsed.data.checks;
  if (new Set(checks.map((check) => check.id)).size !== checks.length)
    return invalid('duplicate requirement id');
  const missing = expected.filter((r) => !checks.some((check) => check.id === r.id)).map((r) => r.id);
  if (missing.length) return invalid(`missing requirement ids: ${missing.join(', ')}`);
  let evidenceUnverified = 0;
  const decoder = request.criterionDecoderVersion ?? CRITERION_DECODER_VERSION;
  for (const check of checks) {
    if (check.met === true && check.evidence === null)
      return invalid('a met requirement needs grounded evidence');
    if (
      check.evidence !== null &&
      !(typeof check.evidence === 'string'
        ? groundEvidence(request, { outcome: 'inconclusive', reasoning: '', evidence: check.evidence })
            .grounded
        : check.evidence.every(
            (span) => groundEvidenceSpan(request, span, { symbolQuotes: decoder === 2 }).grounded,
          ))
    ) {
      if (decoder !== 2 || typeof check.evidence !== 'string')
        return invalid('the evidence quote is not in the supplied data');
      // Preserve the model's met value, but never present an unverified string as a quote.
      check.evidence = null;
      Object.assign(check, { grounded: false });
      evidenceUnverified++;
    }
  }
  const evidence = checks.flatMap((check) =>
    check.evidence === null
      ? []
      : typeof check.evidence === 'string'
        ? [check.evidence]
        : check.evidence.map((span) => span.quote),
  )[0];
  const outcome = checks.some((check) => check.met === false)
    ? 'fail'
    : checks.some((check) => check.met === null)
      ? 'inconclusive'
      : 'pass';
  return {
    raw,
    checks,
    ...(evidenceUnverified ? { evidenceUnverified } : {}),
    ...diagnostics,
    answer: {
      outcome,
      reasoning: expected
        .map((r) => `${r.requirement}: ${checks.find((check) => check.id === r.id)?.reasoning}`)
        .join('\n'),
      ...(evidence === undefined ? {} : { evidence }),
    },
  };
}
