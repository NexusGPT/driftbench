import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Jev client for the experiments. The key is read from ~/.nexus-secrets/jev.key, used only in a header,
 * and never written to the cassette, the log or an error. Route as the judges package: gateway sends the
 * api-key header to the Nexus gateway, typesafe a bearer token to the direct API.
 */
const GATEWAY = 'https://jev-gateway.nexus-orga.gpt.nexus/v1/systemone';
const TYPESAFE = 'https://api.typesafe.ai/v1/systemone';

export type Question = { type: 'noul'; instructions: { question: string; focus?: string } };
export type JevBody = { model: string; state: unknown; questions: Record<string, Question> };
export type JevResult = {
  ok: boolean;
  status: number;
  ms: number;
  answers: Record<string, number>;
  raw: unknown;
  error?: string;
  cached?: boolean;
};

const secret = () => readFileSync(join(homedir(), '.nexus-secrets', process.env.JEV_KEY_FILE || 'jev.key'), 'utf8').trim();
const mask = (text: string) => {
  const k = secret();
  return k ? text.split(k).join('***') : text;
};

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export type Config = {
  route: 'gateway' | 'typesafe';
  url: string;
  model: string;
  cassettePath: string;
  budgetPath: string;
  maxCalls: number;
  mode: 'record' | 'replay';
};

export function config(dir: string, overrides: Partial<Config> = {}): Config {
  const route = (process.env.JEV_ROUTE as 'gateway' | 'typesafe') || 'gateway';
  return {
    route,
    url: process.env.JEV_URL || (route === 'gateway' ? GATEWAY : TYPESAFE),
    model: process.env.JEV_MODEL || 'jev-latest',
    cassettePath: join(dir, 'cassette.jsonl'),
    budgetPath: join(dir, 'budget.json'),
    maxCalls: 3000,
    mode: process.env.JEV_MODE === 'replay' ? 'replay' : 'record',
    ...overrides,
  };
}

type Cassette = Map<string, { key: string; run: string; ms: number; status: number; request: JevBody; response: unknown }>;
export function loadCassette(path: string): Cassette {
  const m: Cassette = new Map();
  const gz = path + '.gz';
  const text = existsSync(path) ? readFileSync(path, 'utf8') : existsSync(gz) ? gunzipSync(readFileSync(gz)).toString('utf8') : '';
  for (const line of text.split('\n').filter(Boolean)) {
    const e = JSON.parse(line);
    // One entry per (request, run): runs of the same request are separate recordings.
    m.set(`${e.key}#${e.run}`, e);
  }
  return m;
}

export type Budget = { calls: number; errors: number; tokensIn: number; tokensOut: number };
const live = new Map<string, Budget>();
/** One in-memory copy per file: parallel calls update it synchronously, then it is written out. */
export function budget(path: string): Budget {
  const hit = live.get(path);
  if (hit) return hit;
  const empty = { calls: 0, errors: 0, tokensIn: 0, tokensOut: 0 };
  const b = existsSync(path) ? { ...empty, ...JSON.parse(readFileSync(path, 'utf8')) } : empty;
  live.set(path, b);
  return b;
}

export async function ask(cfg: Config, body: JevBody, run: string, cassette: Cassette): Promise<JevResult> {
  const key = sha(JSON.stringify(body));
  const hit = cassette.get(`${key}#${run}`);
  if (hit) return toResult(hit.status, hit.ms, hit.response, true);
  if (cfg.mode === 'replay') throw new Error(`cassette miss ${key.slice(0, 12)} run ${run}`);
  const b = budget(cfg.budgetPath);
  if (b.calls >= cfg.maxCalls) throw new Error(`call budget ${cfg.maxCalls} reached`);
  const headers: Record<string, string> =
    cfg.route === 'gateway' ? { 'api-key': secret() } : { authorization: `Bearer ${secret()}` };
  let last: JevResult | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    b.calls++;
    writeFileSync(cfg.budgetPath, JSON.stringify(b));
    let status = 0;
    let payload: unknown;
    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(300_000),
      });
      status = res.status;
      const text = await res.text();
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { notJson: mask(text).slice(0, 500) };
      }
    } catch (e) {
      payload = { networkError: mask(String((e as Error).message ?? e)) };
    }
    const ms = Date.now() - t0;
    last = toResult(status, ms, payload, false);
    if (last.ok) {
      const u = (payload as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage;
      b.tokensIn += u?.input_tokens ?? 0;
      b.tokensOut += u?.output_tokens ?? 0;
      writeFileSync(cfg.budgetPath, JSON.stringify(b));
      break;
    }
    b.errors++;
    writeFileSync(cfg.budgetPath, JSON.stringify(b));
    console.error(`jev call failed (attempt ${attempt + 1}): status ${status} ${mask(JSON.stringify(payload)).slice(0, 600)}`);
  }
  const r = last!;
  // Failed calls are recorded too, with their status, so an error cap is reproducible.
  const entry = { key, run, ms: r.ms, status: r.status, request: body, response: r.raw };
  appendFileSync(cfg.cassettePath, JSON.stringify(entry) + '\n');
  cassette.set(`${key}#${run}`, entry);
  return r;
}

function toResult(status: number, ms: number, payload: unknown, cached: boolean): JevResult {
  const answers: Record<string, number> = {};
  const a = (payload as { answers?: Record<string, { noul?: unknown }> })?.answers;
  if (a && typeof a === 'object')
    for (const [k, v] of Object.entries(a)) if (typeof v?.noul === 'number') answers[k] = v.noul;
  const ok = status >= 200 && status < 300 && !!a;
  return { ok, status, ms, answers, raw: payload, cached, ...(ok ? {} : { error: mask(JSON.stringify(payload)).slice(0, 400) }) };
}
