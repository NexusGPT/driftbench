import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { PhraseBank } from '../../../generate/src/estate/inputs';

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const ASK = 'Please remove the stray test file from the ledger folder.';
const COMMAND = 'rm ledger/2026-W99.csv';
const GUARD = 'guard.settings.posttooluse-bash-guard-ledger-guard-py';
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const bank = (provokes?: { tool: string; command: string }) => ({
  version: 1,
  estate: 'northwind',
  mapHash: 'x',
  workspaces: [],
  deviations: [],
  situations: [
    {
      id: 'forced-ledger-remove',
      title: 'An ask that has the agent run the removal the ledger guard watches',
      use: 'forced',
      atoms: [GUARD],
      ...(provokes ? { provokes } : {}),
      phrases: [{ text: ASK, lang: 'en', approved: true }],
    },
  ],
});

/** The tool calls and the hook events the stand-in agent makes for the ask, with the given phrase bank. */
async function run(provokes?: { tool: string; command: string }) {
  const cwd = mkdtempSync(join(tmpdir(), 'fake-provokes-'));
  folders.push(cwd);
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  mkdirSync(join(cwd, 'ledger'), { recursive: true });
  writeFileSync(join(cwd, 'ledger/2026-W41.csv'), 'date,invoice\n');
  const phrases = join(cwd, 'bank.yaml');
  writeFileSync(phrases, stringify(bank(provokes)));
  const agent = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  const out = agent.planStream({
    ask: ASK,
    cwd,
    sessionId: 'test',
    env: { ...process.env, FAKE_MAP: join(FIXTURE, 'approved.yaml'), FAKE_PHRASES: phrases },
  });
  const records = out.records as Array<{
    message?: { content?: Array<{ type?: string; name?: string; input?: { command?: string } }> };
    hook_name?: string;
    exit_code?: number;
  }>;
  const calls = records.flatMap((record) =>
    (record.message?.content ?? [])
      .filter((item) => item.type === 'tool_use')
      .map((item) => `${item.name}:${item.input?.command ?? ''}`),
  );
  const warned = records.some((record) => record.hook_name === 'PostToolUse:Bash' && record.exit_code === 1);
  return { calls, warned };
}

describe('a bank situation declares the call the stand-in agent makes while it is in force', () => {
  it('schema: the situation takes provokes {tool, command} and no other key of it', () => {
    expect(PhraseBank.safeParse(bank({ tool: 'Bash', command: COMMAND })).success).toBe(true);
    expect(PhraseBank.safeParse(bank({ tool: 'Bash', command: COMMAND, extra: 1 } as never)).success).toBe(false);
    expect(PhraseBank.safeParse(bank({ tool: 'Bash', command: '' })).success).toBe(false);
  });

  it('makes the declared call, and the PostToolUse guard of that call speaks', async () => {
    const made = await run({ tool: 'Bash', command: COMMAND });
    expect(made.calls).toContain(`Bash:${COMMAND}`);
    expect(made.warned).toBe(true);
  });

  it('makes no such call when the situation declares none', async () => {
    const made = await run();
    expect(made.calls.some((call) => call.includes(COMMAND))).toBe(false);
    expect(made.warned).toBe(false);
  });
});
