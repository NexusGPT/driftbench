import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { it, vi } from 'vitest';
import { parse } from 'yaml';
import { FIXTURE, fixtureSuite } from '../../src/ladders/estate/bank/fixture-suite';

vi.setConfig({ testTimeout: 900_000 });
const say = (text: string) => console.log(`[PROBE] ${text}`);
it('stage-1 stream', async () => {
  const suite = await fixtureSuite();
  const spec = suite.specs.find((s) => s.id === 'estate.journey.03');
  if (!spec) throw new Error('no spec');
  const doc = parse(readFileSync(spec.path, 'utf8')) as { given: { world: { workspace: { files: Record<string, string> } } }; blocks: Array<{ when: { user: string } }> };
  const cwd = mkdtempSync(join(tmpdir(), 'probe-ws-'));
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  for (const [path, text] of Object.entries(doc.given.world.workspace.files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  const mod = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  const out = mod.planStream({ ask: doc.blocks[0]?.when.user ?? '', cwd, sessionId: 'p', env: { ...process.env, FAKE_MAP: join(FIXTURE, 'approved.yaml'), FAKE_PHRASES: join(FIXTURE, 'phrases.yaml') } });
  const seq = (out.records as Array<Record<string, any>>).map((r) => r.fake === 'step' ? `STEP:${r.step}` : r.fake === 'write' ? `WRITE:${r.path}` : r.message?.content?.[0]?.type === 'tool_use' ? `${r.message.content[0].name}` : '').filter(Boolean);
  say(`SEQ ${seq.join(' > ')}`);
  say(`BLOCKS ${JSON.stringify(spec.spec.blocks.map((b) => b.expect)).slice(0, 400)}`);
});
