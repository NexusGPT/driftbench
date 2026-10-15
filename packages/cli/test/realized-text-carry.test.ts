import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import {
  AgentFailure,
  provenanceDigest,
  provenanceHash,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
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

describe('PR 430 blast radius: a radius campaign that carries a baseline run', { timeout: 60_000 }, () => {
  /** A one-block spec and a change no block depends on, so the radius carries the whole baseline run. */
  async function radiusFixture() {
    await writeFile(
      join(dir, 'one.yaml'),
      'id: blast-radius-realized\nmetadata: { depends: {} }\nblocks:\n  - user: hello\n',
    );
    await writeFile(
      join(dir, 'change.yaml'),
      'from: v1\nto: v2\nchanges:\n  - kind: criterion\n    id: unused\n',
    );
  }
  let sends = 0;
  const deps: Partial<CampaignDeps> = {
    // A seeded driver: the radius carries a run whose stimulus came from a generator, not the spec.
    driver: () => ({
      ...createScriptedDriver(),
      seeds: { sample: 1 },
      next: (ctx) =>
        ctx.blockIndex > 0
          ? { kind: 'stop', reason: 'done' }
          : { kind: 'block', blockIndex: 0, stimulus: { user: SENT } },
    }),
    adapterFor: async () =>
      functionAdapter({
        respond: () => {
          sends++;
          return {
            text: 'ok',
            segments: [{ type: 'text', text: 'ok' }],
            toolCalls: [],
            cost: {},
            latencyMs: 0,
          };
        },
      }),
  };
  const radiusRun = (campaign: string, version: string, extra: string[]) => [
    'campaign',
    'run',
    'one.yaml',
    '--target',
    'function:echo',
    '--agent-version',
    version,
    '--campaign',
    campaign,
    '--store',
    path,
    '--no-cache',
    ...extra,
  ];

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    'source opt-in %s, destination opt-in %s: carry follows the destination',
    async (sourceRecords, destinationRecords) => {
      await radiusFixture();
      const base = await cli(radiusRun('base', 'v1', sourceRecords ? ['--record-realized-text'] : []), deps);
      expect(base.code, base.err).toBe(0);
      sends = 0;
      const copied = await cli(
        radiusRun('copy', 'v2', [
          '--from',
          'base',
          '--change',
          'change.yaml',
          ...(destinationRecords ? ['--record-realized-text'] : []),
        ]),
        deps,
      );
      expect(copied.code, copied.err).toBe(0);
      expect(sends).toBe(0);
      const db = openStore(path);
      try {
        const [source] = await db.listRuns({ campaignId: 'base' });
        const [copy] = await db.listRuns({ campaignId: 'copy' });
        expect(copy?.blocks[0]?.realized).toEqual({
          hash: provenanceHash(SENT),
          ...(sourceRecords && destinationRecords ? { text: SENT } : {}),
        });
        if (!copy) throw new Error('missing carried run');
        expect(copy.provenanceDigest).toBe(provenanceDigest(copy));
        expect(source?.blocks[0]?.realized?.text).toBe(sourceRecords ? SENT : undefined);
        if (sourceRecords && !destinationRecords) {
          expect(copy?.realizedTextStripped).toEqual({ fromRun: source?.runId, fromCampaign: 'base' });
          expect(copy?.provenanceDigest).not.toBe(source?.provenanceDigest);
        }
      } finally {
        await db.close();
      }
    },
  );

  /** Runs the baseline with the text kept, then a radius campaign without the flag that carries it. */
  async function carryIntoHashOnly() {
    await radiusFixture();
    const base = await cli(radiusRun('base', 'v1', ['--record-realized-text']), deps);
    expect(base.code, base.err).toBe(0);
    sends = 0;
    const radius = await cli(
      radiusRun('hash-only', 'v2', ['--from', 'base', '--change', 'change.yaml']),
      deps,
    );
    expect(radius.code, radius.err).toBe(0);
    // The change touches nothing the block reads, so the baseline run is carried and no agent ran.
    expect(sends).toBe(0);
    const db = openStore(path);
    expect((await db.getCampaign('hash-only'))?.provenance).not.toHaveProperty('realizedText');
    const [carried] = await db.listRuns({ campaignId: 'hash-only' });
    expect(carried?.carried?.fromCampaign).toBe('base');
    expect(carried?.blocks[0]?.realized?.hash).toBe(provenanceHash(SENT));
    return { db, carried };
  }

  it('a campaign run without --record-realized-text holds no sent text in a run it carries', async () => {
    const { db, carried } = await carryIntoHashOnly();
    await db.close();
    expect(carried?.blocks[0]?.realized).not.toHaveProperty('text');
  });

  it('the export of that campaign holds no byte of the sent text', async () => {
    const { db } = await carryIntoHashOnly();
    const out = join(dir, 'bundle');
    try {
      await db.exportCampaign('hash-only', out);
    } finally {
      await db.close();
    }
    const files = await readdir(out, { recursive: true });
    const bytes = await Promise.all(
      files.map((name) => readFile(join(out, String(name))).catch(() => Buffer.from(''))),
    );
    expect(Buffer.concat(bytes).toString('utf8')).not.toContain(SENT);
  });
});
