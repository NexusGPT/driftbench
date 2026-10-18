import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { provenanceHash, type UserDriver } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultDeps, registerCampaignCommands } from '../src/commands/campaign';

/**
 * Blast radius of PR 430 (merged) on the two radius paths that run blocks fresh: `--block-reruns`, which
 * reruns the blocks a change reaches inside a partly carried cell, and `--audit`, which runs a sample of the
 * cells about to be carried. Each must keep the text the driver sent when the campaign asks for it, and only
 * its hash when it does not. The baseline sends the authored text, so its cell can be carried block by block;
 * the radius campaign's driver rewrites what it sends, so every fresh block has a realized text to record.
 */

/** Once `rewrite` is on, the driver rewrites every block: the agent receives `sent-<index>`. */
const sent = (index: number) => `sent-${index}`;
let rewrite = false;

function rewriting(): UserDriver {
  const scripted = createScriptedDriver();
  return {
    ...scripted,
    next: (ctx) =>
      !rewrite
        ? scripted.next(ctx)
        : ctx.blockIndex > 2
          ? { kind: 'stop', reason: 'done' }
          : { kind: 'block', blockIndex: ctx.blockIndex, stimulus: { user: sent(ctx.blockIndex) } },
  };
}

let dir = '';
let fault = false;
let sends = 0;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'blast-audit-realized-'));
  fault = false;
  rewrite = false;
  sends = 0;
  await writeFile(
    join(dir, 'spec.yaml'),
    'id: blast-realized-radius\nmetadata: { depends: {} }\nblocks:\n  - user: one\n    expect: { stage: one, must: [good] }\n  - user: two\n    expect: { stage: two, must: [good] }\n  - user: three\n    expect: { stage: three, must: [good] }\n',
  );
  await writeFile(join(dir, 'change.yaml'), 'from: v1\nto: v2\nchanges: [{ kind: stage, id: two }]\n');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function cli(id: string, extra: string[]) {
  let code = 0;
  let out = '';
  let err = '';
  const program = new Command().exitOverride();
  registerCampaignCommands(
    program,
    {
      cwd: dir,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        err += s;
      },
    },
    (c) => {
      code = c;
    },
    {
      ...defaultDeps,
      driver: () => rewriting(),
      adapterFor: async () =>
        functionAdapter({
          respond: (messages) => {
            sends++;
            const text = fault && messages.at(-1)?.content === sent(2) ? 'regression' : 'good';
            return { text, segments: [], toolCalls: [], cost: {}, latencyMs: 0 };
          },
        }),
    },
  );
  await program.parseAsync(
    [
      'campaign',
      'run',
      'spec.yaml',
      '--target',
      'function:acme',
      '--mode',
      'T',
      '--campaign',
      id,
      '--store',
      'runs.db',
      '--agent-version',
      id === 'base' ? 'v1' : 'v2',
      '--no-cache',
      ...extra,
    ],
    { from: 'user' },
  );
  expect(err).toBe('');
  return { code, out };
}

async function blocksOf(campaignId: string) {
  const store = openStore(join(dir, 'runs.db'));
  try {
    const [run] = await store.listRuns({ campaignId });
    return run?.blocks ?? [];
  } finally {
    await store.close();
  }
}

describe('PR 430 blast radius: realized text on radius block reruns and audits', { timeout: 60_000 }, () => {
  it.each([
    [
      'with',
      ['--record-realized-text'],
      (index: number) => ({ hash: provenanceHash(sent(index)), text: sent(index) }),
    ],
    ['without', [], (index: number) => ({ hash: provenanceHash(sent(index)) })],
  ])(
    '--block-reruns %s --record-realized-text records the rerun blocks as the campaign asked',
    async (_, flag, expected) => {
      expect((await cli('base', [...flag])).code).toBe(0);
      rewrite = true;
      sends = 0;
      expect(
        (await cli('partial', ['--from', 'base', '--change', 'change.yaml', '--block-reruns', ...flag])).code,
      ).toBe(0);
      expect(sends).toBeGreaterThan(0);
      const blocks = await blocksOf('partial');
      const fresh = blocks.map((block, index) => ({ block, index })).filter(({ block }) => !block.carried);
      expect(fresh.length).toBeGreaterThan(0);
      // A partly carried cell: the rerun path, not a whole fresh run.
      expect(fresh.length).toBeLessThan(blocks.length);
      for (const { block, index } of fresh) expect(block.realized, `block ${index}`).toEqual(expected(index));
    },
  );

  it.each([
    [
      'with',
      ['--record-realized-text'],
      (index: number) => ({ hash: provenanceHash(sent(index)), text: sent(index) }),
    ],
    ['without', [], (index: number) => ({ hash: provenanceHash(sent(index)) })],
  ])(
    '--audit %s --record-realized-text records the audited run as the campaign asked',
    async (_, flag, expected) => {
      expect((await cli('base', [...flag])).code).toBe(0);
      rewrite = true;
      fault = true;
      sends = 0;
      const audited = await cli('audited', [
        '--from',
        'base',
        '--change',
        'change.yaml',
        '--block-reruns',
        '--audit',
        '1',
        ...flag,
      ]);
      expect(audited.code).toBe(1);
      expect(audited.out).toContain('RADIUS MISS');
      const blocks = await blocksOf('audited');
      expect(blocks).toHaveLength(3);
      expect(blocks.every((block) => !block.carried)).toBe(true);
      blocks.forEach((block, index) => {
        expect(block.realized, `block ${index}`).toEqual(expected(index));
      });
    },
  );
});
