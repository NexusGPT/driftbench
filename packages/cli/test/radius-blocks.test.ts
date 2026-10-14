import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command } from 'commander';
import { expect, it } from 'vitest';
import { defaultDeps, registerCampaignCommands } from '../src/commands/campaign';

it('opts into T block reruns, records snapshot privacy choice, and audits carried blocks inside a partial cell', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-radius-blocks-'));
  let sends = 0,
    fault = false;
  try {
    await writeFile(
      join(dir, 'spec.yaml'),
      'id: acme-blocks\nmetadata: { depends: {} }\nblocks:\n  - user: one\n    expect: { stage: one, must: [good] }\n  - user: two\n    expect: { stage: two, must: [good] }\n  - user: three\n    expect: { stage: three, must: [good] }\n',
    );
    await writeFile(join(dir, 'change.yaml'), 'from: v1\nto: v2\nchanges: [{ kind: stage, id: two }]\n');
    const cli = async (id: string, extra: string[]) => {
      let code = 0,
        out = '',
        err = '';
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
          adapterFor: async () =>
            functionAdapter({
              respond: (messages) => {
                sends++;
                const text = fault && messages.at(-1)?.content === 'three' ? 'regression' : 'good';
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
      if (process.env.DBG) console.log(out);
      expect(err).toBe('');
      return { code, out };
    };
    expect((await cli('base', ['--record-end-state-snapshots'])).code).toBe(0);
    sends = 0;
    expect((await cli('partial', ['--from', 'base', '--change', 'change.yaml', '--block-reruns'])).code).toBe(
      0,
    );
    expect(sends).toBe(1);
    const store = openStore(join(dir, 'runs.db'));
    const [run] = await store.listRuns({ campaignId: 'partial' });
    expect(run?.blocks.filter((b) => b.carried)).toHaveLength(2);
    expect((await store.getCampaign('base'))?.provenance?.endStateSnapshots).toBe(true);
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
    ]);
    expect(audited.code).toBe(1);
    expect(audited.out).toContain('RADIUS MISS');
    const [caught] = await store.listRuns({ campaignId: 'audited' });
    expect(caught?.blocks[2]?.pass).toBe(false);
    expect(caught?.blocks.every((b) => !b.carried)).toBe(true);
    await store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
