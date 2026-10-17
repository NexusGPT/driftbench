// Usage: tsx jev-experiments/run4h2.ts <variant> <run> ...   Haiku labels every unit (like run3h.ts) with another thinking setting. variant: nothink (thinking disabled) | low (effort low).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { haiku, hbudget, loadHaiku, type HaikuCfg, type HaikuBody } from './src/haiku';
import { FILES3, U3 } from './src/p3';
import { sheetOf } from './sheet3';

const scratch = process.env.JEV_SCRATCH || join(dir, 'scratch');
mkdirSync(scratch, { recursive: true });
const replay = process.env.JEV_MODE === 'replay';
const cfg: HaikuCfg = { cassettePath: replay ? join(dir, 'cassette4-haiku-think.jsonl') : join(scratch, 'cassette4-haiku-think.raw.jsonl'), budgetPath: join(scratch, 'budget4-haiku-think.json'), mode: replay ? 'replay' : 'record', maxIn: 800_000, maxOut: 400_000 };
const cassette = loadHaiku(cfg.cassettePath);
const MODEL = process.env.HAIKU_MODEL || 'claude-haiku-5-5';
const guide = readFileSync(join(dir, 'GUIDE3.md'), 'utf8');
const LABELS = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'];
const variant = process.argv[2]!;
const extra: Partial<HaikuBody> = variant === 'nothink' ? { thinking: { type: 'disabled' } } : variant === 'low' ? { output_config: { effort: 'low' } } : {};
for (const run of process.argv.slice(3)) {
  const t0 = Date.now(); const labels: Record<number, string> = {}, groups: Record<number, string> = {}; let calls = 0, bad = 0;
  for (const f of FILES3) {
    const user = `${sheetOf(f.file)}\n\nLabel every unit of the file above that has a number, following the guide. Answer with one line per unit and nothing else: the unit number, a tab, the label (one of ${LABELS.join(', ')}), a tab, and the group word (empty if the unit is not in a group).`;
    const r = await haiku(cfg, cassette, { model: MODEL, max_tokens: 8192, system: guide, messages: [{ role: 'user', content: user }], ...extra }, `${variant}-${run}`);
    calls++; if (!r.ok) bad++;
    if (r.ok) for (const line of r.text.split('\n')) {
      const m = /^\s*(?:\S+\.md\s+)?\[?(\d+)\]?\s*[\t ]\s*(rule|prohibition|gate|example|description|none)\s*(?:[\t ]\s*([A-Za-z0-9_-]+))?\s*$/.exec(line);
      if (m) { labels[f.offset + Number(m[1])] = m[2]!; if (m[3]) groups[f.offset + Number(m[1])] = `${f.file}:${m[3]}`; }
    }
  }
  const missing = U3.filter((u) => !labels[u.g]).length;
  mkdirSync(join(dir, 'results4'), { recursive: true });
  writeFileSync(join(dir, 'results4', `haiku-${variant}-r${run}.json`), JSON.stringify({ runId: `haiku-${variant}-r${run}`, variant, model: MODEL, calls, failed: bad, missing, wallMs: Date.now() - t0, labels, groups }) + '\n');
  const b = hbudget(cfg.budgetPath);
  console.log(`haiku ${variant} run ${run}: ${calls} calls, failed ${bad}, missing ${missing}/${U3.length}, tokens ${b.tokensIn}/${b.tokensOut}, errors ${b.errors}`);
}
