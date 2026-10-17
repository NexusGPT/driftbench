// Usage: tsx jev-experiments/run2h.ts <run> ...   Haiku labels every unit of the held-out set, window by window, under GUIDE.md.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { haiku, hbudget, loadHaiku, type HaikuCfg } from './src/haiku';
import { U, window2, windows } from './src/p2';

const scratch = process.env.JEV_SCRATCH || join(dir, 'scratch');
mkdirSync(scratch, { recursive: true });
const replay = process.env.JEV_MODE === 'replay';
const cfg: HaikuCfg = { cassettePath: replay ? join(dir, process.env.HAIKU_CASSETTE ?? 'cassette2-haiku.jsonl') : join(scratch, process.env.HAIKU_CASSETTE_RAW ?? 'cassette2-haiku.raw.jsonl'), budgetPath: join(scratch, process.env.HAIKU_BUDGET ?? 'budget2-haiku.json'), mode: replay ? 'replay' : 'record', maxIn: 800_000, maxOut: 150_000 };
const cassette = loadHaiku(cfg.cassettePath);
const MODEL = process.env.HAIKU_MODEL || 'claude-haiku-5-5';
const guide = readFileSync(join(dir, process.env.HAIKU_GUIDE ?? 'GUIDE.v1.md'), 'utf8');
const LABELS = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'];
export async function labelWindow(w: typeof U, run: string): Promise<Record<number, string>> {
  const user = `${window2(w, 'role')}\n\nLabel every unit of the window above that is numbered in square brackets, following the guide. Answer with one line per unit and nothing else: the number, a tab, the label (one of ${LABELS.join(', ')}). Units: ${w.map((u) => u.g).join(', ')}.`;
  const r = await haiku(cfg, cassette, { model: MODEL, max_tokens: 4096, system: guide, messages: [{ role: 'user', content: user }] }, run);
  const out: Record<number, string> = {};
  if (r.ok) for (const line of r.text.split('\n')) { const m = /^\s*\[?(\d+)\]?\s*[\t:,-]?\s*([a-z]+)\s*$/.exec(line); if (m && LABELS.includes(m[2]!)) out[Number(m[1])] = m[2]!; }
  return out;
}
for (const run of process.argv.slice(2)) {
  const t0 = Date.now(); const labels: Record<number, string> = {}; let calls = 0;
  for (const w of windows(U, 40)) { Object.assign(labels, await labelWindow(w, run)); calls++; }
  const missing = U.filter((u) => !labels[u.g]).length;
  writeFileSync(join(dir, 'results2', `${process.env.HAIKU_PREFIX ?? 'haiku'}-r${run}.json`), JSON.stringify({ runId: `${process.env.HAIKU_PREFIX ?? 'haiku'}-r${run}`, model: MODEL, calls, missing, wallMs: Date.now() - t0, labels }) + '\n');
  const b = hbudget(cfg.budgetPath);
  console.log(`haiku run ${run}: ${calls} calls, missing ${missing}/${U.length}, tokens ${b.tokensIn}/${b.tokensOut}, errors ${b.errors}`);
}
