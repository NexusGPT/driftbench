import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { it, vi } from 'vitest';
import { parse } from 'yaml';
import { FIXTURE, fixtureSuite, runOnFakeDetailed } from '../../src/ladders/estate/bank/fixture-suite';

vi.setConfig({ testTimeout: 900_000 });
const say = (text: string) => console.log(`[PROBE] ${text}`);
const KINDS = ['instruction', 'gate', 'reference', 'route', 'skill', 'subagent', 'guard', 'tool', 'register', 'stage', 'hazard'];

it('groups the failing originals of kill.fake', async () => {
  const suite = await fixtureSuite();
  const map = await loadEstateMap(suite.map);
  if (!map.ok) throw new Error('map');
  const mod = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  for (const kind of ['stage', 'tool', 'guard', 'instruction']) {
    for (const index of [0, 1]) {
      const atom = map.map.atoms.filter((a) => a.kind === kind).map((a) => a.id).sort()[index];
      if (!atom) continue;
      const naming = suite.specs.filter((s) => s.complete && s.mode === 'live' && s.atoms.includes(atom)).slice(0, 4);
      if (naming.length === 0) { say(`CELL ${kind}-${index + 1} ${atom}: no complete live spec`); continue; }
      const v = runOnFakeDetailed(FIXTURE, naming.map((s) => s.path), `/tmp/pk-${kind}-${index}.db`, join(FIXTURE, 'approved.yaml'));
      const green = naming.filter((s) => v.get(s.id)?.pass);
      say(`CELL ${kind}-${index + 1} ${atom}: ${green.length} of ${naming.length} green; ${naming.map((s) => `${s.id.replace('estate.', '')}=${v.get(s.id)?.pass ? 'ok' : JSON.stringify(v.get(s.id)?.failing)}`).join(' ; ')}`);
      const red = naming.find((s) => !v.get(s.id)?.pass) ?? naming[0];
      if (!red) continue;
      const doc = parse(readFileSync(red.path, 'utf8')) as {
        given?: { world?: { workspace?: { files?: Record<string, string> } } };
        blocks: Array<{ when?: { user?: string }; expect?: unknown }>;
      };
      const cwd = mkdtempSync(join(tmpdir(), 'probe-ws-'));
      cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
      for (const [path, text] of Object.entries(doc.given?.world?.workspace?.files ?? {})) {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), text);
      }
      const ask = doc.blocks[0]?.when?.user ?? '';
      const grammarFile = (await import('node:fs')).readdirSync(tmpdir()).filter((n) => n.startsWith('estate-fixture-grammar-')).map((n) => join(tmpdir(), n, 'grammar.json'))[0];
      const out = mod.planStream({ ask, cwd, sessionId: 'probe', env: { ...process.env, FAKE_MAP: join(FIXTURE, 'approved.yaml'), FAKE_PHRASES: join(FIXTURE, 'phrases.yaml'), ...(grammarFile ? { FAKE_GRAMMAR: grammarFile } : {}) } });
      const calls = (out.records as Array<Record<string, unknown>>).flatMap((r) => {
        const content = (r.message as { content?: Array<{ type: string; name?: string; input?: Record<string, unknown>; text?: string; content?: string; is_error?: boolean }> } | undefined)?.content ?? [];
        return content.map((c) => c.type === 'tool_use' ? `${c.name}(${String(c.input?.file_path ?? c.input?.command ?? c.input?.skill ?? c.input?.subagent_type ?? '').split('/').slice(-3).join('/')})` : c.type === 'text' ? `TEXT:${String(c.text).slice(0, 70)}` : c.is_error ? `ERR:${String(c.content).slice(0, 60)}` : '');
      }).filter(Boolean);
      say(`  ASK ${JSON.stringify(ask)} ${red.id} blocked=${out.blocked} error=${out.error} EXPECT=${JSON.stringify(doc.blocks[0]?.expect).slice(0, 300)}`);
      say(`  CALLS ${calls.join(' > ')}`);
    }
  }
});
