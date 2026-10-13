/** Receipt interpretation only. No request, prompt, parser or scoring-policy changes. */
import type { LedgerCall } from './rubric-ledger-calls';
import { classifyProviderBlock, type DecisionRow } from './rubric-ledger-live';

export function nativeProviderBlockReason(call: LedgerCall): string | undefined {
  if (call.status !== 'ok' || !call.completion?.raw) return undefined;
  let raw: any;
  try { raw = JSON.parse(call.completion.raw); } catch { return undefined; }
  if (!raw.is_error || raw.usage?.output_tokens !== 0 || typeof raw.result !== 'string') return undefined;
  // The native CLI places a provider error in result, even though no model text exists.
  if (!raw.result.startsWith('API Error:') || !raw.result.includes('https://www.anthropic.com/legal/aup')) return undefined;
  return raw.result.match(/Details:\s*`([^`]+)`/)?.[1] ?? 'Anthropic provider policy block';
}

export function classifyAllProviderBlocks(row: DecisionRow, calls: readonly LedgerCall[]): DecisionRow {
  const base = classifyProviderBlock(row, calls), keys = new Set(row.callKeys);
  const native = calls.filter((c) => keys.has(c.key) && nativeProviderBlockReason(c)).map((c) => c.key);
  const blockedCallKeys = [...new Set([...(base.blockedCallKeys ?? []), ...native])];
  return blockedCallKeys.length ? { ...base, providerBlocked: true, blockedCallKeys,
    returnedDecisions: base.returnedDecisions ?? base.decisions, decisions: ['tie', 'tie'], status: 'provider-blocked' } : base;
}
