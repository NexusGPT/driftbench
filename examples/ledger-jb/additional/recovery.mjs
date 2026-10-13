// Runtime-only network recovery. No prompt, settings, parser or score changes.
import {appendFileSync} from 'node:fs';
import {Journal} from '../src/harness.mjs';

export const logicalKey = key => key.replace(/:transport:\d+$/, '');
export const noAnswer = row => Boolean(row?.transportFailure && !row.returnedAnswer && !row.text);
export function missingRequests(rows) {
  const groups = new Map();
  for (const row of rows.filter(x => x.type === 'finish')) {
    const key = logicalKey(row.key);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].filter(([, values]) => values.every(noAnswer)).map(([key, values]) => ({key, last:values.at(-1)}));
}
export function zeroCostConfirmed(error) {
  const u = error.usage;
  return error.costUsd === 0 && u && u.input === 0 && u.output === 0 &&
    (u.cached ?? 0) === 0 && (u.cacheWrite ?? 0) === 0;
}

export class RecoveryJournal extends Journal {
  async recoverCall(key, reserveUsd, operation, metadata, {gate, guard, sleep, quotaBackoffMs}) {
    let quotaRetries = 0;
    // Saved answers are replayed before consulting the link or dispatching anything.
    const past = [...this.finishes.values()].filter(x => logicalKey(x.key) === key);
    const answered = past.find(x => !noAnswer(x));
    if (answered) return answered;
    let attempt = past.length ? Math.max(...past.map(x => x.transportAttempt ?? 1)) + 1 : 1;
    for (;;) {
      guard();
      await gate.before();
      guard();
      const attemptKey = attempt === 1 ? key : `${key}:transport:${attempt}`;
      const response = await this.call(attemptKey, reserveUsd, async () => {
        try {
          const value = await operation();
          return Number.isFinite(value.costUsd) && value.costUsd >= 0 ? value :
            {...value, costUsd:reserveUsd, costEstimated:true, costNote:'Returned answer lacks usage; reservation retained.'};
        } catch (error) {
          if (!['network','http','bad_response'].includes(error.code)) throw error;
          const provenZero = zeroCostConfirmed(error);
          const billingRejected = error.status === 402 && /prepayment credits are depleted/i.test(error.message);
          return {text:'', rawProvider:error.raw ?? null, returnedAnswer:error.code === 'bad_response',
            graderError:false, transportFailure:true, retryable:error.code === 'network' || error.retryable === true,
            errorCode:error.code, status:error.status ?? null, error:error.message,
            costUsd:provenZero || billingRejected ? 0 : Number.isFinite(error.costUsd) ? error.costUsd : reserveUsd,
            costEstimated:!provenZero && !billingRejected && !Number.isFinite(error.costUsd),
            costNote:provenZero ? 'Provider receipt confirms zero tokens and zero cost.' :
              billingRejected ? 'Provider confirms prepayment rejection.' : 'Preserve measured cost or unknown-cost reservation.',
            usage:error.usage ?? null, billingRejected, connectionClass:error.code === 'network'};
        }
      }, {...metadata, transportAttempt:attempt, recoveryAmendment:true});
      gate.observe(response);
      if (!noAnswer(response)) return response;
      if (response.status === 402) throw new Error('BILLING_STOP: HTTP 402; no automatic retry');
      if (response.status === 429) {
        if (quotaRetries >= quotaBackoffMs.length) throw new Error('QUOTA_STOP: no answer; recovery remains eligible');
        await sleep(quotaBackoffMs[quotaRetries++]);
      } else if (!response.retryable) throw new Error(`TRANSPORT_STOP: no answer, status ${response.status}`);
      else await sleep(1000);
      attempt++;
    }
  }
}

export function healthGate({model, path, sleep, guard, event = () => {}, fetchFn = fetch,
  now = () => Date.now(), spacingMs = 30000, cooldownMs = 600000, required = 10}) {
  const url = model === 'gpt-6.1-sol' ? 'https://api.openai.com/v1/models' : 'https://api.anthropic.com/v1/models';
  let healthy = false, consecutive = 0, failures = 0, until = 0, promise;
  const record = row => {appendFileSync(path, JSON.stringify({at:new Date(now()).toISOString(),model,...row})+'\n');event(row);};
  return {
    observe(row) {
      if (noAnswer(row) && (row.errorCode === 'network' || row.connectionClass)) failures++;
      else failures = 0;
      if (failures >= 3) {
        healthy = false; consecutive = 0; until = now() + cooldownMs; failures = 0;
        record({status:'network-paused',cooldownUntil:new Date(until).toISOString()});
      }
    },
    async before() {
      if (healthy) return;
      if (!promise) promise = (async () => {
        if (until > now()) await sleep(until-now());
        while (!healthy) {
          guard(); const started = now(); let row;
          try {
            // No key or generation: a 401 from the model-list endpoint proves a completed
            // provider HTTP round trip, not inference quality or quota availability.
            const response = await fetchFn(url, {method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});
            await response.text();
            row = {url,status:'health-probe',httpStatus:response.status,healthy:response.status === 401,elapsedMs:now()-started};
          } catch (error) {
            row = {url,status:'health-probe',healthy:false,errorClass:error.name,causeCode:error.cause?.code ?? null,elapsedMs:now()-started};
          }
          consecutive = row.healthy ? consecutive+1 : 0;
          record({...row,consecutive,required});
          if (consecutive >= required) {healthy=true;failures=0;break;}
          await sleep(Math.max(0,spacingMs-(now()-started)));
        }
        record({status:'health-gate-passed',consecutive,workers:2});
      })().finally(() => {promise=undefined;});
      await promise;
    },
  };
}
