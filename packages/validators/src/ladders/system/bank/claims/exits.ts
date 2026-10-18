import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { type BankItem, fail, type ItemResult, PASS, type Tier } from '../types';

/**
 * Level 10, the exit-code matrix of the command line. Every command and subcommand `driftbench --help` lists
 * that runs without a model is crossed with bad input shapes (a missing file, a folder where a file is
 * expected, a file where a folder is expected, an empty file, a file that is not YAML or JSON, valid YAML of
 * the wrong shape, an unknown option, a missing required option, a number option given text, a negative
 * number, zero, an empty string, a huge number, a store path that is a folder, a store that is not a
 * database). Only the cells docs/reference/cli.md or docs/running.md make a claim about are kept.
 *
 * The oracle of a cell: the documented exit code; for a refusal (exit 2, or 64 for `validate`) a non-empty
 * message on stderr and no file written or changed under the item's folder; never a stack trace in what the
 * command printed; an uncaught throw is a failure, never a pass. Huge numbers and `view` run in a child
 * process with `node --max-old-space-size=256` and a time limit, killed by its own pid, so a command that
 * exhausts memory or never returns fails its item instead of the runner.
 *
 * docs/reference/cli.md, "Running it": "Unless a command says otherwise, its exit code is 0 on success, 1
 * when what it checks fails, and 2 on a usage or input error. An option or argument error that the argument
 * parser reports (an unknown option, a missing argument) always exits 2."
 */

const C = 'packages/cli/src/commands/';
const SPEC_CMD = `${C}spec.ts`;
const COVERAGE_CMD = `${C}coverage.ts`;
const CAMPAIGN_CMD = `${C}campaign.ts`;
const SMOKE_CMD = `${C}smoke.ts`;
const SPACE_CMD = `${C}space.ts`;
const GENERATE_CMD = `${C}generate.ts`;
const EXTRACT_CMD = `${C}extract.ts`;
const REGISTRY_CMD = `${C}registry.ts`;
const REPORT_CMD = `${C}report.ts`;
const COMPARE_CMD = `${C}compare.ts`;
const CI_CMD = `${C}ci.ts`;
const MONITOR_CMD = `${C}monitor.ts`;
const GATE_CMD = `${C}gate.ts`;
const SELECT_CMD = `${C}select.ts`;
const HOLDOUT_CMD = `${C}holdout.ts`;
const FAMILY_CMD = `${C}family.ts`;
const PILOT_CMD = `${C}pilot.ts`;
const JUDGE_CMD = `${C}judge.ts`;
const IMPORT_CMD = `${C}import.ts`;
const TRACES_CMD = `${C}import-traces.ts`;
const INTAKE_CMD = `${C}intake.ts`;
const REPLAY_CMD = `${C}replay.ts`;
const ESTATE_CMD = `${C}estate.ts`;
const ESTATE_PLAN_CMD = `${C}estate-plan.ts`;
const ESTATE_MAINTAIN_CMD = `${C}estate-maintain.ts`;
const VALIDATE_CMD = `${C}validate.ts`;
const VIEW_CMD = `${C}view.ts`;
const MAIN = 'packages/cli/src/main.ts';
const STORE = 'packages/store/src/store.ts';

const PLAN_UPGRADE = 'examples/acme/specs/conversations/plan-upgrade.yaml';
const ACME_SPECS = 'examples/acme/specs';
const INVENTORY = 'examples/acme/inventory.yaml';
const COV_INVENTORY = 'packages/core/test/coverage/fixtures/inventory.yaml';
const COV_SPECS = 'packages/core/test/coverage/fixtures/specs';
const SPACE_MAP = 'packages/space/test/fixtures/acme-space.yaml';
const APPROVED = 'examples/acme/map/approved.yaml';
const PROPOSAL = 'examples/acme/map/proposal.yaml';
const GENERATED = 'examples/acme/generated/specs';
const GATED = 'examples/acme/gated/specs';
const FAULTS = 'examples/acme/faults';
const CRITERIA = 'examples/acme/criteria';
const CASSETTE = 'examples/acme/criteria/council.cassette.json';
const CSV = 'examples/acme/import/cases.csv';
const MAPPING = 'examples/acme/import/mapping.yaml';
const FAMILY = 'examples/acme/families/price-sheet';
const ESTATE = 'examples/estates/fixture';
const ESTATE_MAP = 'examples/estates/fixture/approved.yaml';
const SESSIONS = 'examples/estates/sessions';
const REFERENCE = 'examples/acme/reference';
const TARGET = 'function:acme';

type Cli = { code: number; out: string; err: string };

/** Runs the command line in process from `cwd`; the module is imported when first used. */
async function cli(argv: string[], cwd: string): Promise<Cli> {
  const { main } = (await import('../../../../../../cli/src/main')) as {
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

const CHILD_LIMIT_MS = 150_000;
const VIEW_LIMIT_MS = 60_000;
const CHILD_SCRIPT = `const [mainPath, argvJson, cwd] = process.argv.slice(2);
const { main } = await import(mainPath);
let out = '';
let err = '';
const code = await main(JSON.parse(argvJson), { out: (t) => { out += t; }, err: (t) => { err += t; }, cwd });
process.stdout.write('\\n@@EXIT@@' + JSON.stringify({ code, out: out.slice(0, 4000), err: err.slice(0, 4000) }) + '\\n');
process.exit(0);
`;

type ChildResult = { ok: true; cli: Cli } | { ok: false; why: string };

/**
 * Runs the command line in a child node with a 256 MB heap and a time limit. The child is killed by the pid
 * this function captured when it started it, and by nothing else.
 */
function childCli(
  argv: string[],
  cwd: string,
  root: string,
  scratch: string,
  limitMs = CHILD_LIMIT_MS,
): Promise<ChildResult> {
  const script = join(scratch, 'exits-child.mjs');
  if (!existsSync(script)) writeFileSync(script, CHILD_SCRIPT);
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=256', '--import', 'tsx', script, join(root, MAIN), JSON.stringify(argv), cwd],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const pid = child.pid;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (pid !== undefined) process.kill(pid, 'SIGKILL');
    }, limitMs);
    child.on('error', (cause) => {
      clearTimeout(timer);
      done({ ok: false, why: `the child process could not start: ${cause.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        done({ ok: false, why: `the command was still running after ${limitMs / 1000} s and was killed` });
        return;
      }
      const marker = stdout.lastIndexOf('@@EXIT@@');
      if (code !== 0 || marker < 0) {
        const oom = /heap out of memory|Allocation failed/i.test(stderr);
        done({
          ok: false,
          why: oom
            ? `the command ran out of memory under a 256 MB heap (child exit ${code ?? signal}): ${tail(stderr)}`
            : `the command crashed instead of exiting (child exit ${code ?? signal}): ${tail(stderr)}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(
          stdout
            .slice(marker + 8)
            .trim()
            .split('\n')[0] ?? '',
        ) as Cli;
        done({ ok: true, cli: parsed });
      } catch (cause) {
        done({ ok: false, why: `the child printed no readable result: ${(cause as Error).message}` });
      }
    });
  });
}

function tail(text: string): string {
  return JSON.stringify(text.trim().split('\n').slice(-4).join(' | ').slice(0, 300));
}

/** Every file and folder under `dir`, with a digest of each file, for the "nothing written" check. */
function snapshot(dir: string): Map<string, string> {
  const seen = new Map<string, string>();
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const info = statSync(path);
      const rel = relative(dir, path);
      if (info.isDirectory()) {
        seen.set(rel, 'dir');
        walk(path);
      } else {
        seen.set(rel, `${info.size}:${createHash('sha1').update(readFileSync(path)).digest('hex')}`);
      }
    }
  };
  walk(dir);
  return seen;
}

function written(before: Map<string, string>, after: Map<string, string>): string[] {
  const changes: string[] = [];
  for (const [path, mark] of after) {
    const old = before.get(path);
    if (old === undefined) changes.push(`created ${path}`);
    else if (old !== mark) changes.push(`changed ${path}`);
  }
  for (const path of before.keys()) if (!after.has(path)) changes.push(`removed ${path}`);
  return changes;
}

const STACK = /^\s+at .+:\d+:\d+\)?\s*$/m;

/** The files one item works on, in its own folder: every bad shape, a valid spec, and paths that do not exist. */
type World = {
  dir: string;
  root: string;
  seed: number;
  r: (rel: string) => string;
  missing: (ext?: string) => string;
  folder: string;
  aFile: string;
  empty: (ext?: string) => string;
  garbage: (ext?: string) => string;
  wrong: (ext?: string) => string;
  notDb: string;
  spec: string;
  specDir: string;
  out: string;
  put: (rel: string, text: string) => string;
};

function worldFor(root: string, scratch: string, seed: number, id: string): World {
  const dir = join(scratch, 'exits', id.replace(/[^a-z0-9]+/gi, '-'), String(seed));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const put = (rel: string, text: string) => {
    const path = join(dir, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
    return path;
  };
  const folder = join(dir, 'a-folder');
  mkdirSync(folder);
  const specDir = join(dir, 'specs');
  mkdirSync(specDir);
  const spec = join(specDir, 'plan-upgrade.yaml');
  copyFileSync(join(root, PLAN_UPGRADE), spec);
  return {
    dir,
    root,
    seed,
    r: (rel) => join(root, rel),
    missing: (ext = '.yaml') => join(dir, `absent-${seed}${ext}`),
    folder,
    aFile: put('a-file.txt', `a plain file, not a folder ${seed}\n`),
    empty: (ext = '.yaml') => put(`empty${ext}`, ''),
    garbage: (ext = '.yaml') => put(`garbage${ext}`, `{{{ not: [yaml or json ${seed}\n\t: :\n`),
    wrong: (ext = '.yaml') => put(`list${ext}`, `[1, 2, ${seed % 7}]\n`),
    notDb: put('not-a-db.db', `this is a text file, not a database ${seed}\n`),
    spec,
    specDir,
    out: join(dir, 'out'),
    put,
  };
}

/** Bad numbers. Each is sized from the seed so a seed up to 9999 keeps it of its kind. */
function numberText(kind: NumberShape, seed: number): string {
  switch (kind) {
    case 'text':
      return `many${seed % 7}`;
    case 'negative':
      return `-${1 + (seed % 9)}`;
    case 'zero':
      return '0';
    case 'empty':
      return '';
    case 'huge':
      return `1${'0'.repeat(9 + (seed % 4))}`;
  }
}

type NumberShape = 'text' | 'negative' | 'zero' | 'empty' | 'huge';
type FileShape = 'missing' | 'folder' | 'empty' | 'garbage' | 'wrong';

const FILE_WORDS: Record<FileShape, string> = {
  missing: 'a file that does not exist',
  folder: 'a folder where a file is expected',
  empty: 'an empty file',
  garbage: 'a file that is not YAML or JSON',
  wrong: 'valid YAML of the wrong shape (a list)',
};

const NUMBER_WORDS: Record<NumberShape, string> = {
  text: 'text',
  negative: 'a negative number',
  zero: 'zero',
  empty: 'an empty string',
  huge: 'a huge number',
};

const FILE_TIER: Record<FileShape, Tier> = { missing: 1, folder: 2, empty: 2, garbage: 3, wrong: 3 };
const NUMBER_TIER: Record<NumberShape, Tier> = { text: 2, negative: 2, zero: 3, empty: 4, huge: 5 };

function fileValue(w: World, shape: FileShape, ext: string): string {
  switch (shape) {
    case 'missing':
      return w.missing(ext);
    case 'folder':
      return w.folder;
    case 'empty':
      return w.empty(ext);
    case 'garbage':
      return w.garbage(ext);
    case 'wrong':
      return w.wrong(ext);
  }
}

type Cell = {
  family: string;
  /** The command, as words: `spec validate`. */
  cmd: string;
  slug: string;
  tier: Tier;
  component: string;
  title: string;
  cause?: string;
  /** Documented exit codes; the first is what the title states. */
  want: readonly number[];
  /** A refusal: stderr carries a message and nothing under the item's folder is written. */
  refusal: boolean;
  /** Run in a child node with a capped heap and a time limit. */
  child?: boolean;
  /** The time limit of a child run, when not the default. */
  limitMs?: number;
  /** Work done before the snapshot, such as a campaign stored so a later refusal has something to refuse. */
  setup?: (w: World) => Promise<string | undefined>;
  argv: (w: World) => string[];
};

const cells: Cell[] = [];

function idOf(cmd: string): string {
  return cmd.replace(/\s+/g, '-');
}

/** A cell for each file shape the docs make a claim about, on one file argument or option. */
function fileRow(
  base: Omit<Cell, 'slug' | 'tier' | 'title' | 'want' | 'refusal' | 'argv'>,
  slot: string,
  ext: string,
  shapes: Partial<Record<FileShape, number>>,
  argv: (w: World, value: string) => string[],
  doc: string,
  extra: Partial<Pick<Cell, 'setup'>> = {},
): void {
  for (const [shape, code] of Object.entries(shapes) as Array<[FileShape, number]>) {
    cells.push({
      ...base,
      ...extra,
      slug: `${slot.replace(/^-+/, '')}-${shape}`,
      tier: FILE_TIER[shape],
      title: `${base.cmd} given ${FILE_WORDS[shape]} as ${slot} exits ${code} (${doc})`,
      want: [code],
      refusal: code === 2 || code === 64,
      argv: (w) => argv(w, fileValue(w, shape, ext)),
    });
  }
}

/** A cell for each bad number the docs make a claim about, on one option. */
function numberRow(
  base: Omit<Cell, 'slug' | 'tier' | 'title' | 'want' | 'refusal' | 'argv'>,
  flag: string,
  shapes: Partial<Record<NumberShape, readonly number[]>>,
  argv: (w: World, value: string) => string[],
  doc: string,
  extra: Partial<Pick<Cell, 'setup'>> = {},
): void {
  for (const [shape, want] of Object.entries(shapes) as Array<[NumberShape, readonly number[]]>) {
    const huge = shape === 'huge';
    cells.push({
      ...base,
      ...extra,
      slug: `${flag.replace(/^-+/, '')}-${shape}`,
      tier: NUMBER_TIER[shape],
      title: huge
        ? `${base.cmd} given a huge ${flag} exits with a documented code (${want.join(' or ')}) without a crash (${doc})`
        : `${base.cmd} given ${NUMBER_WORDS[shape]} as ${flag} exits ${want.join(' or ')} (${doc})`,
      want,
      refusal: !huge && want.every((code) => code === 2 || code === 64),
      ...(huge ? { child: true } : {}),
      argv: (w) => argv(w, numberText(shape, w.seed)),
    });
  }
}

function single(cell: Cell): void {
  cells.push(cell);
}

/** Stores one passing Acme campaign under `c-<seed>` in `<dir>/runs.db`, for commands that read a store. */
async function storeCampaign(w: World): Promise<string | undefined> {
  const store = join(w.dir, 'runs.db');
  const result = await cli(
    ['campaign', 'run', w.spec, '--target', TARGET, '--store', store, '--campaign', `c-${w.seed}`],
    w.dir,
  );
  return result.code === 0
    ? undefined
    : `setup: campaign run exited ${result.code}: ${result.err.slice(0, 200)}`;
}

// ---------------------------------------------------------------------------------------------------------
// Family exits-spec: spec validate, spec lint, spec coverage.

{
  const family = 'exits-spec';
  const doc =
    'cli.md "driftbench spec validate": a path that does not exist is an invalid spec, SPEC_PARSE; exit 1 a spec is invalid, or no spec file was found';
  for (const cmd of ['spec validate', 'spec lint'] as const) {
    const words = cmd.split(' ');
    fileRow(
      {
        family,
        cmd,
        component: SPEC_CMD,
        cause: `${SPEC_CMD}: ${cmd} reports an unreadable or invalid spec file as an invalid spec and exits 1`,
      },
      'path',
      '.yaml',
      { missing: 1, empty: 1, garbage: 1, wrong: 1 },
      (_w, value) => [...words, value],
      doc,
    );
    single({
      family,
      cmd,
      slug: 'path-empty-folder',
      tier: 2,
      component: SPEC_CMD,
      title: `${cmd} on a folder that holds no spec exits 1 (cli.md: "no spec file was found")`,
      want: [1],
      refusal: false,
      argv: (w) => [...words, w.folder],
    });
    single({
      family,
      cmd,
      slug: 'unknown-option',
      tier: 1,
      component: MAIN,
      title: `${cmd} with an unknown option exits 2 (cli.md: "an unknown option ... always exits 2")`,
      want: [2],
      refusal: true,
      argv: (w) => [...words, w.spec, `--no-such-option-${w.seed % 5}`],
    });
    single({
      family,
      cmd,
      slug: 'no-path',
      tier: 1,
      component: MAIN,
      title: `${cmd} with no path exits 2 (cli.md: "usage error, such as a missing path")`,
      want: [2],
      refusal: true,
      argv: () => words,
    });
  }
  single({
    family,
    cmd: 'spec validate',
    slug: 'acme-valid',
    tier: 1,
    component: SPEC_CMD,
    title: 'spec validate on the seven Acme specs exits 0 (cli.md: "0 every spec is valid")',
    want: [0],
    refusal: false,
    argv: (w) => ['spec', 'validate', w.r(ACME_SPECS)],
  });
  single({
    family,
    cmd: 'spec lint',
    slug: 'strict-warning',
    tier: 2,
    component: SPEC_CMD,
    title:
      'spec lint --strict on a spec whose block checks nothing exits 1 (cli.md: "a warning was printed with --strict")',
    want: [1],
    refusal: false,
    argv: (w) => [
      'spec',
      'lint',
      w.put('nc.yaml', `id: no-checks-${w.seed}\nblocks:\n  - user: hi\n`),
      '--strict',
    ],
  });

  const cov = (w: World) => ['spec', 'coverage', w.r(COV_SPECS), '--inventory', w.r(COV_INVENTORY)];
  const covDoc =
    'cli.md "driftbench spec coverage": exit 2 an invalid inventory; INVENTORY_PARSE, INVENTORY_NOT_OBJECT stop the command';
  fileRow(
    { family, cmd: 'spec coverage', component: COVERAGE_CMD },
    '--inventory',
    '.yaml',
    { missing: 2, folder: 2, empty: 2, garbage: 2, wrong: 2 },
    (w, value) => ['spec', 'coverage', w.r(COV_SPECS), '--inventory', value],
    covDoc,
  );
  fileRow(
    { family, cmd: 'spec coverage', component: COVERAGE_CMD },
    'path',
    '.yaml',
    { missing: 2 },
    (w, value) => ['spec', 'coverage', value, '--inventory', w.r(COV_INVENTORY)],
    'cli.md "driftbench spec coverage": exit 2 a path that does not exist',
  );
  single({
    family,
    cmd: 'spec coverage',
    slug: 'path-empty-folder',
    tier: 2,
    component: COVERAGE_CMD,
    title: 'spec coverage on a folder with no spec exits 2 (cli.md: "2 ... no spec file found")',
    want: [2],
    refusal: true,
    argv: (w) => ['spec', 'coverage', w.folder, '--inventory', w.r(COV_INVENTORY)],
  });
  single({
    family,
    cmd: 'spec coverage',
    slug: 'channel-unknown',
    tier: 2,
    component: COVERAGE_CMD,
    title: 'spec coverage with an unknown --channel exits 2 (cli.md: "an unknown channel is a usage error")',
    want: [2],
    refusal: true,
    argv: (w) => [...cov(w), '--channel', `pigeon-${w.seed % 9}`],
  });
  single({
    family,
    cmd: 'spec coverage',
    slug: 'channel-empty',
    tier: 4,
    component: COVERAGE_CMD,
    title: 'spec coverage with an empty --channel exits 2 (cli.md: "an unknown channel is a usage error")',
    want: [2],
    refusal: true,
    argv: (w) => [...cov(w), '--channel', ''],
  });
  single({
    family,
    cmd: 'spec coverage',
    slug: 'no-inventory',
    tier: 1,
    component: COVERAGE_CMD,
    title: 'spec coverage without --inventory exits 2 (cli.md: "--inventory ... required")',
    want: [2],
    refusal: true,
    argv: (w) => ['spec', 'coverage', w.r(COV_SPECS)],
  });
  single({
    family,
    cmd: 'spec coverage',
    slug: 'unknown-option',
    tier: 1,
    component: MAIN,
    title: 'spec coverage with an unknown option exits 2 (cli.md "Running it")',
    want: [2],
    refusal: true,
    argv: (w) => [...cov(w), '--colour'],
  });
  single({
    family,
    cmd: 'spec coverage',
    slug: 'fixtures-missing-cell',
    tier: 1,
    component: COVERAGE_CMD,
    title:
      'spec coverage on the coverage fixtures exits 1 (cli.md: "The command exits 1 here: B-004 is missing on whatsapp")',
    want: [1],
    refusal: false,
    argv: cov,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Family exits-campaign: campaign plan, run, status, resume, export, import, and smoke.

{
  const family = 'exits-campaign';
  const runningDoc =
    'running.md "Exit codes": bad input is ... an invalid spec or none found, a bad number for an option, a store that cannot be opened';
  const plan = (w: World) => ['campaign', 'plan', w.spec, '--target', TARGET];
  fileRow(
    { family, cmd: 'campaign plan', component: CAMPAIGN_CMD },
    'path',
    '.yaml',
    { missing: 2, empty: 2, garbage: 2, wrong: 2 },
    (_w, value) => ['campaign', 'plan', value, '--target', TARGET],
    runningDoc,
  );
  single({
    family,
    cmd: 'campaign plan',
    slug: 'path-empty-folder',
    tier: 2,
    component: CAMPAIGN_CMD,
    title: `campaign plan on a folder with no spec exits 2 (${runningDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['campaign', 'plan', w.folder, '--target', TARGET],
  });
  const base = { family, cmd: 'campaign plan', component: CAMPAIGN_CMD };
  numberRow(
    base,
    '--repeats',
    { text: [2], negative: [2], empty: [2], huge: [0, 2] },
    (w, v) => [...plan(w), '--repeats', v],
    'running.md: "--repeats ... at least 1"; "a bad number for an option" is bad input',
  );
  numberRow(
    base,
    '--budget-usd',
    { text: [2], negative: [2], empty: [2] },
    (w, v) => [...plan(w), '--budget-usd', v],
    'running.md "Exit codes": a bad number for an option is bad input, exit 2',
  );
  numberRow(
    base,
    '--baseline-rate',
    { text: [2], zero: [2], negative: [2], empty: [2], huge: [2] },
    (w, v) => [...plan(w), '--baseline-rate', v],
    'running.md: "--baseline-rate ... between 0 and 1"',
  );
  for (const [slug, tier, words, value] of [
    ['store-folder', 4, 'a store path that is a folder', (w: World) => w.folder],
    ['store-not-db', 4, 'a store that is not a database', (w: World) => w.notDb],
  ] as const) {
    single({
      family,
      cmd: 'campaign plan',
      slug,
      tier,
      component: CAMPAIGN_CMD,
      title: `campaign plan with ${words} as --store exits 2 (running.md: "a store that cannot be opened")`,
      want: [2],
      refusal: true,
      argv: (w) => [...plan(w), '--store', value(w)],
    });
  }
  single({
    family,
    cmd: 'campaign plan',
    slug: 'mode-empty',
    tier: 4,
    component: CAMPAIGN_CMD,
    title: 'campaign plan with an empty --mode exits 2 (running.md: "an unknown mode" is bad input)',
    want: [2],
    refusal: true,
    argv: (w) => [...plan(w), '--mode', ''],
  });
  single({
    family,
    cmd: 'campaign plan',
    slug: 'unknown-option',
    tier: 1,
    component: MAIN,
    title: 'campaign plan with an unknown option exits 2 (cli.md "Running it")',
    want: [2],
    refusal: true,
    argv: (w) => [...plan(w), '--repeat', '2'],
  });
  single({
    family,
    cmd: 'campaign plan',
    slug: 'no-path',
    tier: 1,
    component: MAIN,
    title: 'campaign plan with no path exits 2 (cli.md: "a missing argument ... always exits 2")',
    want: [2],
    refusal: true,
    argv: () => ['campaign', 'plan', '--target', TARGET],
  });

  const run = (w: World) => ['campaign', 'run', w.spec, '--target', TARGET, '--store', join(w.dir, 'run.db')];
  const runBase = { family, cmd: 'campaign run', component: CAMPAIGN_CMD };
  numberRow(
    runBase,
    '--concurrency',
    { text: [2], negative: [2], empty: [2] },
    (w, v) => [...run(w), '--concurrency', v],
    runningDoc,
  );
  numberRow(
    runBase,
    '--retry-attempts',
    { zero: [2], text: [2] },
    (w, v) => [...run(w), '--retry-attempts', v],
    'cli.md: "--retry-attempts ... attempts per model call, the first included"; a bad number is bad input',
  );
  numberRow(
    runBase,
    '--retry-base-ms',
    { negative: [2] },
    (w, v) => [...run(w), '--retry-base-ms', v],
    runningDoc,
  );
  numberRow(
    runBase,
    '--retry-max-ms',
    { empty: [2] },
    (w, v) => [...run(w), '--retry-max-ms', v],
    runningDoc,
  );
  numberRow(runBase, '--budget-usd', { text: [2] }, (w, v) => [...run(w), '--budget-usd', v], runningDoc);
  for (const [slug, words, value] of [
    ['store-folder', 'a store path that is a folder', (w: World) => w.folder],
    ['store-not-db', 'a store that is not a database', (w: World) => w.notDb],
  ] as const) {
    single({
      family,
      cmd: 'campaign run',
      slug,
      tier: 4,
      component: CAMPAIGN_CMD,
      title: `campaign run with ${words} as --store exits 2 (running.md: "a store that cannot be opened")`,
      want: [2],
      refusal: true,
      argv: (w) => ['campaign', 'run', w.spec, '--target', TARGET, '--store', value(w)],
    });
  }
  fileRow(
    runBase,
    'path',
    '.yaml',
    { missing: 2, garbage: 2 },
    (w, value) => ['campaign', 'run', value, '--target', TARGET, '--store', join(w.dir, 'run.db')],
    runningDoc,
  );

  for (const cmd of ['campaign status', 'campaign resume'] as const) {
    const words = cmd.split(' ');
    single({
      family,
      cmd,
      slug: 'store-missing',
      tier: 3,
      component: CAMPAIGN_CMD,
      title: `${cmd} on a store file that does not exist exits 2 and writes no store (running.md: "a store with no campaign" is bad input)`,
      want: [2],
      refusal: true,
      argv: (w) => [...words, '--store', join(w.dir, `none-${w.seed}.db`)],
    });
    single({
      family,
      cmd,
      slug: 'store-not-db',
      tier: 4,
      component: CAMPAIGN_CMD,
      title: `${cmd} on a store that is not a database exits 2 (running.md: "a store that cannot be opened")`,
      want: [2],
      refusal: true,
      argv: (w) => [...words, '--store', w.notDb],
    });
    single({
      family,
      cmd,
      slug: 'store-folder',
      tier: 4,
      component: CAMPAIGN_CMD,
      title: `${cmd} on a store path that is a folder exits 2 (running.md: "a store that cannot be opened")`,
      want: [2],
      refusal: true,
      argv: (w) => [...words, '--store', w.folder],
    });
  }
  single({
    family,
    cmd: 'campaign status',
    slug: 'no-store',
    tier: 1,
    component: CAMPAIGN_CMD,
    title: 'campaign status without --store exits 2 (cli.md: "--store ... required by resume and status")',
    want: [2],
    refusal: true,
    argv: () => ['campaign', 'status', 'c-x'],
  });
  single({
    family,
    cmd: 'campaign export',
    slug: 'store-missing',
    tier: 3,
    component: CAMPAIGN_CMD,
    title:
      'campaign export from a store file that does not exist exits 2 and writes nothing (cli.md: "2 bad input ... a store that cannot be opened")',
    want: [2],
    refusal: true,
    argv: (w) => ['campaign', 'export', `c-${w.seed}`, '--store', join(w.dir, 'none.db'), '--out', w.out],
  });
  single({
    family,
    cmd: 'campaign export',
    slug: 'no-out',
    tier: 1,
    component: MAIN,
    title: 'campaign export without --out exits 2 (cli.md synopsis: --out <dir> is required)',
    want: [2],
    refusal: true,
    argv: (w) => ['campaign', 'export', `c-${w.seed}`, '--store', join(w.dir, 'none.db')],
  });
  single({
    family,
    cmd: 'campaign export',
    slug: 'unknown-campaign',
    tier: 2,
    component: CAMPAIGN_CMD,
    title:
      'campaign export of a campaign the store does not hold exits 2 and writes no bundle (cli.md: "2 bad input")',
    want: [2],
    refusal: true,
    setup: storeCampaign,
    argv: (w) => [
      'campaign',
      'export',
      `c-other-${w.seed}`,
      '--store',
      join(w.dir, 'runs.db'),
      '--out',
      w.out,
    ],
  });
  for (const [slug, tier, words, value] of [
    ['folder-missing', 1, 'a bundle folder that does not exist', (w: World) => join(w.dir, 'no-bundle')],
    ['folder-is-file', 2, 'a file where the bundle folder is expected', (w: World) => w.aFile],
    ['folder-empty', 2, 'an empty folder', (w: World) => w.folder],
  ] as const) {
    single({
      family,
      cmd: 'campaign import',
      slug,
      tier,
      component: CAMPAIGN_CMD,
      title: `campaign import of ${words} exits 2 and stores nothing (cli.md: "2 bad input"; datasets.md: all or nothing)`,
      want: [2],
      refusal: true,
      argv: (w) => ['campaign', 'import', value(w), '--store', join(w.dir, 'import.db')],
    });
  }

  const smokeDoc = 'running.md: "--runs ... at least 2"; "a bad number for an option" is bad input';
  const smokeBase = { family, cmd: 'smoke', component: SMOKE_CMD };
  numberRow(
    smokeBase,
    '--runs',
    { text: [2], zero: [2], negative: [2], empty: [2] },
    (w, v) => ['smoke', w.spec, '--target', TARGET, '--runs', v],
    smokeDoc,
  );
  fileRow(
    smokeBase,
    'spec',
    '.yaml',
    { missing: 2, garbage: 2, empty: 2 },
    (_w, value) => ['smoke', value, '--target', TARGET],
    runningDoc,
  );
}

// ---------------------------------------------------------------------------------------------------------
// Family exits-space: space coverage, space complete, space declare.

{
  const family = 'exits-space';
  const doc =
    'cli.md "driftbench space": exit 2 usage or input error: an invalid map, `t` out of range, a missing path, no spec file';
  const base = { family, cmd: 'space coverage', component: SPACE_CMD };
  const cov = (w: World) => ['space', 'coverage', w.r(ACME_SPECS), '--map', w.r(SPACE_MAP)];
  fileRow(
    base,
    '--map',
    '.yaml',
    { missing: 2, folder: 2, empty: 2, garbage: 2, wrong: 2 },
    (w, value) => ['space', 'coverage', w.r(ACME_SPECS), '--map', value],
    doc,
  );
  numberRow(
    base,
    '--t',
    { text: [2], negative: [2], zero: [2], empty: [2], huge: [2] },
    (w, v) => [...cov(w), '--t', v],
    'cli.md: "--t <n> ... from 1 to the number of dimensions"; exit 2 `t` out of range',
  );
  fileRow(
    base,
    'path',
    '.yaml',
    { missing: 2 },
    (w, value) => ['space', 'coverage', value, '--map', w.r(SPACE_MAP)],
    doc,
  );
  single({
    family,
    cmd: 'space coverage',
    slug: 'path-empty-folder',
    tier: 2,
    component: SPACE_CMD,
    title: `space coverage on a folder with no spec exits 2 (${doc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['space', 'coverage', w.folder, '--map', w.r(SPACE_MAP)],
  });
  single({
    family,
    cmd: 'space coverage',
    slug: 'no-map',
    tier: 1,
    component: SPACE_CMD,
    title: 'space coverage without --map exits 2 (cli.md: "--map ... required by coverage and complete")',
    want: [2],
    refusal: true,
    argv: (w) => ['space', 'coverage', w.r(ACME_SPECS)],
  });
  single({
    family,
    cmd: 'space coverage',
    slug: 'acme-required-empty',
    tier: 1,
    component: SPACE_CMD,
    title:
      'space coverage of the Acme specs at t = 2 exits 1 (cli.md: "The command exits 1 here: three required flow deviations have no spec")',
    want: [1],
    refusal: false,
    argv: (w) => [...cov(w), '--t', '2'],
  });
  const comp = { family, cmd: 'space complete', component: SPACE_CMD };
  fileRow(
    comp,
    '--map',
    '.yaml',
    { missing: 2, garbage: 2 },
    (w, value) => ['space', 'complete', w.r(ACME_SPECS), '--map', value],
    doc,
  );
  numberRow(
    comp,
    '--t',
    { zero: [2], text: [2] },
    (w, v) => ['space', 'complete', w.r(ACME_SPECS), '--map', w.r(SPACE_MAP), '--t', v],
    doc,
  );
  single({
    family,
    cmd: 'space complete',
    slug: 'acme-too-few',
    tier: 1,
    component: SPACE_CMD,
    title:
      'space complete of the Acme specs at t = 1 exits 1 (cli.md: "1 complete: too few conversations for the line")',
    want: [1],
    refusal: false,
    argv: (w) => ['space', 'complete', w.r(ACME_SPECS), '--map', w.r(SPACE_MAP), '--t', '1'],
  });
  const decl = (w: World, out: string) => [
    'space',
    'declare',
    w.r(ACME_SPECS),
    '--inventory',
    w.r(INVENTORY),
    '--out',
    out,
  ];
  single({
    family,
    cmd: 'space declare',
    slug: 'out-exists',
    tier: 2,
    component: SPACE_CMD,
    title:
      'space declare onto a file that exists exits 2 and leaves it as it was (cli.md: "An existing file is never overwritten"; exit 2 a declare target that exists)',
    want: [2],
    refusal: true,
    argv: (w) => decl(w, w.aFile),
  });
  fileRow(
    { family, cmd: 'space declare', component: SPACE_CMD },
    '--inventory',
    '.yaml',
    { missing: 2, garbage: 2, wrong: 2 },
    (w, value) => [
      'space',
      'declare',
      w.r(ACME_SPECS),
      '--inventory',
      value,
      '--out',
      join(w.dir, 'map.yaml'),
    ],
    'cli.md: exit 2 an unreadable inventory',
  );
  single({
    family,
    cmd: 'space declare',
    slug: 'no-out',
    tier: 1,
    component: SPACE_CMD,
    title: 'space declare without --out exits 2 (cli.md: "--out <file> ... required")',
    want: [2],
    refusal: true,
    argv: (w) => ['space', 'declare', w.r(ACME_SPECS), '--inventory', w.r(INVENTORY)],
  });
  single({
    family,
    cmd: 'space declare',
    slug: 'written',
    tier: 1,
    component: SPACE_CMD,
    title:
      'space declare of the Acme specs and inventory to a new file exits 0 (cli.md: "0 declare: the map written")',
    want: [0],
    refusal: false,
    argv: (w) => decl(w, join(w.dir, `declared-${w.seed}.yaml`)),
  });
}

// ---------------------------------------------------------------------------------------------------------
// Family exits-generate: generate, extract, extract approve, extract map.

{
  const family = 'exits-generate';
  const doc =
    'cli.md "driftbench generate": exit 2 usage or input error, nothing written: an invalid or unapproved map, a bad number';
  const base = { family, cmd: 'generate', component: GENERATE_CMD };
  const gen = (w: World) => ['generate', '--map', w.r(APPROVED), '--out', w.out];
  fileRow(
    base,
    '--map',
    '.yaml',
    { missing: 2, folder: 2, empty: 2, garbage: 2, wrong: 2 },
    (w, value) => ['generate', '--map', value, '--out', w.out],
    doc,
  );
  numberRow(
    base,
    '--t',
    { text: [2], negative: [2], zero: [2], empty: [2] },
    (w, v) => [...gen(w), '--t', v],
    doc,
  );
  numberRow(
    base,
    '--seed',
    { text: [2], empty: [2] },
    (w, v) => [...gen(w), '--seed', v],
    `${doc}; "--seed <n> the integer seed"`,
  );
  numberRow(base, '--max', { text: [2], negative: [2] }, (w, v) => [...gen(w), '--max', v], doc);
  single({
    family,
    cmd: 'generate',
    slug: 'out-is-file',
    tier: 2,
    component: GENERATE_CMD,
    title: `generate with a file where the --out folder is expected exits 2 and leaves the file as it was (${doc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['generate', '--map', w.r(APPROVED), '--out', w.aFile],
  });
  single({
    family,
    cmd: 'generate',
    slug: 'no-out',
    tier: 1,
    component: GENERATE_CMD,
    title: 'generate without --out exits 2 (cli.md: "--out <dir> ... required")',
    want: [2],
    refusal: true,
    argv: (w) => ['generate', '--map', w.r(APPROVED)],
  });
  const exDoc = 'cli.md "driftbench extract": exit 2 usage or input error; nothing is written';
  const exBase = { family, cmd: 'extract', component: EXTRACT_CMD };
  const ex = (w: World, prompt: string, inventory: string) => [
    'extract',
    '--prompt',
    prompt,
    '--inventory',
    inventory,
    '--out',
    join(w.dir, 'proposal.yaml'),
    '--no-model',
  ];
  fileRow(
    exBase,
    '--prompt',
    '.md',
    { missing: 2, folder: 2 },
    (w, value) => ex(w, value, w.r(INVENTORY)),
    exDoc,
  );
  fileRow(
    exBase,
    '--inventory',
    '.yaml',
    { missing: 2, garbage: 2 },
    (w, value) => ex(w, w.put('prompt.md', `You are the Acme assistant ${w.seed}.\n`), value),
    exDoc,
  );
  single({
    family,
    cmd: 'extract',
    slug: 'no-out',
    tier: 1,
    component: EXTRACT_CMD,
    title: 'extract without --out exits 2 (cli.md: "--out <file> ... required")',
    want: [2],
    refusal: true,
    argv: (w) => [
      'extract',
      '--prompt',
      w.put('prompt.md', 'Acme.\n'),
      '--inventory',
      w.r(INVENTORY),
      '--no-model',
    ],
  });
  const apDoc =
    'cli.md "extract approve": exit 2 the file is not found, --all with --dimension, or --to outside the proposal folder; exit 1 the proposal is invalid';
  const apBase = { family, cmd: 'extract approve', component: EXTRACT_CMD };
  fileRow(
    apBase,
    'proposal',
    '.yaml',
    { missing: 2, garbage: 1, wrong: 1, empty: 1 },
    (_w, value) => ['extract', 'approve', value],
    apDoc,
  );
  const proposalCopy = (w: World) => {
    const path = join(w.dir, 'copy', 'proposal.yaml');
    mkdirSync(join(w.dir, 'copy'), { recursive: true });
    copyFileSync(w.r(PROPOSAL), path);
    return path;
  };
  single({
    family,
    cmd: 'extract approve',
    slug: 'all-with-dimension',
    tier: 3,
    component: EXTRACT_CMD,
    title: `extract approve with --all and --dimension exits 2 and leaves the proposal as it was (${apDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['extract', 'approve', proposalCopy(w), '--all', '--dimension', 'channel'],
  });
  single({
    family,
    cmd: 'extract approve',
    slug: 'to-outside',
    tier: 3,
    component: EXTRACT_CMD,
    title: `extract approve with --to outside the proposal folder exits 2 and writes nothing (${apDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['extract', 'approve', proposalCopy(w), '--all', '--to', join(w.dir, 'elsewhere.yaml')],
  });
  const mapDoc =
    'cli.md "extract map": exit 2 the file is not found, or --to is missing; exit 1 the proposal is invalid';
  fileRow(
    { family, cmd: 'extract map', component: EXTRACT_CMD },
    'proposal',
    '.yaml',
    { missing: 2, garbage: 1 },
    (w, value) => ['extract', 'map', value, '--to', join(w.dir, 'space.yaml')],
    mapDoc,
  );
  single({
    family,
    cmd: 'extract map',
    slug: 'no-to',
    tier: 1,
    component: EXTRACT_CMD,
    title: `extract map without --to exits 2 (${mapDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['extract', 'map', w.r(APPROVED)],
  });
}

// ---------------------------------------------------------------------------------------------------------
// Family exits-registry: dataset and prompt push, list, diff, restore.

{
  const family = 'exits-registry';
  const doc =
    'cli.md "driftbench dataset and driftbench prompt": exit 2 bad input: an unknown name or version, a path that cannot be read, a store that cannot be opened';
  for (const kind of ['dataset', 'prompt'] as const) {
    const source = (w: World) =>
      kind === 'dataset' ? w.specDir : w.put('prompts/system.md', `You are Acme ${w.seed}.\n`);
    const db = (w: World) => join(w.dir, 'reg.db');
    const pushed = async (w: World) => {
      const result = await cli([kind, 'push', `acme-${kind}`, source(w), '--store', db(w)], w.dir);
      return result.code === 0
        ? undefined
        : `setup: ${kind} push exited ${result.code}: ${result.err.slice(0, 200)}`;
    };
    single({
      family,
      cmd: `${kind} push`,
      slug: 'path-missing',
      tier: 1,
      component: REGISTRY_CMD,
      title: `${kind} push of a path that does not exist exits 2 and writes no store (${doc})`,
      want: [2],
      refusal: true,
      argv: (w) => [kind, 'push', 'acme', w.missing(''), '--store', db(w)],
    });
    single({
      family,
      cmd: `${kind} push`,
      slug: 'store-folder',
      tier: 4,
      component: REGISTRY_CMD,
      title: `${kind} push into a store path that is a folder exits 2 (${doc})`,
      want: [2],
      refusal: true,
      argv: (w) => [kind, 'push', 'acme', source(w), '--store', w.folder],
    });
    single({
      family,
      cmd: `${kind} push`,
      slug: 'store-not-db',
      tier: 4,
      component: REGISTRY_CMD,
      title: `${kind} push into a store that is not a database exits 2 and leaves it as it was (${doc})`,
      want: [2],
      refusal: true,
      argv: (w) => [kind, 'push', 'acme', source(w), '--store', w.notDb],
    });
    single({
      family,
      cmd: `${kind} push`,
      slug: 'no-store',
      tier: 1,
      component: MAIN,
      title: `${kind} push without --store exits 2 (cli.md synopsis: --store <file> is required)`,
      want: [2],
      refusal: true,
      argv: (w) => [kind, 'push', 'acme', source(w)],
    });
    single({
      family,
      cmd: `${kind} push`,
      slug: 'unknown-option',
      tier: 1,
      component: MAIN,
      title: `${kind} push with an unknown option exits 2 (cli.md "Running it")`,
      want: [2],
      refusal: true,
      argv: (w) => [kind, 'push', 'acme', source(w), '--store', db(w), '--message', 'x'],
    });
    single({
      family,
      cmd: `${kind} push`,
      slug: 'twice',
      tier: 2,
      component: REGISTRY_CMD,
      title: `${kind} push of the same content twice exits 0 (cli.md: "the same content again gives back the version that holds it"; "0 push ... done")`,
      want: [0],
      refusal: false,
      setup: pushed,
      argv: (w) => [kind, 'push', `acme-${kind}`, source(w), '--store', db(w)],
    });
    for (const [cmd, slug, argv] of [
      [`${kind} list`, 'unknown-name', (w: World) => [kind, 'list', `nobody-${w.seed}`, '--store', db(w)]],
      [
        `${kind} diff`,
        'unknown-ref',
        (w: World) => [kind, 'diff', `acme-${kind}@${9 + (w.seed % 50)}`, '--store', db(w)],
      ],
      [
        `${kind} restore`,
        'unknown-ref',
        (w: World) => [kind, 'restore', `nobody@1`, '--store', db(w), '--out', w.out],
      ],
    ] as const) {
      single({
        family,
        cmd,
        slug,
        tier: 2,
        component: REGISTRY_CMD,
        title: `${cmd} of a name or version the store does not hold exits 2 and writes nothing (${doc})`,
        want: [2],
        refusal: true,
        setup: pushed,
        argv,
      });
    }
    single({
      family,
      cmd: `${kind} list`,
      slug: 'store-not-db',
      tier: 4,
      component: REGISTRY_CMD,
      title: `${kind} list of a store that is not a database exits 2 (${doc})`,
      want: [2],
      refusal: true,
      argv: (w) => [kind, 'list', '--store', w.notDb],
    });
  }
  single({
    family,
    cmd: 'dataset push',
    slug: 'invalid-spec',
    tier: 2,
    component: REGISTRY_CMD,
    title:
      'dataset push of a folder holding an invalid spec exits 1 (cli.md: "1 push: an invalid spec"; "dataset push refuses a folder with an invalid spec")',
    want: [1],
    refusal: false,
    argv: (w) => [
      'dataset',
      'push',
      'acme',
      (() => {
        w.put('bad/b.yaml', `id: bad-${w.seed}\nblocks: []\n`);
        return join(w.dir, 'bad');
      })(),
      '--store',
      join(w.dir, 'reg.db'),
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------
// Family exits-verdict: report, compare, ci, monitor.

{
  const family = 'exits-verdict';
  const reportDoc =
    'cli.md "driftbench report and driftbench compare": report exit 0 when written, 2 on bad input';
  const rep = (w: World) => [
    'report',
    `c-${w.seed}`,
    '--store',
    join(w.dir, 'runs.db'),
    '--out',
    join(w.dir, 'card.html'),
  ];
  for (const [slug, tier, words, value] of [
    ['store-missing', 3, 'a store file that does not exist', (w: World) => join(w.dir, 'none.db')],
    ['store-folder', 4, 'a store path that is a folder', (w: World) => w.folder],
    ['store-not-db', 4, 'a store that is not a database', (w: World) => w.notDb],
  ] as const) {
    single({
      family,
      cmd: 'report',
      slug,
      tier,
      component: REPORT_CMD,
      title: `report on ${words} exits 2 and writes no scorecard and no store (${reportDoc})`,
      want: [2],
      refusal: true,
      argv: (w) => ['report', '--store', value(w), '--out', join(w.dir, 'card.html')],
    });
  }
  single({
    family,
    cmd: 'report',
    slug: 'no-out',
    tier: 1,
    component: MAIN,
    title: 'report without --out exits 2 (cli.md synopsis: --out <file.html> is required)',
    want: [2],
    refusal: true,
    argv: (w) => ['report', '--store', join(w.dir, 'none.db')],
  });
  single({
    family,
    cmd: 'report',
    slug: 'unknown-campaign',
    tier: 2,
    component: REPORT_CMD,
    title: `report of a campaign the store does not hold exits 2 and writes no scorecard (${reportDoc})`,
    want: [2],
    refusal: true,
    setup: storeCampaign,
    argv: (w) => [
      'report',
      `c-none-${w.seed}`,
      '--store',
      join(w.dir, 'runs.db'),
      '--out',
      join(w.dir, 'card.html'),
    ],
  });
  const repBase = { family, cmd: 'report', component: REPORT_CMD };
  numberRow(
    repBase,
    '--margin',
    { text: [2], negative: [2] },
    (w, v) => [...rep(w), '--margin', v],
    `${reportDoc}; "--margin <points|auto>"`,
    { setup: storeCampaign },
  );
  numberRow(
    repBase,
    '--min-goldens',
    { text: [2], negative: [2] },
    (w, v) => [...rep(w), '--min-goldens', v],
    reportDoc,
    { setup: storeCampaign },
  );
  numberRow(
    repBase,
    '--max-runs',
    { text: [2], negative: [2] },
    (w, v) => [...rep(w), '--max-runs', v],
    reportDoc,
    { setup: storeCampaign },
  );
  single({
    family,
    cmd: 'report',
    slug: 'written',
    tier: 1,
    component: REPORT_CMD,
    title: `report of a stored passing campaign exits 0 (${reportDoc})`,
    want: [0],
    refusal: false,
    setup: storeCampaign,
    argv: rep,
  });

  const cmpDoc =
    'cli.md: compare "Exit 0 non-inferior, 1 regressed or not shown non-inferior, 2 on bad input"';
  const cmp = (w: World) => [
    'compare',
    '--baseline',
    `c-${w.seed}`,
    '--candidate',
    `c-${w.seed}`,
    '--store',
    join(w.dir, 'runs.db'),
  ];
  for (const [slug, tier, words, value] of [
    ['store-missing', 3, 'a store file that does not exist', (w: World) => join(w.dir, 'none.db')],
    ['store-not-db', 4, 'a store that is not a database', (w: World) => w.notDb],
  ] as const) {
    single({
      family,
      cmd: 'compare',
      slug,
      tier,
      component: COMPARE_CMD,
      title: `compare on ${words} exits 2 and writes no store (${cmpDoc})`,
      want: [2],
      refusal: true,
      argv: (w) => ['compare', '--baseline', 'c-a', '--candidate', 'c-b', '--store', value(w)],
    });
  }
  single({
    family,
    cmd: 'compare',
    slug: 'unknown-campaign',
    tier: 2,
    component: COMPARE_CMD,
    title: `compare with a candidate the store does not hold exits 2 (${cmpDoc})`,
    want: [2],
    refusal: true,
    setup: storeCampaign,
    argv: (w) => [
      'compare',
      '--baseline',
      `c-${w.seed}`,
      '--candidate',
      `c-none-${w.seed}`,
      '--store',
      join(w.dir, 'runs.db'),
    ],
  });
  const cmpBase = { family, cmd: 'compare', component: COMPARE_CMD };
  numberRow(
    cmpBase,
    '--q',
    { text: [2], negative: [2], zero: [2] },
    (w, v) => [...cmp(w), '--q', v],
    `${cmpDoc}; --q is a false discovery rate`,
    { setup: storeCampaign },
  );
  numberRow(cmpBase, '--margin', { text: [2] }, (w, v) => [...cmp(w), '--margin', v], cmpDoc, {
    setup: storeCampaign,
  });
  single({
    family,
    cmd: 'compare',
    slug: 'mode-unknown',
    tier: 2,
    component: COMPARE_CMD,
    title: `compare with an unknown --mode exits 2 (${cmpDoc})`,
    want: [2],
    refusal: true,
    setup: storeCampaign,
    argv: (w) => [...cmp(w), '--mode', 'Q'],
  });
  single({
    family,
    cmd: 'compare',
    slug: 'no-candidate',
    tier: 1,
    component: MAIN,
    title: 'compare without --candidate exits 2 (cli.md "Running it": a missing argument always exits 2)',
    want: [2],
    refusal: true,
    argv: (w) => ['compare', '--baseline', 'c-a', '--store', join(w.dir, 'none.db')],
  });

  const ciDoc =
    'cli.md "driftbench ci" with docs/reference/cli.md "Running it": exit 2 on a usage or input error';
  const ci = (w: World) => [
    'ci',
    '--specs',
    w.spec,
    '--target',
    TARGET,
    '--baseline',
    `c-${w.seed}`,
    '--store',
    join(w.dir, 'runs.db'),
  ];
  fileRow(
    { family, cmd: 'ci', component: CI_CMD },
    '--specs',
    '.yaml',
    { missing: 2, garbage: 2 },
    (w, value) => [
      'ci',
      '--specs',
      value,
      '--target',
      TARGET,
      '--baseline',
      `c-${w.seed}`,
      '--store',
      join(w.dir, 'runs.db'),
    ],
    ciDoc,
    { setup: storeCampaign },
  );
  const ciBase = { family, cmd: 'ci', component: CI_CMD };
  numberRow(ciBase, '--repeats', { zero: [2], text: [2] }, (w, v) => [...ci(w), '--repeats', v], ciDoc, {
    setup: storeCampaign,
  });
  numberRow(ciBase, '--budget-usd', { negative: [2] }, (w, v) => [...ci(w), '--budget-usd', v], ciDoc, {
    setup: storeCampaign,
  });
  numberRow(ciBase, '--concurrency', { text: [2] }, (w, v) => [...ci(w), '--concurrency', v], ciDoc, {
    setup: storeCampaign,
  });
  single({
    family,
    cmd: 'ci',
    slug: 'store-not-db',
    tier: 4,
    component: CI_CMD,
    title: `ci with a store that is not a database exits 2 and writes no summary (${ciDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['ci', '--specs', w.spec, '--target', TARGET, '--baseline', 'c-x', '--store', w.notDb],
  });

  const monDoc =
    'cli.md "driftbench monitor": exit 2 bad input: an unknown metric for the source, no store or no path, a bad --every or --window, too few points';
  const mon = (w: World) => ['monitor', '--store', join(w.dir, 'runs.db'), '--metric', 'pass_rate'];
  single({
    family,
    cmd: 'monitor',
    slug: 'metric-unknown',
    tier: 1,
    component: MONITOR_CMD,
    title: `monitor with an unknown --metric exits 2 (${monDoc})`,
    want: [2],
    refusal: true,
    setup: storeCampaign,
    argv: (w) => ['monitor', '--store', join(w.dir, 'runs.db'), '--metric', `mood${w.seed % 3}`],
  });
  single({
    family,
    cmd: 'monitor',
    slug: 'no-store',
    tier: 1,
    component: MONITOR_CMD,
    title: `monitor without --store exits 2 (${monDoc})`,
    want: [2],
    refusal: true,
    argv: () => ['monitor', '--metric', 'pass_rate'],
  });
  for (const [slug, tier, words, value] of [
    ['store-missing', 3, 'a store file that does not exist', (w: World) => join(w.dir, 'none.db')],
    ['store-not-db', 4, 'a store that is not a database', (w: World) => w.notDb],
    ['store-folder', 4, 'a store path that is a folder', (w: World) => w.folder],
  ] as const) {
    single({
      family,
      cmd: 'monitor',
      slug,
      tier,
      component: MONITOR_CMD,
      title: `monitor on ${words} exits 2 and writes no store (${monDoc})`,
      want: [2],
      refusal: true,
      argv: (w) => ['monitor', '--store', value(w), '--metric', 'pass_rate'],
    });
  }
  numberRow(
    { family, cmd: 'monitor', component: MONITOR_CMD },
    '--window',
    { text: [2], negative: [2], zero: [2], empty: [2], huge: [2] },
    (w, v) => [...mon(w), '--window', v],
    monDoc,
    { setup: storeCampaign },
  );
  single({
    family,
    cmd: 'monitor',
    slug: 'traces-no-path',
    tier: 2,
    component: MONITOR_CMD,
    title: `monitor --source traces without a path exits 2 (${monDoc})`,
    want: [2],
    refusal: true,
    argv: () => ['monitor', '--source', 'traces', '--metric', 'latency'],
  });
  single({
    family,
    cmd: 'monitor',
    slug: 'traces-path-missing',
    tier: 2,
    component: MONITOR_CMD,
    title: `monitor --source traces on a path that does not exist exits 2 (${monDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['monitor', '--source', 'traces', w.missing('.jsonl'), '--metric', 'latency'],
  });
}

// ---------------------------------------------------------------------------------------------------------
// Family exits-suite: gate, select, holdout, family, pilot.

{
  const family = 'exits-suite';
  const gateDoc =
    'cli.md "driftbench gate": exit 2 usage or input error, nothing written: a bad option value, an invalid candidate, a fault set that does not load';
  const gate = (w: World) => [
    'gate',
    w.specDir,
    '--reference',
    'function:acme-sales',
    '--faults',
    w.r(FAULTS),
    '--out',
    w.out,
    '--date',
    '2026-10-11',
  ];
  const gBase = { family, cmd: 'gate', component: GATE_CMD };
  fileRow(
    gBase,
    'specs',
    '.yaml',
    { missing: 2, garbage: 2 },
    (w, value) => [
      'gate',
      value,
      '--reference',
      'function:acme-sales',
      '--faults',
      w.r(FAULTS),
      '--out',
      w.out,
    ],
    gateDoc,
  );
  fileRow(
    gBase,
    '--faults',
    '.ts',
    { missing: 2, garbage: 2 },
    (w, value) => [
      'gate',
      w.specDir,
      '--reference',
      'function:acme-sales',
      '--faults',
      value,
      '--out',
      w.out,
    ],
    gateDoc,
  );
  numberRow(gBase, '--k', { text: [2], zero: [2], negative: [2] }, (w, v) => [...gate(w), '--k', v], gateDoc);
  numberRow(
    gBase,
    '--holdout',
    { text: [2], negative: [2], huge: [2] },
    (w, v) => [...gate(w), '--holdout', v],
    `${gateDoc}; "--holdout <share> the share of gated specs"`,
  );
  numberRow(gBase, '--overlap', { text: [2] }, (w, v) => [...gate(w), '--overlap', v], gateDoc);
  numberRow(gBase, '--concurrency', { zero: [2] }, (w, v) => [...gate(w), '--concurrency', v], gateDoc);
  numberRow(gBase, '--audit', { text: [2] }, (w, v) => [...gate(w), '--audit', v], gateDoc);
  single({
    family,
    cmd: 'gate',
    slug: 'date-bad',
    tier: 3,
    component: GATE_CMD,
    title: `gate with a --date that is not YYYY-MM-DD exits 2 and writes nothing (${gateDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => [
      'gate',
      w.specDir,
      '--reference',
      'function:acme-sales',
      '--faults',
      w.r(FAULTS),
      '--out',
      w.out,
      '--date',
      `someday-${w.seed % 9}`,
    ],
  });
  single({
    family,
    cmd: 'gate',
    slug: 'no-reference',
    tier: 1,
    component: GATE_CMD,
    title: 'gate without --reference exits 2 (cli.md: "--reference ... required")',
    want: [2],
    refusal: true,
    argv: (w) => ['gate', w.specDir, '--faults', w.r(FAULTS), '--out', w.out],
  });

  const selDoc = 'cli.md "driftbench select": "2 on a usage or input error"';
  const sel = (w: World) => ['select', '--cover', w.r(SPACE_MAP), '--specs', w.r(GATED), '--out', w.out];
  const sBase = { family, cmd: 'select', component: SELECT_CMD };
  fileRow(
    sBase,
    '--cover',
    '.yaml',
    { missing: 2, garbage: 2 },
    (w, value) => ['select', '--cover', value, '--specs', w.r(GATED), '--out', w.out],
    selDoc,
  );
  single({
    family,
    cmd: 'select',
    slug: 'specs-missing',
    tier: 1,
    component: SELECT_CMD,
    title: `select with a --specs folder that does not exist exits 2 and writes nothing (${selDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['select', '--cover', w.r(SPACE_MAP), '--specs', join(w.dir, 'none'), '--out', w.out],
  });
  numberRow(sBase, '--k', { text: [2], negative: [2] }, (w, v) => [...sel(w), '--k', v], selDoc);
  numberRow(sBase, '--t', { zero: [2], text: [2] }, (w, v) => [...sel(w), '--t', v], selDoc);

  const holdDoc =
    'cli.md "driftbench select and driftbench holdout": "Seal: exit 0 when written, 2 on bad input. Score: ... 2 on bad input"';
  const seal = (w: World) => ['holdout', 'seal', '--specs', w.specDir, '--out', w.out];
  single({
    family,
    cmd: 'holdout seal',
    slug: 'specs-missing',
    tier: 1,
    component: HOLDOUT_CMD,
    title: `holdout seal of a --specs folder that does not exist exits 2 and writes nothing (${holdDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['holdout', 'seal', '--specs', join(w.dir, 'none'), '--out', w.out],
  });
  numberRow(
    { family, cmd: 'holdout seal', component: HOLDOUT_CMD },
    '--share',
    { text: [2], negative: [2], huge: [2] },
    (w, v) => [...seal(w), '--share', v],
    holdDoc,
  );
  numberRow(
    { family, cmd: 'holdout seal', component: HOLDOUT_CMD },
    '--seed',
    { text: [2] },
    (w, v) => [...seal(w), '--seed', v],
    holdDoc,
  );
  single({
    family,
    cmd: 'holdout score',
    slug: 'sealed-missing',
    tier: 1,
    component: HOLDOUT_CMD,
    title: `holdout score of a --sealed folder that does not exist exits 2 (${holdDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['holdout', 'score', '--sealed', join(w.dir, 'none'), '--target', 'function:acme-sales'],
  });

  const famDoc =
    'cli.md "driftbench family": instances exit 2 bad input: an invalid family, a bad number, an earlier output without --force';
  const inst = (w: World) => ['family', 'instances', w.r(FAMILY), '--seed', '1', '--out', w.out];
  const fBase = { family, cmd: 'family instances', component: FAMILY_CMD };
  single({
    family,
    cmd: 'family instances',
    slug: 'family-missing',
    tier: 1,
    component: FAMILY_CMD,
    title: `family instances of a family folder that does not exist exits 2 and writes nothing (${famDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['family', 'instances', join(w.dir, 'no-family'), '--n', '1', '--seed', '1', '--out', w.out],
  });
  numberRow(
    fBase,
    '--n',
    { text: [2], zero: [2], negative: [2], empty: [2] },
    (w, v) => [...inst(w), '--n', v],
    `${famDoc}; "--n <n> how many instances, at least 1"`,
  );
  numberRow(
    fBase,
    '--seed',
    { text: [2], empty: [2] },
    (w, v) => ['family', 'instances', w.r(FAMILY), '--n', '1', '--seed', v, '--out', w.out],
    `${famDoc}; "--seed <s> the integer seed"`,
  );
  single({
    family,
    cmd: 'family verify',
    slug: 'dir-missing',
    tier: 1,
    component: FAMILY_CMD,
    title:
      'family verify of a folder that does not exist exits 2 (cli.md: verify exit 2 "no spec under the folder")',
    want: [2],
    refusal: true,
    argv: (w) => ['family', 'verify', join(w.dir, 'none'), '--reference', 'process:acme-ops'],
  });
  numberRow(
    { family, cmd: 'family verify', component: FAMILY_CMD },
    '--concurrency',
    { zero: [2], text: [2] },
    (w, v) => ['family', 'verify', w.specDir, '--reference', 'process:acme-ops', '--concurrency', v],
    'cli.md: verify exit 2 "a bad number"',
  );

  const pilotDoc = 'cli.md "driftbench pilot": exit 2 bad input';
  const pplan = (w: World) => ['pilot', 'plan', '--map', w.r(APPROVED), '--suite', w.r(GENERATED)];
  const pBase = { family, cmd: 'pilot plan', component: PILOT_CMD };
  fileRow(
    pBase,
    '--map',
    '.yaml',
    { missing: 2, garbage: 2 },
    (w, value) => ['pilot', 'plan', '--map', value, '--suite', w.r(GENERATED)],
    pilotDoc,
  );
  single({
    family,
    cmd: 'pilot plan',
    slug: 'suite-missing',
    tier: 1,
    component: PILOT_CMD,
    title: `pilot plan with a --suite folder that does not exist exits 2 (${pilotDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['pilot', 'plan', '--map', w.r(APPROVED), '--suite', join(w.dir, 'none')],
  });
  numberRow(
    pBase,
    '--conversations',
    { text: [2], zero: [2], negative: [2] },
    (w, v) => [...pplan(w), '--conversations', v],
    pilotDoc,
  );
  numberRow(pBase, '--repeats', { text: [2], empty: [2] }, (w, v) => [...pplan(w), '--repeats', v], pilotDoc);
  numberRow(pBase, '--wordings', { zero: [2] }, (w, v) => [...pplan(w), '--wordings', v], pilotDoc);
  for (const [slug, tier, words, value] of [
    ['store-missing', 3, 'a store file that does not exist', (w: World) => join(w.dir, 'none.db')],
    ['store-not-db', 4, 'a store that is not a database', (w: World) => w.notDb],
  ] as const) {
    single({
      family,
      cmd: 'pilot analyse',
      slug,
      tier,
      component: PILOT_CMD,
      title: `pilot analyse of ${words} exits 2 and writes no report and no store (cli.md: analyse exit 2 "bad input, or a store without that pilot")`,
      want: [2],
      refusal: true,
      argv: (w) => ['pilot', 'analyse', '--store', value(w), '--out', w.out],
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Family exits-readers: judge, import, intake, replay, estate, validate, view.

{
  const family = 'exits-readers';
  const judgeDoc = 'cli.md "driftbench judge": exit 2 bad input; check: the folder cannot be read';
  for (const [slug, tier, words, value] of [
    ['criteria-missing', 1, 'a folder that does not exist', (w: World) => join(w.dir, 'none')],
    ['criteria-is-file', 2, 'a file where the criteria folder is expected', (w: World) => w.aFile],
  ] as const) {
    single({
      family,
      cmd: 'judge check',
      slug,
      tier,
      component: JUDGE_CMD,
      title: `judge check of ${words} exits 2 (${judgeDoc})`,
      want: [2],
      refusal: true,
      argv: (w) => ['judge', 'check', value(w)],
    });
  }
  const jr = (w: World, cassette: string) => [
    'judge',
    'run',
    '--criteria',
    w.r(CRITERIA),
    '--cassette',
    cassette,
  ];
  fileRow(
    { family, cmd: 'judge run', component: JUDGE_CMD },
    '--cassette',
    '.json',
    { missing: 2, garbage: 2, empty: 2, wrong: 2 },
    (w, value) => jr(w, value),
    judgeDoc,
  );
  single({
    family,
    cmd: 'judge run',
    slug: 'criteria-missing',
    tier: 1,
    component: JUDGE_CMD,
    title: `judge run with a --criteria folder that does not exist exits 2 (${judgeDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['judge', 'run', '--criteria', join(w.dir, 'none'), '--cassette', w.r(CASSETTE)],
  });
  single({
    family,
    cmd: 'judge run',
    slug: 'mode-unknown',
    tier: 2,
    component: JUDGE_CMD,
    title: `judge run with an unknown --mode exits 2 (${judgeDoc}; modes system1, hybrid, llm)`,
    want: [2],
    refusal: true,
    argv: (w) => [...jr(w, w.r(CASSETTE)), '--mode', 'system9'],
  });
  numberRow(
    { family, cmd: 'judge calibrate', component: JUDGE_CMD },
    '--repeats',
    { text: [2], zero: [2] },
    (w, v) => [
      'judge',
      'calibrate',
      '--criteria',
      w.r(CRITERIA),
      '--labels',
      w.r('examples/acme/labels'),
      '--cassette',
      w.r(CASSETTE),
      '--out',
      join(w.dir, 'table.yaml'),
      '--repeats',
      v,
    ],
    judgeDoc,
  );

  const impDoc =
    'cli.md "driftbench import": exit 2 bad input: the mapping, the file, a column the table lacks';
  const imp = (w: World, file: string, mapping: string) => [
    'import',
    'csv',
    file,
    '--mapping',
    mapping,
    '--out',
    w.out,
  ];
  single({
    family,
    cmd: 'import csv',
    slug: 'file-missing',
    tier: 1,
    component: IMPORT_CMD,
    title: `import csv of a file that does not exist exits 2 and writes nothing (${impDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => imp(w, w.missing('.csv'), w.r(MAPPING)),
  });
  fileRow(
    { family, cmd: 'import csv', component: IMPORT_CMD },
    '--mapping',
    '.yaml',
    { missing: 2, empty: 2, garbage: 2, wrong: 2 },
    (w, value) => imp(w, w.r(CSV), value),
    impDoc,
  );
  single({
    family,
    cmd: 'import csv',
    slug: 'no-out',
    tier: 1,
    component: MAIN,
    title: 'import csv without --out exits 2 (cli.md "Running it": a missing option always exits 2)',
    want: [2],
    refusal: true,
    argv: (w) => ['import', 'csv', w.r(CSV), '--mapping', w.r(MAPPING)],
  });
  single({
    family,
    cmd: 'import csv',
    slug: 'written',
    tier: 1,
    component: IMPORT_CMD,
    title: `import csv of the Acme cases exits 0 (${impDoc}; "0 every spec is written")`,
    want: [0],
    refusal: false,
    argv: (w) => imp(w, w.r(CSV), w.r(MAPPING)),
  });
  const trDoc =
    'cli.md "driftbench import traces": exit 2 bad input, nothing written: no --from or --out, an unreadable path, no trace found';
  for (const [slug, tier, words, argv] of [
    [
      'path-missing',
      1,
      'a path that does not exist',
      (w: World) => ['import', 'traces', w.missing('.jsonl'), '--from', 'otel', '--out', w.out],
    ],
    ['no-from', 1, 'no --from', (w: World) => ['import', 'traces', w.put('t.jsonl', '{}\n'), '--out', w.out]],
    [
      'from-unknown',
      2,
      'an unknown --from',
      (w: World) => [
        'import',
        'traces',
        w.put('t.jsonl', '{}\n'),
        '--from',
        'carrier-pigeon',
        '--out',
        w.out,
      ],
    ],
    [
      'empty-folder',
      2,
      'a folder with no trace',
      (w: World) => ['import', 'traces', w.folder, '--from', 'otel', '--out', w.out],
    ],
  ] as const) {
    single({
      family,
      cmd: 'import traces',
      slug,
      tier,
      component: TRACES_CMD,
      title: `import traces with ${words} exits 2 and writes nothing (${trDoc})`,
      want: [2],
      refusal: true,
      argv,
    });
  }

  const inDoc = 'cli.md "driftbench intake": exit 2 usage or input error';
  single({
    family,
    cmd: 'intake approve',
    slug: 'file-missing',
    tier: 1,
    component: INTAKE_CMD,
    title:
      'intake approve of a file that does not exist exits 2 (cli.md: approve exit 2 "the file is not found")',
    want: [2],
    refusal: true,
    argv: (w) => ['intake', 'approve', w.missing()],
  });
  const fid = (w: World) =>
    w.put('cand.jsonl', `${JSON.stringify({ text: `Hello, I want fiber ${w.seed}`, cell: {} })}\n`);
  single({
    family,
    cmd: 'intake fidelity',
    slug: 'reference-missing',
    tier: 1,
    component: INTAKE_CMD,
    title: `intake fidelity with a --reference that does not exist exits 2 (${inDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['intake', 'fidelity', '--reference', join(w.dir, 'none'), '--candidate', fid(w)],
  });
  single({
    family,
    cmd: 'intake fidelity',
    slug: 'candidate-missing',
    tier: 1,
    component: INTAKE_CMD,
    title: `intake fidelity with a --candidate that does not exist exits 2 (${inDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['intake', 'fidelity', '--reference', w.r(REFERENCE), '--candidate', w.missing('.jsonl')],
  });
  numberRow(
    { family, cmd: 'intake fidelity', component: INTAKE_CMD },
    '--threshold',
    { text: [2], negative: [2] },
    (w, v) => ['intake', 'fidelity', '--reference', w.r(REFERENCE), '--candidate', fid(w), '--threshold', v],
    inDoc,
  );
  single({
    family,
    cmd: 'intake interview',
    slug: 'map-missing',
    tier: 1,
    component: INTAKE_CMD,
    title: `intake interview with a --map that does not exist exits 2 and writes nothing (${inDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['intake', 'interview', '--map', w.missing(), '--out', join(w.dir, 'q.yaml')],
  });

  const repDoc =
    'cli.md "driftbench replay": exit 2 bad input: an unreadable session or a file that is not a transcript, an unreadable owner file, an invalid spec, a store that cannot be opened';
  const session = (w: World) => w.r(`${SESSIONS}/clean-build.jsonl`);
  const suite = (w: World) => w.r(`${SESSIONS}/specs`);
  for (const [slug, tier, words, argv] of [
    [
      'session-missing',
      1,
      'a session file that does not exist',
      (w: World) => ['replay', w.missing('.jsonl'), '--suite', suite(w)],
    ],
    [
      'session-folder',
      2,
      'a folder given as a session',
      (w: World) => ['replay', w.folder, '--suite', suite(w)],
    ],
    [
      'session-garbage',
      3,
      'a file that is not a transcript',
      (w: World) => ['replay', w.garbage('.jsonl'), '--suite', suite(w)],
    ],
    [
      'suite-missing',
      1,
      'a --suite that does not exist',
      (w: World) => ['replay', session(w), '--suite', join(w.dir, 'none')],
    ],
    [
      'store-not-db',
      4,
      'a store that is not a database',
      (w: World) => ['replay', session(w), '--suite', suite(w), '--store', w.notDb],
    ],
    [
      'owner-file-missing',
      2,
      'an owner file that does not exist',
      (w: World) => ['replay', session(w), '--suite', suite(w), '--owner-file', w.missing('.txt')],
    ],
  ] as const) {
    single({
      family,
      cmd: 'replay',
      slug,
      tier,
      component: REPLAY_CMD,
      title: `replay with ${words} exits 2 (${repDoc})`,
      want: [2],
      refusal: true,
      argv,
    });
  }

  const esDoc =
    'cli.md "driftbench estate": exit 2 usage or input error, nothing written: a missing file or option';
  for (const [cmd, slug, component, argv] of [
    ['estate lint', 'map-missing', ESTATE_CMD, (w: World) => ['estate', 'lint', w.missing()]],
    ['estate approve', 'map-missing', ESTATE_CMD, (w: World) => ['estate', 'approve', w.missing()]],
    [
      'estate map',
      'map-missing',
      ESTATE_CMD,
      (w: World) => ['estate', 'map', w.missing(), '--to', join(w.dir, 'space.yaml')],
    ],
    [
      'estate scan',
      'root-missing',
      ESTATE_CMD,
      (w: World) => [
        'estate',
        'scan',
        join(w.dir, 'no-estate'),
        '--no-model',
        '--out',
        join(w.dir, 'map.yaml'),
      ],
    ],
    [
      'estate plan',
      'map-missing',
      ESTATE_PLAN_CMD,
      (w: World) => ['estate', 'plan', w.missing(), '--out', join(w.dir, 'plan.yaml')],
    ],
    [
      'estate diff',
      'old-missing',
      ESTATE_MAINTAIN_CMD,
      (w: World) => ['estate', 'diff', w.missing(), w.r(ESTATE_MAP)],
    ],
  ] as const) {
    single({
      family,
      cmd,
      slug,
      tier: 1,
      component,
      title: `${cmd} of a file that does not exist exits 2 and writes nothing (${esDoc})`,
      want: [2],
      refusal: true,
      argv,
    });
  }
  numberRow(
    { family, cmd: 'estate scan', component: ESTATE_CMD },
    '--ceiling',
    { text: [2], negative: [2], zero: [2] },
    (w, v) => ['estate', 'scan', w.r(ESTATE), '--no-model', '--out', join(w.dir, 'map.yaml'), '--ceiling', v],
    esDoc,
  );
  numberRow(
    { family, cmd: 'estate lint', component: ESTATE_CMD },
    '--ceiling',
    { text: [2] },
    (w, v) => ['estate', 'lint', w.r(ESTATE_MAP), '--ceiling', v],
    esDoc,
  );
  single({
    family,
    cmd: 'estate scan',
    slug: 'out-exists',
    tier: 2,
    component: ESTATE_CMD,
    title: `estate scan onto a map that exists without --force exits 2 and leaves it as it was (${esDoc}; "a target that exists without --force")`,
    want: [2],
    refusal: true,
    argv: (w) => ['estate', 'scan', w.r(ESTATE), '--no-model', '--out', w.aFile],
  });

  const valDoc =
    'cli.md "driftbench validate": "64 an input error: an unknown component, a bad seed, an unreadable file"';
  numberRow(
    { family, cmd: 'validate', component: VALIDATE_CMD },
    '--seed',
    { text: [64], negative: [64], empty: [64] },
    (_w, v) => ['validate', 'stats', '--seed', v],
    valDoc,
  );
  single({
    family,
    cmd: 'validate',
    slug: 'seeds-empty',
    tier: 4,
    component: VALIDATE_CMD,
    title: `validate with an empty --seeds exits 64 (${valDoc})`,
    want: [64],
    refusal: true,
    argv: () => ['validate', 'stats', '--seeds', ''],
  });
  single({
    family,
    cmd: 'validate',
    slug: 'unknown-option',
    tier: 1,
    component: MAIN,
    title:
      'validate with an unknown option exits 2 (cli.md: "An option error the argument parser reports ... exits 2, as for every command")',
    want: [2],
    refusal: true,
    argv: () => ['validate', 'stats', '--sed', '1'],
  });

  const viewDoc =
    'cli.md "driftbench view": "2 when the store is missing, the port is not a number, or the port cannot be opened"';
  single({
    family,
    cmd: 'view',
    slug: 'store-missing',
    tier: 3,
    component: VIEW_CMD,
    title: `view of a store file that does not exist exits 2 and writes no store (${viewDoc})`,
    want: [2],
    refusal: true,
    child: true,
    limitMs: VIEW_LIMIT_MS,
    argv: (w) => ['view', '--store', join(w.dir, 'none.db'), '--port', '0'],
  });
  single({
    family,
    cmd: 'view',
    slug: 'port-text',
    tier: 2,
    component: VIEW_CMD,
    title: `view with a --port that is not a number exits 2 (${viewDoc})`,
    want: [2],
    refusal: true,
    child: true,
    limitMs: VIEW_LIMIT_MS,
    argv: (w) => ['view', '--store', w.notDb, '--port', `port${w.seed % 5}`],
  });
  // A store that exists, so only the port decides. An empty --port is not a number; a port above 65535 cannot
  // be opened. A view that does not refuse serves until it is stopped, so its item fails on the time limit.
  const viewStore = async (w: World) => storeCampaign(w);
  for (const [slug, tier, words, value] of [
    ['port-empty', 4, 'an empty --port', () => ''],
    ['port-huge', 5, 'a huge --port', (w: World) => numberText('huge', w.seed)],
  ] as const) {
    single({
      family,
      cmd: 'view',
      slug,
      tier,
      component: VIEW_CMD,
      title: `view with ${words} exits 2 and serves nothing (${viewDoc})`,
      want: [2],
      refusal: true,
      child: true,
      limitMs: VIEW_LIMIT_MS,
      setup: viewStore,
      argv: (w) => [
        'view',
        '--store',
        join(w.dir, 'runs.db'),
        '--port',
        value(w),
        '--labels',
        join(w.dir, 'labels'),
      ],
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Output paths of the wrong kind, and empty numbers whose minimum is 0, across the families above. A folder
// where an output file is expected, and a file where an output folder is expected, are bad input: exit 2
// with a message, nothing written. An empty string is not a number (running.md: "a bad number for an
// option" is bad input), even where 0 is allowed.

{
  const outFile = (
    family: string,
    cmd: string,
    component: string,
    doc: string,
    argv: (w: World, out: string) => string[],
    setup?: (w: World) => Promise<string | undefined>,
  ) =>
    single({
      family,
      cmd,
      slug: 'out-is-folder',
      tier: 3,
      component,
      title: `${cmd} with a folder where its output file is expected exits 2 and writes nothing (${doc})`,
      want: [2],
      refusal: true,
      ...(setup ? { setup } : {}),
      argv: (w) => argv(w, w.folder),
    });
  const outDir = (
    family: string,
    cmd: string,
    component: string,
    doc: string,
    argv: (w: World, out: string) => string[],
    setup?: (w: World) => Promise<string | undefined>,
  ) =>
    single({
      family,
      cmd,
      slug: 'out-is-file',
      tier: 3,
      component,
      title: `${cmd} with a file where its output folder is expected exits 2 and leaves the file as it was (${doc})`,
      want: [2],
      refusal: true,
      ...(setup ? { setup } : {}),
      argv: (w) => argv(w, w.aFile),
    });

  outFile(
    'exits-generate',
    'extract',
    EXTRACT_CMD,
    'cli.md "driftbench extract": exit 2 usage or input error; nothing is written',
    (w, out) => [
      'extract',
      '--prompt',
      w.put('prompt.md', `You are the Acme assistant ${w.seed}.\n`),
      '--inventory',
      w.r(INVENTORY),
      '--out',
      out,
      '--no-model',
    ],
  );
  outFile(
    'exits-space',
    'space declare',
    SPACE_CMD,
    'cli.md: exit 2 "a declare target that exists"',
    (w, out) => ['space', 'declare', w.r(ACME_SPECS), '--inventory', w.r(INVENTORY), '--out', out],
  );
  outDir(
    'exits-campaign',
    'campaign export',
    CAMPAIGN_CMD,
    'cli.md: export "2 bad input"',
    (w, out) => ['campaign', 'export', `c-${w.seed}`, '--store', join(w.dir, 'runs.db'), '--out', out],
    storeCampaign,
  );
  outFile(
    'exits-verdict',
    'report',
    REPORT_CMD,
    'cli.md: report "Exit 0 when written, 2 on bad input"',
    (w, out) => ['report', `c-${w.seed}`, '--store', join(w.dir, 'runs.db'), '--out', out],
    storeCampaign,
  );
  outFile(
    'exits-verdict',
    'ci',
    CI_CMD,
    'cli.md "driftbench ci": the summary goes to --out; exit 2 on bad input',
    (w, out) => [
      'ci',
      '--specs',
      w.spec,
      '--target',
      TARGET,
      '--baseline',
      `c-${w.seed}`,
      '--store',
      join(w.dir, 'runs.db'),
      '--out',
      out,
    ],
    storeCampaign,
  );
  single({
    family: 'exits-verdict',
    cmd: 'report',
    slug: 'max-runs-empty',
    tier: 4,
    component: REPORT_CMD,
    title:
      'report with an empty --max-runs exits 2 and writes no scorecard (cli.md: report "2 on bad input"; an empty string is not a number)',
    want: [2],
    refusal: true,
    setup: storeCampaign,
    argv: (w) => [
      'report',
      `c-${w.seed}`,
      '--store',
      join(w.dir, 'runs.db'),
      '--out',
      join(w.dir, 'card.html'),
      '--max-runs',
      '',
    ],
  });
  outDir(
    'exits-suite',
    'gate',
    GATE_CMD,
    'cli.md "driftbench gate": exit 2 usage or input error, nothing written',
    (w, out) => [
      'gate',
      w.specDir,
      '--reference',
      'function:acme-sales',
      '--faults',
      w.r(FAULTS),
      '--out',
      out,
      '--date',
      '2026-10-11',
    ],
  );
  outDir(
    'exits-suite',
    'select',
    SELECT_CMD,
    'cli.md "driftbench select": "2 on a usage or input error"',
    (w, out) => ['select', '--cover', w.r(SPACE_MAP), '--specs', w.r(GATED), '--out', out, '--k', '3'],
  );
  outDir('exits-suite', 'holdout seal', HOLDOUT_CMD, 'cli.md: seal "2 on bad input"', (w, out) => [
    'holdout',
    'seal',
    '--specs',
    w.specDir,
    '--out',
    out,
  ]);
  outDir(
    'exits-suite',
    'family instances',
    FAMILY_CMD,
    'cli.md "driftbench family": instances exit 2 bad input',
    (w, out) => ['family', 'instances', w.r(FAMILY), '--n', '1', '--seed', '1', '--out', out],
  );
  outDir(
    'exits-readers',
    'import csv',
    IMPORT_CMD,
    'cli.md "driftbench import": exit 2 bad input',
    (w, out) => ['import', 'csv', w.r(CSV), '--mapping', w.r(MAPPING), '--out', out],
  );
  outDir(
    'exits-readers',
    'import traces',
    TRACES_CMD,
    'cli.md "driftbench import traces": exit 2 bad input, nothing written',
    (w, out) => [
      'import',
      'traces',
      w.r(`${SESSIONS}/clean-build.jsonl`),
      '--from',
      'claude-code',
      '--out',
      out,
    ],
  );
  outFile(
    'exits-readers',
    'intake interview',
    INTAKE_CMD,
    'cli.md "driftbench intake": interview exit 2 usage or input error',
    (w, out) => ['intake', 'interview', '--map', w.r(APPROVED), '--out', out],
  );
  outFile(
    'exits-readers',
    'judge calibrate',
    JUDGE_CMD,
    'cli.md "driftbench judge": calibrate exit 2 bad input',
    (w, out) => [
      'judge',
      'calibrate',
      '--criteria',
      w.r(CRITERIA),
      '--labels',
      w.r('examples/acme/labels'),
      '--cassette',
      w.r(CASSETTE),
      '--out',
      out,
    ],
  );
  outFile(
    'exits-readers',
    'estate scan',
    ESTATE_CMD,
    'cli.md "driftbench estate": exit 2 usage or input error, nothing written',
    (w, out) => ['estate', 'scan', w.r(ESTATE), '--no-model', '--out', out],
  );
  single({
    family: 'exits-readers',
    cmd: 'intake fidelity',
    slug: 'threshold-empty',
    tier: 4,
    component: INTAKE_CMD,
    title:
      'intake fidelity with an empty --threshold exits 2 (cli.md: fidelity exit 2 "usage or input error"; an empty string is not a number)',
    want: [2],
    refusal: true,
    argv: (w) => [
      'intake',
      'fidelity',
      '--reference',
      w.r(REFERENCE),
      '--candidate',
      w.put('cand.jsonl', `${JSON.stringify({ text: `Hello, I want fiber ${w.seed}`, cell: {} })}\n`),
      '--threshold',
      '',
    ],
  });
  single({
    family: 'exits-readers',
    cmd: 'intake from-interview',
    slug: 'turns-empty',
    tier: 4,
    component: INTAKE_CMD,
    title:
      'intake from-interview --dry-run with an empty --turns exits 2 (cli.md: from-interview exit 2 "usage or input error"; an empty string is not a number)',
    want: [2],
    refusal: true,
    argv: (w) => [
      'intake',
      'from-interview',
      w.r(`${REFERENCE}/answers.yaml`),
      '--map',
      w.r(APPROVED),
      '--out',
      w.out,
      '--dry-run',
      '--turns',
      '',
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------
// Family exits-users: perturb, simulate, attack (the commands that drive a user against one spec).

{
  const family = 'exits-users';
  const PERTURB_CMD = `${C}perturb.ts`;
  const SIMULATE_CMD = `${C}simulate.ts`;
  const ATTACK_CMD = `${C}attack.ts`;
  const PERSONA = 'examples/acme/personas/sam-upgrader.yaml';
  const RECORDING = 'examples/acme/personas/recordings/sam-upgrader.yaml';
  const REDTEAM = 'examples/acme/redteam';
  const pDoc = 'cli.md "driftbench perturb": "2 on bad input (nothing ran)"';
  const perturb = (w: World) => [
    'perturb',
    w.r(PLAN_UPGRADE),
    '--class',
    'D2_goal_shift',
    '--pack',
    w.r(REDTEAM),
  ];
  const pBase = { family, cmd: 'perturb', component: PERTURB_CMD };
  fileRow(
    pBase,
    'spec',
    '.yaml',
    { missing: 2, garbage: 2 },
    (w, value) => ['perturb', value, '--class', 'D2_goal_shift', '--at', '2', '--pack', w.r(REDTEAM)],
    pDoc,
  );
  numberRow(
    pBase,
    '--at',
    { text: [2], negative: [2], empty: [2], huge: [2] },
    (w, v) => [...perturb(w), '--at', v],
    `${pDoc}; "--at <n> the block the deviation goes in before, counting from 0"`,
  );
  numberRow(
    pBase,
    '--seed',
    { text: [2], negative: [2] },
    (w, v) => [...perturb(w), '--at', '2', '--seed', v],
    pDoc,
  );
  for (const [slug, tier, words, argv] of [
    [
      'class-unknown',
      2,
      'an unknown --class',
      (w: World) => [
        'perturb',
        w.r(PLAN_UPGRADE),
        '--class',
        `D${40 + (w.seed % 9)}`,
        '--at',
        '1',
        '--pack',
        w.r(REDTEAM),
      ],
    ],
    [
      'no-deviation',
      1,
      'neither --class and --at nor --perturbation',
      (w: World) => ['perturb', w.r(PLAN_UPGRADE)],
    ],
    [
      'perturbation-unknown',
      2,
      'a --perturbation the spec does not declare',
      (w: World) => ['perturb', w.r(PLAN_UPGRADE), '--perturbation', `nobody-${w.seed}`],
    ],
    [
      'pack-missing',
      2,
      'a --pack folder that does not exist',
      (w: World) => [
        'perturb',
        w.r(PLAN_UPGRADE),
        '--class',
        'D1_off_topic',
        '--at',
        '1',
        '--pack',
        join(w.dir, 'no-pack'),
      ],
    ],
  ] as const) {
    single({
      family,
      cmd: 'perturb',
      slug,
      tier,
      component: PERTURB_CMD,
      title: `perturb with ${words} exits 2 (${pDoc})`,
      want: [2],
      refusal: true,
      argv,
    });
  }
  single({
    family,
    cmd: 'perturb',
    slug: 'recovers',
    tier: 1,
    component: PERTURB_CMD,
    title:
      'perturb of the Acme plan upgrade with D2_goal_shift at block 2 exits 0 (cli.md: the example prints "(exit 0)")',
    want: [0],
    refusal: false,
    argv: (w) => [...perturb(w), '--at', '2'],
  });

  const sDoc =
    'simulated-user.md: simulate exit 2 "bad input, nothing ran: no source or both, a bad persona, a bad number"';
  const sim = (w: World) => [
    'simulate',
    w.r(PLAN_UPGRADE),
    '--persona',
    w.r(PERSONA),
    '--recording',
    w.r(RECORDING),
  ];
  const sBase = { family, cmd: 'simulate', component: SIMULATE_CMD };
  fileRow(
    sBase,
    '--persona',
    '.yaml',
    { missing: 2, empty: 2, garbage: 2, wrong: 2 },
    (w, value) => ['simulate', w.r(PLAN_UPGRADE), '--persona', value, '--recording', w.r(RECORDING)],
    sDoc,
  );
  numberRow(
    sBase,
    '--turns',
    { text: [2], zero: [2], negative: [2], empty: [2] },
    (w, v) => [...sim(w), '--turns', v],
    sDoc,
  );
  single({
    family,
    cmd: 'simulate',
    slug: 'no-source',
    tier: 2,
    component: SIMULATE_CMD,
    title: `simulate with neither --model nor --recording exits 2 (${sDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['simulate', w.r(PLAN_UPGRADE), '--persona', w.r(PERSONA)],
  });
  single({
    family,
    cmd: 'simulate',
    slug: 'both-sources',
    tier: 3,
    component: SIMULATE_CMD,
    title: `simulate with both --model and --recording exits 2 (${sDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => [...sim(w), '--model'],
  });
  fileRow(
    sBase,
    '--recording',
    '.yaml',
    { missing: 2, garbage: 2 },
    (w, value) => ['simulate', w.r(PLAN_UPGRADE), '--persona', w.r(PERSONA), '--recording', value],
    sDoc,
  );
  single({
    family,
    cmd: 'simulate',
    slug: 'recorded-pass',
    tier: 1,
    component: SIMULATE_CMD,
    title:
      'simulate of the Acme plan upgrade with the recorded Sam exits 0 (simulated-user.md: "0 the run completed and every block passes"; the example passes 5 of 5)',
    want: [0],
    refusal: false,
    argv: sim,
  });

  const aDoc =
    'attack.md: exit 2 "bad input, nothing ran: a bad number, an unreadable or foreign recording, no pack"';
  const attack = (w: World) => ['attack', w.r(PLAN_UPGRADE), '--pack', w.r(REDTEAM)];
  const aBase = { family, cmd: 'attack', component: ATTACK_CMD };
  numberRow(
    aBase,
    '--rounds',
    { text: [2], zero: [2], empty: [2], huge: [2] },
    (w, v) => [...attack(w), '--rounds', v],
    `${aDoc}; "--rounds <n> the most attacks, one class each, 1 to 10"`,
  );
  numberRow(
    aBase,
    '--seed',
    { text: [2], negative: [2], empty: [2] },
    (w, v) => [...attack(w), '--seed', v],
    aDoc,
  );
  fileRow(
    aBase,
    '--replay',
    '.json',
    { missing: 2, garbage: 2, wrong: 2 },
    (w, value) => [...attack(w), '--replay', value],
    aDoc,
  );
  single({
    family,
    cmd: 'attack',
    slug: 'pack-empty',
    tier: 2,
    component: ATTACK_CMD,
    title: `attack with an empty --pack folder exits 2 (${aDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['attack', w.r(PLAN_UPGRADE), '--pack', w.folder],
  });
}

// ---------------------------------------------------------------------------------------------------------
// More of exits-readers and exits-verdict: estate static, generate, mutate, run, impact; queue.

{
  const family = 'exits-readers';
  const ESTATE_GEN_CMD = `${C}estate-generate.ts`;
  const ESTATE_STATIC_CMD = `${C}estate-static.ts`;
  const ESTATE_LIVE_CMD = `${C}estate-live.ts`;
  const STATIC = `${ESTATE}/generated/static`;
  const esDoc =
    'cli.md "driftbench estate": estate static "2 usage or input error"; exit 2 usage or input error, nothing written: a missing file or option';
  single({
    family,
    cmd: 'estate static',
    slug: 'tests-missing',
    tier: 1,
    component: ESTATE_STATIC_CMD,
    title: `estate static of a test path that does not exist exits 2 (${esDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['estate', 'static', join(w.dir, 'none'), '--estate', w.r(ESTATE)],
  });
  single({
    family,
    cmd: 'estate static',
    slug: 'estate-missing',
    tier: 1,
    component: ESTATE_STATIC_CMD,
    title: `estate static against an estate root that does not exist exits 2 (${esDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['estate', 'static', w.r(STATIC), '--estate', join(w.dir, 'no-estate')],
  });
  numberRow(
    { family, cmd: 'estate static', component: ESTATE_STATIC_CMD },
    '--ceiling',
    { text: [2], empty: [2] },
    (w, v) => ['estate', 'static', w.r(STATIC), '--estate', w.r(ESTATE), '--ceiling', v],
    esDoc,
  );
  const egen = (w: World, map: string, plan: string) => [
    'estate',
    'generate',
    '--map',
    map,
    '--plan',
    plan,
    '--out',
    w.out,
  ];
  single({
    family,
    cmd: 'estate generate',
    slug: 'map-missing',
    tier: 1,
    component: ESTATE_GEN_CMD,
    title: `estate generate with a --map that does not exist exits 2 and writes nothing (${esDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => egen(w, w.missing(), w.r(`${ESTATE}/plan.yaml`)),
  });
  single({
    family,
    cmd: 'estate generate',
    slug: 'plan-missing',
    tier: 1,
    component: ESTATE_GEN_CMD,
    title: `estate generate with a --plan that does not exist exits 2 and writes nothing (${esDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => egen(w, w.r(ESTATE_MAP), w.missing()),
  });
  numberRow(
    { family, cmd: 'estate generate', component: ESTATE_GEN_CMD },
    '--seed',
    { text: [2], negative: [2], empty: [2] },
    (w, v) => [...egen(w, w.r(ESTATE_MAP), w.r(`${ESTATE}/plan.yaml`)), '--seed', v],
    esDoc,
  );
  const mDoc =
    'cli.md "driftbench estate run and driftbench estate mutate": mutate "2 on a usage or input error (nothing is written)"';
  const mutate = (w: World) => ['estate', 'mutate', w.r(ESTATE_MAP), '--to', w.out];
  for (const [slug, tier, words, argv] of [
    [
      'atom-unknown',
      2,
      'an --atom the map does not hold',
      (w: World) => [...mutate(w), '--atom', `gate.nobody-${w.seed}`, '--delete'],
    ],
    [
      'both-forms',
      3,
      'both --delete and --invert',
      (w: World) => [
        ...mutate(w),
        '--atom',
        'gate.standing.read-a-file-before-editing-it',
        '--delete',
        '--invert',
      ],
    ],
    [
      'no-form',
      2,
      'neither --delete nor --invert',
      (w: World) => [...mutate(w), '--atom', 'gate.standing.read-a-file-before-editing-it'],
    ],
    [
      'map-missing',
      1,
      'a map that does not exist',
      (w: World) => ['estate', 'mutate', w.missing(), '--to', w.out, '--atom', 'gate.x', '--delete'],
    ],
  ] as const) {
    single({
      family,
      cmd: 'estate mutate',
      slug,
      tier,
      component: ESTATE_LIVE_CMD,
      title: `estate mutate with ${words} exits 2 and writes nothing (${mDoc})`,
      want: [2],
      refusal: true,
      argv,
    });
  }
  const rDoc = 'cli.md: estate run "2 on a usage or input error (nothing runs)"';
  const erun = (w: World) => [
    'estate',
    'run',
    w.spec,
    '--estate',
    w.r(ESTATE),
    '--runtime',
    'claude-code',
    '--store',
    join(w.dir, 'live.db'),
    '--command',
    w.r(`${ESTATE}/live/fake/claude.mjs`),
  ];
  const rBase = { family, cmd: 'estate run', component: ESTATE_LIVE_CMD };
  numberRow(
    rBase,
    '--timeout',
    { text: [2], zero: [2], negative: [2] },
    (w, v) => [...erun(w), '--timeout', v],
    rDoc,
  );
  numberRow(rBase, '--max-turns', { zero: [2], empty: [2] }, (w, v) => [...erun(w), '--max-turns', v], rDoc);
  numberRow(
    rBase,
    '--max-budget-usd',
    { negative: [2], text: [2] },
    (w, v) => [...erun(w), '--max-budget-usd', v],
    rDoc,
  );
  single({
    family,
    cmd: 'estate run',
    slug: 'runtime-unknown',
    tier: 2,
    component: ESTATE_LIVE_CMD,
    title: `estate run with an unknown --runtime exits 2 and writes no store (${rDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => [
      'estate',
      'run',
      w.spec,
      '--estate',
      w.r(ESTATE),
      '--runtime',
      'abacus',
      '--store',
      join(w.dir, 'live.db'),
    ],
  });
  single({
    family,
    cmd: 'estate impact',
    slug: 'diff-missing',
    tier: 1,
    component: ESTATE_MAINTAIN_CMD,
    title: `estate impact of a diff file that does not exist exits 2 (${esDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['estate', 'impact', w.missing('.json'), '--tests', w.r(`${ESTATE}/generated/specs`)],
  });
  single({
    family,
    cmd: 'estate impact',
    slug: 'diff-garbage',
    tier: 3,
    component: ESTATE_MAINTAIN_CMD,
    title: `estate impact of a diff file that is not JSON exits 2 (${esDoc})`,
    want: [2],
    refusal: true,
    argv: (w) => ['estate', 'impact', w.garbage('.json'), '--tests', w.r(`${ESTATE}/generated/specs`)],
  });

  const QUEUE_CMD = `${C}queue.ts`;
  const qDoc =
    'cli.md "Running it": exit 2 on a usage or input error; queue create reads the campaign of --store';
  for (const [slug, tier, words, value] of [
    ['store-missing', 3, 'a store file that does not exist', (w: World) => join(w.dir, 'none.db')],
    ['store-not-db', 4, 'a store that is not a database', (w: World) => w.notDb],
  ] as const) {
    single({
      family: 'exits-verdict',
      cmd: 'queue create',
      slug,
      tier,
      component: QUEUE_CMD,
      title: `queue create from ${words} exits 2 and writes no store and no queue (${qDoc})`,
      want: [2],
      refusal: true,
      argv: (w) => [
        'queue',
        'create',
        '--store',
        value(w),
        '--campaign',
        `c-${w.seed}`,
        '--labels',
        join(w.dir, 'labels'),
      ],
    });
  }
  single({
    family: 'exits-verdict',
    cmd: 'queue create',
    slug: 'unknown-campaign',
    tier: 2,
    component: QUEUE_CMD,
    title: `queue create of a campaign the store does not hold exits 2 and writes no queue (${qDoc})`,
    want: [2],
    refusal: true,
    setup: storeCampaign,
    argv: (w) => [
      'queue',
      'create',
      '--store',
      join(w.dir, 'runs.db'),
      '--campaign',
      `c-none-${w.seed}`,
      '--labels',
      join(w.dir, 'labels'),
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------
// Causes: one per (command, input-handling path) that would need its own fix. Set after reading each
// command's source: failures one change fixes share the sentence word for word.

const THROW_CAUSE = `${MAIN}: main rethrows every error that is not a CommanderError, so a file-system or parse error inside a command escapes as an uncaught throw; main must print the message on stderr and exit 2`;
const STORE_CAUSE = `${STORE}: openStore creates the database file for a path that does not exist, and the read-only commands (campaign status, resume and export, report, compare, monitor, pilot analyse) open their store with it; they need an open that refuses a missing store without writing it`;
const PLANNER = 'packages/core/src/runner/campaign.ts';

/** Failing cells, by the one change that turns them green; each component is where that change goes. */
const SHARED: ReadonlyArray<{ cause: string; component: string; ids: readonly string[] }> = [
  {
    cause: THROW_CAUSE,
    component: MAIN,
    ids: [
      'exits/generate/out-is-file',
      'exits/gate/out-is-file',
      'exits/select/out-is-file',
      'exits/family-instances/out-is-file',
      'exits/import-csv/out-is-file',
      'exits/import-traces/out-is-file',
      'exits/report/out-is-folder',
      'exits/judge-calibrate/out-is-folder',
      'exits/family-verify/dir-missing',
      'exits/attack/replay-wrong',
      'exits/queue-create/store-not-db',
    ],
  },
  {
    cause: STORE_CAUSE,
    component: STORE,
    ids: [
      'exits/campaign-status/store-missing',
      'exits/campaign-resume/store-missing',
      'exits/campaign-export/store-missing',
      'exits/report/store-missing',
      'exits/compare/store-missing',
      'exits/monitor/store-missing',
      'exits/pilot-analyse/store-missing',
    ],
  },
  {
    cause: `${CAMPAIGN_CMD}: campaign import opens, and so creates, the store before it reads the bundle; it must read and check the bundle first, so an invalid bundle writes nothing (all or nothing)`,
    component: CAMPAIGN_CMD,
    ids: [
      'exits/campaign-import/folder-missing',
      'exits/campaign-import/folder-is-file',
      'exits/campaign-import/folder-empty',
    ],
  },
  {
    cause: `${CAMPAIGN_CMD}: parseNumber reads --budget-usd with Number(), which turns an empty string into 0; it must refuse a value that is not a number with exit 2`,
    component: CAMPAIGN_CMD,
    ids: ['exits/campaign-plan/budget-usd-empty'],
  },
  {
    cause: `${CAMPAIGN_CMD}: parseRetry reads --retry-attempts, --retry-base-ms and --retry-max-ms with Number(), which turns an empty string into 0; it must refuse an empty value with exit 2`,
    component: CAMPAIGN_CMD,
    ids: ['exits/campaign-run/retry-max-ms-empty'],
  },
  {
    cause: `${PLANNER}: planCampaign pushes every cell into one array, so a huge --repeats exhausts the heap before the plan prints; it must count the cells without holding them all, or refuse a count it cannot hold`,
    component: PLANNER,
    ids: ['exits/campaign-plan/repeats-huge'],
  },
  {
    cause: `${REGISTRY_CMD}: listCommand prints "No <kind> <name>" and returns 0 for a name the store does not hold; an unknown name is bad input, exit 2`,
    component: REGISTRY_CMD,
    ids: ['exits/dataset-list/unknown-name', 'exits/prompt-list/unknown-name'],
  },
  {
    cause: `${REPORT_CMD}: --max-runs is read with Number(), which turns an empty string into 0; it must refuse a value that is not a whole number with exit 2`,
    component: REPORT_CMD,
    ids: ['exits/report/max-runs-empty'],
  },
  {
    cause: `${CI_CMD}: ci runs and stores the candidate campaign before it finds that --out cannot be written; it must check the summary path before anything runs`,
    component: CI_CMD,
    ids: ['exits/ci/out-is-folder'],
  },
  {
    cause: `${INTAKE_CMD}: whole() reads --turns, --min-per-cell, --max-cells, --spot-check and --seed with Number(), which turns an empty string into 0; it must refuse an empty value with exit 2`,
    component: INTAKE_CMD,
    ids: ['exits/intake-from-interview/turns-empty'],
  },
  {
    cause: `${VIEW_CMD}: --port is read with Number(), which turns an empty string into 0 (a free port), so view serves instead of refusing; a --port that is not a number must exit 2`,
    component: VIEW_CMD,
    ids: ['exits/view/port-empty'],
  },
];

const SHARED_BY_ID = new Map(SHARED.flatMap((entry) => entry.ids.map((id) => [id, entry] as const)));

function causeOf(cell: Cell, id: string): string {
  return (
    SHARED_BY_ID.get(id)?.cause ??
    cell.cause ??
    `${cell.component}: ${cell.cmd} handles the input of ${cell.slug} as documented: the exit code ${cell.want.join(' or ')}, a message on stderr, no stack trace, nothing written on refusal`
  );
}

async function judgeCell(
  cell: Cell,
  ctx: { seed: number; root: string; scratch: string },
  id: string,
): Promise<ItemResult> {
  const w = worldFor(ctx.root, ctx.scratch, ctx.seed, id);
  if (cell.setup) {
    const problem = await cell.setup(w);
    if (problem) return fail(problem);
  }
  const argv = cell.argv(w);
  const before = cell.refusal ? snapshot(w.dir) : undefined;
  let result: Cli;
  if (cell.child) {
    const ran = await childCli(argv, w.dir, ctx.root, ctx.scratch, cell.limitMs);
    if (!ran.ok)
      return fail(`driftbench ${showArgv(argv, w)}: ${ran.why}; documented exit ${cell.want.join(' or ')}`);
    result = ran.cli;
  } else {
    try {
      result = await cli(argv, w.dir);
    } catch (cause) {
      return fail(
        `driftbench ${showArgv(argv, w)} threw instead of exiting ${cell.want.join(' or ')}: ${(cause as Error).message?.slice(0, 200)}`,
      );
    }
  }
  const shown = `driftbench ${showArgv(argv, w)}: exit ${result.code}, stderr ${JSON.stringify(result.err.slice(0, 220))}, stdout ${JSON.stringify(result.out.slice(0, 120))}`;
  if (!cell.want.includes(result.code)) return fail(`expected exit ${cell.want.join(' or ')}; got ${shown}`);
  if (STACK.test(result.err) || STACK.test(result.out))
    return fail(`expected no stack trace in the output; got ${shown}`);
  const refused = result.code === 2 || result.code === 64;
  if (cell.refusal || refused) {
    if (result.err.trim() === '')
      return fail(`expected a message on stderr with exit ${result.code}; got ${shown}`);
    if (before) {
      const changes = written(before, snapshot(w.dir));
      if (changes.length > 0)
        return fail(`expected nothing written on refusal; ${changes.slice(0, 4).join(', ')}. ${shown}`);
    }
  }
  return PASS;
}

function showArgv(argv: string[], w: World): string {
  return argv
    .map((part) => part.split(w.dir).join('<item>').split(w.root).join('<repo>'))
    .map((part) => (part === '' || /\s/.test(part) ? JSON.stringify(part) : part))
    .join(' ');
}

export function exitItems(): BankItem[] {
  const seen = new Set<string>();
  const items = cells.map((cell) => {
    const id = `exits/${idOf(cell.cmd)}/${cell.slug}`;
    if (seen.has(id)) throw new Error(`exits: duplicate id ${id}`);
    seen.add(id);
    return {
      id,
      family: cell.family,
      tier: cell.tier,
      level: 10,
      component: SHARED_BY_ID.get(id)?.component ?? cell.component,
      source: cell.child ? 'scale' : cell.want.includes(0) || cell.want.includes(1) ? 'contract' : 'hostile',
      title: cell.title,
      cause: causeOf(cell, id),
      check: (ctx) => judgeCell(cell, ctx, id),
    } satisfies BankItem;
  });
  for (const id of SHARED_BY_ID.keys())
    if (!seen.has(id)) throw new Error(`exits: shared cause names no item ${id}`);
  return items;
}
