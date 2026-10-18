import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { provenanceHash } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { Command } from 'commander';
import { expect, it } from 'vitest';
import { defaultDeps, registerCampaignCommands } from '../src/commands/campaign';

it('reruns and catches the planted failure when the current driver seed changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-radius-context-'));
  let seed = 1,
    sends = 0,
    planted = false;
  try {
    await writeFile(
      join(dir, 'spec.yaml'),
      'id: acme-seeds\nmetadata: { depends: {} }\nblocks:\n  - user: hello\n    expect:\n      must: ["^good$"]\n',
    );
    await writeFile(
      join(dir, 'change.yaml'),
      'from: v1\nto: v2\nchanges:\n  - kind: criterion\n    id: unused\n',
    );
    const cli = async (id: string, version: string, radius: boolean, from = 'base') => {
      let code = 0,
        error = '';
      const program = new Command('driftbench').exitOverride();
      registerCampaignCommands(
        program,
        {
          cwd: dir,
          out: () => {},
          err: (text) => {
            error += text;
          },
        },
        (exit) => {
          code = exit;
        },
        {
          ...defaultDeps,
          driver: () => ({
            ...createScriptedDriver(),
            seeds: { sample: seed },
            next: (ctx) =>
              ctx.blockIndex > 0
                ? { kind: 'stop', reason: 'done' }
                : { kind: 'block', blockIndex: 0, stimulus: { user: seed === 1 ? 'good' : 'bad' } },
          }),
          adapterFor: async () =>
            functionAdapter({
              respond: (messages) => {
                sends++;
                const text = planted ? 'bad' : String(messages.at(-1)?.content);
                return {
                  text,
                  segments: [],
                  toolCalls: [],
                  cost: {},
                  latencyMs: 0,
                  artifacts: [{ path: 'fixture.txt', sha256: provenanceHash('Acme') }],
                };
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
          'function:echo',
          '--agent-version',
          version,
          '--campaign',
          id,
          '--store',
          'runs.db',
          '--no-cache',
          ...(radius ? ['--from', from, '--change', 'change.yaml'] : []),
        ],
        { from: 'user' },
      );
      expect(error).toBe('');
      return code;
    };
    expect(await cli('base', 'v1', false)).toBe(0);
    sends = 0;
    expect(await cli('same-context', 'v2', true)).toBe(0);
    expect(sends).toBe(0);
    const db = openStore(join(dir, 'runs.db'));
    const campaign = await db.getCampaign('base');
    const [baseline] = await db.listRuns({ campaignId: 'base' });
    if (!campaign || !baseline) throw new Error('missing baseline');
    planted = true;
    // An under-sized manifest would carry this pass and hide the planted failure. Every damaged
    // evidence field instead sends a new request and catches exactly the full-run failure.
    const paths = [
      'blocks.0.provenance.specIndex',
      'blocks.0.provenance.stimulusHash',
      'blocks.0.provenance.ledgerHash',
      'blocks.0.provenance.artifacts.0.pathHash',
      'blocks.0.provenance.artifacts.0.sha256',
      'blocks.0.givenHash',
      'provenanceDigest',
    ];
    for (const [index, path] of paths.entries()) {
      const changed = structuredClone(baseline);
      const parts = path.split('.');
      let object = changed as unknown as Record<string, unknown>;
      for (const part of parts.slice(0, -1)) object = object[part] as Record<string, unknown>;
      const key = parts.at(-1);
      if (!key) throw new Error('empty mutation path');
      object[key] =
        key === 'specIndex' ? 1 : key === 'givenHash' ? 'abcdef123456' : provenanceHash('changed');
      const id = `tampered-${index}`;
      await db.putCampaign({ ...campaign, campaignId: id });
      await db.putRun(id, changed);
      sends = 0;
      expect(await cli(`rerun-${index}`, 'v2', true, id), path).toBe(1);
      expect(sends, path).toBe(1);
      const [result] = await db.listRuns({ campaignId: `rerun-${index}` });
      expect(result?.carried, path).toBeUndefined();
      expect(result?.blocks[0]?.pass, path).toBe(false);
    }
    expect(await cli('planted-full', 'v2', false)).toBe(1);
    await db.close();
    planted = false;
    seed = 2;
    sends = 0;
    expect(await cli('radius', 'v2', true)).toBe(1);
    expect(sends).toBe(1);
    expect(await cli('full', 'v2', false)).toBe(1);
    const store = openStore(join(dir, 'runs.db'));
    const [run] = await store.listRuns({ campaignId: 'radius' });
    expect(run?.carried).toBeUndefined();
    expect(run?.blocks[0]?.pass).toBe(false);
    await store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
