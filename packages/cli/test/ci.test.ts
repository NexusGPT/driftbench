import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunResult } from '@driftbench/core';
import { openStore } from '@driftbench/store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pricedAcmeAdapter } from '../../core/test/runner/support';
import { type CampaignDeps, defaultDeps } from '../src/commands/campaign';
import { type CiSummary, compareArms, DEFAULT_FLAGS, pairArms, registerCiCommand } from '../src/commands/ci';
import { type Io, main } from '../src/index';

/** Fictional data only: the Acme Telecom example agents and their planted faults. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GATED = 'examples/acme/gated/specs';
const BOUNDARY = 'examples/acme/gated/specs/boundary';
const CONVERSATIONS = 'examples/acme/specs/conversations';
const FAULTS = 'examples/acme/faults';
const SLOW = 120_000;

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function tempFolder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-ci-'));
  made.push(dir);
  return dir;
}

/** Runs the CLI through `main`, or with the campaign deps a test gives. */
async function cli(argv: string[], deps?: Partial<CampaignDeps>) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  if (!deps) return { code: await main(argv, io), out, err };
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  registerCiCommand(
    program,
    io,
    (exit) => {
      code = exit;
    },
    { ...defaultDeps, ...deps },
  );
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return { code: cause.exitCode === 0 ? 0 : 2, out, err };
    throw cause;
  }
  return { code, out, err };
}

async function summaryAt(path: string): Promise<CiSummary> {
  return JSON.parse(await readFile(path, 'utf8')) as CiSummary;
}

/** A baseline campaign of the real Acme sales assistant over `specs`, kept in `store`. Returns its id. */
async function baselineCampaign(specs: string, store: string): Promise<string> {
  const run = await cli([
    'campaign',
    'run',
    specs,
    '--target',
    'function:acme-sales',
    '--store',
    store,
    '--json',
  ]);
  expect(run.err).toBe('');
  expect(run.code).toBe(0);
  return (JSON.parse(run.out) as { campaignId: string }).campaignId;
}

describe('driftbench ci on the Acme gated suite', () => {
  let dir: string;
  let baseline: string;
  let baselineId: string;

  beforeAll(async () => {
    dir = await tempFolder();
    baseline = join(dir, 'baseline.db');
    baselineId = await baselineCampaign(GATED, baseline);
  }, SLOW);

  function ci(args: string[], out: string) {
    return cli(['ci', '--specs', GATED, '--baseline', baseline, '--out', out, ...args]);
  }

  it(
    'exits 0 on the Acme agent against itself: parity at a 5 point margin',
    async () => {
      const out = join(dir, 'parity.json');
      const result = await ci(
        ['--target', 'function:acme-sales', '--store', join(dir, 'parity.db'), '--margin', '5'],
        out,
      );
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      expect(result.out).toContain('verdict                               PARITY');
      expect(result.out).toContain('Verdict: PARITY.');
      const summary = await summaryAt(out);
      expect(summary.verdict).toBe('parity');
      expect(summary.exitCode).toBe(0);
      expect(summary.baseline.campaignId).toBe(baselineId);
      expect(summary.pairs).toBe(134);
      expect(summary.table).toEqual({ bothPass: 134, regressed: 0, improved: 0, bothFail: 0 });
      expect(summary.effectPoints.estimate).toBe(0);
      expect(summary.effectPoints.upper).toBeLessThan(5);
      expect(summary.smallestMarginPoints).toBe(summary.effectPoints.upper);
      expect(summary.newFlags).toEqual([]);
      expect(summary.flags).toEqual([...DEFAULT_FLAGS]);
    },
    SLOW,
  );

  it(
    'exits 1 on the fault that skips the recap: a regression far beyond the margin',
    async () => {
      const out = join(dir, 'regression.json');
      const result = await ci(
        [
          '--target',
          'fault:x3-skips-recap',
          '--faults',
          FAULTS,
          '--store',
          join(dir, 'regression.db'),
          '--margin',
          '5',
        ],
        out,
      );
      expect(result.err).toBe('');
      expect(result.code).toBe(1);
      expect(result.out).toContain('Verdict: REGRESSION.');
      expect(result.out).toContain('Goldens that changed:');
      expect(result.out).toMatch(
        /gen-boundary-065 · F +1\/1 pass +0\/1 pass +regressed +yes +block 3 forbidden/,
      );
      expect(result.out).toContain('and 55 more: every golden is in the summary file.');
      const summary = await summaryAt(out);
      expect(summary.verdict).toBe('regression');
      expect(summary.table).toEqual({ bothPass: 54, regressed: 80, improved: 0, bothFail: 0 });
      expect(summary.regressed).toHaveLength(80);
      expect(summary.effectPoints.lower).toBeGreaterThan(5);
      expect(summary.rows.find((row) => row.name === 'gen-boundary-065 · F')?.candidate.failing[0]).toBe(
        'block 3 forbidden.order.create',
      );
    },
    SLOW,
  );

  it(
    'exits 1 with the gating verdict when the effect is within the margin but a flag fires the baseline never fired',
    async () => {
      const out = join(dir, 'gating.json');
      const result = await ci(
        [
          '--target',
          'fault:d6-obeys-instruction',
          '--faults',
          FAULTS,
          '--store',
          join(dir, 'gating.db'),
          '--margin',
          '20',
        ],
        out,
      );
      expect(result.code).toBe(1);
      expect(result.out).toContain('Verdict: GATING.');
      const summary = await summaryAt(out);
      expect(summary.verdict).toBe('gating');
      expect(summary.effectPoints.upper).toBeLessThan(20);
      expect(summary.newFlags).toHaveLength(12);
      expect(summary.rows.filter((row) => row.newFlag).map((row) => row.name)).toEqual(summary.newFlags);
    },
    SLOW,
  );

  it(
    'reads the same fault as parity when --flag leaves out the check it breaks',
    async () => {
      const out = join(dir, 'pii-only.json');
      const result = await ci(
        [
          '--target',
          'fault:d6-obeys-instruction',
          '--faults',
          FAULTS,
          '--store',
          join(dir, 'pii-only.db'),
          '--margin',
          '20',
          '--flag',
          'pii',
        ],
        out,
      );
      expect(result.code).toBe(0);
      const summary = await summaryAt(out);
      expect(summary.flags).toEqual(['pii']);
      expect(summary.table.regressed).toBe(12);
      expect(summary.newFlags).toEqual([]);
    },
    SLOW,
  );

  it(
    'refuses parity below the smallest margin the goldens can show, even for the agent against itself',
    async () => {
      const out = join(dir, 'tight.json');
      const result = await ci(
        ['--target', 'function:acme-sales', '--store', join(dir, 'tight.db'), '--margin', '2'],
        out,
      );
      expect(result.code).toBe(1);
      const summary = await summaryAt(out);
      expect(summary.verdict).toBe('regression');
      expect(summary.table.regressed).toBe(0);
      expect(summary.smallestMarginPoints).toBeGreaterThan(2);
    },
    SLOW,
  );

  it(
    'prints the summary it writes with --json',
    async () => {
      const out = join(dir, 'json.json');
      const result = await ci(
        ['--target', 'function:acme-sales', '--store', join(dir, 'json.db'), '--margin', '5', '--json'],
        out,
      );
      expect(result.code).toBe(0);
      expect(JSON.parse(result.out)).toEqual(await summaryAt(out));
    },
    SLOW,
  );
});

describe('driftbench ci baselines', () => {
  it(
    'takes a campaign id held in --store, and reads a --baseline naming the --store before the candidate joins it',
    async () => {
      const dir = await tempFolder();
      const store = join(dir, 'shared.db');
      const first = await baselineCampaign(CONVERSATIONS, store);

      const byId = await cli([
        'ci',
        '--specs',
        CONVERSATIONS,
        '--target',
        'function:acme-sales',
        '--baseline',
        first,
        '--store',
        store,
        '--margin',
        '50',
        '--out',
        join(dir, 'by-id.json'),
      ]);
      expect(byId.err).toBe('');
      expect(byId.code).toBe(0);
      const byIdSummary = await summaryAt(join(dir, 'by-id.json'));
      expect(byIdSummary.baseline.campaignId).toBe(first);
      expect(byIdSummary.candidate.campaignId).not.toBe(first);

      // The store now holds two campaigns; the latest is the candidate just run. Naming the store as the
      // baseline takes that one, and the new candidate is a third campaign.
      const byPath = await cli([
        'ci',
        '--specs',
        CONVERSATIONS,
        '--target',
        'function:acme-sales',
        '--baseline',
        store,
        '--store',
        store,
        '--margin',
        '50',
        '--out',
        join(dir, 'by-path.json'),
      ]);
      expect(byPath.code).toBe(0);
      const byPathSummary = await summaryAt(join(dir, 'by-path.json'));
      expect(byPathSummary.baseline.campaignId).toBe(byIdSummary.candidate.campaignId);
      expect(byPathSummary.candidate.campaignId).not.toBe(byIdSummary.candidate.campaignId);
      const opened = openStore(store);
      try {
        expect(await opened.listCampaigns()).toHaveLength(3);
      } finally {
        await opened.close();
      }
    },
    SLOW,
  );

  it(
    'runs the agent on every cell by default, and replays the cache only with --cache',
    async () => {
      const dir = await tempFolder();
      const base = join(dir, 'base.db');
      await baselineCampaign(CONVERSATIONS, base);
      const store = join(dir, 'cand.db');
      const args = (out: string) => [
        'ci',
        '--specs',
        CONVERSATIONS,
        '--target',
        'function:acme-sales',
        '--baseline',
        base,
        '--store',
        store,
        '--margin',
        '50',
        '--out',
        join(dir, out),
      ];
      const hits = async (out: string) => {
        const summary = await summaryAt(join(dir, out));
        const opened = openStore(store);
        try {
          const stored = await opened.listRuns({ campaignId: summary.candidate.campaignId });
          return stored.filter((run) => run.cacheHit).length;
        } finally {
          await opened.close();
        }
      };
      expect((await cli([...args('first.json'), '--cache'])).code).toBe(0);
      expect((await cli(args('second.json'))).code).toBe(0);
      expect(await hits('second.json')).toBe(0);
      expect((await cli([...args('third.json'), '--cache'])).code).toBe(0);
      expect(await hits('third.json')).toBe(6);
    },
    SLOW,
  );

  it(
    'lists the goldens only one side ran and compares the rest',
    async () => {
      const dir = await tempFolder();
      const base = join(dir, 'base.db');
      await baselineCampaign(GATED, base);
      const out = join(dir, 'subset.json');
      const result = await cli([
        'ci',
        '--specs',
        BOUNDARY,
        '--target',
        'function:acme-sales',
        '--baseline',
        base,
        '--store',
        join(dir, 'cand.db'),
        '--margin',
        '40',
        '--out',
        out,
      ]);
      expect(result.code).toBe(0);
      const summary = await summaryAt(out);
      expect(summary.pairs).toBe(10);
      expect(summary.unpaired.baselineOnly).toHaveLength(124);
      expect(summary.unpaired.candidateOnly).toEqual([]);
      expect(result.out).toContain('Not run by the candidate: ');
    },
    SLOW,
  );

  it(
    'is incomplete, exit 1, when the budget stops a candidate cell',
    async () => {
      const dir = await tempFolder();
      const base = join(dir, 'base.db');
      await baselineCampaign(CONVERSATIONS, base);
      const out = join(dir, 'incomplete.json');
      const result = await cli(
        [
          'ci',
          '--specs',
          CONVERSATIONS,
          '--target',
          'function:acme-sales',
          '--baseline',
          base,
          '--store',
          join(dir, 'cand.db'),
          '--margin',
          '50',
          '--budget-usd',
          '0.05',
          '--concurrency',
          '1',
          '--out',
          out,
        ],
        { adapterFor: async () => pricedAcmeAdapter() },
      );
      expect(result.code).toBe(1);
      const summary = await summaryAt(out);
      expect(summary.verdict).toBe('incomplete');
      expect(summary.candidate.incompleteCells).toBeGreaterThan(0);
      expect(result.out).toContain('Verdict: INCOMPLETE.');
    },
    SLOW,
  );
});

describe('driftbench ci input', () => {
  let dir: string;
  let base: string;
  beforeAll(async () => {
    dir = await tempFolder();
    base = join(dir, 'base.db');
    await baselineCampaign(CONVERSATIONS, base);
  }, SLOW);

  function ci(args: string[]) {
    return cli([
      'ci',
      '--specs',
      CONVERSATIONS,
      '--target',
      'function:acme-sales',
      '--store',
      join(dir, 'cand.db'),
      '--out',
      join(dir, 'never.json'),
      ...args,
    ]);
  }

  it.each(['0', '100', '-3', 'five'])('exits 2 on the margin %s', async (margin) => {
    const result = await ci(['--baseline', base, '--margin', margin]);
    expect(result.code).toBe(2);
    expect(result.err).toContain(`--margin takes a number of points between 0 and 100, not "${margin}"`);
    expect(existsSync(join(dir, 'never.json'))).toBe(false);
  });

  it('exits 2 on a baseline that is neither a file nor a campaign of an existing store', async () => {
    const result = await cli([
      'ci',
      '--specs',
      CONVERSATIONS,
      '--target',
      'function:acme-sales',
      '--store',
      join(dir, 'missing.db'),
      '--baseline',
      'c-nothing',
      '--margin',
      '5',
    ]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('--baseline c-nothing is neither a store file nor a campaign in --store');
  });

  it('exits 2 on a campaign id the store does not hold', async () => {
    const result = await cli([
      'ci',
      '--specs',
      CONVERSATIONS,
      '--target',
      'function:acme-sales',
      '--store',
      base,
      '--baseline',
      'c-nothing',
      '--margin',
      '5',
    ]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('no such file, and no campaign c-nothing in');
  });

  it('exits 2 on a fault target without --faults, and on a fault the set does not define', async () => {
    const bare = await ci(['--baseline', base, '--margin', '5', '--target', 'fault:x3-skips-recap']);
    expect(bare.code).toBe(2);
    expect(bare.err).toContain('A fault:<id> target needs --faults <path>');
    const unknown = await ci([
      '--baseline',
      base,
      '--margin',
      '5',
      '--target',
      'fault:x9-nothing',
      '--faults',
      FAULTS,
    ]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('No adapter is set up for fault:x9-nothing');
  });

  it(
    'exits 2 when the baseline shares no golden with the candidate',
    async () => {
      const result = await cli([
        'ci',
        '--specs',
        BOUNDARY,
        '--target',
        'function:acme-sales',
        '--store',
        join(dir, 'cand.db'),
        '--baseline',
        base,
        '--margin',
        '5',
        '--out',
        join(dir, 'never.json'),
      ]);
      expect(result.code).toBe(2);
      expect(result.err).toContain('share no golden (spec and mode): nothing to compare');
      expect(existsSync(join(dir, 'never.json'))).toBe(false);
    },
    SLOW,
  );
});

describe('pairArms and compareArms', () => {
  let runs: RunResult[];
  beforeAll(async () => {
    const dir = await tempFolder();
    const store = join(dir, 'repeats.db');
    const result = await cli([
      'campaign',
      'run',
      CONVERSATIONS,
      '--target',
      'function:acme-sales',
      '--repeats',
      '2',
      '--store',
      store,
      '--json',
    ]);
    expect(result.code).toBe(0);
    const opened = openStore(store);
    try {
      runs = await opened.listRuns({
        campaignId: (JSON.parse(result.out) as { campaignId: string }).campaignId,
      });
    } finally {
      await opened.close();
    }
  }, SLOW);

  it('pairs on spec and mode across targets, and a golden passes only when every repeat passes', () => {
    expect(runs).toHaveLength(12);
    const candidate = structuredClone(runs).map((run) => ({
      ...run,
      target: { adapter: 'fault', agent: 'x' },
    }));
    const broken = candidate.find(
      (run) => run.specId === 'acme-plan-upgrade' && run.repeat === 1,
    ) as RunResult;
    (broken.blocks[1] as RunResult['blocks'][number]).pass = false;
    const paired = pairArms(runs, candidate, [...DEFAULT_FLAGS]);
    expect(paired.pairs).toHaveLength(6);
    const row = paired.pairs.find((pair) => pair.specId === 'acme-plan-upgrade');
    expect(row?.baseline).toMatchObject({ pass: true, runs: 2, passing: 2 });
    expect(row?.candidate).toMatchObject({ pass: false, runs: 2, passing: 1 });
    expect(row?.change).toBe('regressed');
    expect(paired.pairs.filter((pair) => pair.change === 'same')).toHaveLength(5);
  });

  it('sets a flag only for a failing gating verdict of a flag check, and a new flag only where the baseline had none', () => {
    const candidate = structuredClone(runs);
    const run = candidate.find((entry) => entry.specId === 'acme-tool-failure') as RunResult;
    const verdict = (run.blocks[0] as RunResult['blocks'][number]).verdicts[0];
    if (!verdict) throw new Error('the Acme run has no verdict');
    verdict.name = 'safety';
    verdict.gating = true;
    verdict.outcome = 'fail';
    const flagged = pairArms(runs, candidate, ['safety']);
    expect(flagged.pairs.filter((pair) => pair.newFlag).map((pair) => pair.specId)).toEqual([
      'acme-tool-failure',
    ]);
    expect(pairArms(runs, candidate, ['pii']).pairs.some((pair) => pair.newFlag)).toBe(false);
    verdict.gating = false;
    expect(pairArms(runs, candidate, ['safety']).pairs.some((pair) => pair.newFlag)).toBe(false);
    verdict.gating = true;
    // The same flag on both sides is no new flag.
    expect(pairArms(candidate, candidate, ['safety']).pairs.some((pair) => pair.newFlag)).toBe(false);
  });

  it('keeps the modes apart: a spec in T and in F is two goldens', () => {
    const teacher = structuredClone(runs).map((run) => ({ ...run, mode: 'T' as const }));
    const candidate = [...structuredClone(runs), ...structuredClone(teacher)];
    const broken = candidate.find(
      (run) => run.specId === 'acme-plan-upgrade' && run.mode === 'T',
    ) as RunResult;
    (broken.blocks[0] as RunResult['blocks'][number]).pass = false;
    const paired = pairArms([...runs, ...teacher], candidate, [...DEFAULT_FLAGS]);
    expect(paired.pairs).toHaveLength(12);
    expect(paired.pairs.filter((pair) => pair.change === 'regressed').map((pair) => pair.name)).toEqual([
      'acme-plan-upgrade · T',
    ]);
  });

  it('compareArms is nonInferiority on the all-pass flag: the regression effect and the new flags', () => {
    const candidate = structuredClone(runs);
    for (const run of candidate.filter((entry) => entry.specId === 'acme-plan-upgrade')) {
      (run.blocks[0] as RunResult['blocks'][number]).pass = false;
    }
    const { pairs } = pairArms(runs, candidate, [...DEFAULT_FLAGS]);
    const result = compareArms(pairs, 0.5);
    expect(result.discordant).toEqual({ regressed: 1, improved: 0 });
    expect(result.regressedPairs).toEqual(['acme-plan-upgrade · F']);
    expect(result.effect.estimate).toBeCloseTo(1 / 6, 10);
    expect(result.effect.n).toBe(6);
  });
});

describe('the driftbench ci GitHub Action', () => {
  it('declares the inputs and outputs the brief names and runs run.sh', async () => {
    const yml = await readFile(join(ROOT, 'action/action.yml'), 'utf8');
    for (const input of ['specs', 'target', 'baseline', 'store', 'margin']) {
      expect(yml).toMatch(new RegExp(`^  ${input}:\\n    description: `, 'm'));
    }
    expect(yml).toContain('verdict:\n    description:');
    expect(yml).toMatch(/value: \$\{\{ steps\.ci\.outputs\.verdict \}\}/);
    expect(yml).toMatch(/value: \$\{\{ steps\.ci\.outputs\.report-path \}\}/);
    expect(yml).toContain('using: composite');
    expect(yml).toContain('run: bash "$GITHUB_ACTION_PATH/run.sh"');
    // Inputs reach the shell through the environment, never spliced into the script.
    expect(yml).not.toMatch(/run: .*\$\{\{ inputs\./);
  });

  it(
    'run.sh writes the verdict and the report path, and exits with the CLI code: 0 on parity, 2 on bad input',
    async () => {
      const dir = await tempFolder();
      const base = join(dir, 'base.db');
      await baselineCampaign(BOUNDARY, base);
      const tsx = join(ROOT, 'node_modules/.bin/tsx');
      const action = (margin: string) => {
        const output = join(dir, `output-${margin}.txt`);
        const report = join(dir, `report-${margin}.json`);
        const result = spawnSync('bash', [join(ROOT, 'action/run.sh')], {
          cwd: ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_OUTPUT: output,
            INPUT_SPECS: BOUNDARY,
            INPUT_TARGET: 'function:acme-sales',
            INPUT_BASELINE: base,
            INPUT_STORE: join(dir, 'cand.db'),
            INPUT_MARGIN: margin,
            INPUT_REPORT_PATH: report,
            INPUT_DRIFTBENCH: `${tsx} packages/cli/src/bin.ts`,
          },
        });
        return { result, output, report };
      };

      const parity = action('40');
      // Node 22 warns that its SQLite module is experimental; that line is the runtime's, not the action's.
      expect(
        parity.result.stderr
          .split('\n')
          .filter((l) => l !== '' && !/ExperimentalWarning|--trace-warnings/.test(l)),
      ).toEqual([]);
      expect(parity.result.status).toBe(0);
      expect(await readFile(parity.output, 'utf8')).toBe(`verdict=parity\nreport-path=${parity.report}\n`);
      expect((await summaryAt(parity.report)).verdict).toBe('parity');

      const bad = action('0');
      expect(bad.result.status).toBe(2);
      expect(await readFile(bad.output, 'utf8')).toBe(`verdict=input-error\nreport-path=${bad.report}\n`);
    },
    SLOW,
  );
});
