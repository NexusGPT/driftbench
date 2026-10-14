import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { agentVersionOf } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAcmeAgent } from '../../../examples/acme/src/index';
import { type CampaignDeps, defaultDeps, registerCampaignCommands } from '../src/commands/campaign';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ACME_SPECS = join(ROOT, 'examples/acme/specs/conversations');
/** Fictional data only. The bytes keep a trailing space and a CR LF, which a text round trip would lose. */
const PROMPT = 'You are the Acme Telecom sales assistant. \r\nAnswer in one message.\n';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-registry-prompt-'));
  await cp(ACME_SPECS, join(dir, 'specs'), { recursive: true });
  await writeFile(join(dir, 'acme-sales.md'), PROMPT);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function ioFor(cwd: string) {
  const io = { out: '', err: '' };
  const handle: Io = {
    out: (text) => {
      io.out += text;
    },
    err: (text) => {
      io.err += text;
    },
    cwd,
  };
  return { io, handle };
}

async function cli(argv: string[], cwd = dir) {
  const { io, handle } = ioFor(cwd);
  const code = await main(argv, handle);
  return { code, ...io };
}

/** `campaign` with an Acme function adapter that keeps the prompt each block received. */
async function campaignSeeing(argv: string[], seen: (string | undefined)[]) {
  const { io, handle } = ioFor(dir);
  const agent = createAcmeAgent();
  const deps: CampaignDeps = {
    ...defaultDeps,
    adapterFor: async () =>
      functionAdapter({
        respond: (messages, world, _vars, _state, context) => {
          seen.push(context.prompt);
          return agent.respond(messages, world);
        },
      }),
  };
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: handle.out, writeErr: handle.err });
  registerCampaignCommands(
    program,
    handle,
    (exit) => {
      code = exit;
    },
    deps,
  );
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return { code: 2, ...io };
    throw cause;
  }
  return { code, ...io };
}

describe('--prompt reaches the agent', () => {
  it('hands the restored prompt text to every block, and records it on the campaign targets', async () => {
    await cli(['dataset', 'push', 'acme-specs', 'specs', '--store', 'store.db']);
    await cli(['prompt', 'push', 'acme-sales', 'acme-sales.md', '--store', 'store.db']);
    const seen: (string | undefined)[] = [];
    const run = await campaignSeeing(
      [
        'campaign',
        'run',
        '--dataset',
        'acme-specs',
        '--prompt',
        'acme-sales@1',
        '--target',
        'function:acme',
        '--campaign',
        'c-prompt',
        '--store',
        'store.db',
        '--json',
      ],
      seen,
    );
    expect(run.err).toBe('');
    expect(seen.length).toBeGreaterThan(6);
    expect(new Set(seen)).toEqual(new Set([PROMPT]));

    const store = openStore(join(dir, 'store.db'));
    try {
      const campaign = await store.getCampaign('c-prompt');
      expect(campaign?.targets).toEqual([
        {
          adapter: 'function',
          agent: 'acme',
          prompt: expect.objectContaining({ name: 'acme-sales', version: 1, text: PROMPT }),
        },
      ]);
      const upgrade = campaign?.specs.find((spec) => spec.id === 'acme-plan-upgrade');
      expect((await store.getSpec('acme-plan-upgrade', upgrade?.hash ?? ''))?.path).toBe(
        'acme-specs@1/plan-upgrade.yaml',
      );
    } finally {
      await store.close();
    }
  }, 60_000);

  it('refuses two prompts, and a prompt version of several files', async () => {
    await cli(['prompt', 'push', 'acme-sales', 'acme-sales.md', '--store', 'store.db']);
    await mkdir(join(dir, 'prompts'));
    await writeFile(join(dir, 'prompts', 'system.md'), 'You are Acme.\n');
    await writeFile(join(dir, 'prompts', 'style.md'), 'Be brief.\n');
    await cli(['prompt', 'push', 'acme-pack', 'prompts', '--store', 'store.db']);
    const base = ['campaign', 'run', 'specs', '--target', 'function:acme', '--store', 'store.db'];

    const two = await cli([...base, '--prompt', 'acme-sales', '--prompt', 'acme-pack']);
    expect(two.code).toBe(2);
    expect(two.err).toBe('--prompt names the one prompt the agent runs with: give it once.\n');
    const pack = await cli([...base, '--prompt', 'acme-pack']);
    expect(pack.code).toBe(2);
    expect(pack.err).toBe(
      'prompt acme-pack@1 holds 2 files; --prompt hands the agent one text, so push a single prompt file.\n',
    );
  });
});

describe('a campaign bundle runs again on another machine', () => {
  it('exports the campaign with its specs and sources, imports it into a fresh store, and runs it again', async () => {
    await cli(['dataset', 'push', 'acme-specs', 'specs', '--store', 'store.db']);
    await cli(['prompt', 'push', 'acme-sales', 'acme-sales.md', '--store', 'store.db']);
    const first = await cli([
      'campaign',
      'run',
      '--dataset',
      'acme-specs',
      '--prompt',
      'acme-sales',
      '--target',
      'function:acme',
      '--campaign',
      'c-ship',
      '--store',
      'store.db',
    ]);
    expect(first.code).toBe(0);
    const exported = await cli(['campaign', 'export', 'c-ship', '--store', 'store.db', '--out', 'bundles']);
    expect(exported.err).toBe('');
    expect(exported.out).toBe(
      'Exported campaign c-ship to bundles/c-ship: 6 runs, 6 specs, 2 sources (dataset acme-specs@1, prompt acme-sales@1).\n',
    );

    // The other machine: a folder holding only the bundle.
    const elsewhere = await mkdtemp(join(tmpdir(), 'driftbench-elsewhere-'));
    try {
      await cp(join(dir, 'bundles'), join(elsewhere, 'bundles'), { recursive: true });
      const imported = await cli(['campaign', 'import', 'bundles/c-ship', '--store', 'there.db'], elsewhere);
      expect(imported.err).toBe('');
      expect(imported.out).toBe('Imported campaign c-ship into there.db: 6 runs, 6 specs, 2 sources.\n');
      const status = await cli(['campaign', 'status', 'c-ship', '--store', 'there.db'], elsewhere);
      expect(status.code).toBe(0);
      const again = await cli(
        [
          'campaign',
          'run',
          '--dataset',
          'acme-specs@1',
          '--prompt',
          'acme-sales@1',
          '--target',
          'function:acme',
          '--campaign',
          'c-again',
          '--store',
          'there.db',
        ],
        elsewhere,
      );
      expect(again.err).toBe('');
      expect(again.code).toBe(0);
      const here = openStore(join(dir, 'store.db'));
      const there = openStore(join(elsewhere, 'there.db'));
      try {
        expect((await there.getCampaign('c-again'))?.sources).toEqual(
          (await here.getCampaign('c-ship'))?.sources,
        );
      } finally {
        await here.close();
        await there.close();
      }
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('--agent-version names the agent under test', () => {
  const run = (campaign: string, extra: string[]) =>
    campaignSeeing(
      [
        'campaign',
        'run',
        'specs',
        '--target',
        'function:acme',
        '--campaign',
        campaign,
        '--store',
        'store.db',
        ...extra,
      ],
      [],
    );

  it('writes the label as the variant of every run, and leaves a run without the flag as it was', async () => {
    expect((await run('c-plain', [])).err).toBe('');
    expect((await run('c-v1', ['--agent-version', 'v1'])).err).toBe('');
    expect((await run('c-v2', ['--agent-version', 'v2'])).err).toBe('');
    const store = openStore(join(dir, 'store.db'));
    try {
      const plain = await store.listRuns({ campaignId: 'c-plain' });
      const v1 = await store.listRuns({ campaignId: 'c-v1' });
      const v2 = await store.listRuns({ campaignId: 'c-v2' });
      expect(plain.length).toBeGreaterThan(0);
      expect(plain.map((each) => each.target)).toEqual(
        plain.map(() => ({ adapter: 'function', agent: 'acme' })),
      );
      expect(new Set(v1.map((each) => agentVersionOf(each)))).toEqual(new Set(['v1']));
      expect(new Set(v2.map((each) => agentVersionOf(each)))).toEqual(new Set(['v2']));
      expect(plain.map((each) => agentVersionOf(each))).toEqual(plain.map(() => undefined));
      // The version is part of the cell id: no run of v2 has the id of a run of v1 or of the plain campaign.
      const ids = (runs: typeof v1) => new Set(runs.map((each) => each.runId));
      for (const id of ids(v2)) {
        expect(ids(v1).has(id)).toBe(false);
        expect(ids(plain).has(id)).toBe(false);
      }
      // A cold cache for the new version: nothing of v2 is a replay of v1.
      expect(v2.every((each) => each.cacheHit !== true)).toBe(true);
    } finally {
      store.close();
    }
  });
});
