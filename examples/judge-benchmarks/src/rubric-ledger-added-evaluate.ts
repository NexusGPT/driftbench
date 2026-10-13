// Isolated extension of the frozen evaluator. Judge prompts, parser, order, and retry contract are unchanged.
import { buildPrompt, canonicalPairOrder, judgePairLedger, pairLedgerRequest, pairLedgerSchema,
  parsePairLedgerText, scoreLedger, type DialectTransport, type JudgeClient, type JudgeRequest,
  type JudgeResult, type RubricItem } from '@agent-nexus/driftbench-judges';
import { contestantById, type PairDecision } from './contestants';
import type { PairItem } from './data';
import { LedgerBudgetStop, LedgerRateLimitStop, LedgerPrepaymentStop, LedgerProbeStop, LedgerCalls,
  billingIdentity, isPrepaymentRejection, transportRetryable } from './rubric-ledger-calls';
import { quotaIdentity, requestHistory } from './rubric-ledger-quota';
import { SETTINGS, candidateReference, flip, mapped, type DecisionRow, type EvaluationRuntime } from './rubric-ledger-live';
import { ADDED_LIMITS, type AddedModel } from './rubric-ledger-added-transports';
export type AddedDecisionRow = Omit<DecisionRow, 'model'> & { model: AddedModel };

export async function evaluateAdded(item: PairItem, requirements: readonly RubricItem[], model: AddedModel,
  phase: string, sample: number, contestant: 'pair-ledger' | 'promptfoo' | 'seat',
  raw: DialectTransport, calls: LedgerCalls, execute: boolean,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  authorizedBillingEpoch?: number, authorizedQuotaEpoch?: number, runtime: EvaluationRuntime = {}): Promise<AddedDecisionRow> {
  const rateLimitWaitMs = runtime.rateLimitWaitMs ?? SETTINGS.rateLimitWaitMs;
  const start = Date.now(); const callKeys: string[] = []; let ordinal = 0;
  const ask = async (request: { system: string; user: string; schema?: Record<string, unknown> }) => {
    const baseIdentity = { model, phase, item: item.id, contestant, sample, ordinal: ordinal++, transportFingerprint: raw.fingerprint, request };
    const history = requestHistory(baseIdentity, calls.rows);
    const answered = history.find((r) => r.status === 'ok');
    if (answered) { callKeys.push(...history.map((r) => r.key)); return answered; }
    const identity = quotaIdentity(billingIdentity(baseIdentity, calls.rows, authorizedBillingEpoch), calls.rows, authorizedQuotaEpoch);
    for (let attempt = 0; attempt <= rateLimitWaitMs.length; attempt++) {
      const row = await calls.complete({ ...identity, ...(attempt ? { transportAttempt: attempt } : {}) }, ADDED_LIMITS.reserveUsd,
        () => raw.complete(request), runtime.price ?? (() => undefined), !execute);
      callKeys.push(row.key);
      if (row.status === 'ok') return row;
      if (isPrepaymentRejection(row)) throw new LedgerPrepaymentStop(`HTTP 402 prepayment depleted for ${model}; no judge verdict recorded`);
      if (row.httpStatus === 429 || /answered 429:/.test(row.error ?? '')) {
        const waitMs = rateLimitWaitMs[attempt];
        if (waitMs === undefined) throw new LedgerRateLimitStop(`HTTP 429 retries exhausted for ${model}; no judge verdict recorded`);
        await sleep(Math.max(waitMs, row.retryAfterMs ?? 0));
        continue;
      }
      const retryable = transportRetryable(row);
      if (!retryable || attempt + 1 >= SETTINGS.transportTries) throw new Error(row.error ?? 'Recorded transport error');
    }
    throw new Error('Transport attempts exhausted');
  };
  const base = { model, phase, id: item.id, group: item.group, sample, contestant, label: item.label, callKeys };
  try {
    if (contestant === 'promptfoo') {
      const peer = contestantById('promptfoo'); const decisions: PairDecision[] = []; const errors: string[] = [];
      for (const swapped of [false, true]) {
        const p = peer.pair!({ question: item.question, criterion: item.criterion!,
          a: swapped ? item.b : item.a, b: swapped ? item.a : item.b });
        try {
          const row = await ask(p); const decision = peer.parsePair!(row.text);
          decisions.push(swapped ? flip(decision) : decision);
        } catch (e) {
          if (e instanceof LedgerBudgetStop || e instanceof LedgerRateLimitStop || e instanceof LedgerPrepaymentStop || e instanceof LedgerProbeStop || !execute) throw e;
          decisions.push('tie'); errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      return { ...base, decisions, status: errors.length ? 'transport-error' : decisions.includes('tie') ? 'missing-or-tie' : 'decided',
        ...(errors.length ? { error: errors.join('; ') } : {}), elapsedMs: Date.now() - start };
    }
    const canonical = canonicalPairOrder(item.a, item.b);
    const request = pairLedgerRequest({ name: 'expert-rubrics', rubric: item.criterion! },
      [{ role: 'user', text: item.question }], canonical.first, canonical.second, { requirements, reasoning: raw.reasoning });
    let previous: JudgeResult | undefined;
    const client: JudgeClient = { id: model, family: model === 'gpt-6.1-sol' ? 'openai' : 'anthropic',
      cls: 'system2', cost: 10, dialect: raw.dialect, reasoning: raw.reasoning,
      async judge(input: JudgeRequest) {
        if (input.system?.includes('Your previous answer broke the ledger contract.')) {
          if (!previous) throw new Error('Core requested a reask without a previous answer');
          return { ...previous, metadata: { graderError: true } };
        }
        const effective = { ...input, reference: await candidateReference(item, input.candidates!.A) };
        const row = await ask({ ...buildPrompt(effective), schema: pairLedgerSchema(effective) });
        previous = { ...parsePairLedgerText(row.text, effective), costUsd: row.costUsd };
        return previous;
      } };
    if (contestant === 'seat') {
      const result = await client.judge({ ...request, dialect: raw.dialect });
      const reading = result.pairLedger ? scoreLedger(result.pairLedger, requirements) : undefined;
      const decision = mapped(reading?.sign === 1 ? 'first' : reading?.sign === -1 ? 'second' : 'tie', canonical.firstIsOriginalFirst);
      return { ...base, decisions: [decision, decision], status: result.unparsed ? 'unparsed' : 'decided',
        detail: { result, reading }, elapsedMs: Date.now() - start };
    }
    const result = await judgePairLedger(client, request, { stage0: { correctness: false, compute: false }, tiePolicy: 'canonical' });
    const decision = mapped(result.choice, canonical.firstIsOriginalFirst);
    return { ...base, decisions: [decision, decision], status: result.status,
      detail: { ...result, coreJudgeInvocations: result.calls, calls: callKeys.length,
        contentReaskPolicy: 'Suppressed per owner: returned answers are never retried. Reask trace entries represent cached reparse only.' }, elapsedMs: Date.now() - start };
  } catch (e) {
    if (e instanceof LedgerBudgetStop || e instanceof LedgerRateLimitStop || e instanceof LedgerPrepaymentStop || e instanceof LedgerProbeStop || !execute) throw e;
    return { ...base, decisions: ['tie', 'tie'], status: 'transport-error', error: e instanceof Error ? e.message : String(e), elapsedMs: Date.now() - start };
  }
}
