import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadSpecs } from '@agent-nexus/driftbench-core';
import { mde as powerMde } from '@agent-nexus/driftbench-stats';
import { openStore } from '@agent-nexus/driftbench-store';
import { parse, stringify } from 'yaml';
import { docBlock, docCellId } from '../doc-blocks';
import { reviewFamily } from '../review-family';
import { type BankItem, expectAll, fail, type ItemResult, PASS, type Tier } from '../types';

/**
 * Level 10, claims of the command line. Each item runs the command line in process through its own `main`,
 * with the item's folder as the working folder, and checks one statement of docs/reference/cli.md or
 * docs/running.md (and docs/datasets.md for the registry and the import): an exit code, a printed line, a
 * field of the `--json` document, or the effect of one option. The inputs are the Acme example (target
 * function:acme) and spec, inventory and map files the item writes into its own folder, so the right answer
 * is known by construction or printed in the docs. None of the 53 items of bank/cli.ts is repeated here.
 */

const SPEC_CMD = 'packages/cli/src/commands/spec.ts';
const SEMANTICS = 'packages/core/src/spec/semantics.ts';
const NORMALIZE = 'packages/core/src/spec/normalize.ts';
const LINT = 'packages/core/src/spec/lint.ts';
const LOADER = 'packages/core/src/spec/load.ts';
const COVERAGE = 'packages/core/src/coverage/compute.ts';
const INVENTORY = 'packages/core/src/coverage/inventory.ts';
const COVERAGE_CMD = 'packages/cli/src/commands/coverage.ts';
const CAMPAIGN_CMD = 'packages/cli/src/commands/campaign.ts';
const PLANNER = 'packages/core/src/runner/campaign.ts';
const SMOKE_CMD = 'packages/cli/src/commands/smoke.ts';
const SPACE_CMD = 'packages/cli/src/commands/space.ts';
const SPACE_LOAD = 'packages/space/src/load.ts';
const SPACE_COVERAGE = 'packages/space/src/coverage.ts';
const EXTRACT_CMD = 'packages/cli/src/commands/extract.ts';
const REGISTRY_CMD = 'packages/cli/src/commands/registry.ts';
const REGISTRY = 'packages/store/src/registry.ts';
const IMPORT_CMD = 'packages/cli/src/commands/import.ts';
const TABLE = 'packages/core/src/import/table.ts';
const GENERATE_CMD = 'packages/cli/src/commands/generate.ts';
const INTAKE_CMD = 'packages/cli/src/commands/intake.ts';
const JUDGE_CMD = 'packages/cli/src/commands/judge.ts';
const FAMILY_CMD = 'packages/cli/src/commands/family.ts';
const ESTATE_CMD = 'packages/cli/src/commands/estate.ts';
const REPLAY_CMD = 'packages/cli/src/commands/replay.ts';
const VALIDATE_CMD = 'packages/cli/src/commands/validate.ts';
const PILOT_CMD = 'packages/cli/src/commands/pilot.ts';
const GATE_CMD = 'packages/cli/src/commands/gate.ts';
const MAIN = 'packages/cli/src/main.ts';

const TARGET = 'function:acme';
const PLAN_UPGRADE = 'examples/acme/specs/conversations/plan-upgrade.yaml';
const LOOSE = 'examples/acme/specs/conversations/order-loose-confirmation.yaml';
const PRICE_SHEET = 'examples/acme/specs/tasks/price-sheet.yaml';
const CONVERSATIONS = 'examples/acme/specs/conversations';
const COV_FIXTURES = 'packages/core/test/coverage/fixtures';
const SPACE_FIXTURE = 'packages/space/test/fixtures/acme-space.yaml';

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

function shown(result: Cli): string {
  return `exit ${result.code}, out ${JSON.stringify(result.out.slice(0, 300))}, err ${JSON.stringify(result.err.slice(0, 300))}`;
}

function json<T = Record<string, unknown>>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function put(dir: string, rel: string, text: string): string {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

const BLOCK = { user: 'Hello there', expect: { must: ['Acme'] } };

/** A minimal spec in YAML: one block, plus the top-level fields given. */
function mini(id: string, top: Record<string, unknown> = {}, blocks: unknown[] = [BLOCK]): string {
  return stringify({ id, ...top, blocks });
}

type Ctx = { dir: string; root: string; seed: number };

type Case = {
  slug: string;
  tier: Tier;
  component: string;
  title: string;
  cause: string;
  flags?: boolean;
  source?: BankItem['source'];
  run(ctx: Ctx): Promise<ItemResult>;
};

const cases: Case[] = [];
function add(each: Case): void {
  cases.push(each);
}

function exitIs(result: Cli, want: number, what: string): ItemResult {
  return result.code === want ? PASS : fail(`${what}: documented exit ${want}; ${shown(result)}`);
}

type Entry = {
  path: string;
  ok: boolean;
  id?: string;
  hash?: string;
  blocks?: number;
  errors?: Array<{ level: string; code: string; path: string; message: string }>;
  warnings?: Array<{ level: string; code: string; path: string; message: string }>;
};

/** `spec lint <file> --json` on one spec text; returns the exit code and the one entry. */
async function lintOne(ctx: Ctx, name: string, text: string): Promise<{ result: Cli; entry?: Entry }> {
  const file = put(ctx.dir, name, text);
  const result = await cli(['spec', 'lint', file, '--json'], ctx.dir);
  return { result, entry: json<Entry[]>(result.out)?.[0] };
}

/** One issue code of docs/reference/cli.md "Issue codes", at its documented path. */
function issueCase(
  slug: string,
  code: string,
  level: 'error' | 'warning',
  path: string,
  component: string,
  title: string,
  text: (seed: number) => string,
  tier: Tier = 2,
): void {
  add({
    slug: `issue-${slug}`,
    tier,
    component,
    title: `spec lint reports ${code} (${level}) at ${path || 'the file'}: ${title} (docs/reference/cli.md "Issue codes")`,
    cause: `${component} reports ${code} when ${title}.`,
    async run(ctx) {
      const { result, entry } = await lintOne(ctx, `${slug}.yaml`, text(ctx.seed));
      if (!entry) return fail(`no JSON entry for the spec; ${shown(result)}`);
      const list = level === 'error' ? (entry.errors ?? []) : (entry.warnings ?? []);
      const hit = list.find((issue) => issue.code === code);
      const others = [...(entry.errors ?? []), ...(entry.warnings ?? [])].map((i) => `${i.code}@${i.path}`);
      return expectAll([
        [hit !== undefined, `expected ${level} ${code}; the spec got ${others.join(', ') || 'no issue'}`],
        [
          hit === undefined || hit.path === path || hit.path.startsWith(`${path}.`),
          `expected ${code} at "${path}" (or a field under it), got "${hit?.path}"`,
        ],
        [
          result.code === (level === 'error' ? 1 : 0),
          `expected exit ${level === 'error' ? 1 : 0} (lint without --strict), got ${result.code}`,
        ],
      ]);
    },
  });
}

// ---------------------------------------------------------------- paths and spec validate

add({
  slug: 'paths/recursive-sorted-skips',
  tier: 2,
  component: LOADER,
  title:
    'a folder is searched recursively for *.yaml, *.yml and *.spec.json in sorted path order, skipping dot entries, node_modules, dist and plain .json (cli.md "Paths")',
  cause:
    'the spec file finder walks folders recursively in sorted order and skips dot entries, node_modules and dist.',
  async run(ctx) {
    const s = ctx.seed;
    const tree = join(ctx.dir, 'tree');
    put(tree, 'b.yaml', mini(`s-b-${s}`));
    put(tree, 'a/z.yaml', mini(`s-az-${s}`));
    put(tree, 'c.yml', mini(`s-c-${s}`));
    put(tree, 'd.spec.json', JSON.stringify({ id: `s-d-${s}`, blocks: [BLOCK] }));
    put(tree, 'e.json', JSON.stringify({ id: `s-e-${s}`, blocks: [BLOCK] }));
    put(tree, '.hidden/h.yaml', mini(`s-h-${s}`));
    put(tree, '.dot.yaml', mini(`s-dot-${s}`));
    put(tree, 'node_modules/n.yaml', mini(`s-n-${s}`));
    put(tree, 'dist/x.yaml', mini(`s-x-${s}`));
    const result = await cli(['spec', 'validate', 'tree', '--json'], ctx.dir);
    const paths = (json<Entry[]>(result.out) ?? []).map((entry) => entry.path);
    const want = ['tree/a/z.yaml', 'tree/b.yaml', 'tree/c.yml', 'tree/d.spec.json'];
    return expectAll([
      [
        paths.join() === want.join(),
        `expected paths ${want.join(', ')}; got ${paths.join(', ') || shown(result)}`,
      ],
      [result.code === 0, `expected exit 0, got ${result.code}`],
    ]);
  },
});

add({
  slug: 'paths/json-read-as-json',
  tier: 3,
  component: LOADER,
  title:
    'a file ending in .json is read as JSON: a duplicate key that YAML refuses takes its last value (cli.md "Paths")',
  cause: 'the spec loader parses a file ending in .json with a JSON parser, not as YAML.',
  source: 'adversarial',
  async run(ctx) {
    const file = put(
      ctx.dir,
      'dup.json',
      `{"id":"first-${ctx.seed}","id":"second-${ctx.seed}","blocks":[{"user":"hi","expect":{"must":["a"]}}]}`,
    );
    const result = await cli(['spec', 'validate', file, '--json'], ctx.dir);
    const entry = json<Entry[]>(result.out)?.[0];
    return expectAll([
      [
        entry?.ok === true,
        `expected a valid spec; got ${JSON.stringify(entry)?.slice(0, 240) ?? shown(result)}`,
      ],
      [
        entry?.id === `second-${ctx.seed}`,
        `expected id second-${ctx.seed} (JSON last key wins), got ${entry?.id}`,
      ],
    ]);
  },
});

add({
  slug: 'paths/other-extension-yaml',
  tier: 2,
  component: LOADER,
  title: 'a file with any other extension, such as .txt, given directly is read as YAML (cli.md "Paths")',
  cause: 'the spec loader reads every file not ending in .json as YAML, whatever its extension.',
  async run(ctx) {
    const file = put(ctx.dir, 'case.txt', mini(`txt-${ctx.seed}`));
    const result = await cli(['spec', 'validate', file, '--json'], ctx.dir);
    const entry = json<Entry[]>(result.out)?.[0];
    return expectAll([
      [
        entry?.ok === true && entry.id === `txt-${ctx.seed}`,
        `expected valid txt-${ctx.seed}; ${shown(result)}`,
      ],
    ]);
  },
});

add({
  slug: 'paths/missing-is-spec-parse',
  tier: 1,
  component: SPEC_CMD,
  title:
    'a path that does not exist is reported as an invalid spec with the code SPEC_PARSE, and spec validate exits 1 (cli.md "Paths", exit table)',
  cause: 'spec validate reports a missing path as an invalid spec with SPEC_PARSE and exits 1.',
  async run(ctx) {
    const result = await cli(['spec', 'validate', `missing-${ctx.seed}.yaml`, '--json'], ctx.dir);
    const entry = json<Entry[]>(result.out)?.[0];
    return expectAll([
      [
        entry?.ok === false && entry.errors?.[0]?.code === 'SPEC_PARSE' && entry.errors[0].path === '',
        `expected ok false with SPEC_PARSE at path ""; ${shown(result)}`,
      ],
      [result.code === 1, `expected exit 1, got ${result.code}`],
    ]);
  },
});

add({
  slug: 'validate/json-empty-array',
  tier: 2,
  component: SPEC_CMD,
  title:
    'spec validate --json on a folder with no spec prints one JSON document, an empty array (cli.md "--json")',
  cause: 'spec validate --json prints an empty JSON array when no spec file was found.',
  flags: true,
  async run(ctx) {
    mkdirSync(join(ctx.dir, 'empty'), { recursive: true });
    const result = await cli(['spec', 'validate', 'empty', '--json'], ctx.dir);
    const doc = json<unknown>(result.out);
    return expectAll([
      [Array.isArray(doc) && doc.length === 0, `expected [] on stdout; ${shown(result)}`],
      [result.code === 1, `expected exit 1, got ${result.code}`],
    ]);
  },
});

add({
  slug: 'validate/hash-key-order',
  tier: 2,
  component: 'packages/core/src/spec/hash.ts',
  title:
    'the spec hash is 12 hex characters of a canonical JSON with keys sorted at every depth: the same spec with its keys reordered has the same hash (cli.md spec validate)',
  cause: 'the spec hash sorts keys at every depth of the canonical JSON before hashing.',
  async run(ctx) {
    const id = `order-${ctx.seed}`;
    const a = put(
      ctx.dir,
      'a.yaml',
      `id: ${id}\ntitle: T\nblocks:\n  - user: hi\n    expect: { must: [x], must_not: [y], stage: s }\nstages: [s]\n`,
    );
    const b = put(
      ctx.dir,
      'b.yaml',
      `stages: [s]\nblocks:\n  - expect: { stage: s, must_not: [y], must: [x] }\n    user: hi\ntitle: T\nid: ${id}\n`,
    );
    const result = await cli(['spec', 'validate', a, b, '--json'], ctx.dir);
    const entries = json<Entry[]>(result.out) ?? [];
    const [ha, hb] = entries.map((entry) => entry.hash);
    return expectAll([
      [/^[0-9a-f]{12}$/.test(ha ?? ''), `expected a 12-hex hash, got ${ha}; ${shown(result)}`],
      [ha === hb, `expected equal hashes for reordered keys, got ${ha} and ${hb}`],
    ]);
  },
});

add({
  slug: 'validate/json-valid-entry',
  tier: 1,
  component: SPEC_CMD,
  title:
    'spec validate --json gives a valid spec path, ok true, id, hash, blocks and warnings (cli.md "JSON output")',
  cause: 'spec validate --json writes path, ok, id, hash, blocks and warnings for a valid spec.',
  async run(ctx) {
    const blocks = [
      BLOCK,
      { user: 'more', expect: { must: ['b'] } },
      { user: 'end', expect: { must: ['c'] } },
    ];
    put(ctx.dir, 'ok.yaml', mini(`ok-${ctx.seed}`, {}, blocks));
    const result = await cli(['spec', 'validate', 'ok.yaml', '--json'], ctx.dir);
    const entry = json<Entry[]>(result.out)?.[0];
    return expectAll([
      [
        entry?.path === 'ok.yaml' &&
          entry.ok === true &&
          entry.id === `ok-${ctx.seed}` &&
          entry.blocks === 3 &&
          Array.isArray(entry.warnings) &&
          typeof entry.hash === 'string',
        `expected {path, ok: true, id, hash, blocks: 3, warnings: []}; got ${JSON.stringify(entry)?.slice(0, 260) ?? shown(result)}`,
      ],
    ]);
  },
});

add({
  slug: 'validate/summary-line',
  tier: 1,
  component: SPEC_CMD,
  title: 'spec validate ends with "Checked N specs: v valid, i invalid, w warnings." (cli.md spec validate)',
  cause: 'spec validate prints the summary line with the counts of valid, invalid and warnings.',
  async run(ctx) {
    put(ctx.dir, 'set/a.yaml', mini(`a-${ctx.seed}`));
    put(ctx.dir, 'set/b.yaml', mini(`b-${ctx.seed}`));
    put(ctx.dir, 'set/c.yaml', `id: c-${ctx.seed}\nblocks:\n  - expect: { must: [a] }\n`);
    const result = await cli(['spec', 'validate', 'set'], ctx.dir);
    const want = 'Checked 3 specs: 2 valid, 1 invalid, 0 warnings.';
    return expectAll([
      [result.out.includes(want), `expected the line "${want}"; ${shown(result)}`],
      [result.code === 1, `expected exit 1, got ${result.code}`],
    ]);
  },
});

// ---------------------------------------------------------------- issue codes

issueCase(
  'alias-workspace',
  'SPEC_ALIAS_CONFLICT',
  'error',
  'workspace_seed',
  NORMALIZE,
  'workspace_seed and given.world.workspace are both set',
  (seed) =>
    mini(`alias-${seed}`, {
      workspace_seed: { files: { 'a.txt': 'one' } },
      given: { world: { workspace: { files: { 'b.txt': 'two' } } } },
    }),
);
issueCase(
  'perturbation-range',
  'PERTURBATION_OUT_OF_RANGE',
  'error',
  'perturbations.0.inject_at',
  SEMANTICS,
  'inject_at is past the last position',
  (seed) =>
    mini(`prange-${seed}`, {
      perturbations: [
        {
          id: 'p',
          class: 'D1_off_topic',
          inject_at: 4 + seed,
          user: 'hours?',
          recovery: { within_blocks: 0 },
        },
      ],
    }),
);
issueCase(
  'stage-after',
  'STAGE_UNKNOWN',
  'error',
  'perturbations.0.recovery.stage_after',
  SEMANTICS,
  'recovery.stage_after names a stage the spec does not list',
  (seed) =>
    mini(
      `safter-${seed}`,
      {
        stages: ['greet', 'offer'],
        perturbations: [
          {
            id: 'p',
            class: 'D1_off_topic',
            inject_at: 0,
            user: 'a',
            recovery: { within_blocks: 0, stage_after: 'nowhere' },
          },
        ],
      },
      [{ user: 'hi', expect: { stage: 'greet' } }],
    ),
  3,
);
issueCase(
  'retention-unknown',
  'RETENTION_FACT_UNKNOWN',
  'error',
  'blocks.0.expect.knowledge_retention.0',
  SEMANTICS,
  'knowledge_retention names a fact no ledger holds before the block',
  (seed) =>
    mini(`ret-${seed}`, {}, [{ user: 'hi', expect: { knowledge_retention: [{ fact: `fact_${seed}` }] } }]),
  3,
);
issueCase(
  'forbidden-max-calls',
  'TOOL_FORBIDDEN_EXPECTED',
  'error',
  'blocks.0.expect.tools.0',
  SEMANTICS,
  'a block expects a tool whose rules.max_calls is 0',
  (seed) =>
    mini(`fmax-${seed}`, { rules: { max_calls: { 'records.lookup': 0 } } }, [
      { user: 'hi', expect: { tools: [{ label: 'records.lookup', count: 1 }] } },
    ]),
  3,
);
issueCase(
  'task-without-outcome',
  'TASK_WITHOUT_OUTCOME',
  'warning',
  'blocks',
  LINT,
  'a task spec checks none of artifacts, workspace, execution and end_state',
  (seed) => mini(`task-${seed}`, { kind: 'task' }),
);

add({
  slug: 'issue-retention-known',
  tier: 3,
  component: SEMANTICS,
  title:
    'a retention fact held in given.ledger, or added by an earlier block\'s ledger_add, is not RETENTION_FACT_UNKNOWN (cli.md "Issue codes")',
  cause:
    "the semantic check knows the facts of given.ledger and of earlier blocks' ledger_add when it checks knowledge_retention.",
  source: 'adversarial',
  async run(ctx) {
    const fact = `fact_${ctx.seed}`;
    const viaGiven = await lintOne(
      ctx,
      'given.yaml',
      mini(`kg-${ctx.seed}`, { given: { ledger: { [fact]: 'R-1234' } } }, [
        { user: 'hi', expect: { knowledge_retention: [{ fact }] } },
      ]),
    );
    const viaAdd = await lintOne(
      ctx,
      'added.yaml',
      mini(`ka-${ctx.seed}`, {}, [
        { user: 'hi', expect: { must: ['a'], ledger_add: { [fact]: 'R-1234' } } },
        { user: 'again', expect: { knowledge_retention: [{ fact }] } },
      ]),
    );
    const codes = (entry?: Entry) => (entry?.errors ?? []).map((issue) => issue.code).join(',');
    return expectAll([
      [
        viaGiven.entry?.ok === true,
        `given.ledger: expected valid, got errors ${codes(viaGiven.entry)}; ${shown(viaGiven.result)}`,
      ],
      [
        viaAdd.entry?.ok === true,
        `earlier ledger_add: expected valid, got errors ${codes(viaAdd.entry)}; ${shown(viaAdd.result)}`,
      ],
    ]);
  },
});

// ---------------------------------------------------------------- spec lint

add({
  slug: 'lint/warning-line',
  tier: 1,
  component: SPEC_CMD,
  title:
    'spec lint prints "  ! blocks.0  BLOCK_NO_EXPECTATION  this block checks nothing", counts "1 warning" and exits 0 without --strict (cli.md spec lint)',
  cause:
    'spec lint prints each warning of a valid spec on its own line, counts it, and exits 0 without --strict.',
  async run(ctx) {
    const file = put(ctx.dir, 'no-checks.yaml', `id: no-checks-${ctx.seed}\nblocks:\n  - user: hi\n`);
    const result = await cli(['spec', 'lint', file], ctx.dir);
    return expectAll([
      [
        result.out.includes('  ! blocks.0  BLOCK_NO_EXPECTATION  this block checks nothing'),
        `expected the warning line; ${shown(result)}`,
      ],
      [
        result.out.includes('Checked 1 spec: 1 valid, 0 invalid, 1 warning.'),
        `expected the summary line; ${shown(result)}`,
      ],
      [result.code === 0, `expected exit 0, got ${result.code}`],
    ]);
  },
});

add({
  slug: 'lint/strict',
  tier: 1,
  component: SPEC_CMD,
  title: 'spec lint --strict treats a warning as a failure and exits 1 (cli.md spec lint options)',
  cause: 'spec lint --strict exits 1 when a warning was printed.',
  flags: true,
  async run(ctx) {
    const file = put(ctx.dir, 'no-checks.yaml', `id: strict-${ctx.seed}\nblocks:\n  - user: hi\n`);
    return exitIs(
      await cli(['spec', 'lint', file, '--strict'], ctx.dir),
      1,
      'lint --strict with one warning',
    );
  },
});

// ---------------------------------------------------------------- spec coverage

add({
  slug: 'coverage/fixture-summary',
  tier: 1,
  component: COVERAGE_CMD,
  title:
    'spec coverage on the test fixtures prints "Coverage: 4 of 5 behaviours covered, 3 of 4 flow deviations covered." and exits 1 (cli.md spec coverage)',
  cause: 'spec coverage prints the documented summary and exits 1 on a missing behaviour or deviation.',
  async run(ctx) {
    const result = await cli(
      [
        'spec',
        'coverage',
        join(ctx.root, COV_FIXTURES, 'specs'),
        '--inventory',
        join(ctx.root, COV_FIXTURES, 'inventory.yaml'),
      ],
      ctx.dir,
    );
    const want = 'Coverage: 4 of 5 behaviours covered, 3 of 4 flow deviations covered.';
    return expectAll([
      [result.out.includes(want), `expected "${want}"; ${shown(result)}`],
      [result.code === 1, `expected exit 1, got ${result.code}`],
    ]);
  },
});

add({
  slug: 'coverage/json-keys',
  tier: 1,
  component: COVERAGE_CMD,
  title:
    'spec coverage --json prints one document with inventory, channels, behaviours, perChannel, flows, warnings, invalidSpecs, summary and ok (cli.md spec coverage)',
  cause: 'spec coverage --json writes the documented top-level keys.',
  flags: true,
  async run(ctx) {
    const result = await cli(
      [
        'spec',
        'coverage',
        join(ctx.root, COV_FIXTURES, 'specs'),
        '--inventory',
        join(ctx.root, COV_FIXTURES, 'inventory.yaml'),
        '--json',
      ],
      ctx.dir,
    );
    const doc = json(result.out);
    const want = [
      'inventory',
      'channels',
      'behaviours',
      'perChannel',
      'flows',
      'warnings',
      'invalidSpecs',
      'summary',
      'ok',
    ];
    const missing = want.filter((key) => !(doc && key in doc));
    return expectAll([
      [doc !== undefined && missing.length === 0, `missing keys ${missing.join(', ')}; ${shown(result)}`],
      [doc?.ok === false, `expected ok false on the fixtures, got ${doc?.ok}`],
    ]);
  },
});

const ONE_FLOW = (deviations: string[], channels?: string[]) =>
  stringify({
    ...(channels ? { channels } : {}),
    behaviours: [{ id: 'B-001', title: 'Greets the customer' }],
    flows: [{ id: 'f1', title: 'The flow', behaviours: ['B-001'], deviations }],
  });

add({
  slug: 'coverage/default-channel',
  tier: 2,
  component: COVERAGE,
  title:
    'with no channel in the inventory, the behaviours or the specs, the matrix has the one channel "default" (cli.md spec coverage)',
  cause: 'spec coverage falls back to the single channel default when nothing names a channel.',
  async run(ctx) {
    put(ctx.dir, 'inv.yaml', ONE_FLOW([]));
    put(ctx.dir, 'specs/a.yaml', mini(`d-${ctx.seed}`, { covers: ['B-001'] }));
    const result = await cli(['spec', 'coverage', 'specs', '--inventory', 'inv.yaml', '--json'], ctx.dir);
    const doc = json<{ channels?: string[]; ok?: boolean }>(result.out);
    return expectAll([
      [
        doc?.channels?.join() === 'default',
        `expected channels [default], got ${JSON.stringify(doc?.channels)}; ${shown(result)}`,
      ],
      [result.code === 0, `expected exit 0, got ${result.code}`],
    ]);
  },
});

add({
  slug: 'coverage/no-channel-spec',
  tier: 2,
  component: COVERAGE,
  title:
    'a spec on no channel covers its behaviour on every channel of the inventory (cli.md spec coverage: "on that channel, or on no channel")',
  cause: 'spec coverage counts a spec without a channel on every channel.',
  async run(ctx) {
    put(ctx.dir, 'inv.yaml', ONE_FLOW([], ['chat', 'whatsapp', 'email']));
    put(ctx.dir, 'specs/a.yaml', mini(`nc-${ctx.seed}`, { covers: ['B-001'] }));
    const result = await cli(['spec', 'coverage', 'specs', '--inventory', 'inv.yaml', '--json'], ctx.dir);
    const doc = json<{ behaviours?: Array<{ cells: Array<{ channel: string; status: string }> }> }>(
      result.out,
    );
    const cells = doc?.behaviours?.[0]?.cells ?? [];
    return expectAll([
      [
        cells.length === 3 && cells.every((cell) => cell.status === 'covered'),
        `expected B-001 covered on chat, whatsapp and email; got ${JSON.stringify(cells)}; ${shown(result)}`,
      ],
      [result.code === 0, `expected exit 0, got ${result.code}`],
    ]);
  },
});

add({
  slug: 'coverage/channel-narrows-flows',
  tier: 3,
  component: COVERAGE,
  title:
    'spec coverage --channel chat counts only chat specs and specs on no channel, for the flows too: a deviation covered only on whatsapp is missing, exit 1 (cli.md spec coverage)',
  cause: 'spec coverage --channel drops the specs of other channels from the flow deviation matrix.',
  flags: true,
  async run(ctx) {
    put(ctx.dir, 'inv.yaml', ONE_FLOW(['D1_off_topic'], ['chat', 'whatsapp']));
    put(ctx.dir, 'specs/c.yaml', mini(`chat-${ctx.seed}`, { channel: 'chat', covers: ['B-001'] }));
    put(
      ctx.dir,
      'specs/w.yaml',
      mini(`wa-${ctx.seed}`, {
        channel: 'whatsapp',
        covers: ['B-001'],
        perturbations: [
          { id: 'p', class: 'D1_off_topic', inject_at: 0, user: 'hours?', recovery: { within_blocks: 0 } },
        ],
      }),
    );
    const all = await cli(['spec', 'coverage', 'specs', '--inventory', 'inv.yaml'], ctx.dir);
    const chat = await cli(
      ['spec', 'coverage', 'specs', '--inventory', 'inv.yaml', '--channel', 'chat'],
      ctx.dir,
    );
    return expectAll([
      [all.code === 0, `without --channel: expected exit 0, got ${all.code}`],
      [chat.code === 1, `with --channel chat: expected exit 1 (D1 only on whatsapp), ${shown(chat)}`],
    ]);
  },
});

add({
  slug: 'coverage/unknown-channel',
  tier: 1,
  component: COVERAGE_CMD,
  title: 'spec coverage --channel with a channel the inventory does not have exits 2 (cli.md spec coverage)',
  cause: 'spec coverage refuses an unknown --channel as a usage error.',
  flags: true,
  async run(ctx) {
    return exitIs(
      await cli(
        [
          'spec',
          'coverage',
          join(ctx.root, COV_FIXTURES, 'specs'),
          '--inventory',
          join(ctx.root, COV_FIXTURES, 'inventory.yaml'),
          '--channel',
          `pager-${ctx.seed}`,
        ],
        ctx.dir,
      ),
      2,
      'an unknown channel',
    );
  },
});

add({
  slug: 'coverage/no-spec-exit-2',
  tier: 2,
  component: COVERAGE_CMD,
  title:
    'spec coverage on a folder with no spec file exits 2, unlike spec validate (cli.md spec coverage exit table)',
  cause: 'spec coverage exits 2 when no spec file was found.',
  async run(ctx) {
    mkdirSync(join(ctx.dir, 'empty'), { recursive: true });
    put(ctx.dir, 'inv.yaml', ONE_FLOW([]));
    return exitIs(
      await cli(['spec', 'coverage', 'empty', '--inventory', 'inv.yaml'], ctx.dir),
      2,
      'no spec found',
    );
  },
});

add({
  slug: 'coverage/invalid-never-counts',
  tier: 2,
  component: COVERAGE,
  title:
    'an invalid spec that lists a behaviour in covers never counts: the behaviour stays missing and it appears in invalidSpecs (cli.md spec coverage)',
  cause: 'spec coverage leaves invalid specs out of the matrices and lists them.',
  async run(ctx) {
    put(ctx.dir, 'inv.yaml', ONE_FLOW([]));
    put(
      ctx.dir,
      'specs/bad.yaml',
      `id: bad-${ctx.seed}\ncovers: [B-001]\nblocks:\n  - expect: { must: [a] }\n`,
    );
    const result = await cli(['spec', 'coverage', 'specs', '--inventory', 'inv.yaml', '--json'], ctx.dir);
    const doc = json<{ behaviours?: Array<{ status: string }>; invalidSpecs?: unknown[] }>(result.out);
    return expectAll([
      [
        doc?.behaviours?.[0]?.status === 'missing',
        `expected B-001 missing, got ${doc?.behaviours?.[0]?.status}; ${shown(result)}`,
      ],
      [
        (doc?.invalidSpecs?.length ?? 0) === 1,
        `expected 1 invalid spec listed, got ${JSON.stringify(doc?.invalidSpecs)}`,
      ],
      [result.code === 1, `expected exit 1, got ${result.code}`],
    ]);
  },
});

add({
  slug: 'coverage/unlisted-channel',
  tier: 2,
  component: COVERAGE,
  title:
    'a spec on a channel the inventory does not list warns UNLISTED_CHANNEL and counts for no channel; the warning leaves the exit at 1 or 0 by coverage alone (cli.md spec coverage warnings)',
  cause: 'spec coverage warns UNLISTED_CHANNEL and counts such a spec on no channel.',
  async run(ctx) {
    put(ctx.dir, 'inv.yaml', ONE_FLOW([], ['chat']));
    put(ctx.dir, 'specs/s.yaml', mini(`sms-${ctx.seed}`, { channel: 'sms', covers: ['B-001'] }));
    const result = await cli(['spec', 'coverage', 'specs', '--inventory', 'inv.yaml', '--json'], ctx.dir);
    const doc = json<{ warnings?: Array<{ code: string }>; behaviours?: Array<{ status: string }> }>(
      result.out,
    );
    return expectAll([
      [
        doc?.warnings?.some((w) => w.code === 'UNLISTED_CHANNEL') === true,
        `expected UNLISTED_CHANNEL; ${shown(result)}`,
      ],
      [
        doc?.behaviours?.[0]?.status === 'missing',
        `expected B-001 missing on chat, got ${doc?.behaviours?.[0]?.status}`,
      ],
      [result.code === 1, `expected exit 1, got ${result.code}`],
    ]);
  },
});

add({
  slug: 'coverage/kind-mismatch',
  tier: 3,
  component: COVERAGE,
  title:
    'a task behaviour covered only by conversation specs warns KIND_MISMATCH, and the warning never changes the verdict: exit 0 (cli.md spec coverage warnings)',
  cause: 'spec coverage warns KIND_MISMATCH without changing the verdict.',
  async run(ctx) {
    put(
      ctx.dir,
      'inv.yaml',
      stringify({
        behaviours: [{ id: 'T-001', title: 'Builds the sheet', kind: 'task' }],
        flows: [{ id: 'f1', title: 'f', behaviours: ['T-001'] }],
      }),
    );
    put(ctx.dir, 'specs/s.yaml', mini(`conv-${ctx.seed}`, { covers: ['T-001'] }));
    const result = await cli(['spec', 'coverage', 'specs', '--inventory', 'inv.yaml', '--json'], ctx.dir);
    const doc = json<{ warnings?: Array<{ code: string }> }>(result.out);
    return expectAll([
      [
        doc?.warnings?.some((w) => w.code === 'KIND_MISMATCH') === true,
        `expected KIND_MISMATCH; ${shown(result)}`,
      ],
      [result.code === 0, `expected exit 0 (warnings never change the verdict), got ${result.code}`],
    ]);
  },
});

add({
  slug: 'coverage/inventory-duplicate',
  tier: 2,
  component: INVENTORY,
  title:
    'an inventory that lists a behaviour id twice stops the command with INVENTORY_DUPLICATE, exit 2 (cli.md inventory errors)',
  cause: 'the inventory loader refuses a duplicate id with INVENTORY_DUPLICATE.',
  async run(ctx) {
    put(
      ctx.dir,
      'inv.yaml',
      stringify({
        behaviours: [
          { id: 'B-001', title: 'a' },
          { id: 'B-001', title: 'b' },
        ],
        flows: [],
      }),
    );
    put(ctx.dir, 'specs/s.yaml', mini(`s-${ctx.seed}`, { covers: ['B-001'] }));
    const result = await cli(['spec', 'coverage', 'specs', '--inventory', 'inv.yaml'], ctx.dir);
    return expectAll([
      [result.code === 2, `expected exit 2; ${shown(result)}`],
      [
        `${result.out}${result.err}`.includes('INVENTORY_DUPLICATE'),
        `expected the code INVENTORY_DUPLICATE; ${shown(result)}`,
      ],
    ]);
  },
});

add({
  slug: 'coverage/injection-covers-deviation',
  tier: 3,
  component: COVERAGE,
  title:
    'a block whose stimulus is an injection of the required class covers the flow deviation (cli.md spec coverage, flows by required deviation)',
  cause: 'spec coverage counts an injection block of the class as covering a required deviation.',
  async run(ctx) {
    put(ctx.dir, 'inv.yaml', ONE_FLOW(['D2_goal_shift']));
    put(
      ctx.dir,
      'specs/s.yaml',
      mini(`inj-${ctx.seed}`, { covers: ['B-001'] }, [
        {
          when: { injection: { class: 'D2_goal_shift', user: 'Actually, a different plan.' } },
          expect: { must: ['a'] },
        },
      ]),
    );
    const result = await cli(['spec', 'coverage', 'specs', '--inventory', 'inv.yaml'], ctx.dir);
    return exitIs(result, 0, 'a flow whose required deviation is injected by a block');
  },
});

// ---------------------------------------------------------------- campaign plan, run, status, resume, smoke

add({
  slug: 'plan/cell-ids-documented',
  tier: 2,
  component: PLANNER,
  title:
    'the cell ids running.md prints for acme-plan-upgrade in F at repeat 0, on function:acme and on its own target, are the ids campaign plan gives',
  cause:
    'the planner derives the cell id from the spec hash, target, mode, repeat and perturbation as running.md documents.',
  async run(ctx) {
    const forcedRows = docBlock(
      ctx.root,
      'docs/running.md',
      'pnpm -s driftbench campaign plan examples/acme/specs/conversations --target function:acme --repeats 2',
    );
    const ownRows = docBlock(
      ctx.root,
      'docs/running.md',
      'pnpm -s driftbench campaign plan examples/acme/specs',
    );
    if (typeof forcedRows === 'string') return fail(forcedRows);
    if (typeof ownRows === 'string') return fail(ownRows);
    const documentedForced = docCellId(forcedRows, 'acme-plan-upgrade', TARGET, 'F', 0);
    const documentedOwn = docCellId(ownRows, 'acme-plan-upgrade', 'function:acme-sales', 'F', 0);
    const spec = join(ctx.root, PLAN_UPGRADE);
    const forced = await cli(['campaign', 'plan', spec, '--target', TARGET, '--json'], ctx.dir);
    const own = await cli(['campaign', 'plan', spec, '--json'], ctx.dir);
    const id = (r: Cli) => json<{ cells?: Array<{ cellId: string }> }>(r.out)?.cells?.[0]?.cellId;
    return expectAll([
      [
        documentedForced !== undefined,
        'running.md prints no F row at repeat 0 of acme-plan-upgrade on function:acme',
      ],
      [documentedOwn !== undefined, 'running.md prints no F row of acme-plan-upgrade on function:acme-sales'],
      [
        id(forced) === documentedForced,
        `--target function:acme: running.md prints ${documentedForced}, campaign plan gives ${id(forced)}; ${shown(forced)}`,
      ],
      [
        id(own) === documentedOwn,
        `own target: running.md prints ${documentedOwn}, campaign plan gives ${id(own)}; ${shown(own)}`,
      ],
    ]);
  },
});

add({
  slug: 'plan/override-note',
  tier: 2,
  component: CAMPAIGN_CMD,
  title:
    'campaign plan --target prints "Note: acme-price-sheet names the process adapter; --target runs it on function:acme." (running.md)',
  cause: 'campaign plan prints a note for each spec whose own target names another adapter than --target.',
  flags: true,
  async run(ctx) {
    const result = await cli(['campaign', 'plan', join(ctx.root, PRICE_SHEET), '--target', TARGET], ctx.dir);
    const want = 'Note: acme-price-sheet names the process adapter; --target runs it on function:acme.';
    return expectAll([[`${result.out}${result.err}`.includes(want), `expected "${want}"; ${shown(result)}`]]);
  },
});

add({
  slug: 'plan/mode-order-perturbations',
  tier: 3,
  component: PLANNER,
  title:
    'campaign plan --mode P,T orders cells T then P, gives one P cell per perturbation, and a world-only perturbation sends the spec blocks alone (running.md "Cells")',
  cause:
    'the planner orders cells T, F, P, expands P per perturbation, and adds no block for a world-only perturbation.',
  flags: true,
  async run(ctx) {
    const result = await cli(
      ['campaign', 'plan', join(ctx.root, LOOSE), '--target', TARGET, '--mode', 'P,T', '--json'],
      ctx.dir,
    );
    const cells =
      json<{ cells?: Array<{ mode: string; perturbationId?: string; blocks: number }> }>(result.out)?.cells ??
      [];
    const got = cells.map((cell) => `${cell.mode}:${cell.perturbationId ?? '-'}:${cell.blocks}`).join(' ');
    const want = 'T:-:4 P:second-loose-yes:5 P:order-service-down:4';
    return expectAll([[got === want, `expected cells ${want}; got ${got || shown(result)}`]]);
  },
});

const mdeOf = (p: number, n: number) => powerMde({ n, baselineRate: p }).effect;

add({
  slug: 'plan/mde-own-targets',
  tier: 3,
  component: PLANNER,
  title:
    'when each spec runs on its own target, the runs per arm are the cells of the mode over every spec: 7 for the Acme specs, with power computed by stats.mde (running.md "The minimum detectable effect")',
  cause:
    'the planner counts the cells of the mode over every spec as the runs per arm when no --target is given.',
  async run(ctx) {
    const result = await cli(['campaign', 'plan', join(ctx.root, 'examples/acme/specs'), '--json'], ctx.dir);
    const mde = json<{ mde?: Array<{ runsPerArm: number; effect: number }> }>(result.out)?.mde?.[0];
    const loaded = await loadSpecs([join(ctx.root, 'examples/acme/specs')]);
    if (loaded.some((entry) => !entry.ok)) return fail('invalid Acme spec fixture');
    const n = loaded.length;
    const want = mdeOf(0.5, n);
    return expectAll([
      [mde?.runsPerArm === n, `expected runsPerArm ${n}, got ${mde?.runsPerArm}; ${shown(result)}`],
      [
        want === null
          ? mde !== undefined && mde.effect === undefined
          : Math.abs((mde?.effect ?? -1) - want) < 1e-6,
        `expected effect ${want}, got ${mde?.effect}`,
      ],
    ]);
  },
});

add({
  slug: 'plan/baseline-rate',
  tier: 2,
  component: PLANNER,
  title:
    'campaign plan --baseline-rate 0.9 puts p = 0.9 into the documented two-proportion power equation (running.md)',
  cause: 'campaign plan passes --baseline-rate into the minimum detectable effect.',
  flags: true,
  async run(ctx) {
    const repeats = 30 + (ctx.seed % 7);
    const result = await cli(
      [
        'campaign',
        'plan',
        join(ctx.root, PLAN_UPGRADE),
        '--target',
        TARGET,
        '--repeats',
        String(repeats),
        '--baseline-rate',
        '0.9',
        '--json',
      ],
      ctx.dir,
    );
    const mde = json<{ mde?: Array<{ effect: number; baselineRate: number }> }>(result.out)?.mde?.[0];
    const want = mdeOf(0.9, repeats);
    return expectAll([
      [mde?.baselineRate === 0.9, `expected baselineRate 0.9, got ${mde?.baselineRate}; ${shown(result)}`],
      [
        want === null
          ? mde !== undefined && mde.effect === undefined
          : Math.abs((mde?.effect ?? -1) - want) < 1e-6,
        `expected effect ${want}, got ${mde?.effect}`,
      ],
    ]);
  },
});

add({
  slug: 'plan/store-unit-cost',
  tier: 3,
  component: PLANNER,
  title:
    'campaign plan --store prices an adapter at its blocks times the cost per block measured in the store (running.md "campaign plan")',
  cause: 'campaign plan reads the block unit of each adapter from --store and multiplies it by the blocks.',
  flags: true,
  async run(ctx) {
    const path = join(ctx.dir, 'units.db');
    const store = openStore(path);
    const usd = 0.01 * ctx.seed;
    await store.putUnit({
      adapter: 'function',
      metric: 'block',
      usd,
      measuredAt: '2026-01-01T00:00:00.000Z',
    });
    await store.close();
    const result = await cli(
      ['campaign', 'plan', join(ctx.root, PLAN_UPGRADE), '--target', TARGET, '--store', path, '--json'],
      ctx.dir,
    );
    const cost = json<{ cost?: { usd: number; unmeasured: string[] } }>(result.out)?.cost;
    return expectAll([
      [
        Math.abs((cost?.usd ?? -1) - 5 * usd) < 1e-9,
        `expected usd ${5 * usd} (5 blocks), got ${cost?.usd}; ${shown(result)}`,
      ],
      [
        (cost?.unmeasured ?? []).length === 0,
        `expected no unmeasured adapter, got ${JSON.stringify(cost?.unmeasured)}`,
      ],
    ]);
  },
});

add({
  slug: 'run/not-kept-line',
  tier: 1,
  component: CAMPAIGN_CMD,
  title:
    'campaign run without --store ends with "The runs are not kept: pass --store <file> to keep them." (running.md)',
  cause: 'campaign run prints that the runs are not kept when no --store is given.',
  async run(ctx) {
    const result = await cli(['campaign', 'run', join(ctx.root, PLAN_UPGRADE), '--target', TARGET], ctx.dir);
    const want = 'The runs are not kept: pass --store <file> to keep them.';
    return expectAll([[result.out.includes(want), `expected "${want}"; ${shown(result)}`]]);
  },
});

add({
  slug: 'run/concurrency-header',
  tier: 2,
  component: CAMPAIGN_CMD,
  title:
    'campaign run --concurrency 2 says "2 at a time" in its header line, and a budget adds "Budget $1.50." (running.md)',
  cause: 'campaign run prints the concurrency and the budget it was given in its header.',
  flags: true,
  async run(ctx) {
    const result = await cli(
      [
        'campaign',
        'run',
        join(ctx.root, PLAN_UPGRADE),
        '--target',
        TARGET,
        '--concurrency',
        '2',
        '--budget-usd',
        '1.5',
        '--campaign',
        `c-hdr-${ctx.seed}`,
      ],
      ctx.dir,
    );
    const head = result.out.split('\n')[0] ?? '';
    return expectAll([
      [head.startsWith(`Campaign c-hdr-${ctx.seed}: 1 cell, 2 at a time.`), `header ${JSON.stringify(head)}`],
      [head.includes('Budget $1.50.'), `expected "Budget $1.50." in the header ${JSON.stringify(head)}`],
    ]);
  },
});

add({
  slug: 'run/dataset-sources',
  tier: 4,
  component: CAMPAIGN_CMD,
  title:
    'campaign run --dataset <ref> --prompt <ref> runs the dataset specs and the stored campaign records both versions in sources with 64-hex hashes (datasets.md)',
  cause:
    'campaign run records each --dataset and --prompt version by kind, name, number and full hash in the campaign sources.',
  flags: true,
  async run(ctx) {
    const specs = join(ctx.dir, 'specs');
    mkdirSync(specs, { recursive: true });
    cpSync(join(ctx.root, PLAN_UPGRADE), join(specs, 'plan-upgrade.yaml'));
    put(ctx.dir, 'prompts/sales.md', `You are the Acme sales assistant, version ${ctx.seed}.\n`);
    const store = join(ctx.dir, 'reg.db');
    const pushed = await cli(['dataset', 'push', 'acme-specs', 'specs', '--store', store], ctx.dir);
    const prompt = await cli(['prompt', 'push', 'acme-sales', 'prompts', '--store', store], ctx.dir);
    const run = await cli(
      [
        'campaign',
        'run',
        '--dataset',
        'acme-specs@1',
        '--prompt',
        'acme-sales',
        '--target',
        TARGET,
        '--campaign',
        `c-src-${ctx.seed}`,
        '--store',
        store,
        '--json',
      ],
      ctx.dir,
    );
    if (pushed.code !== 0 || prompt.code !== 0)
      return fail(`push failed: ${shown(pushed)} / ${shown(prompt)}`);
    const doc = json<{ cells?: unknown[] }>(run.out);
    const opened = openStore(store);
    const campaign = (await opened.getCampaign(`c-src-${ctx.seed}`)) as
      | { sources?: Array<{ kind: string; name: string; version: number; hash: string }> }
      | undefined;
    await opened.close();
    const sources = (campaign?.sources ?? [])
      .map((s) => `${s.kind}:${s.name}@${s.version}:${s.hash.length}`)
      .sort();
    return expectAll([
      [
        doc?.cells?.length === 1 && run.code === 0,
        `expected one passing cell from the dataset; ${shown(run)}`,
      ],
      [
        sources.join() === 'dataset:acme-specs@1:64,prompt:acme-sales@1:64',
        `expected sources dataset:acme-specs@1 and prompt:acme-sales@1 with 64-hex hashes, got ${sources.join() || 'none'}`,
      ],
    ]);
  },
});

add({
  slug: 'status/latest',
  tier: 2,
  component: CAMPAIGN_CMD,
  title:
    'campaign status without an id takes the latest campaign of the store, by creation, not by id order (running.md)',
  cause: 'campaign status picks the newest campaign of the store when no id is given.',
  flags: true,
  async run(ctx) {
    const store = join(ctx.dir, 's.db');
    const spec = join(ctx.root, PLAN_UPGRADE);
    await cli(
      ['campaign', 'run', spec, '--target', TARGET, '--store', store, '--campaign', `c-zzz-${ctx.seed}`],
      ctx.dir,
    );
    await cli(
      ['campaign', 'run', spec, '--target', TARGET, '--store', store, '--campaign', `c-aaa-${ctx.seed}`],
      ctx.dir,
    );
    const result = await cli(['campaign', 'status', '--store', store], ctx.dir);
    return expectAll([
      [
        result.out.startsWith(`Campaign c-aaa-${ctx.seed}, created `),
        `expected the second campaign c-aaa-${ctx.seed}; ${shown(result)}`,
      ],
    ]);
  },
});

add({
  slug: 'status/no-campaign',
  tier: 1,
  component: CAMPAIGN_CMD,
  title: 'campaign status on a store that holds no campaign exits 2 (running.md)',
  cause: 'campaign status exits 2 on a store with no campaign.',
  async run(ctx) {
    put(ctx.dir, 'specs/a.yaml', mini(`ds-${ctx.seed}`));
    const store = join(ctx.dir, 'only-datasets.db');
    await cli(['dataset', 'push', 'only', 'specs', '--store', store], ctx.dir);
    return exitIs(
      await cli(['campaign', 'status', '--store', store], ctx.dir),
      2,
      'status on a store with no campaign',
    );
  },
});

add({
  slug: 'status/detail-empty-tables',
  tier: 2,
  component: CAMPAIGN_CMD,
  title:
    'campaign status --detail on an F-only campaign prints "No spec ran in both T and F." and "No perturbed run." (running.md)',
  cause: 'campaign status --detail prints the documented lines for an empty compounding and recovery table.',
  flags: true,
  async run(ctx) {
    const store = join(ctx.dir, 'd.db');
    await cli(
      ['campaign', 'run', join(ctx.root, PLAN_UPGRADE), '--target', TARGET, '--store', store],
      ctx.dir,
    );
    const result = await cli(['campaign', 'status', '--store', store, '--detail'], ctx.dir);
    return expectAll([
      [
        result.out.includes('No spec ran in both T and F.'),
        `expected "No spec ran in both T and F."; ${shown(result)}`,
      ],
      [result.out.includes('No perturbed run.'), `expected "No perturbed run."; ${shown(result)}`],
    ]);
  },
});

add({
  slug: 'resume/stored-zero-budget',
  tier: 3,
  component: CAMPAIGN_CMD,
  title:
    'campaign resume reads a stored budget of 0 as no budget: cells the zero budget stopped run and pass, exit 0 (running.md "The budget")',
  cause: 'campaign resume treats a stored budget of 0 as no budget and reruns stopped cells.',
  flags: true,
  async run(ctx) {
    const store = join(ctx.dir, 'b.db');
    const first = await cli(
      [
        'campaign',
        'run',
        join(ctx.root, PLAN_UPGRADE),
        '--target',
        TARGET,
        '--store',
        store,
        '--budget-usd',
        '0',
      ],
      ctx.dir,
    );
    const resumed = await cli(['campaign', 'resume', '--store', store], ctx.dir);
    return expectAll([
      [first.code === 1, `the zero-budget run: expected exit 1, got ${first.code}`],
      [
        resumed.code === 0 && resumed.out.includes('1 pass'),
        `resume: expected exit 0 and 1 pass; ${shown(resumed)}`,
      ],
    ]);
  },
});

add({
  slug: 'resume/explicit-budget-zero',
  tier: 2,
  component: CAMPAIGN_CMD,
  title:
    'campaign resume --budget-usd 0 stops the cells again and exits 1 (cli.md option table: "resume: the same stop")',
  cause: 'campaign resume applies an explicit --budget-usd as a hard stop.',
  flags: true,
  async run(ctx) {
    const store = join(ctx.dir, 'b.db');
    await cli(
      [
        'campaign',
        'run',
        join(ctx.root, PLAN_UPGRADE),
        '--target',
        TARGET,
        '--store',
        store,
        '--budget-usd',
        '0',
      ],
      ctx.dir,
    );
    const resumed = await cli(['campaign', 'resume', '--store', store, '--budget-usd', '0'], ctx.dir);
    return expectAll([
      [
        resumed.code === 1 && resumed.out.includes('stopped'),
        `expected the cell stopped again, exit 1; ${shown(resumed)}`,
      ],
    ]);
  },
});

add({
  slug: 'resume/specs-from-store',
  tier: 4,
  component: CAMPAIGN_CMD,
  title:
    'campaign resume runs the specs from the store at the hashes the campaign pins: editing the file on disk after the run changes nothing (running.md "campaign resume")',
  cause: 'campaign resume loads each cell spec from the store by its pinned hash, never from disk.',
  source: 'adversarial',
  async run(ctx) {
    const file = join(ctx.dir, 'plan-upgrade.yaml');
    const text = readFileSync(join(ctx.root, PLAN_UPGRADE), 'utf8');
    writeFileSync(file, text);
    const store = join(ctx.dir, 'r.db');
    await cli(['campaign', 'run', file, '--target', TARGET, '--store', store, '--budget-usd', '0'], ctx.dir);
    const doc = parse(text) as { blocks: Array<{ expect: { must?: string[] } }> };
    (doc.blocks[0] as { expect: { must?: string[] } }).expect.must = [`NEVER-SAID-${ctx.seed}`];
    writeFileSync(file, stringify(doc));
    const resumed = await cli(['campaign', 'resume', '--store', store], ctx.dir);
    return exitIs(resumed, 0, 'resume after the spec file on disk was planted with a failing must');
  },
});

add({
  slug: 'smoke/own-target',
  tier: 1,
  component: SMOKE_CMD,
  title:
    'smoke without --target runs the spec on its own target, function:acme-sales (running.md smoke options)',
  cause: "smoke takes the spec's own target when no --target is given.",
  flags: true,
  async run(ctx) {
    const result = await cli(['smoke', join(ctx.root, PLAN_UPGRADE), '--json'], ctx.dir);
    const doc = json<{ target?: { adapter: string; agent?: string } }>(result.out);
    return expectAll([
      [
        doc?.target?.adapter === 'function' && doc.target.agent === 'acme-sales',
        `expected target function:acme-sales, got ${JSON.stringify(doc?.target)}; ${shown(result)}`,
      ],
    ]);
  },
});

add({
  slug: 'smoke/documented-transcript',
  tier: 2,
  component: SMOKE_CMD,
  title:
    'smoke on plan-upgrade with --target function:acme prints "transcript 9ec7c3e69cd4" for each run and "✓ The transcripts are identical." (running.md)',
  cause:
    'smoke hashes the transcript without cost, latency, timestamps and the raw trace, as running.md documents.',
  async run(ctx) {
    const result = await cli(['smoke', join(ctx.root, PLAN_UPGRADE), '--target', TARGET], ctx.dir);
    const lines = result.out.split('\n').filter((line) => line.includes('transcript 9ec7c3e69cd4'));
    return expectAll([
      [lines.length === 3, `expected 3 runs with transcript 9ec7c3e69cd4; ${shown(result)}`],
      [
        result.out.includes('✓ The transcripts are identical.'),
        `expected the identical line; ${shown(result)}`,
      ],
    ]);
  },
});

add({
  slug: 'smoke/no-checks',
  tier: 3,
  component: SMOKE_CMD,
  title:
    'smoke runs with no checks: a spec whose must the agent never meets still gives identical transcripts and exit 0 (running.md smoke)',
  cause: 'smoke runs the spec without checks, so a failing expectation does not change its exit.',
  source: 'adversarial',
  async run(ctx) {
    const doc = parse(readFileSync(join(ctx.root, PLAN_UPGRADE), 'utf8')) as {
      blocks: Array<{ expect: { must?: string[] } }>;
    };
    (doc.blocks[1] as { expect: { must?: string[] } }).expect.must = [`NEVER-SAID-${ctx.seed}`];
    const file = put(ctx.dir, 'planted.yaml', stringify(doc));
    return exitIs(
      await cli(['smoke', file, '--target', TARGET], ctx.dir),
      0,
      'smoke on a spec with an unmet must',
    );
  },
});

// ---------------------------------------------------------------- space

add({
  slug: 'space/coverage-documented',
  tier: 2,
  component: SPACE_COVERAGE,
  title:
    'space coverage --t 2 on the Acme specs and map prints the Coverage line cli.md prints for that command, and exits 1 (cli.md space coverage)',
  cause: 'space coverage counts the required cells and the t-wise cells as cli.md documents.',
  async run(ctx) {
    const block = docBlock(
      ctx.root,
      'docs/reference/cli.md',
      'pnpm -s driftbench space coverage --map packages/space/test/fixtures/acme-space.yaml examples/acme/specs --t 2',
    );
    if (typeof block === 'string') return fail(block);
    const want = block.find((line) => line.startsWith('Coverage: '));
    if (!want) return fail('cli.md prints no Coverage line for space coverage --t 2 on the Acme specs');
    const result = await cli(
      [
        'space',
        'coverage',
        '--map',
        join(ctx.root, SPACE_FIXTURE),
        join(ctx.root, 'examples/acme/specs'),
        '--t',
        '2',
      ],
      ctx.dir,
    );
    return expectAll([
      [result.out.split('\n').includes(want), `cli.md prints "${want}"; ${shown(result)}`],
      [result.code === 1, `expected exit 1, got ${result.code}`],
    ]);
  },
});

function smallMap(
  agent: string,
  dims: Array<{ id: string; kind: string; values: string[] }>,
  extra: Record<string, unknown> = {},
): string {
  return stringify({
    version: '1',
    agent,
    dimensions: dims.map((dim) => ({
      id: dim.id,
      title: dim.id,
      kind: dim.kind,
      values: dim.values.map((id) => ({ id, title: id })),
    })),
    constraints: [],
    prior: { kind: 'declared' },
    ...extra,
  });
}

add({
  slug: 'space/grid-limit',
  tier: 2,
  component: SPACE_CMD,
  title: 'a full grid over 250000 cells is an input error, exit 2 (cli.md space exit table)',
  cause: 'the space commands refuse a full grid over 250000 cells.',
  source: 'scale',
  async run(ctx) {
    const values = (prefix: string) => Array.from({ length: 64 }, (_, i) => `${prefix}${i}`);
    put(
      ctx.dir,
      'big.yaml',
      smallMap(`big-${ctx.seed}`, [
        { id: 'a', kind: 'data', values: values('a') },
        { id: 'b', kind: 'persona', values: values('b') },
        { id: 'c', kind: 'task', values: values('c') },
      ]),
    );
    return exitIs(
      await cli(['space', 'coverage', join(ctx.root, PLAN_UPGRADE), '--map', 'big.yaml'], ctx.dir),
      2,
      'a full grid of 262144 cells',
    );
  },
});

add({
  slug: 'space/strict-keys',
  tier: 2,
  component: SPACE_LOAD,
  title:
    'every key of the map is checked strictly: an unknown top-level key stops the command with SCHEMA_UNRECOGNIZED_KEYS, exit 2 (cli.md space)',
  cause: 'the space map loader refuses unknown keys with SCHEMA_UNRECOGNIZED_KEYS.',
  async run(ctx) {
    put(
      ctx.dir,
      'map.yaml',
      smallMap('strict', [{ id: 'channel', kind: 'channel', values: ['chat'] }], { colour: ctx.seed }),
    );
    const result = await cli(
      ['space', 'coverage', join(ctx.root, PLAN_UPGRADE), '--map', 'map.yaml'],
      ctx.dir,
    );
    return expectAll([
      [result.code === 2, `expected exit 2; ${shown(result)}`],
      [
        `${result.out}${result.err}`.includes('SCHEMA_UNRECOGNIZED_KEYS'),
        `expected SCHEMA_UNRECOGNIZED_KEYS; ${shown(result)}`,
      ],
    ]);
  },
});

add({
  slug: 'space/forbidden-cell',
  tier: 3,
  component: SPACE_COVERAGE,
  title:
    'a spec in a cell the constraints forbid warns FORBIDDEN_CELL and the cell counts in neither the covered nor the allowed cells (cli.md space coverage)',
  cause: 'space coverage leaves forbidden cells out of both counts and warns FORBIDDEN_CELL.',
  async run(ctx) {
    put(
      ctx.dir,
      'map.yaml',
      smallMap('forbid', [{ id: 'channel', kind: 'channel', values: ['chat', 'whatsapp'] }], {
        constraints: [{ forbid: { channel: 'chat' }, reason: 'no chat in this map' }],
      }),
    );
    const result = await cli(
      ['space', 'coverage', join(ctx.root, PLAN_UPGRADE), '--map', 'map.yaml', '--json'],
      ctx.dir,
    );
    const doc = json<{ grid?: { allowed: number; covered: number }; warnings?: Array<{ code: string }> }>(
      result.out,
    );
    return expectAll([
      [
        doc?.grid?.allowed === 1 && doc.grid.covered === 0,
        `expected 1 allowed, 0 covered, got ${JSON.stringify(doc?.grid)?.slice(0, 160)}; ${shown(result)}`,
      ],
      [
        doc?.warnings?.some((w) => w.code === 'FORBIDDEN_CELL') === true,
        `expected FORBIDDEN_CELL in ${JSON.stringify(doc?.warnings?.map((w) => w.code))}`,
      ],
    ]);
  },
});

add({
  slug: 'space/complete-line',
  tier: 3,
  component: SPACE_CMD,
  title:
    'space complete prints the completeness line and exits 0 when there are at least as many conversations as allowed cells (cli.md space complete)',
  cause: 'space complete prints the completeness line once the conversations reach the allowed cells.',
  async run(ctx) {
    put(ctx.dir, 'map.yaml', smallMap('complete', [{ id: 'channel', kind: 'channel', values: ['chat'] }]));
    const result = await cli(
      ['space', 'complete', join(ctx.root, CONVERSATIONS), '--map', 'map.yaml'],
      ctx.dir,
    );
    return expectAll([
      [result.code === 0, `expected exit 0; ${shown(result)}`],
      [!result.out.includes('No completeness line'), `expected the completeness line; ${shown(result)}`],
    ]);
  },
});

add({
  slug: 'space/complete-too-few',
  tier: 2,
  component: SPACE_CMD,
  title:
    'space complete --t 1 on the Acme specs says "No completeness line: ... there are 7 for 46." and exits 1 (cli.md space complete)',
  cause: 'space complete exits 1 and says why when the conversations are fewer than the cells.',
  async run(ctx) {
    const result = await cli(
      [
        'space',
        'complete',
        join(ctx.root, 'examples/acme/specs'),
        '--map',
        join(ctx.root, SPACE_FIXTURE),
        '--t',
        '1',
      ],
      ctx.dir,
    );
    return expectAll([
      [result.out.includes('there are 7 for 46.'), `expected "there are 7 for 46."; ${shown(result)}`],
      [result.code === 1, `expected exit 1, got ${result.code}`],
    ]);
  },
});

add({
  slug: 'space/declare-never-overwrites',
  tier: 1,
  component: SPACE_CMD,
  title:
    'space declare writes the map, exit 0, and a second declare on the same file exits 2 and leaves it as it was (cli.md space declare)',
  cause: 'space declare refuses to overwrite an existing file.',
  async run(ctx) {
    const argv = [
      'space',
      'declare',
      join(ctx.root, 'examples/acme/specs'),
      '--inventory',
      join(ctx.root, 'examples/acme/inventory.yaml'),
      '--out',
      'map.yaml',
    ];
    const first = await cli(argv, ctx.dir);
    const before = existsSync(join(ctx.dir, 'map.yaml'))
      ? readFileSync(join(ctx.dir, 'map.yaml'), 'utf8')
      : '';
    const second = await cli(argv, ctx.dir);
    const after = existsSync(join(ctx.dir, 'map.yaml'))
      ? readFileSync(join(ctx.dir, 'map.yaml'), 'utf8')
      : '';
    return expectAll([
      [first.code === 0 && before.length > 0, `first declare: ${shown(first)}`],
      [
        second.code === 2 && after === before,
        `second declare: expected exit 2 and the file unchanged; ${shown(second)}`,
      ],
    ]);
  },
});

add({
  slug: 'space/declare-agent',
  tier: 2,
  component: SPACE_CMD,
  title:
    'space declare --agent <name> writes that agent into the declared map, which declares stage, behaviour, deviation and channel only (cli.md space declare)',
  cause: 'space declare writes --agent and leaves persona, data and task dimensions to the owner.',
  flags: true,
  async run(ctx) {
    const result = await cli(
      [
        'space',
        'declare',
        join(ctx.root, 'examples/acme/specs'),
        '--inventory',
        join(ctx.root, 'examples/acme/inventory.yaml'),
        '--out',
        'map.yaml',
        '--agent',
        `agent-${ctx.seed}`,
      ],
      ctx.dir,
    );
    const doc = existsSync(join(ctx.dir, 'map.yaml'))
      ? (parse(readFileSync(join(ctx.dir, 'map.yaml'), 'utf8')) as {
          agent?: string;
          dimensions?: Array<{ kind: string }>;
        })
      : undefined;
    const kinds = (doc?.dimensions ?? [])
      .map((dim) => dim.kind)
      .sort()
      .join();
    return expectAll([
      [
        doc?.agent === `agent-${ctx.seed}`,
        `expected agent agent-${ctx.seed}, got ${doc?.agent}; ${shown(result)}`,
      ],
      [
        kinds === 'behaviour,channel,deviation,stage',
        `expected kinds behaviour, channel, deviation, stage, got ${kinds}`,
      ],
    ]);
  },
});

// ---------------------------------------------------------------- extract

/** Writes a code-only proposal from the Acme inventory and tools into the item's folder. */
async function proposal(ctx: Ctx): Promise<{ result: Cli; path: string }> {
  const result = await cli(
    [
      'extract',
      '--prompt',
      join(ctx.root, 'examples/acme/README.md'),
      '--inventory',
      join(ctx.root, 'examples/acme/inventory.yaml'),
      '--tools',
      join(ctx.root, 'examples/acme/map/tools.yaml'),
      '--out',
      'prop/proposal.yaml',
      '--no-model',
    ],
    ctx.dir,
  );
  return { result, path: join(ctx.dir, 'prop/proposal.yaml') };
}

add({
  slug: 'extract/proposal-is-space-map',
  tier: 3,
  component: SPACE_LOAD,
  title:
    'extract writes a proposal, not a space map: the space command refuses it until extract map converts its approved axes (cli.md extract)',
  cause: 'the space map loader refuses proposal-only fields and requires conversion through extract map.',
  async run(ctx) {
    const { result, path } = await proposal(ctx);
    if (result.code !== 0) return fail(`extract --no-model: ${shown(result)}`);
    const coverage = await cli(['space', 'coverage', join(ctx.root, CONVERSATIONS), '--map', path], ctx.dir);
    const docs = readFileSync(join(ctx.root, 'docs/reference/cli.md'), 'utf8');
    if (!docs.includes('The proposal is not a space map'))
      return fail('missing proposal/map boundary in CLI docs');
    return coverage.code === 2 ? PASS : fail(`expected proposal rejection, exit 2; ${shown(coverage)}`);
  },
});

add({
  slug: 'extract/agent-default',
  tier: 2,
  component: EXTRACT_CMD,
  title: 'extract without --agent names the agent after the folder of the inventory (cli.md extract options)',
  cause: 'extract defaults the agent name to the folder of the inventory.',
  flags: true,
  async run(ctx) {
    const folder = `inv-${ctx.seed}`;
    cpSync(join(ctx.root, 'examples/acme/inventory.yaml'), join(ctx.dir, folder, 'inventory.yaml'));
    const result = await cli(
      [
        'extract',
        '--prompt',
        join(ctx.root, 'examples/acme/README.md'),
        '--inventory',
        `${folder}/inventory.yaml`,
        '--out',
        'p.yaml',
        '--no-model',
      ],
      ctx.dir,
    );
    const doc = existsSync(join(ctx.dir, 'p.yaml'))
      ? (parse(readFileSync(join(ctx.dir, 'p.yaml'), 'utf8')) as { agent?: string })
      : undefined;
    return expectAll([
      [doc?.agent === folder, `expected agent ${folder}, got ${doc?.agent}; ${shown(result)}`],
    ]);
  },
});

add({
  slug: 'extract/force',
  tier: 2,
  component: EXTRACT_CMD,
  title:
    'extract onto an existing proposal exits 2 and writes nothing; with --force it replaces it, exit 0 (cli.md extract)',
  cause: 'extract refuses an existing --out without --force and replaces it with --force.',
  flags: true,
  async run(ctx) {
    const first = await proposal(ctx);
    writeFileSync(first.path, `${readFileSync(first.path, 'utf8')}# marker ${ctx.seed}\n`);
    const marked = readFileSync(first.path, 'utf8');
    const again = await proposal(ctx);
    const kept = readFileSync(first.path, 'utf8');
    const forced = await cli(
      [
        'extract',
        '--prompt',
        join(ctx.root, 'examples/acme/README.md'),
        '--inventory',
        join(ctx.root, 'examples/acme/inventory.yaml'),
        '--tools',
        join(ctx.root, 'examples/acme/map/tools.yaml'),
        '--out',
        'prop/proposal.yaml',
        '--no-model',
        '--force',
      ],
      ctx.dir,
    );
    return expectAll([
      [
        again.result.code === 2 && kept === marked,
        `without --force: expected exit 2 and the file unchanged; ${shown(again.result)}`,
      ],
      [
        forced.code === 0 && !readFileSync(first.path, 'utf8').includes(`# marker ${ctx.seed}`),
        `with --force: ${shown(forced)}`,
      ],
    ]);
  },
});

add({
  slug: 'extract/approve-to-other-file',
  tier: 3,
  component: EXTRACT_CMD,
  title:
    'extract approve --dimension behaviour --to <file in the same folder> writes the approval there and leaves the proposal unapproved (cli.md extract approve)',
  cause: 'extract approve --to writes the approved copy to the other file and never over the proposal.',
  flags: true,
  async run(ctx) {
    const { result, path } = await proposal(ctx);
    if (result.code !== 0) return fail(`extract --no-model: ${shown(result)}`);
    const before = readFileSync(path, 'utf8');
    const approved = await cli(
      ['extract', 'approve', path, '--dimension', 'behaviour', '--to', join(ctx.dir, 'prop/approved.yaml')],
      ctx.dir,
    );
    const copy = existsSync(join(ctx.dir, 'prop/approved.yaml'))
      ? (parse(readFileSync(join(ctx.dir, 'prop/approved.yaml'), 'utf8')) as {
          dimensions?: Array<{ id: string; approved?: boolean }>;
        })
      : undefined;
    const dim = copy?.dimensions?.find((d) => d.id === 'behaviour');
    return expectAll([
      [approved.code === 0, `expected exit 0; ${shown(approved)}`],
      [
        dim?.approved === true,
        `expected behaviour approved in the copy, got ${JSON.stringify(dim)?.slice(0, 120)}`,
      ],
      [readFileSync(path, 'utf8') === before, 'the proposal itself changed'],
    ]);
  },
});

add({
  slug: 'extract/approve-unknown-dimension',
  tier: 1,
  component: EXTRACT_CMD,
  title: 'extract approve --dimension <unknown id> exits 1 (cli.md extract exit table)',
  cause: 'extract approve exits 1 on a dimension the proposal does not have.',
  async run(ctx) {
    const { result, path } = await proposal(ctx);
    if (result.code !== 0) return fail(`extract --no-model: ${shown(result)}`);
    return exitIs(
      await cli(['extract', 'approve', path, '--dimension', `nosuch-${ctx.seed}`], ctx.dir),
      1,
      'an unknown dimension',
    );
  },
});

add({
  slug: 'extract/map-all',
  tier: 2,
  component: EXTRACT_CMD,
  title:
    'extract map on an unapproved proposal exits 1 (no approved axis); with --all it takes every axis value and writes the space map, exit 0 (cli.md extract map)',
  cause: 'extract map writes only approved axes, and every axis with --all.',
  flags: true,
  async run(ctx) {
    const { result, path } = await proposal(ctx);
    if (result.code !== 0) return fail(`extract --no-model: ${shown(result)}`);
    const plain = await cli(['extract', 'map', path, '--to', 'space.yaml'], ctx.dir);
    const all = await cli(['extract', 'map', path, '--to', 'space-all.yaml', '--all'], ctx.dir);
    return expectAll([
      [plain.code === 1, `without --all: expected exit 1; ${shown(plain)}`],
      [
        all.code === 0 && existsSync(join(ctx.dir, 'space-all.yaml')),
        `with --all: expected exit 0 and the file; ${shown(all)}`,
      ],
    ]);
  },
});

add({
  slug: 'extract/map-documented',
  tier: 2,
  component: EXTRACT_CMD,
  title:
    'extract map on the approved Acme proposal reports the axes, constraints and grid documented in cli.md',
  cause: 'extract map builds the space map of the approved axes and constraints as cli.md documents.',
  async run(ctx) {
    const result = await cli(
      [
        'extract',
        'map',
        join(ctx.root, 'examples/acme/map/approved.yaml'),
        '--to',
        join(ctx.dir, 'space.yaml'),
      ],
      ctx.dir,
    );
    const page = readFileSync(join(ctx.root, 'docs/reference/cli.md'), 'utf8');
    const want = /Wrote [^\n]+: (\d+ axes \([^\n]+\), \d+ constraints, a full grid of \d+ cells\.)/.exec(
      page,
    )?.[1];
    return expectAll([
      [
        result.code === 0 && want !== undefined && result.out.includes(want),
        `expected "${want}"; ${shown(result)}`,
      ],
    ]);
  },
});

// ---------------------------------------------------------------- dataset and prompt registry

function copyConversations(ctx: Ctx, folder: string): string {
  const dir = join(ctx.dir, folder);
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(join(ctx.root, CONVERSATIONS))) {
    cpSync(join(ctx.root, CONVERSATIONS, name), join(dir, name));
  }
  return dir;
}

add({
  slug: 'dataset/documented-hashes',
  tier: 3,
  component: REGISTRY,
  title:
    'dataset push of the six Acme conversation specs, then again after adding "# edited" under the id of plan-upgrade.yaml, gives the two hashes datasets.md prints ("The registry")',
  cause:
    'the registry hashes a version as the SHA-256 of its sorted paths and file hashes, as datasets.md documents.',
  async run(ctx) {
    const hashOf = (command: string, version: number): string | undefined => {
      const block = docBlock(ctx.root, 'docs/datasets.md', command);
      if (typeof block === 'string') return undefined;
      const line = block.find((each) => each.startsWith(`Pushed dataset acme-specs@${version} (hash `));
      return line ? /\(hash ([0-9a-f]+)\)/.exec(line)?.[1] : undefined;
    };
    const firstHash = hashOf(
      "pnpm -s driftbench dataset push acme-specs _demo/specs --store _demo/store.db --note 'first import'",
      1,
    );
    const secondHash = hashOf(
      'pnpm -s driftbench dataset push acme-specs _demo/specs --store _demo/store.db',
      2,
    );
    if (!firstHash || !secondHash)
      return fail('datasets.md prints no hash for one of the two pushes of acme-specs');
    const dir = copyConversations(ctx, 'specs');
    const store = join(ctx.dir, 'r.db');
    const first = await cli(['dataset', 'push', `acme-${ctx.seed}`, 'specs', '--store', store], ctx.dir);
    const file = join(dir, 'plan-upgrade.yaml');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('id: acme-plan-upgrade\n', 'id: acme-plan-upgrade\n# edited\n'),
    );
    const second = await cli(['dataset', 'push', `acme-${ctx.seed}`, 'specs', '--store', store], ctx.dir);
    return expectAll([
      [
        first.out.includes(`@1 (hash ${firstHash})`),
        `datasets.md prints ${firstHash} for @1; first push: ${shown(first)}`,
      ],
      [
        second.out.includes(`@2 (hash ${secondHash})`),
        `datasets.md prints ${secondHash} for @2; second push: ${shown(second)}`,
      ],
    ]);
  },
});

add({
  slug: 'dataset/same-content-same-version',
  tier: 2,
  component: REGISTRY,
  title:
    'pushing content a name already holds gives back that version and adds nothing: a second push stays @1 (datasets.md)',
  cause: 'dataset push returns the existing version for content the name already holds.',
  async run(ctx) {
    put(ctx.dir, 'specs/a.yaml', mini(`same-${ctx.seed}`));
    const store = join(ctx.dir, 'r.db');
    await cli(['dataset', 'push', 'same', 'specs', '--store', store], ctx.dir);
    const again = await cli(['dataset', 'push', 'same', 'specs', '--store', store, '--json'], ctx.dir);
    const list = await cli(['dataset', 'list', 'same', '--store', store, '--json'], ctx.dir);
    const doc = json<{ version?: number; created?: boolean }>(again.out);
    const versions = json<unknown[]>(list.out) ?? [];
    return expectAll([
      [doc?.version === 1, `expected version 1 again, got ${doc?.version}; ${shown(again)}`],
      [versions.length === 1, `expected 1 version listed, got ${versions.length}; ${shown(list)}`],
    ]);
  },
});

add({
  slug: 'dataset/diff-and-restore',
  tier: 3,
  component: REGISTRY_CMD,
  title:
    'after an edit: diff @2 marks "M plan-upgrade.yaml" and exits 1; restore @1 stops on the changed file with exit 1 and writes nothing; --force restores "1 written, 5 unchanged" (datasets.md)',
  cause:
    'dataset diff and restore compare file hashes, and restore writes nothing on a conflict without --force.',
  flags: true,
  async run(ctx) {
    const dir = copyConversations(ctx, 'specs');
    const store = join(ctx.dir, 'r.db');
    await cli(['dataset', 'push', 'acme', 'specs', '--store', store], ctx.dir);
    const file = join(dir, 'plan-upgrade.yaml');
    const edited = readFileSync(file, 'utf8').replace(
      'id: acme-plan-upgrade\n',
      `id: acme-plan-upgrade\n# edited ${ctx.seed}\n`,
    );
    writeFileSync(file, edited);
    await cli(['dataset', 'push', 'acme', 'specs', '--store', store], ctx.dir);
    const diff = await cli(['dataset', 'diff', 'acme@2', '--store', store], ctx.dir);
    const refused = await cli(['dataset', 'restore', 'acme@1', '--store', store], ctx.dir);
    const keptEdit = readFileSync(file, 'utf8') === edited;
    const forced = await cli(['dataset', 'restore', 'acme@1', '--store', store, '--force'], ctx.dir);
    return expectAll([
      [diff.code === 1 && diff.out.includes('M plan-upgrade.yaml'), `diff: ${shown(diff)}`],
      [
        refused.code === 1 && keptEdit,
        `restore without --force: expected exit 1 and nothing written; ${shown(refused)}`,
      ],
      [
        forced.code === 0 && forced.out.includes('1 written, 5 unchanged'),
        `restore --force: ${shown(forced)}`,
      ],
      [!readFileSync(file, 'utf8').includes('# edited'), 'restore --force left the edited bytes'],
    ]);
  },
});

add({
  slug: 'dataset/ref-forms',
  tier: 2,
  component: REGISTRY,
  title:
    'a ref may be name@version, name@latest, name@<six or more hex of the hash> or a bare name for the latest: all resolve, and equal versions diff to exit 0 (datasets.md)',
  cause:
    'the registry, or datasets.md, settles a ref of six or more digits: a hash prefix as the page lists it, or a version number',
  async run(ctx) {
    put(ctx.dir, 'specs/a.yaml', mini(`ref-${ctx.seed}`));
    const store = join(ctx.dir, 'r.db');
    const pushed = await cli(['dataset', 'push', 'refs', 'specs', '--store', store, '--json'], ctx.dir);
    const hash = json<{ hash?: string }>(pushed.out)?.hash ?? '';
    const latest = await cli(
      ['dataset', 'diff', 'refs@latest', `refs@${hash.slice(0, 6)}`, '--store', store],
      ctx.dir,
    );
    const bare = await cli(['dataset', 'diff', 'refs', 'refs@1', '--store', store], ctx.dir);
    return expectAll([
      [/^[0-9a-f]{64}$/.test(hash), `expected a 64-hex hash from push --json, got ${hash}; ${shown(pushed)}`],
      [latest.code === 0, `refs@latest vs refs@${hash.slice(0, 6)}: ${shown(latest)}`],
      [bare.code === 0, `refs vs refs@1: ${shown(bare)}`],
    ]);
  },
});

add({
  slug: 'dataset/push-skips-dot-and-node-modules',
  tier: 2,
  component: REGISTRY_CMD,
  title:
    'dataset push skips entries whose name starts with a dot and node_modules (datasets.md "The registry")',
  cause: 'dataset push skips dot entries and node_modules when it reads the folder.',
  async run(ctx) {
    put(ctx.dir, 'specs/a.yaml', mini(`kept-${ctx.seed}`));
    put(ctx.dir, 'specs/.cache/x.yaml', mini('hidden'));
    put(ctx.dir, 'specs/.notes.yaml', mini('dotfile'));
    put(ctx.dir, 'specs/node_modules/pkg/y.yaml', mini('module'));
    const result = await cli(
      ['dataset', 'push', 'skips', 'specs', '--store', join(ctx.dir, 'r.db'), '--json'],
      ctx.dir,
    );
    const files = (json<{ files?: Array<{ path: string }> }>(result.out)?.files ?? []).map((f) => f.path);
    return expectAll([
      [files.join() === 'a.yaml', `expected only a.yaml, got ${files.join(', ') || shown(result)}`],
    ]);
  },
});

add({
  slug: 'dataset/push-invalid',
  tier: 1,
  component: REGISTRY_CMD,
  title:
    'dataset push refuses a folder with an invalid spec, exit 1, and stores no version (cli.md dataset exit table)',
  cause: 'dataset push loads every spec first and refuses the push on an invalid one.',
  async run(ctx) {
    put(ctx.dir, 'specs/a.yaml', mini(`good-${ctx.seed}`));
    put(ctx.dir, 'specs/b.yaml', `id: bad\nblocks:\n  - expect: { must: [a] }\n`);
    const store = join(ctx.dir, 'r.db');
    const pushed = await cli(['dataset', 'push', 'bad', 'specs', '--store', store], ctx.dir);
    const list = await cli(['dataset', 'list', '--store', store, '--json'], ctx.dir);
    return expectAll([
      [pushed.code === 1, `expected exit 1; ${shown(pushed)}`],
      [(json<unknown[]>(list.out) ?? ['?']).length === 0, `expected no version stored; ${shown(list)}`],
    ]);
  },
});

add({
  slug: 'prompt/no-spec-check',
  tier: 2,
  component: REGISTRY_CMD,
  title:
    'prompt push stores any files: only dataset push loads specs, so a YAML file that is no spec pushes fine, exit 0 (cli.md "push")',
  cause: 'prompt push stores files without loading them as specs.',
  flags: true,
  async run(ctx) {
    put(ctx.dir, 'prompts/system.yaml', `role: system\ntext: You are the Acme assistant ${ctx.seed}.\n`);
    return exitIs(
      await cli(['prompt', 'push', 'p', 'prompts', '--store', join(ctx.dir, 'r.db')], ctx.dir),
      0,
      'prompt push of a non-spec YAML file',
    );
  },
});

add({
  slug: 'dataset/diff-dir',
  tier: 2,
  component: REGISTRY_CMD,
  title: 'dataset diff <ref> --dir <folder> marks a file only in the folder "A" and exits 1 (datasets.md)',
  cause: 'dataset diff --dir compares a version with the files of a folder.',
  flags: true,
  async run(ctx) {
    put(ctx.dir, 'specs/a.yaml', mini(`dir-${ctx.seed}`));
    const store = join(ctx.dir, 'r.db');
    await cli(['dataset', 'push', 'dir', 'specs', '--store', store], ctx.dir);
    put(ctx.dir, 'specs/new.yaml', mini(`new-${ctx.seed}`));
    const result = await cli(['dataset', 'diff', 'dir@1', '--dir', 'specs', '--store', store], ctx.dir);
    return expectAll([
      [
        result.code === 1 && result.out.includes('A new.yaml'),
        `expected "A new.yaml" and exit 1; ${shown(result)}`,
      ],
    ]);
  },
});

// ---------------------------------------------------------------- import

add({
  slug: 'import/documented',
  tier: 1,
  component: IMPORT_CMD,
  title:
    'import csv of the Acme cases writes two specs, "Imported 2 specs from 3 rows of cases.csv", each starting with "# Imported from cases.csv, rows ..." (datasets.md)',
  cause: 'import csv groups rows by group_by and writes one commented spec file per group.',
  async run(ctx) {
    const result = await cli(
      [
        'import',
        'csv',
        join(ctx.root, 'examples/acme/import/cases.csv'),
        '--mapping',
        join(ctx.root, 'examples/acme/import/mapping.yaml'),
        '--out',
        'out',
      ],
      ctx.dir,
    );
    const file = join(ctx.dir, 'out/acme-imported-upgrade.yaml');
    const head = existsSync(file) ? (readFileSync(file, 'utf8').split('\n')[0] ?? '') : '';
    return expectAll([
      [
        result.out.includes('Imported 2 specs from 3 rows of cases.csv'),
        `expected the summary line; ${shown(result)}`,
      ],
      [
        head === '# Imported from cases.csv, rows 2, 3.',
        `expected the first line "# Imported from cases.csv, rows 2, 3.", got ${JSON.stringify(head)}`,
      ],
    ]);
  },
});

add({
  slug: 'import/invalid-row',
  tier: 2,
  component: IMPORT_CMD,
  title: 'import csv where a row makes an invalid spec exits 1 and writes nothing (cli.md import exit table)',
  cause: 'import checks every spec before writing and writes nothing when one is invalid.',
  async run(ctx) {
    put(ctx.dir, 'cases.csv', `case,question,stage\nok,Hello there,greet\nbad,,greet\n`);
    put(
      ctx.dir,
      'mapping.yaml',
      stringify({
        spec: { id: `imp-{case}-${ctx.seed}` },
        block: { user: '{question}', expect: { stage: '{stage}' } },
      }),
    );
    const result = await cli(
      ['import', 'csv', 'cases.csv', '--mapping', 'mapping.yaml', '--out', 'out'],
      ctx.dir,
    );
    const written = existsSync(join(ctx.dir, 'out')) ? readdirSync(join(ctx.dir, 'out')) : [];
    return expectAll([
      [result.code === 1, `expected exit 1; ${shown(result)}`],
      [written.length === 0, `expected nothing written, found ${written.join(', ')}`],
    ]);
  },
});

add({
  slug: 'import/xlsx-equals-csv',
  tier: 3,
  component: TABLE,
  title: 'the Cases sheet of cases.xlsx gives the same specs as cases.csv: equal spec hashes (datasets.md)',
  cause: 'import xlsx reads the sheet into the same spec values as the CSV reader.',
  async run(ctx) {
    const mapping = join(ctx.root, 'examples/acme/import/mapping.yaml');
    const csv = await cli(
      [
        'import',
        'csv',
        join(ctx.root, 'examples/acme/import/cases.csv'),
        '--mapping',
        mapping,
        '--out',
        'csv',
        '--json',
      ],
      ctx.dir,
    );
    const xlsx = await cli(
      [
        'import',
        'xlsx',
        join(ctx.root, 'examples/acme/import/cases.xlsx'),
        '--mapping',
        mapping,
        '--out',
        'xlsx',
        '--json',
      ],
      ctx.dir,
    );
    const hashes = (r: Cli) =>
      (json<{ specs?: Array<{ id: string; hash: string }> }>(r.out)?.specs ?? [])
        .map((s) => `${s.id}:${s.hash}`)
        .join();
    return expectAll([
      [
        hashes(csv).length > 0 && hashes(csv) === hashes(xlsx),
        `csv ${hashes(csv) || shown(csv)}; xlsx ${hashes(xlsx) || shown(xlsx)}`,
      ],
    ]);
  },
});

add({
  slug: 'import/row-and-header-row',
  tier: 3,
  component: TABLE,
  title:
    'without group_by every row is a spec, {row} is the source row number, and header_row 2 skips the line above the header (datasets.md mapping keys)',
  cause: 'import honours header_row and fills {row} with the source row number.',
  flags: true,
  async run(ctx) {
    put(
      ctx.dir,
      'cases.csv',
      `Export of ${ctx.seed}\nquestion,stage\nHello there,greet\nI want fiber,offer\n`,
    );
    put(
      ctx.dir,
      'mapping.yaml',
      stringify({
        header_row: 2,
        spec: { id: 'case-{row}' },
        block: { user: '{question}', expect: { stage: '{stage}' } },
      }),
    );
    const result = await cli(
      ['import', 'csv', 'cases.csv', '--mapping', 'mapping.yaml', '--out', 'out', '--json'],
      ctx.dir,
    );
    const ids = (json<{ specs?: Array<{ id: string }> }>(result.out)?.specs ?? []).map((s) => s.id).join();
    return expectAll([[ids === 'case-3,case-4', `expected case-3,case-4, got ${ids || shown(result)}`]]);
  },
});

// ---------------------------------------------------------------- generate, intake, pilot, gate

add({
  slug: 'generate/unapproved',
  tier: 1,
  component: GENERATE_CMD,
  title:
    'generate on a proposal that is not approved exits 2 and writes nothing (cli.md generate exit table)',
  cause: 'generate refuses an unapproved map before writing anything.',
  async run(ctx) {
    const result = await cli(
      ['generate', '--map', join(ctx.root, 'examples/acme/map/proposal.yaml'), '--out', 'gen'],
      ctx.dir,
    );
    return expectAll([
      [result.code === 2, `expected exit 2; ${shown(result)}`],
      [!existsSync(join(ctx.dir, 'gen/generate-report.json')), 'a report was written'],
    ]);
  },
});

add({
  slug: 'generate/max-and-force',
  tier: 2,
  component: GENERATE_CMD,
  title:
    'generate --max 2 cuts the seeders and exits 1 with the report written; a second run into the same folder without --force exits 2 (cli.md generate)',
  cause: 'generate exits 1 on a seeder cut by --max and refuses an earlier output without --force.',
  flags: true,
  async run(ctx) {
    const argv = [
      'generate',
      '--map',
      join(ctx.root, 'examples/acme/map/approved.yaml'),
      '--out',
      'gen',
      '--max',
      '2',
      '--seed',
      String(ctx.seed),
    ];
    const first = await cli(argv, ctx.dir);
    const second = await cli(argv, ctx.dir);
    return expectAll([
      [
        first.code === 1 && existsSync(join(ctx.dir, 'gen/generate-report.json')),
        `first run: ${shown(first)}`,
      ],
      [second.code === 2, `second run without --force: ${shown(second)}`],
    ]);
  },
});

add({
  slug: 'intake/logs-in-git',
  tier: 2,
  component: INTAKE_CMD,
  title:
    'intake logs with --out inside a git work tree exits 2 and writes nothing (cli.md intake exit table)',
  cause: 'intake logs refuses an output folder inside a git work tree.',
  source: 'hostile',
  async run(ctx) {
    const logs = put(
      ctx.dir,
      'logs.jsonl',
      `${JSON.stringify({ messages: [{ role: 'user', content: 'Hello, is fiber available?' }] })}\n`,
    );
    const out = join(ctx.root, `_claims_intake_${ctx.seed}_must_not_exist`);
    const result = await cli(['intake', 'logs', logs, '--out', out], ctx.dir);
    return expectAll([
      [result.code === 2, `expected exit 2; ${shown(result)}`],
      [!existsSync(out), `the folder ${out} was created inside the repository`],
    ]);
  },
});

add({
  slug: 'intake/dry-run-documented',
  tier: 2,
  component: INTAKE_CMD,
  title:
    'intake from-interview --dry-run on the Acme answers prints "Cells: 20, 44 model turns to request, 0 cells dropped by the map." and calls no model (cli.md intake)',
  cause: 'intake from-interview --dry-run allocates the turns over the cells by weight as cli.md documents.',
  flags: true,
  async run(ctx) {
    const result = await cli(
      [
        'intake',
        'from-interview',
        join(ctx.root, 'examples/acme/reference/answers.yaml'),
        '--out',
        'ref',
        '--dry-run',
      ],
      ctx.dir,
    );
    const want = 'Cells: 20, 44 model turns to request, 0 cells dropped by the map.';
    return expectAll([
      [
        result.code === 0 && want !== undefined && result.out.includes(want),
        `expected "${want}"; ${shown(result)}`,
      ],
      [!existsSync(join(ctx.dir, 'ref/reference.yaml')), 'a dry run wrote reference.yaml'],
    ]);
  },
});

add({
  slug: 'pilot/analyse-no-pilot',
  tier: 1,
  component: PILOT_CMD,
  title: 'pilot analyse on a store without a pilot campaign exits 2 (cli.md pilot exit table)',
  cause: 'pilot analyse exits 2 on a store that holds no pilot.',
  async run(ctx) {
    const store = join(ctx.dir, 's.db');
    await cli(
      ['campaign', 'run', join(ctx.root, PLAN_UPGRADE), '--target', TARGET, '--store', store],
      ctx.dir,
    );
    return exitIs(
      await cli(['pilot', 'analyse', '--store', store], ctx.dir),
      2,
      'a store with a campaign but no pilot',
    );
  },
});

add({
  slug: 'gate/target-not-reference',
  tier: 2,
  component: GATE_CMD,
  title:
    'gate on specs whose target is not a --reference exits 2 and writes nothing (cli.md gate exit table)',
  cause: 'gate refuses a spec whose target is not one of the --reference agents.',
  async run(ctx) {
    const result = await cli(
      [
        'gate',
        join(ctx.root, 'examples/acme/specs'),
        '--reference',
        'function:acme-sales',
        '--faults',
        join(ctx.root, 'examples/acme/faults'),
        '--out',
        'gated',
      ],
      ctx.dir,
    );
    return expectAll([
      [result.code === 2, `expected exit 2 (acme-price-sheet names process:acme-ops); ${shown(result)}`],
      [!existsSync(join(ctx.dir, 'gated/gate-report.json')), 'a report was written'],
    ]);
  },
});

// ---------------------------------------------------------------- judge, family, estate, replay

add({
  slug: 'judge/check-documented',
  tier: 1,
  component: JUDGE_CMD,
  title:
    'judge check on the Acme criteria prints "12 valid criteria, 0 issue(s)." and exits 0 (cli.md judge)',
  cause: 'judge check validates each criterion with its fixture pair and prints the documented summary.',
  async run(ctx) {
    const result = await cli(['judge', 'check', join(ctx.root, 'examples/acme/criteria')], ctx.dir);
    return expectAll([
      [
        result.code === 0 && result.out.includes('12 valid criteria, 0 issue(s).'),
        `expected the summary and exit 0; ${shown(result)}`,
      ],
    ]);
  },
});

add({
  slug: 'judge/run-documented',
  tier: 2,
  component: JUDGE_CMD,
  title:
    'judge run on the Acme cassette prints "12 of 12 criteria separated in mode hybrid." and exits 0 (cli.md judge)',
  cause: 'judge run replays the cassette and separates every Acme criterion in hybrid mode.',
  async run(ctx) {
    const result = await cli(
      [
        'judge',
        'run',
        '--criteria',
        join(ctx.root, 'examples/acme/criteria'),
        '--cassette',
        join(ctx.root, 'examples/acme/criteria/council.cassette.json'),
      ],
      ctx.dir,
    );
    return expectAll([
      [
        result.code === 0 && result.out.includes('12 of 12 criteria separated in mode hybrid.'),
        `${shown(result)}`,
      ],
    ]);
  },
});

add({
  slug: 'family/review-pending',
  tier: 1,
  component: FAMILY_CMD,
  title:
    'family review prints "Review: pending." and exits 1 for an unsigned family; a signed family is not pending and exits 0 (cli.md family)',
  cause: 'family review exits 1 while a person still has to sign.',
  async run(ctx) {
    const family = reviewFamily(ctx.dir);
    const pending = await cli(['family', 'review', family.path], ctx.dir);
    family.sign();
    const signed = await cli(['family', 'review', family.path], ctx.dir);
    return expectAll([
      [
        pending.code === 1 && pending.out.startsWith('Review: pending.'),
        `pending family: expected exit 1 and "Review: pending."; ${shown(pending)}`,
      ],
      [
        signed.code === 0 &&
          signed.out.startsWith('Review: signed by ') &&
          !signed.out.includes('Review: pending.'),
        `signed family: expected exit 0 and a signed review, not pending; ${shown(signed)}`,
      ],
    ]);
  },
});

add({
  slug: 'estate/scan-documented',
  tier: 2,
  component: ESTATE_CMD,
  title:
    'estate scan --no-model on the fixture estate writes "68 atoms (68 read by code and approved, 0 split from prose by the model and waiting for approval), 47 edges." (cli.md estate)',
  cause: 'estate scan reads the structured atoms and edges of the fixture estate as cli.md documents.',
  async run(ctx) {
    const result = await cli(
      ['estate', 'scan', join(ctx.root, 'examples/estates/fixture'), '--no-model', '--out', 'map.yaml'],
      ctx.dir,
    );
    const want =
      '68 atoms (68 read by code and approved, 0 split from prose by the model and waiting for approval), 47 edges.';
    return expectAll([
      [
        result.code === 0 && want !== undefined && result.out.includes(want),
        `expected "${want}"; ${shown(result)}`,
      ],
    ]);
  },
});

add({
  slug: 'estate/lint-findings',
  tier: 2,
  component: ESTATE_CMD,
  title:
    'estate lint on the approved fixture map reports ORPHAN, UNREACHABLE and MISSING_REFERENCE and exits 1 (cli.md estate lint)',
  cause: 'estate lint reports the orphan, unreachable and missing-reference findings and exits 1.',
  async run(ctx) {
    const result = await cli(
      ['estate', 'lint', join(ctx.root, 'examples/estates/fixture/approved.yaml')],
      ctx.dir,
    );
    const missing = ['ORPHAN', 'UNREACHABLE', 'MISSING_REFERENCE'].filter(
      (code) => !result.out.includes(code),
    );
    return expectAll([
      [result.code === 1 && missing.length === 0, `missing ${missing.join(', ')}; ${shown(result)}`],
    ]);
  },
});

const SESSIONS = 'examples/estates/sessions';

add({
  slug: 'replay/documented',
  tier: 2,
  component: REPLAY_CMD,
  title:
    'replay of the six recorded sessions prints "7 specs replayed: 3 pass, 4 fail." and exits 1 (cli.md replay)',
  cause: 'replay aligns specs with sessions by metadata and runs them in mode F as cli.md documents.',
  async run(ctx) {
    const names = [
      'clean-build',
      'compaction-mid-task',
      'forbidden-act',
      'gate-violated',
      'skill-skipped',
      'subagent-dispatch',
    ];
    const all = readdirSync(join(ctx.root, SESSIONS));
    const result = await cli(
      [
        'replay',
        ...names.map((name) => join(ctx.root, SESSIONS, `${name}.jsonl`)),
        '--suite',
        join(ctx.root, SESSIONS, 'specs'),
        '--decisions',
        ...all
          .filter((f) => f.endsWith('.decisions.jsonl') && names.some((n) => f === `${n}.decisions.jsonl`))
          .map((f) => join(ctx.root, SESSIONS, f)),
        '--steps',
        ...all
          .filter((f) => f.endsWith('.steps.jsonl') && names.some((n) => f === `${n}.steps.jsonl`))
          .map((f) => join(ctx.root, SESSIONS, f)),
      ],
      ctx.dir,
    );
    return expectAll([
      [result.code === 1 && result.out.includes('7 specs replayed: 3 pass, 4 fail.'), `${shown(result)}`],
    ]);
  },
});

add({
  slug: 'replay/log-as-session',
  tier: 1,
  component: REPLAY_CMD,
  title: 'replay given a decision log as a session exits 2 (cli.md replay exit table)',
  cause: 'replay refuses a decision log passed as a session.',
  async run(ctx) {
    return exitIs(
      await cli(
        [
          'replay',
          join(ctx.root, SESSIONS, 'clean-build.decisions.jsonl'),
          '--suite',
          join(ctx.root, SESSIONS, 'specs'),
        ],
        ctx.dir,
      ),
      2,
      'a log passed as a session',
    );
  },
});

// ---------------------------------------------------------------- validate and global options

add({
  slug: 'validate/default-seed',
  tier: 2,
  component: VALIDATE_CMD,
  title:
    'validate stats without a seed runs seed 1; --seeds 1..3 runs seeds 1, 2 and 3 (cli.md validate options)',
  cause: 'validate runs seed 1 by default and expands --seeds a..b into every seed of the range.',
  flags: true,
  async run(ctx) {
    const plain = await cli(['validate', 'stats', '--json'], ctx.root);
    const range = await cli(['validate', 'stats', '--seeds', '1..3', '--json'], ctx.root);
    const seeds = (r: Cli) => JSON.stringify(json<{ seeds?: unknown[] }>(r.out)?.seeds ?? null);
    const flat = (r: Cli) =>
      (json<{ seeds?: Array<number | { seed: number }> }>(r.out)?.seeds ?? [])
        .map((s) => (typeof s === 'number' ? s : s.seed))
        .join();
    return expectAll([
      [flat(plain) === '1', `no seed: expected seeds [1], got ${seeds(plain)}; ${shown(plain)}`],
      [flat(range) === '1,2,3', `--seeds 1..3: expected 1,2,3, got ${seeds(range)}`],
    ]);
  },
});

add({
  slug: 'validate/brief-all',
  tier: 1,
  component: VALIDATE_CMD,
  title: 'validate all --brief exits 64: --brief takes one component, not all (cli.md validate)',
  cause: 'validate refuses --brief with all as an input error, exit 64.',
  flags: true,
  async run(ctx) {
    return exitIs(await cli(['validate', 'all', '--brief'], ctx.root), 64, 'validate all --brief');
  },
});

add({
  slug: 'global/version',
  tier: 1,
  component: MAIN,
  title:
    '-V and --version print the version of packages/cli/package.json and exit 0 (cli.md "Global options")',
  cause: 'the command line prints the package version for -V and --version.',
  flags: true,
  async run(ctx) {
    const version = (
      JSON.parse(readFileSync(join(ctx.root, 'packages/cli/package.json'), 'utf8')) as { version: string }
    ).version;
    const short = await cli(['-V'], ctx.dir);
    const long = await cli(['--version'], ctx.dir);
    return expectAll([
      [short.code === 0 && short.out.trim() === version, `-V: expected ${version}; ${shown(short)}`],
      [long.code === 0 && long.out.trim() === version, `--version: expected ${version}; ${shown(long)}`],
    ]);
  },
});

add({
  slug: 'global/help-command',
  tier: 1,
  component: MAIN,
  title:
    '"driftbench help <command>" prints the same usage as "<command> --help", exit 0 (cli.md "Global options")',
  cause: 'help <command> and <command> --help print the same usage.',
  flags: true,
  async run(ctx) {
    const a = await cli(['help', 'smoke'], ctx.dir);
    const b = await cli(['smoke', '--help'], ctx.dir);
    const text = (r: Cli) => `${r.out}${r.err}`;
    return expectAll([
      [a.code === 0 && b.code === 0, `exits ${a.code} and ${b.code}`],
      [
        text(a).length > 0 && text(a) === text(b),
        `help smoke ${JSON.stringify(text(a).slice(0, 120))} vs smoke --help ${JSON.stringify(text(b).slice(0, 120))}`,
      ],
    ]);
  },
});

// ---------------------------------------------------------------- the items

function slugOf(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, '-');
}

export function cliItems(): BankItem[] {
  return cases.map((each) => ({
    id: `claim/cli/${each.slug}`,
    family: each.flags ? 'claim-cli-flags' : 'claim-cli',
    tier: each.tier,
    level: 10,
    component: each.component,
    source: each.source ?? 'contract',
    title: each.title,
    cause: each.cause,
    async check({ seed, root, scratch }) {
      const dir = join(
        scratch,
        'claim-cli',
        `${slugOf(each.slug)}-${seed}-${createHash('sha256').update(`${each.slug}:${seed}`).digest('hex').slice(0, 6)}`,
      );
      mkdirSync(dir, { recursive: true });
      return each.run({ dir, root, seed });
    },
  }));
}
