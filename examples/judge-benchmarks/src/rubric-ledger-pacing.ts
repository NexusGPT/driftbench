import { transportRetryable, type LedgerCall } from './rubric-ledger-calls';

export function isHaikuTransportFailure(row: LedgerCall): boolean {
  return row.model === 'claude-haiku-5-5' && row.status === 'error' &&
    !row.error?.startsWith('Runner interrupted;') &&
    (transportRetryable(row) || /claude .*error|claude exited|without a JSON result|not a JSON result|cannot run claude/i.test(row.error ?? ''));
}

/** A pacing-only latch: active requests drain; later jobs use two workers. */
export class HaikuPacing {
  private reduced = false;
  update(loadOneMinute: number, calls: readonly LedgerCall[], now = Date.now()):
    { limit: number; newlyReduced: boolean; recentTransportFailures: number; reason?: string } {
    const recentTransportFailures = calls.filter((r) => isHaikuTransportFailure(r) && r.completedAt &&
      Date.parse(r.completedAt) <= now && now - Date.parse(r.completedAt) <= 600000).length;
    const reason = loadOneMinute > 60 ? 'host one-minute load exceeds 60' :
      recentTransportFailures >= 2 ? 'two Haiku transport failures within ten minutes' : undefined;
    const newlyReduced = !this.reduced && Boolean(reason);
    if (reason) this.reduced = true;
    return { limit: this.reduced ? 2 : 4, newlyReduced, recentTransportFailures, ...(newlyReduced ? { reason } : {}) };
  }
}
