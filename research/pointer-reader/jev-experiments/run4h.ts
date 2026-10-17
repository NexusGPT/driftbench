// Usage: tsx jev-experiments/run4h.ts <tau> <run> ...   Haiku labels only the units whose Jev head margin is below tau (the share a cascade would send), under GUIDE3.md.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { haiku, hbudget, loadHaiku, type HaikuCfg } from './src/haiku';
import { FILES3, U3 } from './src/p3';
import { sheetOf } from './sheet3';
import { headDecisions, HEADS } from './heads4';

const scratch = process.env.JEV_SCRATCH || join(dir, 'scratch');
mkdirSync(scratch, { recursive: true });
const replay = process.env.JEV_MODE === 'replay';
const cfg: HaikuCfg = { cassettePath: replay ? join(dir, 'cassette4-haiku.jsonl') : join(scratch, 'cassette4-haiku.raw.jsonl'), budgetPath: join(scratch, 'budget4-haiku.json'), mode: replay ? 'replay' : 'record', maxIn: 800_000, maxOut: 300_000 };
const cassette = loadHaiku(cfg.cassettePath);
const MODEL = process.env.HAIKU_MODEL || 'claude-haiku-5-5';
const guide = readFileSync(join(dir, 'GUIDE3.md'), 'utf8');
const LABELS = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'];
const tau = Number(process.argv[2]);
const J = headDecisions(HEADS.find((h) => h.id === 'J1')!);
const send = (g: number) => J.get(g)!.conf < tau;
for (const run of process.argv.slice(3)) {
  const t0 = Date.now(); const labels: Record<number, string> = {}, groups: Record<number, string> = {}; let calls = 0, bad = 0, asked = 0;
  for (const f of FILES3) {
    const want = U3.filter((u) => u.file === f.file && send(u.g));
    if (!want.length) continue;
    asked += want.length;
    const user = `${sheetOf(f.file)}\n\nRead the whole file above for context, then label ONLY the units whose numbers are listed here, following the guide: ${want.map((u) => u.n).join(', ')}. Answer with one line per listed unit and nothing else: the unit number, a tab, the label (one of ${LABELS.join(', ')}), a tab, and the group word (empty if the unit is not in a group).`;
    const r = await haiku(cfg, cassette, { model: MODEL, max_tokens: 8192, system: guide, messages: [{ role: 'user', content: user }] }, `${tau}-${run}`);
    calls++; if (!r.ok) bad++;
    if (r.ok) for (const line of r.text.split('\n')) {
      const m = /^\s*(?:\S+\.md\s+)?\[?(\d+)\]?\s*[\t ]\s*(rule|prohibition|gate|example|description|none)\s*(?:[\t ]\s*([A-Za-z0-9_-]+))?\s*$/.exec(line);
      if (m) { labels[f.offset + Number(m[1])] = m[2]!; if (m[3]) groups[f.offset + Number(m[1])] = `${f.file}:${m[3]}`; }
    }
  }
  const missing = U3.filter((u) => send(u.g) && !labels[u.g]).length;
  mkdirSync(join(dir, 'results4'), { recursive: true });
  writeFileSync(join(dir, 'results4', `haiku-subset-${tau}-r${run}.json`), JSON.stringify({ runId: `haiku-subset-${tau}-r${run}`, tau, model: MODEL, calls, failed: bad, asked, missing, wallMs: Date.now() - t0, labels, groups }) + '\n');
  const b = hbudget(cfg.budgetPath);
  console.log(`haiku subset tau ${tau} run ${run}: ${calls} calls, failed ${bad}, asked ${asked}, missing ${missing}, tokens ${b.tokensIn}/${b.tokensOut}`);
}
