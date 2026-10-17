// Usage: tsx jev-experiments/run3h.ts <run> ...   Haiku labels every unit of the growth corpus (gold5) and groups the units of multi-unit rules (GUIDE4.md, guide 2.1). Needs CORPUS=5.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { haiku, hbudget, loadHaiku, type HaikuCfg } from './src/haiku';
import { FILES3, U3 } from './src/p3';
import { sheetOf } from './sheet5';

const scratch = process.env.JEV_SCRATCH || join(dir, 'scratch');
mkdirSync(scratch, { recursive: true });
const replay = process.env.JEV_MODE === 'replay';
const cfg: HaikuCfg = { cassettePath: replay ? join(dir, 'cassette5-haiku.jsonl') : join(scratch, 'cassette5-haiku.raw.jsonl'), budgetPath: join(scratch, 'budget5-haiku.json'), mode: replay ? 'replay' : 'record', maxIn: 800_000, maxOut: 400_000 };
const cassette = loadHaiku(cfg.cassettePath);
const MODEL = process.env.HAIKU_MODEL || 'claude-haiku-5-5';
const guide = readFileSync(join(dir, 'GUIDE4.md'), 'utf8');
const LABELS = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'];
export async function labelFile(file: string, run: string): Promise<{ labels: Record<number, string>; groups: Record<number, string>; ok: boolean }> {
  const user = `${sheetOf(file)}\n\nLabel every unit of the file above that has a number, following the guide. Answer with one line per unit and nothing else: the unit number, a tab, the label (one of ${LABELS.join(', ')}), a tab, and the group word (empty if the unit is not in a group).`;
  const r = await haiku(cfg, cassette, { model: MODEL, max_tokens: 8192, system: guide, messages: [{ role: 'user', content: user }] }, run);
  const labels: Record<number, string> = {}, groups: Record<number, string> = {};
  if (r.ok) for (const line of r.text.split('\n')) {
    const m = /^\s*(?:\S+\.md\s+)?\[?(\d+)\]?\s*[\t ]\s*(rule|prohibition|gate|example|description|none)\s*(?:[\t ]\s*([A-Za-z0-9_-]+))?\s*$/.exec(line);
    if (m) { labels[Number(m[1])] = m[2]!; if (m[3]) groups[Number(m[1])] = m[3]!; }
  }
  return { labels, groups, ok: r.ok };
}
for (const run of process.argv.slice(2)) {
  const t0 = Date.now(); const labels: Record<number, string> = {}, groups: Record<number, string> = {}; let calls = 0, bad = 0;
  for (const f of FILES3) {
    const r = await labelFile(f.file, run); calls++; if (!r.ok) bad++;
    for (const [n, l] of Object.entries(r.labels)) labels[f.offset + Number(n)] = l;
    for (const [n, g] of Object.entries(r.groups)) groups[f.offset + Number(n)] = `${f.file}:${g}`;
  }
  const missing = U3.filter((u) => !labels[u.g]).length;
  mkdirSync(join(dir, 'results5h'), { recursive: true });
  writeFileSync(join(dir, 'results5h', `haiku-r${run}.json`), JSON.stringify({ runId: `haiku-r${run}`, model: MODEL, calls, failed: bad, missing, wallMs: Date.now() - t0, labels, groups }) + '\n');
  const b = hbudget(cfg.budgetPath);
  console.log(`haiku span run ${run}: ${calls} calls, failed ${bad}, missing ${missing}/${U3.length}, groups ${new Set(Object.values(groups)).size}, tokens ${b.tokensIn}/${b.tokensOut}`);
}
