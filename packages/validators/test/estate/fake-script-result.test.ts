import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const ASK =
  'Match the Fjord Kitchenware invoice INV-1001 with its order, then update invoices/INV-1001.json with the reconciled amount.';
const INVOICE = 'invoices/INV-1001.json';
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

type Call = { tool: string; file: string; error: boolean };

async function run() {
  const cwd = mkdtempSync(join(tmpdir(), 'fake-script-'));
  folders.push(cwd);
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  mkdirSync(join(cwd, 'invoices'), { recursive: true });
  writeFileSync(join(cwd, INVOICE), '{ "invoice": "INV-1001", "amount": "1250.00" }\n');
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
  const calls: Call[] = [];
  const failed = new Set<string>();
  for (const record of out.records as Array<{ message?: { content?: unknown } }>) {
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content as Array<{
      type?: string;
      id?: string;
      name?: string;
      tool_use_id?: string;
      is_error?: boolean;
      input?: { file_path?: string; command?: string };
    }>) {
      if (item.type === 'tool_result' && item.is_error && item.tool_use_id) failed.add(item.tool_use_id);
      if (item.type === 'tool_use' && item.name)
        calls.push({
          tool: item.name,
          file: String(item.input?.file_path ?? item.input?.command ?? '').replace(`${cwd}/`, ''),
          error: failed.has(item.id ?? ''),
        });
    }
  }
  return { calls, blocked: out.blocked === true };
}

describe('the stand-in agent takes the exit status of a declared script as the script result', () => {
  it('goes on to the declared edit after the script exits non-zero', async () => {
    const result = await run();
    const script = result.calls.findIndex((call) => call.tool === 'Bash' && call.file.includes('reconcile.py'));
    const edit = result.calls.findIndex((call) => call.tool === 'Edit' && call.file === INVOICE);
    expect(script, JSON.stringify(result.calls)).toBeGreaterThanOrEqual(0);
    expect(edit, JSON.stringify(result.calls)).toBeGreaterThan(script);
    expect(result.blocked).toBe(false);
  });
});
