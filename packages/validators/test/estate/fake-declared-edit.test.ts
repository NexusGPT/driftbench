import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const ASK = "Add the late shipment count to this week's report, reports/2026-W41.md.";
const REPORT = 'reports/2026-W41.md';
const GATE_LINE = '**R3.** Read a file before you edit it.';
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

type Call = { tool: string; file: string };

/** The tool calls the stand-in agent makes for the ask, in an estate copy; the gate line is removed on request. */
async function calls(options: { withoutGate?: boolean } = {}): Promise<{ calls: Call[]; blocked: boolean }> {
  const cwd = mkdtempSync(join(tmpdir(), 'fake-edit-'));
  folders.push(cwd);
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  mkdirSync(join(cwd, 'reports'), { recursive: true });
  writeFileSync(join(cwd, REPORT), '# Week 41\n## Shipments late\n');
  if (options.withoutGate) {
    const standing = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(standing).toContain(GATE_LINE);
    writeFileSync(join(cwd, 'CLAUDE.md'), standing.replace(GATE_LINE, ''));
  }
  const agent = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  const out = agent.planStream({
    ask: ASK,
    cwd,
    sessionId: 'test',
    env: { ...process.env, FAKE_MAP: join(FIXTURE, 'approved.yaml'), FAKE_PHRASES: join(FIXTURE, 'phrases.yaml') },
  });
  const made: Call[] = [];
  for (const record of out.records as Array<{ message?: { content?: unknown } }>) {
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content as Array<{ type?: string; name?: string; input?: { file_path?: string } }>)
      if (item.type === 'tool_use' && item.name)
        made.push({ tool: item.name, file: String(item.input?.file_path ?? '').replace(`${cwd}/`, '') });
  }
  return { calls: made, blocked: out.blocked === true };
}

describe('the stand-in agent edits what the situation of its ask declares, in the order its gate declares', () => {
  it('edits the declared file, after a read of that same file, and does not stop on a reference that is declared missing', async () => {
    const run = await calls();
    const edit = run.calls.findIndex((call) => call.tool === 'Edit' && call.file === REPORT);
    expect(edit, JSON.stringify(run.calls)).toBeGreaterThanOrEqual(0);
    const read = run.calls.findIndex((call) => call.tool === 'Read' && call.file === REPORT);
    expect(read).toBeGreaterThanOrEqual(0);
    expect(read).toBeLessThan(edit);
    expect(run.blocked).toBe(false);
  });

  it('edits it with no prior read when the gate line is gone from the estate', async () => {
    const run = await calls({ withoutGate: true });
    expect(run.calls.some((call) => call.tool === 'Edit' && call.file === REPORT)).toBe(true);
    expect(run.calls.some((call) => call.tool === 'Read' && call.file === REPORT)).toBe(false);
  });
});
