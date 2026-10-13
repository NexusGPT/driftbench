import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { appendRecording, readRecordingRows } from './recording-files';

export type LedgerCompletion = {
  text: string;
  raw: string;
  fingerprint: string;
  costUsd?: number;
  usage?: { input?: number; output?: number };
  finishReason?: string;
  truncated?: boolean;
  refusal?: string;
};
export type CallIdentity = {
  model: string;
  phase: string;
  item: string;
  contestant: string;
  /** Each independent repeat and canonical third read has a distinct sampling identity. */
  sample: number;
  ordinal: number;
  /** Absent on the original attempt. Transport-only retries preserve the original key. */
  transportAttempt?: number;
  /** Owner-authorized top-up epoch; only previously rejected requests advance. */
  billingResume?: number;
  /** Runtime quota-reset epoch; returned answers never advance. */
  quotaResume?: number;
  transportFingerprint: string;
  request: unknown;
};
type Start = { key: string; reserveUsd: number; identity: CallIdentity; startedAt: string };
export type LedgerCall = {
  key: string;
  model: string;
  text: string;
  costUsd: number;
  item: string;
  contestant: string;
  status: 'ok' | 'error';
  costBasis: 'reported' | 'usage' | 'reservation' | 'no-answer';
  identity: CallIdentity;
  completion?: LedgerCompletion;
  error?: string;
  retryable?: boolean;
  httpStatus?: number;
  retryAfterMs?: number;
  reservationReleasedUsd?: number;
  completedAt?: string;
};
export class LedgerBudgetStop extends Error {}
export class LedgerRateLimitStop extends Error {}
export class LedgerPrepaymentStop extends Error {}
export class LedgerProbeStop extends Error {}
export class LedgerUncertainCall extends Error {}
export const isPrepaymentRejection = (row: Pick<LedgerCall, 'status' | 'httpStatus' | 'error'>): boolean =>
  row.status === 'error' && (row.httpStatus === 402 || /answered 402:/.test(row.error ?? ''));

export function billingIdentity(base: CallIdentity, calls: readonly LedgerCall[], authorizedEpoch?: number): CallIdentity {
  const request = JSON.stringify(base.request);
  const same = calls.filter(({ identity: i }) => i.model === base.model && i.phase === base.phase &&
    i.item === base.item && i.contestant === base.contestant && i.sample === base.sample &&
    i.ordinal === base.ordinal && i.transportFingerprint === base.transportFingerprint && JSON.stringify(i.request) === request);
  // Fresh requests inherit this run's top-up epoch too. Otherwise a new 402
  // at epoch zero could consume the same top-up authorization again on restart.
  let epoch = same.length ? Math.max(0, ...same.map((c) => c.identity.billingResume ?? 0)) : authorizedEpoch ?? 0;
  const billingRows = same.filter((c) => (c.identity.billingResume ?? 0) === epoch);
  const quotaEpoch = Math.max(0, ...billingRows.map((c) => c.identity.quotaResume ?? 0));
  const latest = billingRows.filter((c) => (c.identity.quotaResume ?? 0) === quotaEpoch)
    .sort((a, b) => (a.identity.transportAttempt ?? 0) - (b.identity.transportAttempt ?? 0)).at(-1);
  if (latest && isPrepaymentRejection(latest) && authorizedEpoch !== undefined && authorizedEpoch > epoch) epoch = authorizedEpoch;
  return epoch ? { ...base, billingResume: epoch } : base;
}
/** Includes the core's saved network-error text from journals written before retryable was recorded. */
export const transportRetryable = (row: { retryable?: boolean; error?: string }): boolean =>
  row.retryable ?? /fetch failed|could not be reached|timed? ?out|past \d+ ms|ECONNRESET|ECONNREFUSED|ENOTFOUND/i.test(row.error ?? '');

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Durable reservations prevent concurrent calls and restarts from exceeding the lane cap. */
export class LedgerCalls {
  private readonly completed = new Map<string, LedgerCall>();
  private readonly started = new Map<string, Start>();
  private pending: Promise<unknown> = Promise.resolve();
  private readonly live = new Map<string, Promise<LedgerCall>>();
  private newCalls = 0;
  private readonly prepaymentStoppedModels = new Set<string>();
  constructor(readonly directory: string, readonly capUsd: number, readonly maxNewCalls = Infinity,
    private readonly beforeStart: (identity: CallIdentity) => void = () => undefined) {
    if (!(capUsd > 0 && Number.isFinite(capUsd))) throw new Error('Invalid spend cap');
  }
  async load(): Promise<this> {
    await mkdir(this.directory, { recursive: true });
      for (const row of await readRecordingRows<Start>(join(this.directory, 'starts.jsonl'))) {
        if (this.started.has(row.key)) throw new Error(`Duplicate start: ${row.key}`);
        this.started.set(row.key, row);
      }
    for (const row of await readRecordingRows(join(this.directory, 'calls.jsonl'))) {
      const call = row as LedgerCall;
      if (this.completed.has(call.key)) throw new Error(`Duplicate completion: ${call.key}`);
      if (!this.started.has(call.key)) throw new Error(`Completion without reservation: ${call.key}`);
      // Preserve the raw journal. Only an explicit HTTP 402 releases a prior hold.
      this.completed.set(call.key, isPrepaymentRejection(call)
        ? { ...call, costUsd: 0, costBasis: 'no-answer', reservationReleasedUsd: call.costUsd }
        : call);
    }
    return this;
  }
  get chargedUsd(): number {
    return [...this.started].reduce((sum, [key, start]) => sum +
      (this.completed.get(key)?.costUsd ?? start.reserveUsd), 0);
  }
  get rows(): readonly LedgerCall[] { return [...this.completed.values()]; }
  get uncertainKeys(): readonly string[] {
    return [...this.started.keys()].filter((key) => !this.completed.has(key) && !this.live.has(key));
  }
  /** Caller first verifies that the interrupted runner and its children have stopped. */
  async recoverInterrupted(): Promise<number> {
    const keys = [...this.uncertainKeys];
    for (const key of keys) await this.serial(async () => {
      const start = this.started.get(key)!;
      const row: LedgerCall = { key, model: start.identity.model, item: start.identity.item,
        contestant: start.identity.contestant, identity: start.identity, text: '',
        status: 'error', costUsd: start.reserveUsd, costBasis: 'reservation', retryable: true,
        error: 'Runner interrupted; no client completion survived. Original reservation remains charged.' };
      await appendRecording(join(this.directory, 'calls.jsonl'), row);
      this.completed.set(key, row);
    });
    return keys.length;
  }
  private async serial<T>(f: () => Promise<T>): Promise<T> {
    const p = this.pending.then(f);
    this.pending = p.catch(() => undefined);
    return p;
  }
  complete(identity: CallIdentity, reserveUsd: number,
    execute: () => Promise<LedgerCompletion>,
    price: (completion: LedgerCompletion) => number | undefined,
    replayOnly = false): Promise<LedgerCall> {
    const key = hash(identity);
    const hit = this.completed.get(key);
    if (hit) return Promise.resolve(hit);
    const inflight = this.live.get(key);
    if (inflight) return inflight;
    const job = this.run(key, identity, reserveUsd, execute, price, replayOnly);
    this.live.set(key, job);
    job.then(() => this.live.delete(key), () => this.live.delete(key));
    return job;
  }
  private async run(key: string, identity: CallIdentity, reserveUsd: number,
    execute: () => Promise<LedgerCompletion>, price: (c: LedgerCompletion) => number | undefined,
    replayOnly: boolean): Promise<LedgerCall> {
    await this.serial(async () => {
      if (replayOnly) throw new Error(`Replay missing: ${identity.item} ${identity.contestant}`);
      if (this.started.has(key)) throw new LedgerUncertainCall(`Prior call has no completion: ${key}`);
      if (this.prepaymentStoppedModels.has(identity.model))
        throw new LedgerPrepaymentStop(`HTTP 402 circuit is open for ${identity.model}; no further request submitted`);
      if (this.newCalls >= this.maxNewCalls) throw new LedgerProbeStop('Single-call probe recorded; no second call submitted');
      this.beforeStart(identity);
      if (!Number.isFinite(reserveUsd) || reserveUsd <= 0) throw new Error('Invalid call reservation');
      if (this.chargedUsd + reserveUsd > this.capUsd + 1e-12)
        throw new LedgerBudgetStop(`USD ${this.capUsd} lane cap cannot reserve another USD ${reserveUsd}`);
      const start: Start = { key, reserveUsd, identity, startedAt: new Date().toISOString() };
      await appendRecording(join(this.directory, 'starts.jsonl'), start);
      this.started.set(key, start);
      this.newCalls++;
    });
    let row: LedgerCall;
    try {
      const completion = await execute();
      const estimated = price(completion);
      const cost = completion.costUsd ?? estimated;
      if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) throw new Error('Invalid provider cost');
      row = { key, model: identity.model, text: completion.text, costUsd: cost ?? reserveUsd,
        item: identity.item, contestant: identity.contestant, status: 'ok', identity, completion,
        costBasis: completion.costUsd !== undefined ? 'reported' : estimated !== undefined ? 'usage' : 'reservation' };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string }).code;
      const httpStatus = (e as { status?: number }).status;
      const retryAfterMs = (e as { retryAfterMs?: number }).retryAfterMs;
      const retryable = (e as { retryable?: boolean }).retryable === true ||
        code === 'network' || transportRetryable({ error: reason }) || /claude returned an error result|without a JSON result/i.test(reason);
      const rejected = httpStatus === 429 || httpStatus === 402;
      row = { key, model: identity.model, text: '', costUsd: rejected ? 0 : reserveUsd, item: identity.item,
        contestant: identity.contestant, status: 'error', costBasis: rejected ? 'no-answer' : 'reservation', identity,
        error: reason, retryable, ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
    }
    row.completedAt = new Date().toISOString();
    // A sibling job may still be finishing an answer. It can retain that answer,
    // but its next order must not start after this provider rejects prepayment.
    if (isPrepaymentRejection(row)) this.prepaymentStoppedModels.add(identity.model);
    await this.serial(async () => {
      await appendRecording(join(this.directory, 'calls.jsonl'), row);
      this.completed.set(key, row);
    });
    if (row.costUsd > reserveUsd + 1e-12)
      throw new LedgerBudgetStop(`Provider cost exceeded reservation for ${key}; recorded, stop and reproject`);
    return row;
  }
}
