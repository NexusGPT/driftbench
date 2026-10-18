import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Check } from '@agent-nexus/driftbench-core';
import { Command } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultDeps, registerCampaignCommands } from '../src/commands/campaign';
import { type Io, main } from '../src/index';

/** Fictional data only: an agent that echoes the user turn. */
const AGENT = fileURLToPath(new URL('./fixtures/echo-agent.mjs', import.meta.url));
const COMMAND = JSON.stringify([process.execPath, AGENT]);
const RUN = ['campaign', 'run', '--target', 'process:echo', '--process-command', COMMAND];
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

function capture(cwd: string) {
  const seen = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      seen.out += text;
    },
    err: (text) => {
      seen.err += text;
    },
    cwd,
  };
  return { io, seen };
}

async function cli(argv: string[], cwd: string, checks?: Check[]) {
  const { io, seen } = capture(cwd);
  if (!checks) return { code: await main(argv, io), ...seen };
  let code = 0;
  const program = new Command('driftbench');
  registerCampaignCommands(
    program,
    io,
    (exit) => {
      code = exit;
    },
    { ...defaultDeps, checks },
  );
  await program.parseAsync(argv, { from: 'user' });
  return { code, ...seen };
}

const JUDGED = `id: refund-judged
criteria:
  - name: asks_before_acting
    rubric: The agent starts a refund only after the customer has given an order number.
    gating: true
    judge_class: system2
  - name: stays_polite
    rubric: The reply is polite.
    judge_class: system1
blocks:
  - user: hello
    expect:
      must: ['echo: hello']
      criteria: [asks_before_acting]
  - user: thanks
    expect:
      must: ['echo: thanks']
      criteria: [asks_before_acting, stays_polite]
`;

const MACHINE = `id: machine-only
blocks:
  - user: hello
    expect:
      must: ['echo: hello']
`;

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-judged-notice-'));
  made.push(dir);
  await writeFile(join(dir, 'judged.yaml'), JUDGED);
  await writeFile(join(dir, 'machine.yaml'), MACHINE);
  return dir;
}

describe('campaign run on a spec with judged criteria', () => {
  it('says under the list of checks that the criteria are not judged, and leaves the run as it was', async () => {
    const dir = await folder();
    const { code, out, err } = await cli([...RUN, 'judged.yaml'], dir);
    expect(code).toBe(0);
    expect(err).toBe('');
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^Campaign c-[0-9a-f]+: 1 cell, 4 at a time\. Checks: /);
    expect(lines[1]).toBe(
      'Not judged: 2 criteria in 2 blocks of 1 spec (asks_before_acting, stays_polite), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.',
    );
    expect(lines[2]).toMatch(/^✓ refund-judged · process:echo · F · repeat 0 {2}pass {2}2 blocks/);
    expect(lines[3]).toBe('1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.');
    expect(lines[4]).toBe('The runs are not kept: pass --store <file> to keep them.');
  });

  it('says nothing for a spec without criteria', async () => {
    const dir = await folder();
    const { code, out, err } = await cli([...RUN, 'machine.yaml'], dir);
    expect(code).toBe(0);
    expect(err).toBe('');
    expect(out).not.toContain('Not judged');
  });

  it('keeps --json as it was: one JSON document with the same keys', async () => {
    const dir = await folder();
    const { code, out, err } = await cli([...RUN, 'judged.yaml', '--json'], dir);
    expect(code).toBe(0);
    expect(err).toBe('');
    expect(Object.keys(JSON.parse(out) as object)).toEqual([
      'campaignId',
      'stored',
      'checks',
      'cells',
      'summary',
    ]);
  });

  it('says nothing when the checks hold a judge', async () => {
    const dir = await folder();
    const judge: Check = { name: 'judge', applies: () => false, evaluate: () => [] };
    const { code, out, err } = await cli([...RUN, 'judged.yaml'], dir, [...defaultDeps.checks, judge]);
    expect(code).toBe(0);
    expect(err).toBe('');
    expect(out).toContain('1 cell: 1 pass');
    expect(out).not.toContain('Not judged');
  });
});
