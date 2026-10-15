import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provenanceHash, runSpec } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { echoAdapter, specOf } from '../../core/test/runner/support';
import { campaignProvenance } from '../src/commands/campaign-provenance';
import { main } from '../src/index';

const root = fileURLToPath(new URL('../../../', import.meta.url));
it('persists adapter stamps and reruns legacy campaigns in full', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-provenance-'));
  const path = join(dir, 'runs.db');
  const cli = async (args: string[]) => {
    let out = '';
    let err = '';
    const code = await main(args, {
      cwd: root,
      out: (s) => {
        out += s;
      },
      err: (s) => {
        err += s;
      },
    });
    return { code, out, err };
  };
  try {
    const args = [
      'campaign',
      'run',
      'examples/acme/gated/specs/graph',
      '--target',
      'function:acme-sales',
      '--agent-version',
      'acme-v1',
      '--store',
      path,
      '--no-cache',
    ];
    const first = await cli([...args, '--campaign', 'base']);
    expect(first.code, first.err).toBe(0);
    expect(first.out).not.toContain('provenance');
    const db = openStore(path);
    const campaign = await db.getCampaign('base');
    expect(campaign?.provenance?.adapters).toMatchObject([
      { idHash: provenanceHash('function'), agentVersionHash: provenanceHash('acme-v1') },
    ]);
    const runs = await db.listRuns({ campaignId: 'base' });
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.provenance?.driver).toEqual({
        idHash: provenanceHash('scripted'),
        seedsHash: provenanceHash({}),
      });
      expect(run.blocks.every((block) => block.provenance?.stimulusHash !== undefined)).toBe(true);
    }
    if (!campaign) throw new Error('missing campaign');
    const { provenance: _, ...old } = campaign;
    await db.putCampaign({ ...old, campaignId: 'legacy' });
    for (const run of runs) {
      const { provenance: __, ...record } = run;
      await db.putRun('legacy', {
        ...record,
        blocks: run.blocks.map(({ provenance: ___, ...block }) => block),
      });
    }
    await db.putCampaign({ ...campaign, campaignId: 'partial', provenance: { version: 2, adapters: [] } });
    for (const run of runs) await db.putRun('partial', run);
    await db.close();
    await writeFile(join(dir, 'identity.yaml'), 'from: acme-v1\nto: acme-v2\nchanges: []\n');
    const next = [...args];
    next[next.indexOf('acme-v1')] = 'acme-v2';
    const result = await cli([
      ...next,
      '--campaign',
      'next',
      '--from',
      'legacy',
      '--change',
      join(dir, 'identity.yaml'),
    ]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain('the baseline has no execution provenance');
    const partial = await cli([
      ...next,
      '--campaign',
      'partial-next',
      '--from',
      'partial',
      '--change',
      join(dir, 'identity.yaml'),
    ]);
    expect(partial.code, partial.err).toBe(0);
    const reopened = openStore(path);
    expect(
      (await reopened.listRuns({ campaignId: 'partial-next' })).every((run) => run.carried === undefined),
    ).toBe(true);
    const fresh = await reopened.listRuns({ campaignId: 'next' });
    expect(fresh).toHaveLength(runs.length);
    expect(fresh.every((run) => run.carried === undefined)).toBe(true);
    await reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('stores only hashes of private provenance inputs, including the campaign version', async () => {
  const marker = 'ACME_PRIVATE_PROVENANCE_SENTINEL';
  const dir = await mkdtemp(join(tmpdir(), 'acme-private-provenance-'));
  const path = join(dir, 'runs.db');
  try {
    const adapter = {
      ...echoAdapter(),
      id: `${marker}-adapter`,
      version: `${marker}-version`,
      cacheIdentity: `${marker}-command`,
    };
    const run = await runSpec(specOf({ id: 'acme-private', blocks: [{ user: 'hello' }] }), {
      adapter,
      checks: [],
      mode: 'F',
      repeat: 0,
      target: { adapter: 'echo', variant: 'v1' },
      recordProvenance: true,
      driver: {
        ...createScriptedDriver(),
        id: `${marker}-driver`,
        seeds: { [marker]: `${marker}-seed` },
        next: (ctx) =>
          ctx.blockIndex > 0
            ? { kind: 'stop', reason: 'done' }
            : { kind: 'block', blockIndex: 0, stimulus: { user: `${marker}-stimulus` } },
      },
    });
    const db = openStore(path);
    await db.putCampaign({
      campaignId: 'private',
      specs: [{ id: run.specId, hash: run.specHash }],
      targets: [run.target],
      modes: ['F'],
      repeats: { F: 1, T: 0, P: 0 },
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt: run.startedAt,
      provenance: campaignProvenance(
        [{ adapter: `${marker}-target`, variant: `${marker}-agent-version` }],
        () => adapter,
      ),
    });
    await db.putRun('private', run);
    const stored = {
      campaign: await db.getCampaign('private'),
      runs: await db.listRuns({ campaignId: 'private' }),
    };
    expect(Buffer.from(JSON.stringify(stored)).includes(Buffer.from(marker))).toBe(false);
    await db.close();
    expect((await readFile(path)).includes(Buffer.from(marker))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('records the campaign choice to store the text a driver sent only with --record-realized-text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-realized-text-'));
  const path = join(dir, 'runs.db');
  try {
    await writeFile(join(dir, 'spec.yaml'), 'id: acme-realized\nblocks:\n  - user: hello\n');
    const cli = (args: string[]) => main(args, { cwd: dir, out: () => {}, err: () => {} });
    const args = [
      'campaign',
      'run',
      'spec.yaml',
      '--target',
      'function:acme-sales',
      '--store',
      path,
      '--no-cache',
    ];
    expect(await cli([...args, '--campaign', 'hashed'])).toBe(0);
    expect(await cli([...args, '--campaign', 'kept', '--record-realized-text'])).toBe(0);
    const db = openStore(path);
    expect((await db.getCampaign('hashed'))?.provenance).not.toHaveProperty('realizedText');
    expect((await db.getCampaign('kept'))?.provenance?.realizedText).toBe(true);
    await db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('refuses an empty campaign adapter stamp for a cell outside an unused criterion change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-partial-provenance-'));
  const path = join(dir, 'runs.db');
  try {
    await writeFile(
      join(dir, 'spec.yaml'),
      'id: acme-partial\nmetadata: { depends: {} }\nblocks:\n  - user: hello\n',
    );
    await writeFile(
      join(dir, 'change.yaml'),
      'from: v1\nto: v2\nchanges:\n  - kind: criterion\n    id: unused-review\n',
    );
    const cli = (args: string[]) => main(args, { cwd: dir, out: () => {}, err: () => {} });
    const args = [
      'campaign',
      'run',
      'spec.yaml',
      '--target',
      'function:acme-sales',
      '--store',
      path,
      '--no-cache',
    ];
    expect(await cli([...args, '--campaign', 'base', '--agent-version', 'v1'])).toBe(0);
    const db = openStore(path);
    const base = await db.getCampaign('base');
    if (!base?.provenance) throw new Error('missing baseline');
    await db.putCampaign({
      ...base,
      campaignId: 'partial',
      provenance: { ...base.provenance, adapters: [] },
    });
    for (const run of await db.listRuns({ campaignId: 'base' })) await db.putRun('partial', run);
    await db.close();
    for (const from of ['base', 'partial']) {
      expect(
        await cli([
          ...args,
          '--campaign',
          `next-${from}`,
          '--agent-version',
          'v2',
          '--from',
          from,
          '--change',
          'change.yaml',
        ]),
      ).toBe(0);
      const store = openStore(path);
      expect(
        (await store.listRuns({ campaignId: `next-${from}` })).filter((run) => run.carried),
      ).toHaveLength(from === 'base' ? 1 : 0);
      await store.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
