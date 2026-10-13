import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mde as powerMde } from '@agent-nexus/driftbench-stats';
import { parse, stringify } from 'yaml';
import { between, rngFor } from '../random';
import { DOCUMENTED_CHECKS } from './documented';
import { type BankItem, type Draft, expectAll, fail, PASS, type Tier, withCauses } from './types';

/**
 * Level 10: the command line. Exit codes and JSON fields of `campaign plan`, `run`, `status`, `resume`,
 * `smoke`, `validate` and `ci`, as docs/running.md ("Exit codes", the option tables) and docs/validators.md
 * section 8.2 document them, run in process through the command line's own `main` on the Acme agent (the
 * one target the command line reaches) with specs the bank writes: an Acme spec as it is, and the same spec
 * with an expectation planted at one block that the agent can never meet.
 *
 * `ci` is planned on main (docs/reference/cli.md: "exit 0 or 1 on the parity verdict and the gating
 * failures"); its items use the options of the ci lane's command (--specs, --target, --baseline, --store,
 * --margin) and fail until it is merged.
 */

const CAMPAIGN = 'packages/cli/src/commands/campaign.ts';
const SMOKE = 'packages/cli/src/commands/smoke.ts';
const VALIDATE = 'packages/cli/src/commands/validate.ts';
const CI = 'packages/cli/src/commands/ci.ts';

type Cli = { code: number; out: string; err: string };

/** Runs the command line in process; the module is imported when first used, so the bank loads without it. */
async function cli(argv: string[], cwd: string): Promise<Cli> {
  const { main } = (await import('../../../../../cli/src/main')) as {
    main: (argv: string[], io: unknown) => Promise<number>;
  };
  let out = '';
  let err = '';
  const code = await main(argv, {
    out: (text: string) => {
      out += text;
    },
    err: (text: string) => {
      err += text;
    },
    cwd,
  });
  return { code, out, err };
}

const SOURCE = 'examples/acme/specs/conversations/plan-upgrade.yaml';

type Specs = {
  dir: string;
  clean: string;
  planted: string;
  plantedBlock: number;
  invalid: string;
  empty: string;
  second: string;
};

/** The specs one item runs on, written under its own folder of the scratch space. */
function specsFor(root: string, scratch: string, seed: number, tag: string): Specs {
  const dir = join(scratch, `cli-${tag}-${seed}`);
  mkdirSync(join(dir, 'empty'), { recursive: true });
  const text = readFileSync(join(root, SOURCE), 'utf8');
  const clean = join(dir, 'clean.yaml');
  writeFileSync(clean, text);
  const doc = parse(text) as { id: string; blocks: Array<{ expect?: { must?: string[] } }> };
  const plantedBlock = between(rngFor(seed, `${tag}-block`), 0, doc.blocks.length - 1);
  const block = doc.blocks[plantedBlock] as { expect?: { must?: string[] } };
  block.expect = { ...(block.expect ?? {}), must: [...(block.expect?.must ?? []), `NEVER-SAID-${seed}`] };
  doc.id = `${doc.id}-planted`;
  const planted = join(dir, 'planted.yaml');
  writeFileSync(planted, stringify(doc));
  const invalid = join(dir, 'invalid.yaml');
  writeFileSync(invalid, 'id: broken spec\nblocks: []\n');
  const second = join(dir, 'second.yaml');
  writeFileSync(second, stringify({ ...parse(text), id: 'acme-plan-upgrade-second' }));
  return { dir, clean, planted, plantedBlock, invalid, empty: join(dir, 'empty'), second };
}

type Case = {
  id: string;
  tier: Tier;
  component: string;
  title: string;
  run(specs: Specs, root: string): Promise<ReturnType<typeof expectAll>>;
};

const TARGET = 'function:acme';

function json(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

const exitCases: Case[] = [
  {
    id: 'plan/ok',
    tier: 1,
    component: CAMPAIGN,
    title: 'campaign plan prints the plan and exits 0',
    run: async (s) => code(await cli(['campaign', 'plan', s.clean, '--target', TARGET], s.dir), 0),
  },
  {
    id: 'plan/unknown-adapter',
    tier: 1,
    component: CAMPAIGN,
    title: 'campaign plan on a target no adapter is set up for exits 2',
    run: async (s) => code(await cli(['campaign', 'plan', s.clean, '--target', 'nowhere:agent'], s.dir), 2),
  },
  {
    id: 'plan/malformed-target',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign plan on a malformed target exits 2',
    run: async (s) => code(await cli(['campaign', 'plan', s.clean, '--target', ':'], s.dir), 2),
  },
  {
    id: 'plan/invalid-spec',
    tier: 1,
    component: CAMPAIGN,
    title: 'campaign plan on an invalid spec exits 2',
    run: async (s) => code(await cli(['campaign', 'plan', s.invalid, '--target', TARGET], s.dir), 2),
  },
  {
    id: 'plan/no-spec',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign plan on a folder with no spec exits 2',
    run: async (s) => code(await cli(['campaign', 'plan', s.empty, '--target', TARGET], s.dir), 2),
  },
  {
    id: 'plan/repeats-zero',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign plan with --repeats 0 exits 2',
    run: async (s) =>
      code(await cli(['campaign', 'plan', s.clean, '--target', TARGET, '--repeats', '0'], s.dir), 2),
  },
  {
    id: 'plan/bad-rate',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign plan with --baseline-rate 1.5 exits 2',
    run: async (s) =>
      code(await cli(['campaign', 'plan', s.clean, '--target', TARGET, '--baseline-rate', '1.5'], s.dir), 2),
  },
  {
    id: 'run/pass',
    tier: 1,
    component: CAMPAIGN,
    title: 'campaign run where every cell passes exits 0',
    run: async (s) => code(await cli(['campaign', 'run', s.clean, '--target', TARGET], s.dir), 0),
  },
  {
    id: 'run/planted-fail',
    tier: 1,
    component: CAMPAIGN,
    title: 'campaign run with a planted failing block exits 1',
    run: async (s) => code(await cli(['campaign', 'run', s.planted, '--target', TARGET], s.dir), 1),
  },
  {
    id: 'run/budget-zero',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign run with --budget-usd 0 stops every cell and exits 1',
    run: async (s) =>
      code(await cli(['campaign', 'run', s.clean, '--target', TARGET, '--budget-usd', '0'], s.dir), 1),
  },
  {
    id: 'run/existing-campaign',
    tier: 3,
    component: CAMPAIGN,
    title: 'campaign run with a campaign id the store already holds exits 2',
    run: async (s) => {
      const store = join(s.dir, 'existing.db');
      const first = await cli(
        ['campaign', 'run', s.clean, '--target', TARGET, '--store', store, '--campaign', 'c-same'],
        s.dir,
      );
      const second = await cli(
        ['campaign', 'run', s.clean, '--target', TARGET, '--store', store, '--campaign', 'c-same'],
        s.dir,
      );
      return expectAll([
        [first.code === 0, `the first run exited ${first.code}`],
        [second.code === 2, `the second run exited ${second.code}: ${second.err.slice(0, 160)}`],
      ]);
    },
  },
  {
    id: 'run/concurrency-zero',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign run with --concurrency 0 exits 2',
    run: async (s) =>
      code(await cli(['campaign', 'run', s.clean, '--target', TARGET, '--concurrency', '0'], s.dir), 2),
  },
  {
    id: 'run/unknown-mode',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign run with an unknown mode exits 2',
    run: async (s) =>
      code(await cli(['campaign', 'run', s.clean, '--target', TARGET, '--mode', 'X'], s.dir), 2),
  },
  {
    id: 'status/pass',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign status of a campaign whose cells pass exits 0',
    run: async (s) => {
      const store = join(s.dir, 'status-pass.db');
      await cli(
        ['campaign', 'run', s.clean, '--target', TARGET, '--store', store, '--campaign', 'c-pass'],
        s.dir,
      );
      return code(await cli(['campaign', 'status', 'c-pass', '--store', store], s.dir), 0);
    },
  },
  {
    id: 'status/fail',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign status of a campaign with a failing cell exits 1',
    run: async (s) => {
      const store = join(s.dir, 'status-fail.db');
      await cli(
        ['campaign', 'run', s.planted, '--target', TARGET, '--store', store, '--campaign', 'c-fail'],
        s.dir,
      );
      return code(await cli(['campaign', 'status', 'c-fail', '--store', store], s.dir), 1);
    },
  },
  {
    id: 'status/unknown',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign status of an unknown campaign exits 2',
    run: async (s) => {
      const store = join(s.dir, 'status-unknown.db');
      await cli(
        ['campaign', 'run', s.clean, '--target', TARGET, '--store', store, '--campaign', 'c-known'],
        s.dir,
      );
      return code(await cli(['campaign', 'status', 'c-nobody', '--store', store], s.dir), 2);
    },
  },
  {
    id: 'resume/reused',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign resume of a finished passing campaign reuses every cell and exits 0',
    run: async (s) => {
      const store = join(s.dir, 'resume.db');
      await cli(
        [
          'campaign',
          'run',
          s.clean,
          '--target',
          TARGET,
          '--store',
          store,
          '--campaign',
          'c-resume',
          '--repeats',
          '2',
        ],
        s.dir,
      );
      const result = await cli(['campaign', 'resume', 'c-resume', '--store', store, '--json'], s.dir);
      const cells = (json(result.out)?.cells ?? []) as Array<{ reused: boolean }>;
      return expectAll([
        [result.code === 0, `exit ${result.code}`],
        [
          cells.length === 2 && cells.every((cell) => cell.reused),
          `reused ${cells.map((cell) => cell.reused).join(',')}`,
        ],
      ]);
    },
  },
  {
    id: 'resume/fail',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign resume of a campaign with a failing cell exits 1',
    run: async (s) => {
      const store = join(s.dir, 'resume-fail.db');
      await cli(
        ['campaign', 'run', s.planted, '--target', TARGET, '--store', store, '--campaign', 'c-rf'],
        s.dir,
      );
      return code(await cli(['campaign', 'resume', 'c-rf', '--store', store], s.dir), 1);
    },
  },
  {
    id: 'resume/no-store',
    tier: 2,
    component: CAMPAIGN,
    title: 'campaign resume without --store exits 2',
    run: async (s) => code(await cli(['campaign', 'resume', 'c-x'], s.dir), 2),
  },
  {
    id: 'smoke/identical',
    tier: 1,
    component: SMOKE,
    title: 'smoke on a deterministic agent exits 0',
    run: async (s) => code(await cli(['smoke', s.clean, '--target', TARGET], s.dir), 0),
  },
  {
    id: 'smoke/two-specs',
    tier: 2,
    component: SMOKE,
    title: 'smoke with two specs exits 2',
    run: async (s) => code(await cli(['smoke', s.clean, s.second, '--target', TARGET], s.dir), 2),
  },
  {
    id: 'smoke/one-run',
    tier: 2,
    component: SMOKE,
    title: 'smoke with --runs 1 exits 2',
    run: async (s) => code(await cli(['smoke', s.clean, '--target', TARGET, '--runs', '1'], s.dir), 2),
  },
  {
    id: 'validate/unknown-component',
    tier: 1,
    component: VALIDATE,
    title: 'validate on an unknown component exits 64',
    run: async (s, root) => code(await cli(['validate', 'nothing-here', '--seed', '1'], root || s.dir), 64),
  },
  {
    id: 'validate/bad-seeds',
    tier: 2,
    component: VALIDATE,
    title: 'validate with a malformed --seeds exits 64',
    run: async (s, root) => code(await cli(['validate', 'stats', '--seeds', '5..1'], root || s.dir), 64),
  },
  {
    id: 'validate/level-is-exit',
    tier: 3,
    component: VALIDATE,
    title: 'validate exits with the level its run reached, as its --json report says',
    run: async (_s, root) => {
      const result = await cli(['validate', 'stats', '--seed', '1', '--json'], root);
      const level = json(result.out)?.level;
      return expectAll([
        [typeof level === 'number' && result.code === level, `exit ${result.code}, reported level ${level}`],
      ]);
    },
  },
  {
    id: 'ci/missing-baseline',
    tier: 2,
    component: CI,
    title: 'ci without --baseline exits 2',
    run: async (s) => code(await cli(['ci', '--specs', s.clean, '--target', TARGET], s.dir), 2),
  },
  {
    id: 'ci/bad-margin',
    tier: 2,
    component: CI,
    title: 'ci with a margin that is not a number exits 2',
    run: async (s) =>
      code(
        await cli(
          [
            'ci',
            '--specs',
            s.clean,
            '--target',
            TARGET,
            '--baseline',
            'c-x',
            '--store',
            join(s.dir, 'none.db'),
            '--margin',
            'wide',
          ],
          s.dir,
        ),
        2,
      ),
  },
];

function code(result: Cli, want: number) {
  return result.code === want
    ? PASS
    : fail(`exit ${result.code}, documented ${want}: ${(result.err || result.out).slice(0, 200)}`);
}

/** JSON fields of the documented --json outputs. */
const jsonCases: Case[] = [];
function jsonCase(
  id: string,
  tier: Tier,
  component: string,
  title: string,
  argv: (s: Specs) => string[] | Promise<string[]>,
  check: (doc: Record<string, unknown>, s: Specs) => ReturnType<typeof expectAll>,
) {
  jsonCases.push({
    id,
    tier,
    component,
    title,
    run: async (s) => {
      const result = await cli(await argv(s), s.dir);
      const doc = json(result.out);
      return doc ? check(doc, s) : fail(`no JSON document: ${(result.err || result.out).slice(0, 160)}`);
    },
  });
}

jsonCase(
  'plan/cells',
  1,
  CAMPAIGN,
  'plan --json lists one cell per spec and repeat',
  (s) => ['campaign', 'plan', s.clean, '--target', TARGET, '--repeats', '3', '--json'],
  (doc) =>
    expectAll([
      [
        Array.isArray(doc.cells) && (doc.cells as unknown[]).length === 3,
        `cells ${(doc.cells as unknown[] | undefined)?.length}`,
      ],
    ]),
);
jsonCase(
  'plan/blocks',
  2,
  CAMPAIGN,
  'plan --json counts the blocks of every cell',
  (s) => ['campaign', 'plan', s.clean, '--target', TARGET, '--repeats', '2', '--json'],
  (doc, s) => {
    const blocks = (parse(readFileSync(s.clean, 'utf8')) as { blocks: unknown[] }).blocks.length;
    return expectAll([[doc.blocks === 2 * blocks, `blocks ${doc.blocks}, expected ${2 * blocks}`]]);
  },
);
jsonCase(
  'plan/cost',
  2,
  CAMPAIGN,
  'plan --json prices nothing for an adapter with no measured unit and names it',
  (s) => ['campaign', 'plan', s.clean, '--target', TARGET, '--json'],
  (doc) => {
    const cost = doc.cost as { usd?: number; unmeasured?: string[]; byAdapter?: unknown[] } | undefined;
    return expectAll([
      [
        cost?.usd === 0 && cost.unmeasured?.join() === 'function' && cost.byAdapter?.length === 1,
        `cost ${JSON.stringify(cost)}`,
      ],
    ]);
  },
);
jsonCase(
  'plan/budget',
  2,
  CAMPAIGN,
  'plan --json with a budget carries budgetUsd and withinBudget',
  (s) => ['campaign', 'plan', s.clean, '--target', TARGET, '--budget-usd', '3', '--json'],
  (doc) =>
    expectAll([
      [doc.budgetUsd === 3 && doc.withinBudget === true, `budget ${doc.budgetUsd} ${doc.withinBudget}`],
    ]),
);
jsonCase(
  'plan/mde',
  3,
  CAMPAIGN,
  'plan --json prints the documented minimum detectable effect for 12 runs per arm at 0.5',
  (s) => ['campaign', 'plan', s.clean, '--target', TARGET, '--repeats', '12', '--json'],
  (doc) => {
    const mde = (
      doc.mde as
        | Array<{
            effect?: number;
            runsPerArm?: number;
            specs?: number;
            baselineRate?: number;
            rho?: number;
            designEffect?: number;
          }>
        | undefined
    )?.[0];
    const want = powerMde({ n: 1, repeats: 12, baselineRate: 0.5 }).effect;
    return expectAll([
      [
        mde?.runsPerArm === 12 &&
          mde.specs === 1 &&
          mde.baselineRate === 0.5 &&
          mde.rho === 0 &&
          mde.designEffect === 1 &&
          want !== null &&
          Math.abs((mde?.effect ?? -1) - want) < 1e-9,
        `mde ${JSON.stringify(mde)}`,
      ],
    ]);
  },
);
jsonCase(
  'run/campaign-id',
  1,
  CAMPAIGN,
  'run --json gives the campaign id it was asked for and says the runs are not kept without a store',
  (s) => ['campaign', 'run', s.clean, '--target', TARGET, '--campaign', 'c-json', '--json'],
  (doc) =>
    expectAll([
      [
        doc.campaignId === 'c-json' && doc.stored === false,
        `campaignId ${doc.campaignId}, stored ${doc.stored}`,
      ],
    ]),
);
jsonCase(
  'run/checks',
  2,
  CAMPAIGN,
  'run --json lists the checks it applied, the default machine checks in order',
  (s) => ['campaign', 'run', s.clean, '--target', TARGET, '--json'],
  (doc) => {
    // docs/running.md, the campaign run example: "Checks: tools, tools_offered, ...", the list of checks.md.
    const want = DOCUMENTED_CHECKS.join(',');
    return expectAll([
      [
        (doc.checks as string[] | undefined)?.join() === want,
        `checks ${(doc.checks as string[] | undefined)?.join()}`,
      ],
    ]);
  },
);
jsonCase(
  'run/failing-list',
  1,
  CAMPAIGN,
  'run --json lists the planted block as `block <index> must.<n>` on its failing cell',
  (s) => ['campaign', 'run', s.planted, '--target', TARGET, '--json'],
  (doc, s) => {
    const cell = (doc.cells as Array<{ state: string; failing: string[] }> | undefined)?.[0];
    return expectAll([
      [cell?.state === 'fail', `state ${cell?.state}`],
      [
        cell?.failing.some((line) => new RegExp(`^block ${s.plantedBlock} must\\.\\d+$`).test(line)) === true,
        `failing ${cell?.failing.join(', ')}`,
      ],
      [
        cell?.failing.every((line) => line.startsWith(`block ${s.plantedBlock} `)) === true,
        `another block fails: ${cell?.failing.join(', ')}`,
      ],
    ]);
  },
);
jsonCase(
  'run/summary',
  2,
  CAMPAIGN,
  'run --json summary counts each state',
  (s) => ['campaign', 'run', s.clean, s.planted, '--target', TARGET, '--json'],
  (doc) => {
    const summary = doc.summary as Record<string, number> | undefined;
    return expectAll([
      [
        summary?.cells === 2 && summary.pass === 1 && summary.fail === 1 && summary.failed === 0,
        `summary ${JSON.stringify(summary)}`,
      ],
    ]);
  },
);
jsonCase(
  'run/budget-stop',
  2,
  CAMPAIGN,
  'run --json with a zero budget carries the budget stop on every cell',
  (s) => ['campaign', 'run', s.clean, '--target', TARGET, '--repeats', '2', '--budget-usd', '0', '--json'],
  (doc) => {
    const cells = (doc.cells ?? []) as Array<{ state: string; budgetStop?: { budgetUsd: number } }>;
    const summary = doc.summary as Record<string, number> | undefined;
    return expectAll([
      [
        cells.length === 2 &&
          cells.every((cell) => cell.state === 'stopped' && cell.budgetStop?.budgetUsd === 0) &&
          summary?.stoppedByBudget === 2,
        `cells ${JSON.stringify(cells)}`,
      ],
    ]);
  },
);
jsonCase(
  'run/run-id-is-cell',
  2,
  CAMPAIGN,
  'run --json gives each cell the run id of its run, equal to its cell id',
  (s) => ['campaign', 'run', s.clean, '--target', TARGET, '--repeats', '2', '--json'],
  (doc) => {
    const cells = (doc.cells ?? []) as Array<{ cellId: string; runId?: string }>;
    return expectAll([
      [
        cells.length === 2 && cells.every((cell) => cell.runId === cell.cellId),
        `cells ${JSON.stringify(cells)}`,
      ],
    ]);
  },
);
jsonCase(
  'run/replay-marked',
  3,
  CAMPAIGN,
  'a second run --json on the same store marks every cell replayed from the cache',
  async (s) => {
    const store = join(s.dir, 'json-replay.db');
    await cli(['campaign', 'run', s.clean, '--target', TARGET, '--store', store], s.dir);
    return ['campaign', 'run', s.clean, '--target', TARGET, '--store', store, '--json'];
  },
  (doc) => {
    const cells = (doc.cells ?? []) as Array<{ cacheHit?: boolean }>;
    return expectAll([[cells.length === 1 && cells[0]?.cacheHit === true, `cells ${JSON.stringify(cells)}`]]);
  },
);
jsonCase(
  'run/stored',
  2,
  CAMPAIGN,
  'run --json with a store says the runs are kept',
  (s) => ['campaign', 'run', s.clean, '--target', TARGET, '--store', join(s.dir, 'json-stored.db'), '--json'],
  (doc) => expectAll([[doc.stored === true, `stored ${doc.stored}`]]),
);
jsonCase(
  'status/states',
  2,
  CAMPAIGN,
  'status --json gives each cell its state from the stored runs',
  async (s) => {
    const store = join(s.dir, 'json-status.db');
    await cli(
      ['campaign', 'run', s.clean, s.planted, '--target', TARGET, '--store', store, '--campaign', 'c-st'],
      s.dir,
    );
    return ['campaign', 'status', 'c-st', '--store', store, '--json'];
  },
  (doc) => {
    const states = ((doc.cells ?? []) as Array<{ specId: string; state: string }>)
      .map((cell) => `${cell.specId}:${cell.state}`)
      .sort();
    return expectAll([
      [states.join() === 'acme-plan-upgrade-planted:fail,acme-plan-upgrade:pass', `states ${states.join()}`],
    ]);
  },
);
jsonCase(
  'status/detail-compounding',
  4,
  CAMPAIGN,
  'status --detail --json carries the compounding index, the succession and the recovery tables',
  async (s) => {
    const store = join(s.dir, 'json-detail.db');
    await cli(
      ['campaign', 'run', s.planted, '--target', TARGET, '--store', store, '--campaign', 'c-detail'],
      s.dir,
    );
    return ['campaign', 'status', 'c-detail', '--store', store, '--detail', '--json'];
  },
  (doc) => {
    const detail = (doc.detail ?? doc) as Record<string, unknown>;
    return expectAll([
      [
        Array.isArray(detail.succession) &&
          Array.isArray(detail.recovery) &&
          typeof detail.compounding === 'object',
        `keys ${Object.keys(detail).join(',')}`,
      ],
    ]);
  },
);
jsonCase(
  'smoke/fields',
  1,
  SMOKE,
  'smoke --json carries specId, target, runs, deterministicClaim, identical and hashes',
  (s) => ['smoke', s.clean, '--target', TARGET, '--json'],
  (doc) =>
    expectAll([
      [
        doc.specId === 'acme-plan-upgrade' &&
          Array.isArray(doc.runs) &&
          (doc.runs as Array<{ status: string }>).length === 3 &&
          (doc.runs as Array<{ status: string }>).every((run) => run.status === 'completed') &&
          doc.identical === true,
        `doc ${JSON.stringify(doc).slice(0, 200)}`,
      ],
      [
        Array.isArray(doc.hashes) && (doc.hashes as string[]).every((hash) => /^[0-9a-f]{12}$/.test(hash)),
        `hashes ${JSON.stringify(doc.hashes)}`,
      ],
      [doc.firstDifference === undefined, 'firstDifference on identical runs'],
      [typeof doc.deterministicClaim === 'boolean', `deterministicClaim ${doc.deterministicClaim}`],
    ]),
);
jsonCase(
  'smoke/runs-option',
  2,
  SMOKE,
  'smoke --runs 5 --json compares five runs',
  (s) => ['smoke', s.clean, '--target', TARGET, '--runs', '5', '--json'],
  (doc) =>
    expectAll([
      [
        (doc.runs as unknown[] | undefined)?.length === 5 &&
          (doc.hashes as unknown[] | undefined)?.length === 5,
        `runs ${JSON.stringify(doc.runs)?.slice(0, 80)}`,
      ],
    ]),
);
jsonCase(
  'validate/report-shape',
  2,
  VALIDATE,
  'validate --hidden --json prints component, level, top, seeds and hiddenSeed',
  () => ['validate', 'stats', '--seed', '2', '--hidden', '--json'],
  (doc) =>
    expectAll([
      [
        doc.component === 'stats' &&
          typeof doc.level === 'number' &&
          typeof doc.top === 'number' &&
          Array.isArray(doc.seeds) &&
          'hiddenSeed' in doc,
        `keys ${Object.keys(doc).join(',')}`,
      ],
    ]),
);

function itemsOf(cases: Case[], family: string): Draft[] {
  return cases.map((each) => ({
    id: `cli/${each.id}`,
    family,
    tier: each.tier,
    level: 10,
    component: each.component,
    source: 'contract',
    title: each.title,
    async check({ seed, root, scratch }) {
      const specs = specsFor(root, scratch, seed, each.id.replace(/\//g, '-'));
      return each.run(specs, root);
    },
  }));
}

export function cliItems(): BankItem[] {
  return withCauses([...itemsOf(exitCases, 'cli-documented'), ...itemsOf(jsonCases, 'cli-documented')]);
}
