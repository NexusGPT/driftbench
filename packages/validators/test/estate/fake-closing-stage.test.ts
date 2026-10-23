import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const ASK = "Add the late shipment count to this week's report, reports/2026-W41.md.";
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** The step directives the stand-in agent makes for the ask, in order. */
async function steps(): Promise<string[]> {
  const cwd = mkdtempSync(join(tmpdir(), 'fake-stage-'));
  folders.push(cwd);
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  mkdirSync(join(cwd, 'reports'), { recursive: true });
  writeFileSync(join(cwd, 'reports/2026-W41.md'), '# Week 41\n## Shipments late\n');
  const agent = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  const out = agent.planStream({
    ask: ASK,
    cwd,
    sessionId: 'test',
    env: {
      ...process.env,
      FAKE_MAP: join(FIXTURE, 'approved.yaml'),
      FAKE_PHRASES: join(FIXTURE, 'phrases.yaml'),
    },
  });
  return (out.records as Array<{ fake?: string; step?: string }>)
    .filter((record) => record.fake === 'step')
    .map((record) => String(record.step));
}

describe('the stand-in agent closes on the last stage of the step list', () => {
  it('reports a step allowed at any point before the closing stage, never after it', async () => {
    const run = await steps();
    // The step list of the fixture: plan, do, verify, report, and `note`, allowed at any point.
    expect(run).toEqual(['plan', 'do', 'verify', 'note', 'report']);
  });
});
