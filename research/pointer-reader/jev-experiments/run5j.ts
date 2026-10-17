// Usage: JEV_ROUTE=typesafe tsx jev-experiments/run5j.ts <pass> ...
// Jev choice question per unit on the growth corpus (gold5), windows of 30 units of one file with heading lines, definitions of phase 4 (DEF6 wording 1).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ask, budget, config, loadCassette, type JevBody, type Question } from './src/jev';
import { dir, chunk } from './src/arms';
import { DEF6 } from './src/p4';

const scratch = process.env.JEV_SCRATCH || join(dir, 'scratch');
mkdirSync(scratch, { recursive: true }); mkdirSync(join(dir, 'results5'), { recursive: true });
const replay = process.env.JEV_MODE === 'replay';
const cfg = config(dir, { cassettePath: replay ? join(dir, 'cassette5.jsonl') : join(scratch, 'cassette5.raw.jsonl'), budgetPath: join(scratch, 'budget5.json'), maxCalls: 200 });
const cassette = loadCassette(cfg.cassettePath);
type U = { file: string; n: number; text: string; section: string; g: number };
const units = (JSON.parse(readFileSync(join(dir, 'gold5.json'), 'utf8')).units as U[]).map((u) => ({ ...u, text: u.text.replace(/\s*\n\s*/g, ' ') }));
const windows = (): U[][] => { const by = new Map<string, U[]>(); for (const u of units) by.set(u.file, [...(by.get(u.file) ?? []), u]); return [...by.values()].flatMap((us) => chunk(us, 30)); };
const render = (w: U[]) => { const lines = ['WINDOW']; let last = '\u0000'; for (const u of w) { const where = u.section || '(top)'; if (where !== last) { lines.push(`## ${where}`); last = where; } lines.push(`[${u.g}] ${u.text}`); } return lines.join('\n'); };
for (const pass of process.argv.slice(2)) {
  const runId = `jev5-r${pass}`;
  const probs: Record<number, Record<string, number>> = {};
  const calls: Array<Record<string, unknown>> = [];
  const t0 = Date.now();
  for (const w of windows()) {
    const questions: Record<string, Question> = {};
    for (const u of w) questions[`u${u.g}`] = { type: 'choice', instructions: `Which label does unit [${u.g}] of the window have?`, criteria: DEF6[1] };
    const body: JevBody = { model: 'jev-latest', state: render(w), questions };
    const r = await ask(cfg, body, runId, cassette);
    const use = (r.raw as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
    calls.push({ units: w.length, ok: r.ok, status: r.status, ms: r.ms, tokIn: use?.input_tokens, tokOut: use?.output_tokens, ...(r.error ? { error: r.error } : {}) });
    for (const u of w) { const a = r.typed?.[`u${u.g}`]; if (r.ok && a?.probabilities) { const p = (probs[u.g] ??= {}); for (const [k, v] of Object.entries(a.probabilities)) p[k] = v; p._conf = a.confidence ?? 0; } }
  }
  const missing = units.filter((u) => !probs[u.g]).length;
  writeFileSync(join(dir, 'results5', `${runId}.json`), JSON.stringify({ runId, calls, probs, missing, wallMs: Date.now() - t0 }) + '\n');
  const b = budget(cfg.budgetPath);
  console.log(`${runId}: ${calls.length} calls, missing ${missing}/${units.length}, budget calls ${b.calls} errors ${b.errors} tokens ${b.tokensIn}/${b.tokensOut}`);
}
