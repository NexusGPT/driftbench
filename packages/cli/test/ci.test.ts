import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pricedAcmeAdapter } from '../../core/test/runner/support';
import { type CampaignDeps, defaultDeps } from '../src/commands/campaign';
import { aggregateVerdict, type CiSummary, DEFAULT_FLAGS, registerCiCommand } from '../src/commands/ci';
import { type Io, main } from '../src/index';

/** Fictional data only: the Acme Telecom example agents and their planted faults. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GATED = 'examples/acme/gated/specs';
const BOUNDARY = 'examples/acme/gated/specs/boundary';
const GOLDEN = 'examples/acme/golden/specs';
/** The Acme sales faults the golden suite turns red at margin 30 (bench D3, D4): x2 is the one it misses. */
const RED_FAULTS = [
  'd2-ignores-goal-shift',
  'd4-order-on-loose-yes',
  'd6-obeys-instruction',
  'd8-hides-tool-failure',
  'd9-answers-out-of-scope',
  'x1-invents-price',
  'x3-skips-recap',
  'x4-wrong-language',
  'x5-drops-coverage-check',
];
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
/**
 * The Acme suites hold code-agent tasks for the ops agent beside the sales conversations: every `ci` and
 * `campaign run` with a `--target` routes the price-sheet flow to the ops agent, as the gate does.
 */
const ROUTE = ['--route', 'flow:price-sheet=process:acme-ops'];

function routed(argv: string[]): string[] {
  const runs = argv[0] === 'ci' || (argv[0] === 'campaign' && argv[1] === 'run');
  return runs && argv.includes('--target') && !argv.includes('--route') ? [...argv, ...ROUTE] : argv;
}

async function cli(given: string[], deps?: Partial<CampaignDeps>) {
  const argv = routed(given);
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
    'exits 0 on the Acme agent against itself at a 30 point margin: parity on the all-pass flag and every gating criterion',
    async () => {
      const out = join(dir, 'parity.json');
      const result = await ci(
        ['--target', 'function:acme-sales', '--store', join(dir, 'parity.db'), '--margin', '30'],
        out,
      );
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      expect(result.out).toContain('Verdict: PARITY. Exit 0.');
      const summary = await summaryAt(out);
      expect(summary.verdict).toBe('parity');
      expect(summary.baseline.campaignId).toBe(baselineId);
      expect(summary.pairs).toBe(195);
      expect(summary.table).toEqual({ bothPass: 195, regressed: 0, improved: 0, bothFail: 0 });
      expect(summary.criteriaNotShown).toEqual([]);
      expect(summary.newFlags).toEqual([]);
      expect(summary.flags).toEqual([...DEFAULT_FLAGS]);
    },
    SLOW,
  );

  it(
    'exits 0 with the defaults: margin auto, set by guards, with the task criteria and cards underpowered',
    async () => {
      const out = join(dir, 'defaults.json');
      const result = await ci(
        ['--target', 'fault:control-sales-identity', '--faults', FAULTS, '--store', join(dir, 'defaults.db')],
        out,
      );
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      const summary = await summaryAt(out);
      expect(summary.verdict).toBe('parity');
      expect(summary.marginPoints).toBe(7.5);
      expect(summary.marginAuto).toEqual({ neededPoints: 7, limitedBy: 'guards' });
      expect(summary.minGoldens).toBe(30);
      expect(summary.underpowered.map((entry) => entry.criterion)).toEqual([
        'artifacts',
        'budget',
        'cards',
        'execution',
        'must_not',
        'safety',
        'skills',
        'workspace',
      ]);
      expect(result.out).toContain('Margin auto: 7.5 points');
      expect(result.out).not.toContain('Warning:');
      const top = result.out.split('\n').slice(0, 3).join('\n');
      expect(top).toContain('Margin auto: 7.5 points');
      expect(top).toContain(
        'Underpowered, under 30 goldens, left out of the parity test: artifacts (24 goldens), budget (24 goldens), cards (11 goldens), execution (24 goldens), must_not (1 golden), safety (24 goldens), skills (24 goldens), workspace (24 goldens).',
      );
    },
    SLOW,
  );

  it(
    'reads the same agent at a 2 point margin, below the smallest these pairs can show, as not shown non-inferior, naming the criteria too thin for it, never as a regression',
    async () => {
      const out = join(dir, 'tight.json');
      const result = await ci(
        ['--target', 'function:acme-sales', '--store', join(dir, 'tight.db'), '--margin', '2'],
        out,
      );
      expect(result.code).toBe(1);
      expect(result.out).toContain('Verdict: NOT SHOWN NON-INFERIOR. Exit 1.');
      expect(result.out).toContain('Not shown non-inferior is not a regression');
      expect(result.out).not.toContain('REGRESSION');
      const summary = await summaryAt(out);
      expect(summary.verdict).toBe('not-shown-non-inferior');
      expect(summary.table.regressed).toBe(0);
      expect(summary.criteriaNotShown.map((entry) => entry.criterion)).toEqual([
        'end_state',
        'forbidden',
        'guards',
        'lang',
        'must',
        'tools',
      ]);
      expect(summary.underpowered).toEqual([
        { criterion: 'artifacts', goldens: 24 },
        { criterion: 'budget', goldens: 24 },
        { criterion: 'cards', goldens: 11 },
        { criterion: 'execution', goldens: 24 },
        { criterion: 'must_not', goldens: 1 },
        { criterion: 'safety', goldens: 24 },
        { criterion: 'skills', goldens: 24 },
        { criterion: 'workspace', goldens: 24 },
      ]);
    },
    SLOW,
  );

  it(
    'exits 1 on the fault that skips the recap: a regression, with its new forbidden flags',
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
      expect(result.out).toContain('Verdict: REGRESSION. Exit 1.');
      expect(result.out).toContain('Goldens that changed:');
      expect(result.out).toMatch(/gen-boundary-063 · F +pass +fail +regressed +forbidden +block 2 forbidden/);
      expect(result.out).toContain('and 77 more: every golden is in the summary file.');
      const summary = await summaryAt(out);
      expect(summary.verdict).toBe('regression');
      expect(summary.table).toEqual({ bothPass: 93, regressed: 102, improved: 0, bothFail: 0 });
      expect(summary.regressed).toHaveLength(102);
      expect(summary.newFlags).toContain('gen-boundary-063 · F forbidden');
      expect(summary.effectPoints.lower).toBeGreaterThan(5);
      expect(summary.rows.find((row) => row.name === 'gen-boundary-063 · F')?.candidate.failing[0]).toBe(
        'block 2 forbidden.order.create',
      );
    },
    SLOW,
  );

  it(
    'takes a code-agent fault through a route: the task specs regress, the conversations stay on the sales agent',
    async () => {
      const out = join(dir, 'routed-fault.json');
      const result = await ci(
        [
          '--target',
          'function:acme-sales',
          '--route',
          'flow:price-sheet=fault:ops-x1-wrong-price',
          '--faults',
          FAULTS,
          '--store',
          join(dir, 'routed-fault.db'),
        ],
        out,
      );
      expect(result.err).toBe('');
      expect(result.code).toBe(1);
      expect(result.out).toContain('Verdict: REGRESSION. Exit 1.');
      const summary = await summaryAt(out);
      expect(summary.table).toEqual({ bothPass: 173, regressed: 22, improved: 0, bothFail: 0 });
      expect(summary.regressed.every((name) => name.startsWith('acme-price-sheet-'))).toBe(true);
    },
    SLOW,
  );

  it(
    'counts a new flag only in the families --flag names',
    async () => {
      const run = (flag: string[], name: string) =>
        ci(
          [
            '--target',
            'fault:x3-skips-recap',
            '--faults',
            FAULTS,
            '--store',
            join(dir, `${name}.db`),
            '--margin',
            '5',
            ...flag,
          ],
          join(dir, `${name}.json`),
        );
      await run(['--flag', 'pii'], 'pii-only');
      const piiOnly = await summaryAt(join(dir, 'pii-only.json'));
      expect(piiOnly.flags).toEqual(['pii']);
      expect(piiOnly.newFlags).toEqual([]);
      expect(piiOnly.verdict).toBe('regression');
    },
    SLOW,
  );

  it(
    'prints the summary it writes with --json',
    async () => {
      const out = join(dir, 'json.json');
      const result = await ci(
        ['--target', 'function:acme-sales', '--store', join(dir, 'json.db'), '--margin', '30', '--json'],
        out,
      );
      expect(result.code).toBe(0);
      expect(JSON.parse(result.out)).toEqual(await summaryAt(out));
    },
    SLOW,
  );
});

/** Bench D3 and D4: the identical agent never reads REGRESSION, and ci gives compare's verdict on the same pair. */
describe('driftbench ci on the Acme golden suite: one verdict rule with compare', () => {
  let dir: string;
  let store: string;
  beforeAll(async () => {
    dir = await tempFolder();
    store = join(dir, 'golden.db');
    const run = await cli([
      'campaign',
      'run',
      GOLDEN,
      '--target',
      'function:acme-sales',
      '--store',
      store,
      '--campaign',
      'baseline',
      '--json',
    ]);
    expect(run.code).toBe(0);
  }, SLOW);

  async function ciThenCompare(target: string[], margin: string, name: string, gate: string[] = []) {
    const out = join(dir, `${name}.json`);
    const result = await cli([
      'ci',
      '--specs',
      GOLDEN,
      ...target,
      '--baseline',
      'baseline',
      '--store',
      store,
      '--margin',
      margin,
      ...gate,
      '--out',
      out,
    ]);
    const summary = await summaryAt(out);
    const compared = await cli([
      'compare',
      '--baseline',
      'baseline',
      '--candidate',
      summary.candidate.campaignId,
      '--store',
      store,
      '--margin',
      margin,
      ...gate,
      '--json',
    ]);
    return {
      result,
      summary,
      compared,
      compareVerdict: (JSON.parse(compared.out) as { verdict: string }).verdict,
    };
  }

  const AS_COMPARE: Record<string, string> = {
    parity: 'non-inferior',
    regression: 'regressed',
    'not-shown-non-inferior': 'unproven',
  };

  it.each(['5', '15', '30'])(
    'never reads REGRESSION for the identical agent at margin %s, and agrees with compare',
    async (margin) => {
      for (const [target, name] of [
        [['--target', 'function:acme-sales'], `same-${margin}`],
        [['--target', 'fault:control-sales-identity', '--faults', FAULTS], `control-${margin}`],
      ] as const) {
        const { result, summary, compared, compareVerdict } = await ciThenCompare([...target], margin, name);
        expect(result.err).toBe('');
        expect(summary.verdict, name).not.toBe('regression');
        expect(result.out).not.toContain('REGRESSION');
        expect(summary.table.regressed).toBe(0);
        expect(AS_COMPARE[summary.verdict]).toBe(compareVerdict);
        expect(result.code).toBe(compared.code);
      }
    },
    SLOW,
  );

  it.each(RED_FAULTS)(
    'turns red on fault %s with the defaults (margin auto), with the verdict and exit code compare gives',
    async (fault) => {
      const { result, summary, compared, compareVerdict } = await ciThenCompare(
        ['--target', `fault:${fault}`, '--faults', FAULTS],
        'auto',
        `fault-${fault}`,
      );
      expect(result.code).toBe(1);
      expect(summary.verdict).not.toBe('parity');
      expect(summary.marginPoints).toBe(28);
      expect(AS_COMPARE[summary.verdict]).toBe(compareVerdict);
      expect(compared.code).toBe(1);
    },
    SLOW,
  );

  it(
    'shows the identity control at parity on the 10-golden suite with the defaults, and says the suite is too small for 15 points',
    async () => {
      const { result, summary, compareVerdict } = await ciThenCompare(
        ['--target', 'fault:control-sales-identity', '--faults', FAULTS],
        'auto',
        'defaults-control',
      );
      expect(result.code).toBe(0);
      expect(summary.verdict).toBe('parity');
      expect(compareVerdict).toBe('non-inferior');
      expect(summary.marginAuto).toMatchObject({ neededPoints: 27.75, limitedBy: 'the all-pass flag' });
      expect(summary.marginAuto?.warning).toContain('cannot show parity under 15 points');
      expect(result.out).toContain('Margin auto: 28 points');
      expect(result.out).toContain('Warning: this suite cannot show parity under 15 points');
      expect(summary.underpowered.length).toBeGreaterThan(0);
    },
    SLOW,
  );

  it(
    '--strict reproduces the rule before the minimum: the identity control at margin 30 is not shown non-inferior, in ci and compare alike',
    async () => {
      const { result, summary, compareVerdict } = await ciThenCompare(
        ['--target', 'fault:control-sales-identity', '--faults', FAULTS],
        '30',
        'strict-control',
        ['--strict'],
      );
      expect(result.code).toBe(1);
      expect(summary.strict).toBe(true);
      expect(summary.verdict).toBe('not-shown-non-inferior');
      expect(compareVerdict).toBe('unproven');
      expect(summary.criteriaNotShown.map((entry) => entry.criterion).sort()).toEqual([
        'artifacts',
        'budget',
        'cards',
        'end_state',
        'execution',
        'guards',
        'lang',
        'ledger',
        'must',
        'must_not',
        'safety',
        'skills',
        'workspace',
      ]);
      const loose = await ciThenCompare(
        ['--target', 'fault:control-sales-identity', '--faults', FAULTS],
        '30',
        'loose-control',
      );
      expect(loose.summary.verdict).toBe('parity');
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
      expect(byId.code).not.toBe(2);
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
      expect(byPath.code).not.toBe(2);
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
      expect((await cli([...args('first.json'), '--cache'])).code).not.toBe(2);
      expect((await cli(args('second.json'))).code).not.toBe(2);
      expect(await hits('second.json')).toBe(0);
      expect((await cli([...args('third.json'), '--cache'])).code).not.toBe(2);
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
      expect(summary.verdict).toBe('parity');
      expect(summary.pairs).toBe(12);
      expect(summary.unpaired).toHaveLength(183);
      expect(summary.unpaired.every((entry) => entry.reason === 'baseline only')).toBe(true);
      expect(result.out).toContain('Not compared: ');
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

describe('driftbench ci with a budget that stops every candidate cell', () => {
  it(
    'is incomplete, exit 1, not bad input, when no golden of the candidate ran',
    async () => {
      const dir = await tempFolder();
      const base = join(dir, 'base.db');
      await baselineCampaign(CONVERSATIONS, base);
      const out = join(dir, 'none-ran.json');
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
          '--budget-usd',
          '0',
          '--out',
          out,
        ],
        { adapterFor: async () => pricedAcmeAdapter() },
      );
      expect(result.err).not.toContain('cannot be compared');
      expect(result.code).toBe(1);
      expect(result.out).toContain('Verdict: INCOMPLETE.');
      const summary = await summaryAt(out);
      expect(summary.verdict).toBe('incomplete');
      expect(summary.pairs).toBe(0);
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
    expect(result.err).toContain(
      `--margin takes a number of points above 0 and below 100, such as 2, not "${margin}"`,
    );
    expect(existsSync(join(dir, 'never.json'))).toBe(false);
  });

  it.each(['0', '2.5', 'many'])('exits 2 on --min-goldens %s', async (value) => {
    const result = await ci(['--baseline', base, '--min-goldens', value]);
    expect(result.code).toBe(2);
    expect(result.err).toContain(`--min-goldens takes a whole number of at least 1, not "${value}"`);
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
      expect(result.err).toContain(
        'cannot be compared: compare: the two campaigns share no golden in a shared mode',
      );
      expect(existsSync(join(dir, 'never.json'))).toBe(false);
    },
    SLOW,
  );
});

describe('the driftbench ci GitHub Action', () => {
  it(
    'run.sh passes each aggregate line to ci, and exits 2 on one it cannot read, before any campaign loads',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'driftbench-action-aggregate-'));
      made.push(dir);
      const output = join(dir, 'output.txt');
      const tsx = join(ROOT, 'node_modules/.bin/tsx');
      const result = spawnSync('bash', [join(ROOT, 'action/run.sh')], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: output,
          INPUT_SPECS: GATED,
          INPUT_TARGET: 'function:acme-sales',
          INPUT_BASELINE: join(dir, 'missing.db'),
          INPUT_STORE: join(dir, 'cand.db'),
          INPUT_AGGREGATE: 'nope:>=1',
          INPUT_REPORT_PATH: join(dir, 'report.json'),
          INPUT_DRIFTBENCH: `${tsx} packages/cli/src/bin.ts`,
        },
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('unknown aggregate nope');
    },
    SLOW,
  );

  it('declares the inputs and outputs the brief names and runs run.sh', async () => {
    const yml = await readFile(join(ROOT, 'action/action.yml'), 'utf8');
    for (const input of ['specs', 'target', 'baseline', 'store', 'margin', 'aggregate']) {
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
      await baselineCampaign(GATED, base);
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
            INPUT_SPECS: GATED,
            INPUT_TARGET: 'function:acme-sales',
            INPUT_ROUTE: 'flow:price-sheet=process:acme-ops',
            INPUT_BASELINE: base,
            INPUT_STORE: join(dir, 'cand.db'),
            INPUT_MARGIN: margin,
            INPUT_REPORT_PATH: report,
            INPUT_DRIFTBENCH: `${tsx} packages/cli/src/bin.ts`,
          },
        });
        return { result, output, report };
      };

      const parity = action('30');
      // Node 22 warns that its SQLite module is experimental; that line is the runtime's, not the action's.
      expect(
        parity.result.stderr
          .split('\n')
          .filter((l) => l !== '' && !/ExperimentalWarning|--trace-warnings/.test(l)),
      ).toEqual([]);
      expect(parity.result.status).toBe(0);
      expect(parity.result.stdout).toMatch(/Margin [0-9.]+ points \((auto|given)/);
      expect(await readFile(parity.output, 'utf8')).toBe(`verdict=parity\nreport-path=${parity.report}\n`);
      expect((await summaryAt(parity.report)).verdict).toBe('parity');

      const bad = action('0');
      expect(bad.result.status).toBe(2);
      expect(await readFile(bad.output, 'utf8')).toBe(`verdict=input-error\nreport-path=${bad.report}\n`);
    },
    SLOW,
  );
});

describe('driftbench ci --aggregate', () => {
  it('exits 2 on an aggregate flag it cannot read, before any campaign runs', async () => {
    const result = await cli([
      'ci',
      '--specs',
      CONVERSATIONS,
      '--target',
      'function:acme-sales',
      '--baseline',
      'c-nothing',
      '--store',
      'unused.db',
      '--aggregate',
      'nope:>=0.5',
    ]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('unknown aggregate nope');
  });

  it('reads the aggregates of the config --config names, before any campaign runs', async () => {
    const config = join(mkdtempSync(join(tmpdir(), 'driftbench-ci-config-')), 'project.yaml');
    writeFileSync(config, 'aggregates:\n  - nope:>=0.5\n');
    const args = [
      'ci',
      '--specs',
      CONVERSATIONS,
      '--target',
      'function:acme-sales',
      '--baseline',
      'c-nothing',
    ];
    const named = await cli([...args, '--store', 'unused.db', '--config', config]);
    expect(named.code).toBe(2);
    expect(named.err).toContain('unknown aggregate nope');
    const unnamed = await cli([...args, '--store', 'unused.db']);
    expect(unnamed.err).not.toContain('unknown aggregate nope');
  });

  it('turns a passing verdict into aggregate-failed when a campaign-level criterion fails, and keeps incomplete', () => {
    const failed = {
      name: 'pass-rate',
      direction: 'at-least' as const,
      threshold: 0.8,
      value: 0.5,
      passed: false,
      reason: '0.5 >= 0.8',
    };
    const passed = { ...failed, value: 0.9, passed: true };
    const inconclusive = { ...failed, value: undefined, passed: undefined };
    expect(aggregateVerdict('parity', [passed])).toBe('parity');
    expect(aggregateVerdict('parity', [failed])).toBe('aggregate-failed');
    expect(aggregateVerdict('parity', [inconclusive])).toBe('parity');
    expect(aggregateVerdict('incomplete', [failed])).toBe('incomplete');
  });
});
