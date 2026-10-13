import { LedgerRateLimitStop, type CallIdentity, type LedgerCall } from './rubric-ledger-calls';

export const GEMINI_WINDOW = {
  resetUtc: '2026-10-14T00:00:00Z',
  lastCallUtc: '2026-10-14T12:00:00Z',
  status: 'not run: daily quota',
  automaticResetResume: false,
  resumeAuthority: 'Explicit owner word only; finish other models first',
} as const;

/** Called before each new reservation, including retries after a backoff. */
export function checkQuotaWindow(model: string, now = Date.now(), ownerAuthorized = false): void {
  if (model !== 'gemini-3.8-flash') return;
  if (now >= Date.parse(GEMINI_WINDOW.lastCallUtc))
    throw new LedgerRateLimitStop('Gemini last-call cutoff reached; no answer and no judge error');
  if (!ownerAuthorized)
    throw new LedgerRateLimitStop('Gemini not run: daily quota; automatic reset resume disarmed; explicit owner authorization required');
}

export function requestHistory(base: CallIdentity, calls: readonly LedgerCall[]): LedgerCall[] {
  const request = JSON.stringify(base.request);
  return calls.filter(({ identity: i }) => i.model === base.model && i.phase === base.phase &&
    i.item === base.item && i.contestant === base.contestant && i.sample === base.sample &&
    i.ordinal === base.ordinal && i.transportFingerprint === base.transportFingerprint && JSON.stringify(i.request) === request);
}

/** A reset grants a new attempt only to a proven quota rejection, never an answer or 402. */
export function quotaIdentity(base: CallIdentity, calls: readonly LedgerCall[], authorizedEpoch?: number): CallIdentity {
  const same = requestHistory(base, calls).filter((r) => (r.identity.billingResume ?? 0) === (base.billingResume ?? 0));
  let epoch = same.length ? Math.max(...same.map((r) => r.identity.quotaResume ?? 0)) : authorizedEpoch ?? 0;
  const latest = same.filter((r) => (r.identity.quotaResume ?? 0) === epoch)
    .sort((a, b) => (a.identity.transportAttempt ?? 0) - (b.identity.transportAttempt ?? 0)).at(-1);
  if (latest?.status === 'error' && latest.httpStatus === 429 && authorizedEpoch !== undefined && authorizedEpoch > epoch)
    epoch = authorizedEpoch;
  return epoch ? { ...base, quotaResume: epoch } : base;
}
