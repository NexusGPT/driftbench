import { readFileSync, existsSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export const CAP_USD = 40;
export const CLAUDE_CALL_CAP = 400;
const PRICE: Record<string, number[]> = { 'gpt-6.1-sol': [2,.1,10], 'gpt-6-luna': [.1,.01,.5], 'gemini-3.5-flash-lite': [.3,.03,2.5] };
export type Prompt = { system: string; user: string };
type Receipt = { text: string; costUsd?: number; raw: unknown; usage?: unknown; sessionLimit?: boolean; providerError?: string; finishReason?: string; truncated?: boolean; refusal?: string };
type Hooks = { send?: (prompt: Prompt, schema: unknown, model: string) => Promise<Receipt>; probe?: () => Promise<void>; sleep?: (ms: number) => Promise<void> };
type Config = { dir: string; model: string; maxOutputTokens?: number; _test?: Hooks };
export const sha = (x: unknown) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export function readRows(path: string): any[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  // A partial last line indicates a crash during a write. Stop for reconciliation.
  if (raw && !raw.endsWith('\n')) throw Error('INCOMPLETE_JOURNAL ' + path);
  return raw.split('\n').filter(Boolean).map(x => JSON.parse(x));
}
export function append(path: string, value: unknown) {
  const fd = openSync(path, 'a', 0o600);
  try { writeSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}
export function spendTotals(dir: string) {
  const entries = readRows(resolve(dir, 'spend.jsonl'));
  const latest = new Map<string, any>();
  for (const entry of entries) latest.set(entry.attemptKey, entry);
  let spentUsd = 0, heldUsd = 0;
  for (const row of latest.values()) row.type === 'settle' ? spentUsd += row.amount : heldUsd += row.amount;
  return { spentUsd, heldUsd, committedUsd: spentUsd + heldUsd, capUsd: CAP_USD,
    reservations: entries.filter(r => r.type === 'reserve').length,
    claudeCalls: entries.filter(r => r.type === 'reserve' && r.model === 'claude-haiku-5-5').length };
}
export function reserveEstimate(model: string, prompt: Prompt, schema: unknown, maxOutputTokens: number) {
  if (model === 'claude-haiku-5-5') return .25;
  const p = PRICE[model]; if (!p) throw Error('UNAUTHORIZED_MODEL');
  // UTF-8 bytes conservatively bound text tokens. Include schema and protocol allowance.
  return ((Buffer.byteLength(JSON.stringify({ prompt, schema })) + 4096) * p[0] + maxOutputTokens * (model.startsWith('gemini') ? 2 : 1) * p[2]) / 1e6;
}
export function reserve(dir: string, attemptKey: string, model: string, amount: number) {
  const totals = spendTotals(dir);
  if (totals.committedUsd + amount > CAP_USD) throw Error('BUDGET_CAP');
  if (model === 'claude-haiku-5-5' && totals.claudeCalls >= CLAUDE_CALL_CAP) throw Error('CLAUDE_CALL_CAP');
  if (readRows(resolve(dir, 'spend.jsonl')).some(r => r.attemptKey === attemptKey)) throw Error('DUPLICATE_RESERVATION');
  append(resolve(dir, 'spend.jsonl'), { at: now(), type: 'reserve', attemptKey, model, amount });
}
export function networkLatched(events: any[]) {
  return events.some((e, i) => e.connectionFailure && events[i-1]?.connectionFailure && events[i-2]?.connectionFailure);
}
const connectionFailure = (e: any) => /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR|timeout|timed out|connection|HTTP 50[0234]/i.test(String(e) + ' ' + (e?.cause?.code ?? ''));
const states = new Map<string, any>();
function shared(dir: string) {
  let state = states.get(dir);
  if (!state) {
    const events = readRows(resolve(dir, 'network.jsonl'));
    const lastReset = events.findLastIndex(e => e.reset);
    const recent = events.slice(lastReset + 1);
    state = { active: 0, waiters: [] as (() => void)[], stopped: false, network: recent,
      pauseUntil: networkLatched(recent) ? Date.parse(recent.at(-1).at) + 600_000 : 0,
      gates: new Map<string, Promise<void>>(), inflight: new Map<string, Promise<any>>(), answered: new Map<string, any>(),
      terminal: readRows(resolve(dir, 'stops.jsonl')).at(-1)?.reason };
    const calls = readRows(resolve(dir, 'calls.jsonl'));
    for (const row of calls) if (row.answered) state.answered.set(row.logicalKey, row);
    const receipts = new Set(calls.map(row => row.attemptKey));
    const orphan = readRows(resolve(dir, 'spend.jsonl')).find(row => row.type === 'reserve' && !receipts.has(row.attemptKey));
    if (orphan) state.terminal = 'AMBIGUOUS_UNRECEIPTED_RESERVATION ' + orphan.attemptKey;
    states.set(dir, state);
  }
  return state;
}
async function acquire(s: any) {
  if (s.active >= 2) await new Promise<void>(r => s.waiters.push(r));
  else s.active++;
  return () => { const next = s.waiters.shift(); if (next) next(); else s.active--; };
}
function googleSchema(value: any): any {
  if (Array.isArray(value)) return value.map(googleSchema);
  if (!value || typeof value !== 'object') return value;
  const result: any = Object.fromEntries(Object.entries(value).filter(([key]) => !['additionalProperties','$schema'].includes(key)).map(([k,v]) => [k,googleSchema(v)]));
  if (Array.isArray(value.type)) { const types = value.type.filter((x: string) => x !== 'null'); if (types.length !== 1) throw Error('GOOGLE_SCHEMA_TYPE'); result.type = types[0]; if (value.type.includes('null')) result.nullable = true; }
  if (Array.isArray(value.anyOf)) { const types = value.anyOf.filter((x: any) => x.type !== 'null'); if (types.length === 1 && types.length < value.anyOf.length) { delete result.anyOf; Object.assign(result, googleSchema(types[0]), { nullable: true }); } }
  return result;
}
function key(name: 'openai.key' | 'gemini-driftbench.key') { return readFileSync(resolve(homedir(), '.nexus-secrets', name), 'utf8').trim(); }
export function claudeUser(prompt: Prompt, schema?: unknown) {
  return schema === undefined ? prompt.user : `${prompt.user}\n\nThink first in plain text. Then write the JSON object last, matching this schema:\n${JSON.stringify(schema)}`;
}
export function claudeConfig(prompt: Prompt, maxOutputTokens: number) {
  const env: Record<string,string|undefined> = { ...process.env, DISABLE_PROMPT_CACHING: '1', CLAUDE_CODE_MAX_RETRIES: '0', CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens), MAX_THINKING_TOKENS: '2048', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  for (const name of ['CLAUDECODE','OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_JUDGE_MODEL','CLAUDE_CODE_RETRY_WATCHDOG']) delete env[name];
  return { env, args: ['-p','--output-format','json','--model','haiku','--effort','medium','--system-prompt',prompt.system,'--tools','','--setting-sources','','--strict-mcp-config','--no-session-persistence','--disable-slash-commands','--max-turns','1','--max-budget-usd','0.25'] };
}
async function nativeClaude(prompt: Prompt, dir: string, maxOutputTokens: number, schema?: unknown): Promise<Receipt> {
  const cwd = resolve(dir, 'empty'); mkdirSync(cwd, { recursive: true });
  const { env, args } = claudeConfig(prompt, maxOutputTokens);
  return new Promise((yes,no) => {
    const child = spawn('claude',args,{cwd,env,stdio:['pipe','pipe','pipe']}); let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); },300_000);
    child.stdout.on('data',x => stdout += x); child.stderr.on('data',x => stderr += x);
    child.on('error',e => { clearTimeout(timer); no(e); });
    child.stdin.on('error',() => {}); child.stdin.end(claudeUser(prompt, schema));
    child.on('close',code => {
      clearTimeout(timer);
      if (timedOut && !stdout.trim()) { no(Error('Owned Claude connection timeout')); return; }
      if (/session.{0,20}limit|usage limit|hit your limit/i.test(stdout + stderr)) {
        let raw: any; try { raw = JSON.parse(stdout); } catch { raw = {stdout,stderr,code}; }
        yes({text:raw.result ?? '',raw,costUsd:raw.total_cost_usd,sessionLimit:true}); return;
      }
      let raw: any; try { raw = JSON.parse(stdout); } catch {
        if (stdout.trim()) yes({text:stdout,raw:{stdout,stderr,code},providerError:'CLAUDE_INVALID_ENVELOPE'});
        else no(Error('Claude exited without envelope: ' + code + ' ' + stderr.slice(0,1000)));
        return;
      }
      const observed = Object.keys(raw.modelUsage ?? {});
      const mismatch = observed.some(model => model !== 'claude-haiku-5-5');
      const errorText = String(raw.result ?? '') + ' ' + String(raw.subtype ?? '');
      const semanticError = raw.is_error && ((raw.usage?.output_tokens ?? 0) > 0 || /safeguard|content.policy|blocked|refusal|output.limit|max.tokens|max.output|token.limit/i.test(errorText));
      const finishReason = raw.stop_reason ?? raw.stopReason ?? raw.subtype;
      yes({ text: raw.result ?? '', raw: {...raw,stderr,exitCode:code}, usage:raw.usage, costUsd:raw.total_cost_usd,
        finishReason, truncated: Boolean(semanticError || /max_tokens|max_output/.test(finishReason ?? '')),
        ...(semanticError ? {refusal:'provider error: ' + errorText} : {}),
        ...(mismatch ? {providerError:'CLAUDE_MODEL_MISMATCH'} : raw.is_error && !semanticError ? {providerError:'CLAUDE_PROVIDER_ERROR'} : {}) });
    });
  });
}
async function apiSend(model: string, prompt: Prompt, schema: unknown, maxOutputTokens: number): Promise<Receipt> {
  const google = model.startsWith('gemini');
  const url = google ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` : 'https://api.openai.com/v1/responses';
  const headers: any = { 'content-type':'application/json', ...(google ? {'x-goog-api-key':key('gemini-driftbench.key')} : {Authorization:'Bearer ' + key('openai.key')}) };
  const body = google ? {systemInstruction:{parts:[{text:prompt.system}]},contents:[{role:'user',parts:[{text:prompt.user}]}],generationConfig:{maxOutputTokens,thinkingConfig:{thinkingLevel:'medium'},...(schema ? {responseMimeType:'application/json',responseSchema:googleSchema(schema)} : {})}} :
    {model,instructions:prompt.system,input:prompt.user,reasoning:{effort:'medium'},max_output_tokens:maxOutputTokens,store:false,service_tier:'default',...(schema ? {text:{format:{type:'json_schema',name:'judge_answer',strict:true,schema}}} : {})};
  const response = await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(300_000)});
  const rawText = await response.text();
  if (!response.ok) throw Error(`HTTP ${response.status}: ${rawText.slice(0,1500)}`);
  let raw: any; try { raw = JSON.parse(rawText); } catch { return {text:rawText,raw:rawText}; }
  const p = PRICE[model]; let costUsd: number | undefined;
  if (google) {
    const u = raw.usageMetadata;
    if (u && Number.isFinite(u.promptTokenCount)) costUsd = ((u.promptTokenCount - (u.cachedContentTokenCount ?? 0))*p[0] + (u.cachedContentTokenCount ?? 0)*p[1] + ((u.candidatesTokenCount ?? 0)+(u.thoughtsTokenCount ?? 0))*p[2])/1e6;
    const finishReason = raw.candidates?.[0]?.finishReason ?? raw.promptFeedback?.blockReason;
    const refusal = /SAFETY|BLOCK|PROHIBITED|RECITATION/.test(finishReason ?? '') || raw.promptFeedback?.blockReason ? String(finishReason) : undefined;
    return {finishReason, truncated: finishReason === 'MAX_TOKENS', refusal, text:(raw.candidates ?? []).flatMap((c:any) => (c.content?.parts ?? []).filter((x:any) => !x.thought).map((x:any) => x.text ?? '')).join('\n'),raw,costUsd,usage:u};
  }
  const u = raw.usage;
  if (u && Number.isFinite(u.input_tokens) && Number.isFinite(u.output_tokens)) costUsd = ((u.input_tokens-(u.input_tokens_details?.cached_tokens ?? 0))*p[0]+(u.input_tokens_details?.cached_tokens ?? 0)*p[1]+u.output_tokens*p[2])/1e6;
  const refusal = (raw.output ?? []).flatMap((o:any) => (o.content ?? []).filter((c:any) => c.type === 'refusal').map((c:any) => c.refusal)).join('\n') || undefined;
  return {finishReason:raw.status, truncated:raw.status === 'incomplete', refusal, text:(raw.output ?? []).flatMap((o:any) => o.type === 'message' ? (o.content ?? []).map((c:any) => c.text ?? c.refusal ?? '') : []).join('\n'),raw,costUsd,usage:u};
}
export function createTransport({dir,model,maxOutputTokens=4096,_test}: Config) {
  dir = resolve(dir); mkdirSync(dir,{recursive:true});
  if (!(model in PRICE) && model !== 'claude-haiku-5-5') throw Error('UNAUTHORIZED_MODEL');
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 8192) throw Error('OUTPUT_CAP_INVALID');
  const s = shared(dir), wait = _test?.sleep ?? sleep;
  const check = () => { if (s.stopped) throw Error('DRAINING'); if (s.terminal) throw Error(s.terminal); };
  const stopTerminal = (reason: string) => { s.terminal = reason; append(resolve(dir,'stops.jsonl'),{at:now(),reason,model}); };
  async function probe() {
    if (_test?.probe) return _test.probe();
    const google = model.startsWith('gemini');
    if (model === 'claude-haiku-5-5') {
      const response = await fetch('https://api.anthropic.com/v1/models',{signal:AbortSignal.timeout(20_000)});
      const raw = await response.text();
      if (response.status !== 401 || !/authentication_error/i.test(raw)) throw Error('HEALTH_HTTP_' + response.status);
      return {httpStatus:401,networkOnly:true,expectedAuthenticationChallenge:true};
    }
    const response = await fetch(google ? 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1' : 'https://api.openai.com/v1/models',
      {headers:google ? {'x-goog-api-key':key('gemini-driftbench.key')} : {Authorization:'Bearer '+key('openai.key')},signal:AbortSignal.timeout(20_000)});
    await response.arrayBuffer();
    if (!response.ok) throw Error('HEALTH_HTTP_' + response.status);
  }
  async function healthGate(): Promise<void> {
    check();
    const provider = model === 'claude-haiku-5-5' ? 'anthropic' : model.startsWith('gemini') ? 'google' : 'openai';
    if (s.gates.has(provider)) return s.gates.get(provider);
    const pending = (async () => {
      const recovering = Boolean(s.pauseUntil);
      if (s.pauseUntil) await wait(Math.max(0,s.pauseUntil-Date.now()));
      let successes = 0, failures = 0;
      while (successes < 10) {
        check();
        try { const details = await probe(); successes++; failures=0; append(resolve(dir,'probes.jsonl'),{at:now(),model,provider,healthy:true,consecutive:successes,...(details ?? {})}); }
        catch (e) { successes=0; failures++; append(resolve(dir,'probes.jsonl'),{at:now(),model,provider,healthy:false,error:String(e)}); if (/HEALTH_HTTP_(400|401|402|403|429)/.test(String(e))) { stopTerminal('HEALTH_CONFIGURATION_OR_QUOTA'); throw e; } }
        if (failures >= 3) { await wait(600_000); failures=0; }
        else if (successes < 10) await wait(30_000);
      }
      if (recovering) { s.pauseUntil=0; s.network=[]; append(resolve(dir,'network.jsonl'),{at:now(),reset:true,provider}); }
    })();
    s.gates.set(provider,pending);
    try { await pending; } catch(e) { s.gates.delete(provider); throw e; }
  }
  async function execute(prompt: Prompt, schema: unknown, meta: any, logicalKey: string) {
    for (;;) {
      check(); await healthGate();
      const release = await acquire(s);
      let row: any;
      try {
        check();
        if (s.pauseUntil) continue;
        if (s.answered.has(logicalKey)) return s.answered.get(logicalKey);
        if (model === 'claude-haiku-5-5' && (meta?.phase !== 'heldout' || !['writing','wp'].includes(meta?.benchmark))) throw Error('CLAUDE_HELDOUT_WRITING_ONLY');
        const attempt = readRows(resolve(dir,'spend.jsonl')).filter(r => r.type === 'reserve' && r.logicalKey === logicalKey).length;
        // Reservation history is authoritative even if the previous process crashed before recording a call.
        const previous = readRows(resolve(dir,'spend.jsonl')).filter(r => r.type === 'reserve' && r.attemptKey.startsWith(logicalKey + ':')).length;
        const attemptKey = logicalKey + ':' + (Math.max(attempt,previous)+1);
        const bound = reserveEstimate(model,prompt,schema,maxOutputTokens);
        reserve(dir,attemptKey,model,bound);
        const startedAt = now();
        try {
          const got = await (_test?.send ? _test.send(prompt,schema,model) : model === 'claude-haiku-5-5' ? nativeClaude(prompt,dir,maxOutputTokens,schema) : apiSend(model,prompt,schema,maxOutputTokens));
          row = {logicalKey,attemptKey,model,meta,startedAt,finishedAt:now(),answered:true,text:got.text,costUsd:got.costUsd ?? bound,costEstimated:got.costUsd === undefined,usage:got.usage,raw:got.raw,finishReason:got.finishReason,truncated:got.truncated,refusal:got.refusal};
          // Cache and durable raw receipt precede cost settlement and content checks.
          append(resolve(dir,'calls.jsonl'),row); s.answered.set(logicalKey,row);
          if (Number.isFinite(got.costUsd)) append(resolve(dir,'spend.jsonl'),{at:now(),type:'settle',attemptKey,model,amount:got.costUsd});
          const event={at:now(),connectionFailure:false}; s.network.push(event); append(resolve(dir,'network.jsonl'),event);
          if (got.sessionLimit) { stopTerminal('CLAUDE_SESSION_LIMIT_WAIT'); throw Error('CLAUDE_SESSION_LIMIT_WAIT'); }
          if (got.providerError) { stopTerminal(got.providerError); throw Error(got.providerError); }
          if (got.costUsd !== undefined && got.costUsd > bound) { stopTerminal('RESERVATION_BOUND_EXCEEDED'); throw Error('RESERVATION_BOUND_EXCEEDED'); }
          return row;
        } catch(e) {
          if (row?.answered) throw e;
          const isConnection=connectionFailure(e);
          append(resolve(dir,'calls.jsonl'),{logicalKey,attemptKey,model,meta,startedAt,finishedAt:now(),answered:false,error:String(e),reservationRetained:bound});
          const event={at:now(),connectionFailure:isConnection}; s.network.push(event); append(resolve(dir,'network.jsonl'),event);
          if (!isConnection) { stopTerminal('NONTRANSPORT_FAILURE ' + String(e)); throw e; }
          if (networkLatched(s.network)) { s.pauseUntil=Date.now()+600_000; s.gates.clear(); }
        }
      } finally { release(); }
      if (!s.pauseUntil) await wait(30_000);
    }
  }
  function ask(prompt: Prompt, schema?: unknown, meta?: any): Promise<any> {
    try { check(); } catch (e) { return Promise.reject(e); }
    const logicalKey = sha({model,prompt,schema:schema ?? null,maxOutputTokens,reasoning:'medium'});
    if (s.answered.has(logicalKey)) return Promise.resolve({...s.answered.get(logicalKey),cached:true});
    if (s.inflight.has(logicalKey)) return s.inflight.get(logicalKey);
    const pending = execute(prompt,schema,meta,logicalKey).finally(() => s.inflight.delete(logicalKey));
    s.inflight.set(logicalKey,pending); return pending;
  }
  return {ask,healthGate,totals:() => spendTotals(dir),stop:() => {s.stopped=true;},drain:async () => {await Promise.allSettled([...s.inflight.values()]);}};
}
