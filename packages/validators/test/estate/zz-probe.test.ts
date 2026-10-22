import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { it, vi } from 'vitest';
import { parse } from 'yaml';
import { cli } from '../../src/ladders/estate/bank/bench';
import { FIXTURE, fixtureSuite } from '../../src/ladders/estate/bank/fixture-suite';

vi.setConfig({ testTimeout: 1_800_000 });
const say = (text: string) => console.log(`[PROBE] ${text}`);
const ATOMS = [
  'instruction.inbox-triager.a-message-that-fits-none-goes',
  'instruction.inbox-triager.never-answer-a-message-yourself-and',
  'register.invoice-reconcile.end-with-one-line-per-invoice',
];

type Rec = Record<string, any>;
function trace(mod: any, root: string, ask: string, files: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), 'eq-ws-'));
  cpSync(root, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  const out = mod.planStream({ ask, cwd, sessionId: 'p', env: { ...process.env, FAKE_MAP: join(FIXTURE, 'approved.yaml'), FAKE_PHRASES: join(FIXTURE, 'phrases.yaml') } });
  const calls = (out.records as Rec[]).flatMap((r) => (r.message?.content ?? []).filter((c: Rec) => c.type === 'tool_use').map((c: Rec) => `${c.name}:${JSON.stringify(c.input).replaceAll(cwd, '<cwd>')}`));
  const texts = (out.records as Rec[]).flatMap((r) => (r.message?.content ?? []).filter((c: Rec) => c.type === 'text').map((c: Rec) => c.text));
  const steps = (out.records as Rec[]).filter((r) => r.fake === 'step').map((r) => r.step);
  return { calls, texts, steps, blocked: out.blocked };
}

it('traces with and without each rule', async () => {
  const suite = await fixtureSuite();
  const mod = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  const cases: Array<{ id: string; ask: string; files: Record<string, string> }> = [];
  for (const s of suite.specs.filter((x) => x.mode === 'live')) {
    const doc = parse(readFileSync(s.path, 'utf8')) as Rec;
    const files = doc.given?.world?.workspace?.files ?? {};
    for (const b of doc.blocks ?? []) if (b.when?.user) cases.push({ id: s.id, ask: b.when.user, files });
  }
  say(`CASES ${cases.length} live spec asks`);
  for (const atom of ATOMS) {
    const dir = mkdtempSync(join(tmpdir(), 'eq-mut-'));
    const made = cli(['estate', 'mutate', join(FIXTURE, 'approved.yaml'), '--atom', atom, '--delete', '--to', dir]);
    let same = 0; let differ = 0; const examples: string[] = [];
    let textDiffer = 0;
    for (const c of cases) {
      const a = trace(mod, FIXTURE, c.ask, c.files);
      const b = trace(mod, dir, c.ask, c.files);
      if (JSON.stringify(a.calls) === JSON.stringify(b.calls) && JSON.stringify(a.steps) === JSON.stringify(b.steps) && a.blocked === b.blocked) same++; else { differ++; if (examples.length < 3) examples.push(`${c.id}: ${a.calls.length} vs ${b.calls.length} calls`); }
      if (JSON.stringify(a.texts) !== JSON.stringify(b.texts)) textDiffer++;
    }
    say(`ATOM ${atom} mutate=${made.code} same-trace=${same} differ=${differ} reply-text-differs=${textDiffer} ${examples.join(' | ')}`);
  }
});
