import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { expect, it } from 'vitest';
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
    expect(campaign?.provenance?.adapters).toMatchObject([{ id: 'function', agentVersion: 'acme-v1' }]);
    const runs = await db.listRuns({ campaignId: 'base' });
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.provenance?.driver).toEqual({ id: 'scripted', seeds: {} });
      expect(run.blocks.every((block) => block.provenance?.stimulus !== undefined)).toBe(true);
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
    const reopened = openStore(path);
    const fresh = await reopened.listRuns({ campaignId: 'next' });
    expect(fresh).toHaveLength(runs.length);
    expect(fresh.every((run) => run.carried === undefined)).toBe(true);
    await reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
