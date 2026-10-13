// Runtime network amendment; original journals stay append-only and answered requests always replay.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendRecording, readRecordingRows } from './recording-files';
import { LedgerBudgetStop, LedgerRateLimitStop, LedgerPrepaymentStop, LedgerProbeStop, LedgerUncertainCall,
  isPrepaymentRejection, transportRetryable, type CallIdentity, type LedgerCall, type LedgerCompletion } from './rubric-ledger-calls';
export { LedgerBudgetStop, LedgerRateLimitStop, LedgerPrepaymentStop, LedgerProbeStop };
type Start = { key: string; reserveUsd: number; identity: CallIdentity; startedAt: string };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
class NetworkLedgerCallsBase {
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
      const receipt = (e as { completion?: LedgerCompletion }).completion;
      const zeroReceipt = receipt?.costUsd === 0 && !receipt.text.trim() && receipt.usage?.output === 0;
      const rejected = httpStatus === 429 || httpStatus === 402 || zeroReceipt;
      const receiptCost = receipt?.costUsd;
      row = { key, model: identity.model, text: '', costUsd: rejected ? 0 : receiptCost ?? reserveUsd, item: identity.item,
        contestant: identity.contestant, status: 'error', costBasis: rejected ? 'no-answer' : receiptCost !== undefined ? 'reported' : 'reservation', identity,
        error: reason, retryable, ...(receipt ? { completion: receipt } : {}), ...(httpStatus === undefined ? {} : { httpStatus }),
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

const executeFile = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const connectionFailure = (row: LedgerCall) => row.status === 'error' &&
  !row.httpStatus && /network|transport|ECONN|ENOTFOUND|EAI_AGAIN|timed? ?out|timeout|socket|connection|ran past|without a JSON result/i.test(row.error ?? '');
export async function providerGate(provider: 'anthropic' | 'openai', model: string, force = false) {
  if (!force) {
    try {
      const state = JSON.parse(await readFile(`.cache/ledger-rb/${provider}-network-health.json`, 'utf8'));
      if (state.ready && state.model === model && Date.now() - Date.parse(state.at) < 600000) return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await executeFile('python3', ['examples/judge-benchmarks/src/rubric-ledger-network-health.py', provider, model], { maxBuffer: 1024 * 1024 });
}
export class NetworkLedgerCalls extends NetworkLedgerCallsBase {
  private consecutiveConnectionFailures = 0;
  private gate: Promise<void> | undefined;
  constructor(directory: string, capUsd: number, readonly model: string,
    readonly provider: 'anthropic' | 'openai', maxNewCalls = Infinity,
    beforeStart: (identity: CallIdentity) => void = () => undefined) {
    super(directory, capUsd, maxNewCalls, beforeStart);
  }
  async waitForNetwork() {
    this.gate ??= providerGate(this.provider, this.model);
    await this.gate;
  }
  override async complete(identity: CallIdentity, reserveUsd: number, execute: () => Promise<LedgerCompletion>,
    price: (completion: LedgerCompletion) => number | undefined, replayOnly = false): Promise<LedgerCall> {
    const same = (row: LedgerCall) => ['model','phase','item','contestant','sample','ordinal'].every((key) =>
      (row.identity as any)[key] === (identity as any)[key]) && JSON.stringify(row.identity.request) === JSON.stringify(identity.request);
    while (true) {
      const history = this.rows.filter(same);
      const answered = history.find((r) => r.status === 'ok');
      if (answered) return answered;
      if (!replayOnly) await this.waitForNetwork();
      const attempt = history.length ? Math.max(...history.map((r) => r.identity.transportAttempt ?? 0)) + 1 : 0;
      const base = { ...identity }; delete base.transportAttempt;
      const row = await super.complete({ ...base, ...(attempt ? { transportAttempt: attempt } : {}) }, reserveUsd, execute, price, replayOnly);
      if (row.status === 'ok') { this.consecutiveConnectionFailures = 0; return row; }
      if (row.httpStatus === 402 || row.httpStatus === 429 || !transportRetryable(row)) return row;
      if (connectionFailure(row)) this.consecutiveConnectionFailures++;
      else this.consecutiveConnectionFailures = 0;
      if (this.consecutiveConnectionFailures >= 3) {
        this.consecutiveConnectionFailures = 0;
        this.gate = (async () => {
          await appendRecording(join(this.directory, 'network-pauses.jsonl'), { at: new Date().toISOString(), model: this.model,
            reason: 'three consecutive connection failures', waitSeconds: 600, next: 'ten healthy probes, thirty seconds apart' });
          await sleep(600000); await providerGate(this.provider, this.model, true);
        })();
        await this.gate;
      } else await sleep(1000);
    }
  }
}
