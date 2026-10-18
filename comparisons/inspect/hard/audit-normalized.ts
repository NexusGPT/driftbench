import { parseAudit } from './audit';
import type { Outcome } from './harness';

/** Decode one copied JSON quote escape only when the resulting quote is actually present. */
export function parseNormalizedAudit(text: string, submission: string): Outcome {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, ''));
  } catch {
    return 'inconclusive';
  }
  if (value && typeof value === 'object' && 'checks' in value && Array.isArray(value.checks)) {
    for (const check of value.checks) {
      if (!check || typeof check !== 'object' || typeof check.evidence !== 'string') continue;
      if (submission.includes(check.evidence)) continue;
      const decoded = check.evidence.replace(/\\"/g, '"');
      if (decoded !== check.evidence && submission.includes(decoded)) check.evidence = decoded;
    }
  }
  return parseAudit(JSON.stringify(value), submission);
}
