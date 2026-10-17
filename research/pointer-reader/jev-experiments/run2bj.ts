// Usage: JEV_ROUTE=typesafe tsx jev-experiments/run2bj.ts <old|new> <pass> ...
// Jev choice question per unit on the harbour set, windows of 30 units with headings. "old" = the definitions of phase 4 (DEF6 wording 1);
// "new" = the six bullets of guide 2.1 verbatim (GUIDE4.md) plus the strongest-wins sentence. One call returns 30 answers; no other change.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ask, budget, config, loadCassette, type JevBody, type Question } from './src/jev';
import { dir } from './src/arms';
import { U, window2, windows } from './src/p2';
import { DEF6, L6, type Label6 } from './src/p4';

const scratch = process.env.JEV_SCRATCH || join(dir, 'scratch');
mkdirSync(scratch, { recursive: true });
mkdirSync(join(dir, 'results2b'), { recursive: true });
const replay = process.env.JEV_MODE === 'replay';
const cfg = config(dir, { cassettePath: replay ? join(dir, 'cassette2b.jsonl') : join(scratch, 'cassette2b.raw.jsonl'), budgetPath: join(scratch, 'budget2b.json'), maxCalls: 400 });
const cassette = loadCassette(cfg.cassettePath);
const STRONGEST = ' When a unit holds more than one kind of instruction, the strongest wins: prohibition, then gate, then rule.';
const DEF_NEW = (() => {
  const out = {} as Record<Label6, string>;
  for (const line of readFileSync(join(dir, 'GUIDE4.md'), 'utf8').split('\n')) { const m = /^- \*\*(\w+)\*\*: (.*)$/.exec(line); if (m && (L6 as readonly string[]).includes(m[1]!)) out[m[1] as Label6] = m[2]!; }
  for (const l of L6) if (!out[l]) throw new Error(`guide has no bullet for ${l}`);
  return out;
})();
const mode = process.argv[2] as 'old' | 'new';
for (const pass of process.argv.slice(3)) {
  const runId = `jev2b-${mode}-r${pass}`;
  const probs: Record<number, Record<string, number>> = {};
  const calls: Array<Record<string, unknown>> = [];
  const t0 = Date.now();
  for (const w of windows(U, 30)) {
    const questions: Record<string, Question> = {};
    for (const u of w) questions[`u${u.g}`] = { type: 'choice', instructions: `Which label does unit [${u.g}] of the window have?${mode === 'new' ? STRONGEST : ''}`, criteria: mode === 'new' ? DEF_NEW : DEF6[1] };
    const body: JevBody = { model: 'jev-latest', state: window2(w, 'path'), questions };
    const r = await ask(cfg, body, runId, cassette);
    const use = (r.raw as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
    calls.push({ units: w.length, ok: r.ok, status: r.status, ms: r.ms, tokIn: use?.input_tokens, tokOut: use?.output_tokens, ...(r.error ? { error: r.error } : {}) });
    for (const u of w) { const a = r.typed?.[`u${u.g}`]; if (r.ok && a?.probabilities) { const p = (probs[u.g] ??= {}); for (const [k, v] of Object.entries(a.probabilities)) p[k] = v; p._conf = a.confidence ?? 0; } }
  }
  const missing = U.filter((u) => !probs[u.g]).length;
  writeFileSync(join(dir, 'results2b', `${runId}.json`), JSON.stringify({ runId, variant: `jev2b-${mode}`, calls, probs, missing, wallMs: Date.now() - t0 }) + '\n');
  const b = budget(cfg.budgetPath);
  console.log(`${runId}: ${calls.length} calls, missing ${missing}/${U.length}, budget calls ${b.calls} errors ${b.errors} tokens ${b.tokensIn}/${b.tokensOut}`);
}
