// Second labeller: Claude Haiku over the Messages API. The key is read from ~/.nexus-secrets/anthropic-driftbench.key,
// used only in a header, and never written to the cassette, a log or an error.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { sha } from './jev';

const key = () => readFileSync(join(homedir(), '.nexus-secrets', 'anthropic-driftbench.key'), 'utf8').trim();
const mask = (s: string) => s.split(key()).join('***');
export type HaikuBody = { model: string; max_tokens: number; system: string; messages: Array<{ role: 'user'; content: string }> };
export type HaikuEntry = { key: string; run: string; ms: number; status: number; request: HaikuBody; response: unknown };
export type HaikuCfg = { cassettePath: string; budgetPath: string; mode: 'record' | 'replay'; maxIn: number; maxOut: number };

export function loadHaiku(path: string): Map<string, HaikuEntry> {
  const m = new Map<string, HaikuEntry>();
  const text = existsSync(path) ? readFileSync(path, 'utf8') : existsSync(path + '.gz') ? gunzipSync(readFileSync(path + '.gz')).toString('utf8') : '';
  for (const l of text.split('\n').filter(Boolean)) { const e = JSON.parse(l) as HaikuEntry; m.set(`${e.key}#${e.run}`, e); }
  return m;
}
type HB = { calls: number; errors: number; tokensIn: number; tokensOut: number };
const live = new Map<string, HB>();
export function hbudget(path: string): HB {
  const hit = live.get(path); if (hit) return hit;
  const b = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as HB) : { calls: 0, errors: 0, tokensIn: 0, tokensOut: 0 };
  live.set(path, b); return b;
}
export async function haiku(cfg: HaikuCfg, cassette: Map<string, HaikuEntry>, body: HaikuBody, run: string): Promise<{ text: string; ok: boolean; status: number }> {
  const k = sha(JSON.stringify(body));
  const hit = cassette.get(`${k}#${run}`);
  const textOf = (r: unknown) => ((r as { content?: Array<{ type: string; text?: string }> })?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  if (hit) return { text: textOf(hit.response), ok: hit.status === 200, status: hit.status };
  if (cfg.mode === 'replay') throw new Error(`haiku cassette miss ${k.slice(0, 12)} ${run}`);
  const b = hbudget(cfg.budgetPath);
  if (b.tokensIn >= cfg.maxIn || b.tokensOut >= cfg.maxOut) throw new Error(`haiku token budget reached (${b.tokensIn} in, ${b.tokensOut} out)`);
  let last = { text: '', ok: false, status: 0 }, resp: unknown = null, ms = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now(); b.calls++;
    let status = 0;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key(), 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
      status = res.status; const t = await res.text();
      try { resp = JSON.parse(t); } catch { resp = { notJson: mask(t).slice(0, 400) }; }
    } catch (e) { resp = { networkError: mask(String((e as Error).message)) }; }
    ms = Date.now() - t0;
    last = { text: textOf(resp), ok: status === 200, status };
    if (last.ok) { const u = (resp as { usage?: { input_tokens?: number; output_tokens?: number } }).usage; b.tokensIn += u?.input_tokens ?? 0; b.tokensOut += u?.output_tokens ?? 0; writeFileSync(cfg.budgetPath, JSON.stringify(b)); break; }
    b.errors++; writeFileSync(cfg.budgetPath, JSON.stringify(b));
    console.error(`haiku call failed (attempt ${attempt + 1}): status ${status} ${mask(JSON.stringify(resp)).slice(0, 500)}`);
  }
  const entry: HaikuEntry = { key: k, run, ms, status: last.status, request: body, response: resp };
  appendFileSync(cfg.cassettePath, JSON.stringify(entry) + '\n'); cassette.set(`${k}#${run}`, entry);
  return last;
}
