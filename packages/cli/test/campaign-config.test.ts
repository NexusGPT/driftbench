import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CampaignConfig } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import { applyCampaignConfig, readCampaignConfig } from '../src/campaign-config';
import { defaultDeps, registerCampaignCommands } from '../src/commands/campaign';
import { registerCiCommand } from '../src/commands/ci';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPECS = join(ROOT, 'examples/acme/specs/conversations');
const SPEC = join(SPECS, 'plan-upgrade.yaml');

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/** A working folder, with a driftbench.yaml when text is given. */
async function project(config?: string, name = 'driftbench.yaml'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-campaign-config-'));
  made.push(dir);
  if (config !== undefined) await writeFile(join(dir, name), config);
  return dir;
}

async function cli(argv: string[], cwd: string) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  return { code: await main(argv, io), out, err };
}

/** Every key of the file, each with a value no default has. */
const FULL = `campaign:
  specs: [a.yaml, b]
  dataset: goldens@3
  prompts: [sales@2, tone]
  targets: [function:acme-sales, process:acme-ops]
  routes: [flow:price-sheet=process:acme-ops]
  modes: [T, P]
  repeats: 3
  agent_version: v7
  store: runs.db
  cache: false
  cache_suite: nightly
  concurrency: 2
  budget_usd: 1.5
  process_command: node agent.mjs
  driver: simulated
  personas: [p1.yaml, p2.yaml]
  recordings: [r1.yaml]
  model: true
  agent_family: anthropic
  judge_families: [openai, google]
  retry: { max_attempts: 2, base_delay_ms: 10, max_delay_ms: 20 }
`;

/** What each flag of campaign run holds once the file above is applied and no flag is given. */
const FROM_FILE: Record<string, unknown> = {
  dataset: 'goldens@3',
  prompt: ['sales@2', 'tone'],
  target: ['function:acme-sales', 'process:acme-ops'],
  route: ['flow:price-sheet=process:acme-ops'],
  mode: 'T,P',
  repeats: '3',
  agentVersion: 'v7',
  store: 'runs.db',
  cache: false,
  cacheSuite: 'nightly',
  concurrency: '2',
  budgetUsd: '1.5',
  processCommand: 'node agent.mjs',
  driver: 'simulated',
  persona: ['p1.yaml', 'p2.yaml'],
  recording: ['r1.yaml'],
  model: true,
  agentFamily: 'anthropic',
  judgeFamily: ['openai', 'google'],
  retryAttempts: '2',
  retryBaseMs: '10',
  retryMaxMs: '20',
};

/** The flag that sets each option on the command line, with a value other than the file's. */
const FLAGS: Record<string, [argv: string[], value: unknown]> = {
  dataset: [['--dataset', 'other'], 'other'],
  prompt: [['--prompt', 'mine'], ['mine']],
  target: [['--target', 'function:acme'], ['function:acme']],
  route: [['--route', 'flow:x=function:acme'], ['flow:x=function:acme']],
  mode: [['--mode', 'F'], 'F'],
  repeats: [['--repeats', '9'], '9'],
  agentVersion: [['--agent-version', 'v8'], 'v8'],
  store: [['--store', 'mine.db'], 'mine.db'],
  cacheSuite: [['--cache-suite', 'adhoc'], 'adhoc'],
  concurrency: [['--concurrency', '8'], '8'],
  budgetUsd: [['--budget-usd', '9'], '9'],
  processCommand: [['--process-command', 'mine'], 'mine'],
  driver: [['--driver', 'scripted'], 'scripted'],
  persona: [['--persona', 'mine.yaml'], ['mine.yaml']],
  recording: [['--recording', 'mine.yaml'], ['mine.yaml']],
  agentFamily: [['--agent-family', 'none'], 'none'],
  judgeFamily: [['--judge-family', 'mistral'], ['mistral']],
  retryAttempts: [['--retry-attempts', '7'], '7'],
  retryBaseMs: [['--retry-base-ms', '70'], '70'],
  retryMaxMs: [['--retry-max-ms', '700'], '700'],
};

/**
 * The options of the real `campaign run` (or `ci`) command once the config is applied: the command is
 * registered as the CLI registers it, and only its action is replaced, so nothing runs.
 */
async function optionsOf(
  which: 'run' | 'plan' | 'ci',
  argv: string[],
  cwd: string,
  only?: readonly string[],
): Promise<{ options: Record<string, unknown>; applied: Awaited<ReturnType<typeof applyCampaignConfig>> }> {
  const io: Io = { out: () => undefined, err: () => undefined, cwd };
  const program = new Command('driftbench').exitOverride();
  if (which === 'ci') registerCiCommand(program, io, () => undefined, defaultDeps);
  else registerCampaignCommands(program, io, () => undefined, defaultDeps);
  const command =
    which === 'ci'
      ? program.commands.find((entry) => entry.name() === 'ci')
      : program.commands
          .find((entry) => entry.name() === 'campaign')
          ?.commands.find((entry) => entry.name() === which);
  if (!command) throw new Error(`no ${which} command`);
  let seen: { options: Record<string, unknown>; applied: Awaited<ReturnType<typeof applyCampaignConfig>> } = {
    options: {},
    applied: undefined,
  };
  command.action(async (...args: unknown[]) => {
    const self = args.at(-1) as Command;
    const options = args.at(-2) as Record<string, unknown>;
    const applied = await applyCampaignConfig(self, options, io, only);
    seen = { options: { ...options }, applied };
  });
  await program.parseAsync(which === 'ci' ? ['ci', ...argv] : ['campaign', which, ...argv], { from: 'user' });
  return seen;
}

describe('the campaign key of driftbench.yaml', () => {
  it('has one mapping for every key of the schema, and every key of the test file is a key of the schema', () => {
    const keys = Object.keys(CampaignConfig.shape).sort();
    const written = FULL.split('\n')
      .filter((line) => /^ {2}[a-z_]+:/.test(line))
      .map((line) => line.trim().split(':')[0])
      .sort();
    expect(written).toEqual(keys);
  });

  it('fills every option of campaign run the command line does not give', async () => {
    const dir = await project(FULL);
    const { options, applied } = await optionsOf('run', [], dir);
    expect(applied).toMatchObject({ specs: ['a.yaml', 'b'] });
    for (const [name, value] of Object.entries(FROM_FILE))
      expect([name, options[name]]).toEqual([name, value]);
  });

  it.each(Object.entries(FLAGS))(
    'lets the flag of %s win over the file, and only that one',
    async (name, flag) => {
      const dir = await project(FULL);
      const { options } = await optionsOf('run', flag[0], dir);
      expect(options[name]).toEqual(flag[1]);
      for (const [other, value] of Object.entries(FROM_FILE)) {
        if (other !== name) expect([other, options[other]]).toEqual([other, value]);
      }
    },
  );

  it('keeps the cache on with --cache-suite alone, and off with --no-cache over cache: true', async () => {
    const dir = await project('campaign:\n  cache: true\n');
    expect((await optionsOf('run', ['--no-cache'], dir)).options.cache).toBe(false);
    expect((await optionsOf('run', [], dir)).options.cache).toBe(true);
  });

  it('gives campaign plan its own options only, and ci the run settings it shares', async () => {
    const dir = await project(FULL);
    const plan = (await optionsOf('plan', [SPEC], dir)).options;
    expect(plan).toMatchObject({ mode: 'T,P', repeats: '3', budgetUsd: '1.5', store: 'runs.db' });
    expect(plan.target).toEqual(['function:acme-sales', 'process:acme-ops']);
    expect(plan).not.toHaveProperty('concurrency');

    const shared = ['route', 'mode', 'repeats', 'concurrency', 'budgetUsd', 'processCommand', 'agentVersion'];
    const required = [
      '--specs',
      SPEC,
      '--target',
      'function:acme',
      '--baseline',
      'c-base',
      '--store',
      'ci.db',
    ];
    const ci = (await optionsOf('ci', required, dir, shared)).options;
    expect(ci).toMatchObject({
      mode: 'T,P',
      repeats: '3',
      concurrency: '2',
      budgetUsd: '1.5',
      processCommand: 'node agent.mjs',
      agentVersion: 'v7',
      route: ['flow:price-sheet=process:acme-ops'],
    });
    // What ci requires on the command line, and its own cache switch, never come from the file.
    expect(ci).toMatchObject({ specs: SPEC, target: 'function:acme', store: 'ci.db' });
    expect(ci.cache).toBeUndefined();
  });

  it('changes nothing without a campaign key: no file, another key only, or a default file that is not YAML', async () => {
    const args = ['campaign', 'plan', SPECS, '--target', 'function:acme'];
    const bare = await cli(args, await project());
    expect(bare.code).toBe(0);
    for (const text of ['aggregates:\n  - pass-rate:>=0.8\n', 'campaign:\n', ': : not yaml [']) {
      const other = await cli(args, await project(text));
      expect([text, other.code, other.err, other.out]).toEqual([text, bare.code, bare.err, bare.out]);
    }
    const json = await cli([...args, '--json'], await project('scales:\n  x: { min: 1, max: 5 }\n'));
    expect(json.out).toBe((await cli([...args, '--json'], await project())).out);
  });

  it('plans from the file, and a flag changes the plan back', async () => {
    const dir = await project('campaign:\n  targets: [function:acme]\n  modes: [T, F]\n  repeats: 2\n');
    type Plan = { cells: Array<{ mode: string }> };
    const fromFile = JSON.parse((await cli(['campaign', 'plan', SPEC, '--json'], dir)).out) as Plan;
    expect(fromFile.cells).toHaveLength(4);
    expect(new Set(fromFile.cells.map((cell) => cell.mode))).toEqual(new Set(['T', 'F']));
    const overridden = JSON.parse(
      (await cli(['campaign', 'plan', SPEC, '--json', '--mode', 'F', '--repeats', '1'], dir)).out,
    ) as Plan;
    expect(overridden.cells).toHaveLength(1);
    const named = await project('campaign:\n  repeats: 3\n', 'other.yaml');
    const explicit = JSON.parse(
      (
        await cli(
          ['campaign', 'plan', SPEC, '--target', 'function:acme', '--json', '--config', 'other.yaml'],
          named,
        )
      ).out,
    ) as Plan;
    expect(explicit.cells).toHaveLength(3);
  });

  it('runs the specs, the store and the agent version the file names, and paths on the command line replace its specs', async () => {
    const dir = await project(
      `campaign:\n  specs: ['${SPEC}']\n  targets: [function:acme]\n  store: runs.db\n  agent_version: v7\n  repeats: 2\n`,
    );
    const ran = await cli(['campaign', 'run', '--campaign', 'c-file'], dir);
    expect(ran.err).toBe('');
    expect(ran.code).toBe(0);
    const other = await cli(
      ['campaign', 'run', join(SPECS, 'tool-failure.yaml'), '--campaign', 'c-flag', '--repeats', '1'],
      dir,
    );
    expect(other.code).toBe(0);
    const store = await openStore(join(dir, 'runs.db'));
    try {
      const fromFile = await store.listRuns({ campaignId: 'c-file' });
      expect(fromFile).toHaveLength(2);
      expect(new Set(fromFile.map((run) => run.specId))).toEqual(new Set(['acme-plan-upgrade']));
      expect((await store.getCampaign('c-file'))?.targets[0]).toMatchObject({ variant: 'v7' });
      const fromFlag = await store.listRuns({ campaignId: 'c-flag' });
      expect(fromFlag).toHaveLength(1);
      expect(fromFlag[0]?.specId).toBe('acme-tool-failure');
    } finally {
      await store.close();
    }
  }, 120_000);

  it('runs the committed Acme example from the repository root: 24 cells, every one passing', async () => {
    const result = await cli(
      ['campaign', 'run', '--config', 'examples/acme/ci/campaign.yaml', '--json'],
      ROOT,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    const summary = JSON.parse(result.out) as { cells: Array<{ mode: string; state: string }> };
    expect(summary.cells).toHaveLength(24);
    expect(new Set(summary.cells.map((cell) => cell.mode))).toEqual(new Set(['T', 'F']));
    expect(new Set(summary.cells.map((cell) => cell.state))).toEqual(new Set(['pass']));
  }, 120_000);

  it('refuses a campaign key that does not fit, an unknown key in it, and a --config that cannot be read, with exit 2', async () => {
    const args = ['campaign', 'plan', SPEC, '--target', 'function:acme'];
    const cases: Array<[string, string]> = [
      ['campaign:\n  repeats: 0\n', 'campaign.repeats'],
      ['campaign:\n  modes: [X]\n', 'campaign.modes.0'],
      ['campaign:\n  repeat: 2\n', 'campaign'],
      ['campaign:\n  retry: { attempts: 2 }\n', 'campaign.retry'],
    ];
    for (const [text, at] of cases) {
      const result = await cli(args, await project(text));
      expect([text, result.code]).toEqual([text, 2]);
      expect(result.err).toContain(`driftbench.yaml: ${at}`);
      expect(result.out).toBe('');
    }
    const missing = await cli([...args, '--config', 'nowhere.yaml'], await project());
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('Cannot read the config');
    expect((await readCampaignConfig('bad.yaml', await project(': : [', 'bad.yaml'))).ok).toBe(false);
  });

  it('leaves report and ci reading a config that holds the campaign key beside aggregates', async () => {
    const dir = await project('aggregates:\n  - nope:>=0.5\ncampaign:\n  repeats: 2\n');
    const result = await cli(
      [
        'ci',
        '--specs',
        SPEC,
        '--target',
        'function:acme-sales',
        '--baseline',
        'c-nothing',
        '--store',
        'unused.db',
      ],
      dir,
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('unknown aggregate nope');
    expect(result.err).not.toContain('unknown key');
  });
});
