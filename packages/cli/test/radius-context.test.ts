import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { openStore } from '@agent-nexus/driftbench-store';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { Command } from 'commander';
import { expect, it } from 'vitest';
import { defaultDeps, registerCampaignCommands } from '../src/commands/campaign';

it('reruns and catches the planted failure when the current driver seed changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-radius-context-'));
  let seed = 1,
    sends = 0;
  try {
    await writeFile(
      join(dir, 'spec.yaml'),
      'id: acme-seeds\nmetadata: { depends: {} }\nblocks:\n  - user: hello\n    expect:\n      must: ["^good$"]\n',
    );
    await writeFile(
      join(dir, 'change.yaml'),
      'from: v1\nto: v2\nchanges:\n  - kind: criterion\n    id: unused\n',
    );
    const cli = async (id: string, version: string, radius: boolean) => {
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
                const text = String(messages.at(-1)?.content);
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
          'function:echo',
          '--agent-version',
          version,
          '--campaign',
          id,
          '--store',
          'runs.db',
          '--no-cache',
          ...(radius ? ['--from', 'base', '--change', 'change.yaml'] : []),
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
