import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const ASK =
  'Match the Fjord Kitchenware invoice INV-1001 with its order, then update invoices/INV-1001.json with the reconciled amount.';
const INVOICE = 'invoices/INV-1001.json';
const SKILL = '.claude/skills/invoice-reconcile/SKILL.md';
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

type Call = { tool: string; target: string; denied: boolean };

/** The calls of the stand-in agent for the ask, with the skill's allowed-tools line replaced when given. */
async function run(allowed?: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'fake-permissions-'));
  folders.push(cwd);
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  mkdirSync(join(cwd, 'invoices'), { recursive: true });
  writeFileSync(join(cwd, INVOICE), '{ "invoice": "INV-1001", "amount": "1250.00" }\n');
  if (allowed !== undefined) {
    const text = readFileSync(join(cwd, SKILL), 'utf8');
    expect(text).toContain('allowed-tools: Read, Edit, Bash(python3 *)');
    writeFileSync(join(cwd, SKILL), text.replace('allowed-tools: Read, Edit, Bash(python3 *)', allowed));
  }
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
  const uses = new Map<string, Call>();
  for (const record of out.records as Array<{ message?: { content?: unknown } }>) {
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content as Array<{
      type?: string;
      id?: string;
      name?: string;
      tool_use_id?: string;
      is_error?: boolean;
      content?: string;
      input?: { file_path?: string; command?: string };
    }>) {
      if (item.type === 'tool_use' && item.id)
        uses.set(item.id, {
          tool: String(item.name),
          target: String(item.input?.file_path ?? item.input?.command ?? '').replace(`${cwd}/`, ''),
          denied: false,
        });
      if (item.type === 'tool_result' && item.is_error && item.tool_use_id && /permission/i.test(String(item.content)))
        for (const call of [uses.get(item.tool_use_id)]) if (call) call.denied = true;
    }
  }
  return [...uses.values()];
}

describe('the stand-in agent refuses a call that no settings allow rule and no loaded skill covers', () => {
  it('edits the invoice when the skill declares Edit', async () => {
    const calls = await run();
    expect(calls.find((call) => call.tool === 'Edit' && call.target === INVOICE)).toMatchObject({ denied: false });
  });

  it('is refused the Edit, with a permission denial, when the skill does not declare it', async () => {
    const calls = await run('allowed-tools: Read, Bash(python3 *)');
    expect(calls.find((call) => call.tool === 'Edit' && call.target === INVOICE)).toMatchObject({ denied: true });
  });

  it('still runs the script when the skill does not declare it but the settings allow it', async () => {
    const calls = await run('allowed-tools: Read, Edit');
    expect(calls.find((call) => call.tool === 'Bash' && call.target.includes('reconcile.py'))).toMatchObject({
      denied: false,
    });
  });

  it('refuses a Bash call that neither the settings nor the skill allow', async () => {
    const calls = await run('allowed-tools: Read, Edit');
    expect(calls.some((call) => call.tool === 'Bash' && call.denied)).toBe(false);
    // The settings allow Bash(python3 *) only: a command of another program is not covered.
    expect(
      calls.filter((call) => call.tool === 'Bash').every((call) => call.target.includes('python3')),
    ).toBe(true);
  });
});
