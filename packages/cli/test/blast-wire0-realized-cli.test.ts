import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { AgentFailure, provenanceHash, type UserDriver } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CampaignDeps } from '../src/commands/campaign';
import { main } from '../src/index';

/**
 * Blast radius of PR 430 (merged) through the CLI: `campaign run --record-realized-text`, the default that
 * keeps only the hash, and `campaign resume`, which reads the choice back from `provenance.realizedText`.
 */
const SENT = 'blast-wire0 private text the driver wrote';
const SPEC = 'id: blast-realized\nblocks:\n  - user: hello\n  - user: second\n';

/** Sends SENT in place of block 0's authored text, and block 1 as written. */
function rewriting(): UserDriver {
  return {
    ...createScriptedDriver(),
    next: (ctx) =>
      ctx.blockIndex > 1
        ? { kind: 'stop', reason: 'done' }
        : {
            kind: 'block',
            blockIndex: ctx.blockIndex,
            stimulus: { user: ctx.blockIndex === 0 ? SENT : 'second' },
          },
  };
}

const replying = () =>
  functionAdapter({
    respond: () => ({
      text: 'ok',
      segments: [{ type: 'text', text: 'ok' }],
      toolCalls: [],
      cost: {},
      latencyMs: 0,
    }),
  });

let dir = '';
let path = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'blast-wire0-realized-'));
  path = join(dir, 'runs.db');
  await writeFile(join(dir, 'spec.yaml'), SPEC);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function cli(args: string[], deps: Partial<CampaignDeps>) {
  let err = '';
  const code = await main(
    args,
    {
      cwd: dir,
      out: () => {},
      err: (text) => {
        err += text;
      },
    },
    { deps },
  );
  return { code, err };
}

const run = (campaign: string, extra: string[] = []) => [
  'campaign',
  'run',
  'spec.yaml',
  '--target',
  'function:echo',
  '--campaign',
  campaign,
  '--store',
  path,
  ...extra,
];

async function realizedOf(campaign: string) {
  const db = openStore(path);
  try {
    const runs = await db.listRuns({ campaignId: campaign });
    expect(runs).toHaveLength(1);
    return runs[0]?.blocks.map((block) => block.realized);
  } finally {
    await db.close();
  }
}

/** Every byte the store left on disk: the database and its journal files. */
async function storeBytes(): Promise<string> {
  const files = (await readdir(dir)).filter((name) => name.startsWith('runs.db'));
  const parts = await Promise.all(files.map((name) => readFile(join(dir, name))));
  return Buffer.concat(parts).toString('latin1');
}

describe('PR 430 blast radius: campaign run and resume with the realized text', { timeout: 60_000 }, () => {
  it('keeps only the hash by default, and no byte of the sent text anywhere in the store, cache included', async () => {
    const result = await cli(run('hashed'), {
      driver: () => rewriting(),
      adapterFor: async () => replying(),
    });
    expect(result.code, result.err).toBe(0);
    expect(await realizedOf('hashed')).toEqual([{ hash: provenanceHash(SENT) }, undefined]);
    expect(await storeBytes()).not.toContain(SENT);
  });

  it('keeps the text with --record-realized-text', async () => {
    const result = await cli(run('kept', ['--record-realized-text']), {
      driver: () => rewriting(),
      adapterFor: async () => replying(),
    });
    expect(result.code, result.err).toBe(0);
    expect(await realizedOf('kept')).toEqual([{ hash: provenanceHash(SENT), text: SENT }, undefined]);
  });

  it.each([
    ['with', ['--record-realized-text'], { hash: provenanceHash(SENT), text: SENT }],
    ['without', [], { hash: provenanceHash(SENT) }],
  ])('a resumed campaign run %s the flag keeps the choice its run made', async (_, flag, expected) => {
    let calls = 0;
    const broken = functionAdapter({
      respond: () => {
        calls++;
        throw new AgentFailure('the agent is down');
      },
    });
    const first = await cli(run('resumed', flag), {
      driver: () => rewriting(),
      adapterFor: async () => broken,
    });
    expect(calls).toBeGreaterThan(0);
    expect(first.code).not.toBe(0);
    // The resume names no flag: the campaign's provenance carries the choice.
    const again = await cli(['campaign', 'resume', 'resumed', '--store', path], {
      driver: () => rewriting(),
      adapterFor: async () => replying(),
    });
    expect(again.code, again.err).toBe(0);
    const db = openStore(path);
    try {
      const runs = (await db.listRuns({ campaignId: 'resumed' })).filter(
        (each) => each.status === 'completed',
      );
      expect(runs).toHaveLength(1);
      expect(runs[0]?.blocks.map((block) => block.realized)).toEqual([expected, undefined]);
    } finally {
      await db.close();
    }
  });
});
