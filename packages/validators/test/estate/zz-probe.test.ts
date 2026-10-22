import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, vi } from 'vitest';
import { FIXTURE } from '../../src/ladders/estate/bank/fixture-suite';

vi.setConfig({ testTimeout: 900_000 });
const say = (text: string) => console.log(`[PROBE] ${text}`);
it('stage-2 ask', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'probe-ws-'));
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  const mod = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  try {
    const out = mod.planStream({ ask: 'Give me a short status of invoices, shipments and supplier emails.', cwd, sessionId: 'p', env: { ...process.env, FAKE_MAP: join(FIXTURE, 'approved.yaml'), FAKE_PHRASES: join(FIXTURE, 'phrases.yaml') } });
    say(`OK blocked=${out.blocked} n=${out.records.length}`);
  } catch (cause) {
    say(`THREW ${String(cause)} ${(cause as Error).stack?.split('\n').slice(0, 4).join(' | ')}`);
  }
});
