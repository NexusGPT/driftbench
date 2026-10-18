import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { AgentFailure } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command } from 'commander';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { defaultDeps, registerCampaignCommands } from '../src/commands/campaign';

let dir: string;
let calls: string[];
let failSecond = false;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-cache-version-'));
  calls = [];
  failSecond = false;
  await writeFile(
    join(dir, 'spec.yaml'),
    `id: fictional-echo
target:
  adapter: function
  agent: echo
  variant: pinned
blocks:
  - id: first
    user: hello
    expect: {}
  - id: second
    user: goodbye
    expect: {}
`,
  );
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function cli(args: string[]) {
  let code = 0;
  let err = '';
  const program = new Command('driftbench').exitOverride();
  registerCampaignCommands(
    program,
    {
      cwd: dir,
      out: () => {},
      err: (text) => {
        err += text;
      },
    },
    (exit) => {
      code = exit;
    },
    {
      ...defaultDeps,
      checks: [],
      adapterFor: async () =>
        functionAdapter({
          respond: (messages) => {
            const text = String(messages.at(-1)?.content);
            calls.push(text);
            if (failSecond && text === 'goodbye') throw new AgentFailure('fictional interruption');
            return { text, segments: [{ type: 'text', text }], toolCalls: [], cost: {}, latencyMs: 0 };
          },
        }),
    },
  );
  await program.parseAsync(['campaign', ...args, '--store', 'store.db', '--json'], { from: 'user' });
  expect(err).toBe('');
  return code;
}

it('misses the cache when --agent-version changes despite a pinned target variant', async () => {
  expect(await cli(['run', 'spec.yaml', '--campaign', 'first', '--agent-version', 'v1'])).toBe(0);
  expect(calls).toEqual(['hello', 'goodbye']);
  expect(await cli(['run', 'spec.yaml', '--campaign', 'same', '--agent-version', 'v1'])).toBe(0);
  expect(calls).toEqual(['hello', 'goodbye']);
  expect(await cli(['run', 'spec.yaml', '--campaign', 'changed', '--agent-version', 'v2'])).toBe(0);
  expect(calls).toEqual(['hello', 'goodbye', 'hello', 'goodbye']);
  const store = openStore(join(dir, 'store.db'));
  try {
    expect((await store.listRuns({ campaignId: 'changed' }))[0]?.target.variant).toBe('pinned');
    expect((await store.listRuns({ campaignId: 'changed' }))[0]?.cacheHit).not.toBe(true);
  } finally {
    await store.close();
  }
});

it('restores the campaign agent version when resuming a partly cached run', async () => {
  failSecond = true;
  expect(await cli(['run', 'spec.yaml', '--campaign', 'interrupted', '--agent-version', 'v2'])).toBe(1);
  failSecond = false;
  calls = [];
  expect(await cli(['resume', 'interrupted'])).toBe(0);
  expect(calls).toEqual(['goodbye']);
  const store = openStore(join(dir, 'store.db'));
  try {
    expect(await store.getCampaign('interrupted')).toMatchObject({ agentVersion: 'v2' });
  } finally {
    await store.close();
  }
});
