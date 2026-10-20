import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PROTECTED_PATHS, protectedChanges } from '../src/index';

const WORKFLOW = new URL('../../../.github/workflows/validators.yml', import.meta.url);

describe('protectedChanges', () => {
  const files = [
    'packages/validators/src/ladders/stats.ts',
    'packages/validators/src/seeds.ts',
    'validators/floors.json',
    'examples/acme/faults/index.ts',
    'packages/stats/test/reference/fixtures.json',
    '.github/workflows/validators.yml',
    'validators/EXECUTOR.md',
    'packages/stats/src/intervals.ts',
    'validators/stats/journal.jsonl',
    'validators/floors.json.bak',
  ];
  it('names every protected file an executor branch changes, and nothing else', () => {
    expect(protectedChanges('exec/stats-wilson', files)).toEqual(files.slice(0, 7));
  });
  it('protects nothing from a branch that is not an executor branch', () => {
    expect(protectedChanges('lane/validators', files)).toEqual([]);
    expect(protectedChanges('executor/x', files)).toEqual([]);
  });
  it('protects the tools that plan and run the CI shards', () => {
    const ci = ['tools/ci/shard-plan.mjs', 'tools/ci/run-shard.mjs', 'tools/ci/test-durations.json'];
    expect(protectedChanges('exec/ci', [...ci, 'tools/cinema/x.mjs', 'tools/c/shard-plan.mjs'])).toEqual(ci);
    expect(PROTECTED_PATHS).toContain('tools/ci/');
  });
  it('covers the three paths the design names', () => {
    for (const path of [
      'packages/validators/src/ladders/x.ts',
      'validators/floors.json',
      'examples/acme/faults/a.ts',
    ])
      expect(protectedChanges('exec/a', [path])).toEqual([path]);
    expect(PROTECTED_PATHS.length).toBeGreaterThanOrEqual(3);
  });
});

const TRAIN_CONDITION =
  "github.event_name == 'push' || startsWith(github.head_ref, 'train/') || startsWith(github.head_ref, 'release/')";

/**
 * A heavy job runs on main pushes, on train PRs, on release PRs (the one PR that carries a release branch to main)
 * and on a dispatch on a train branch that lists its id.
 */
function heavyCondition(id: string): string {
  return `${TRAIN_CONDITION} || (github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/heads/train/') && contains(format(',{0},', inputs.jobs), ',${id},'))`;
}

/** `prepare` builds for the jobs that need the build: a dispatch that names `build` or `checks` runs it too. */
function prepareCondition(): string {
  return `${TRAIN_CONDITION} || (github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/heads/train/') && (contains(format(',{0},', inputs.jobs), ',prepare,') || contains(format(',{0},', inputs.jobs), ',build,') || contains(format(',{0},', inputs.jobs), ',checks,')))`;
}

/** pr fast runs on every pull request, and on a dispatch on a train branch that lists `fast`. */
const FAST_CONDITION =
  "github.event_name == 'pull_request' || (github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/heads/train/') && contains(format(',{0},', inputs.jobs), ',fast,'))";

/** The fast job is the train entry gate and runs in about 3 minutes: 10 is its limit. */
const FAST_TIMEOUT = 10;

/**
 * pr affected reports the tests a pull request affects. It runs on non-draft pull requests from neither a train nor
 * a release; it compares with the PR's own base branch, so a stacked PR runs its own delta.
 */
const AFFECTED_CONDITION =
  "github.event_name == 'pull_request' && !startsWith(github.head_ref, 'train/') && !startsWith(github.head_ref, 'release/') && !github.event.pull_request.draft";
const AFFECTED_TIMEOUT = 45;
/**
 * The affected tests are those changed against the PR's own base branch, read from the environment: a PR into
 * release/next runs its own delta, never the whole difference between release/next and main.
 */
const AFFECTED_COMMAND = 'pnpm test --maxWorkers=2 --changed "origin/$BASE_REF" --passWithNoTests';
const AFFECTED_FETCH = 'git fetch --no-tags origin "+refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF"';
const BASE_REF_ENV = '${{ github.base_ref }}';

const CI_HEAVY = [
  'bench',
  'research-replay',
  'prepare',
  'checks',
  'build',
  'python',
  'comparison-replay',
  'viewer-journey',
  'guard',
  'timing',
];
const VALIDATORS_HEAVY = ['ladders', 'system-full'];

interface Ctx {
  event: string;
  ref: string;
  headRef?: string;
  baseRef?: string;
  draft?: boolean;
  /** The edit changed the base of the pull request (`github.event.changes.base` is set). */
  baseChanged?: boolean;
  jobs?: string;
  runId?: string;
}

/** Evaluates a workflow expression with the functions these workflows use. */
function evaluate(expression: string, ctx: Ctx): unknown {
  const github = {
    event_name: ctx.event,
    ref: ctx.ref,
    head_ref: ctx.headRef ?? '',
    base_ref: ctx.baseRef ?? '',
    run_id: ctx.runId ?? '1',
    event: {
      pull_request: { draft: ctx.draft ?? false, base: { ref: ctx.baseRef ?? '' } },
      changes: ctx.baseChanged ? { base: { ref: { from: 'feature/stack' } } } : {},
    },
  };
  const inputs = { jobs: ctx.jobs ?? '' };
  const always = () => true;
  const startsWith = (a: string, b: string) => String(a).toLowerCase().startsWith(String(b).toLowerCase());
  const contains = (a: string, b: string) => String(a).toLowerCase().includes(String(b).toLowerCase());
  const format = (pattern: string, ...args: unknown[]) =>
    pattern.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)]));
  const fromJSON = (text: string) => JSON.parse(text);
  return new Function(
    'github',
    'inputs',
    'always',
    'startsWith',
    'contains',
    'format',
    'fromJSON',
    `return (${expression});`,
  )(github, inputs, always, startsWith, contains, format, fromJSON);
}

function evaluateTemplate(text: unknown, ctx: Ctx): unknown {
  if (typeof text !== 'string') return text;
  const whole = text.match(/^\$\{\{([\s\S]*)\}\}$/);
  if (whole) return evaluate(whole[1] ?? '', ctx);
  return text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) => String(evaluate(expression, ctx)));
}

const runs = (ctx: Ctx, id: string, workflow: ReturnType<typeof parse>): boolean =>
  Boolean(evaluate(workflow.jobs[id].if, ctx));

const MAIN_PUSH: Ctx = { event: 'push', ref: 'refs/heads/main' };
const TRAIN_PR: Ctx = {
  event: 'pull_request',
  ref: 'refs/pull/9/merge',
  headRef: 'train/9',
  baseRef: 'main',
};
const ORDINARY_PR: Ctx = {
  event: 'pull_request',
  ref: 'refs/pull/8/merge',
  headRef: 'fix/ordinary',
  baseRef: 'main',
};
const RELEASE_PR: Ctx = {
  event: 'pull_request',
  ref: 'refs/pull/7/merge',
  headRef: 'release/next',
  baseRef: 'main',
};
const FEATURE_PR: Ctx = {
  event: 'pull_request',
  ref: 'refs/pull/6/merge',
  headRef: 'feature/release-notes',
  baseRef: 'release/next',
};
const LOOKALIKE_PRS: Ctx[] = [
  { event: 'pull_request', ref: 'refs/pull/5/merge', headRef: 'release-lookalike', baseRef: 'main' },
  {
    event: 'pull_request',
    ref: 'refs/pull/4/merge',
    headRef: 'feature/release/next',
    baseRef: 'release/next',
  },
];
const dispatchOn = (ref: string, jobs: string): Ctx => ({ event: 'workflow_dispatch', ref, jobs });

/** Behaviour of the heavy-job conditions, as GitHub would evaluate them. */
function assertDispatchBehaviour(workflow: ReturnType<typeof parse>, ids: string[]) {
  const [first, second] = ids;
  for (const id of ids) {
    expect(runs(MAIN_PUSH, id, workflow)).toBe(true);
    expect(runs(TRAIN_PR, id, workflow)).toBe(true);
    expect(runs(ORDINARY_PR, id, workflow)).toBe(false);
    // the release PR runs every heavy job; a feature PR into the release branch, or a look-alike head, runs none
    expect(runs(RELEASE_PR, id, workflow)).toBe(true);
    expect(runs(FEATURE_PR, id, workflow)).toBe(false);
    for (const ctx of LOOKALIKE_PRS) expect(runs(ctx, id, workflow), ctx.headRef).toBe(false);
    // a dispatch on a train branch runs exactly the listed jobs
    expect(runs(dispatchOn('refs/heads/train/9a', ids.join(',')), id, workflow)).toBe(true);
    expect(runs(dispatchOn('refs/heads/train/9a', ''), id, workflow)).toBe(false);
    expect(runs(dispatchOn('refs/heads/train/9a', `${id}-docs,x${id}`), id, workflow)).toBe(false);
    // a dispatch, partial or complete, never runs anything on main or on a look-alike ref
    for (const ref of [
      'refs/heads/main',
      'refs/heads/train-lookalike',
      'refs/heads/feature/train/9',
      'refs/tags/train/9',
    ])
      expect(runs(dispatchOn(ref, ids.join(',')), id, workflow)).toBe(false);
  }
  // listing one job never runs another
  if (first && second) expect(runs(dispatchOn('refs/heads/train/9a', first), second, workflow)).toBe(false);
}

/** Runs on main never cancel each other, and a dispatch never cancels or joins a push run. */
function assertConcurrency(workflow: ReturnType<typeof parse>) {
  const group = (ctx: Ctx) => String(evaluateTemplate(workflow.concurrency.group, ctx));
  const cancel = (ctx: Ctx) => Boolean(evaluateTemplate(workflow.concurrency['cancel-in-progress'], ctx));
  const push = (runId: string): Ctx => ({ ...MAIN_PUSH, runId });
  expect(group(push('1'))).not.toBe(group(push('2')));
  expect(group({ ...dispatchOn('refs/heads/main', 'build'), runId: '2' })).not.toBe(group(push('1')));
  expect(group({ ...dispatchOn('refs/heads/main', 'build'), runId: '3' })).not.toBe(
    group({ ...dispatchOn('refs/heads/main', 'build'), runId: '4' }),
  );
  for (const ctx of [
    push('1'),
    dispatchOn('refs/heads/main', 'build'),
    dispatchOn('refs/heads/train/9a', 'build'),
  ])
    expect(cancel(ctx)).toBe(false);
  expect(cancel(ORDINARY_PR)).toBe(true);
  expect(cancel(TRAIN_PR)).toBe(false);
  expect(cancel(RELEASE_PR)).toBe(false);
  expect(cancel(FEATURE_PR)).toBe(true);
  expect(group(ORDINARY_PR)).toBe(group({ ...ORDINARY_PR, runId: '77' }));
}

/** No job or trigger is path-filtered, and no step may skip work. */
function assertNoPathFilters(workflow: ReturnType<typeof parse>) {
  for (const trigger of [workflow.on.pull_request, workflow.on.push]) {
    expect(trigger.paths).toBeUndefined();
    expect(trigger['paths-ignore']).toBeUndefined();
  }
  expect(workflow.on.workflow_dispatch.paths).toBeUndefined();
  for (const job of Object.values(workflow.jobs) as {
    if?: string;
    needs?: unknown;
    steps: { if?: string; uses?: string; run?: string }[];
  }[]) {
    expect(String(job.if ?? '')).not.toMatch(/changes|paths|changed/i);
    expect(JSON.stringify(job.needs ?? [])).not.toMatch(/changes|paths/i);
    for (const step of job.steps) {
      expect(step.uses ?? '').not.toMatch(/paths-filter|changed-files/i);
      expect(String(step.if ?? '')).not.toMatch(/changes|paths|changed/i);
    }
  }
}

/** The trigger set and the dispatch input, exactly. */
function assertTriggers(workflow: ReturnType<typeof parse>) {
  expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch']);
  expect(workflow.on.push.branches).toContain('main');
  const inputs = workflow.on.workflow_dispatch.inputs;
  expect(Object.keys(inputs)).toEqual(['jobs']);
  expect(inputs.jobs.required).toBe(true);
  expect(inputs.jobs.type).toBe('string');
}

/**
 * The tests run as SHARDS shards per Node version. `prepare` builds once and plans the shards from the measured
 * duration of each test file; each `build` shard runs the files of its own entry of the plan; `checks` runs lint,
 * typecheck, the docs checks and the CLI smoke. No step of a heavy job carries a condition other than always().
 */
const SHARDS = 32;
const PLAN_COMMAND = `node tools/ci/shard-plan.mjs --count ${SHARDS} --out shard-plan.json`;
const SHARD_COMMAND = 'node tools/ci/run-shard.mjs --plan shard-plan.json --index ${{ matrix.shard }}';
const API_GATE = 'node tools/structure/api-surface.mjs --build --check';
const CHECK_COMMANDS = [
  'pnpm lint',
  'pnpm typecheck',
  'pnpm docs:reference --check',
  'pnpm docs:links',
  'pnpm docs:site:build',
  'node packages/cli/dist/bin.js --version',
];

type Step = { if?: string; run?: string; uses?: string; with?: Record<string, unknown> };

/** Each test file runs in exactly one shard of each Node version, and nothing the old build job ran is dropped. */
function assertShards(workflow: ReturnType<typeof parse>) {
  const { prepare, checks, build } = workflow.jobs;
  const commands = (job: { steps: Step[] }) => job.steps.map((step) => step.run);
  // the build runs once per Node version and is shared: built and stamped by prepare, downloaded by the others
  expect(prepare.strategy.matrix.node).toEqual([22, 24]);
  expect(prepare.name).toBe('prepare (node ${{ matrix.node }})');
  expect(commands(prepare)).toContain(API_GATE);
  expect(commands(prepare).filter((run) => run === PLAN_COMMAND)).toHaveLength(1);
  expect(commands(prepare).indexOf(API_GATE)).toBeLessThan(commands(prepare).indexOf(PLAN_COMMAND));
  const upload = prepare.steps.find((step: Step) => step.uses?.startsWith('actions/upload-artifact@'));
  expect(upload.with.name).toBe('build-node${{ matrix.node }}');
  expect(upload.with['include-hidden-files']).toBe(true);
  expect(upload.with['if-no-files-found']).toBe('error');
  for (const path of [
    'packages/*/dist',
    'examples/*/dist',
    '.cache/api-surface-build.json',
    'shard-plan.json',
  ])
    expect(String(upload.with.path)).toContain(path);
  // the checks the old build job ran in shard 1 run in a job of their own, on both Node versions
  expect(checks.needs).toBe('prepare');
  expect(checks.strategy.matrix.node).toEqual([22, 24]);
  for (const command of CHECK_COMMANDS)
    expect(
      commands(checks).filter((run) => run === command),
      command,
    ).toHaveLength(1);
  // the shards
  expect(build.needs).toBe('prepare');
  expect(build.strategy.matrix.node).toEqual([22, 24]);
  expect(build.strategy.matrix.shard).toEqual(Array.from({ length: SHARDS }, (_, at) => at + 1));
  expect(build.name).toBe(`build (node \${{ matrix.node }}, shard \${{ matrix.shard }}/${SHARDS})`);
  expect(commands(build).filter((run) => run === SHARD_COMMAND)).toHaveLength(1);
  const download = (job: { steps: Step[] }) =>
    job.steps.find((step: Step) => step.uses?.startsWith('actions/download-artifact@'));
  expect(download(build)?.with?.name).toBe('build-node${{ matrix.node }}');
  expect(download(checks)?.with?.name).toBe('build-node${{ matrix.node }}');
  // a shard runs no lint, no test of its own choosing: only the shard command follows the install and the download
  expect(commands(build).filter((run) => run?.startsWith('node tools/ci/'))).toEqual([SHARD_COMMAND]);
}

function assertWorkflowPolicy(workflow: ReturnType<typeof parse>, ids: string[]) {
  assertTriggers(workflow);
  assertNoPathFilters(workflow);
  assertConcurrency(workflow);
  assertDispatchBehaviour(workflow, ids);
  for (const id of ids) {
    expect(workflow.jobs[id].if).toBe(id === 'prepare' ? prepareCondition() : heavyCondition(id));
    for (const step of workflow.jobs[id].steps) {
      // A step condition may only keep artifacts after a failure; it may never skip work.
      if (step.if !== undefined) expect(step.if).toBe('always()');
    }
  }
}

/** Conditions and steps must keep the complete validators on every train and main push. */
function assertTrainValidators(workflow: ReturnType<typeof parse>) {
  assertWorkflowPolicy(workflow, VALIDATORS_HEAVY);
  const commands = workflow.jobs.ladders.steps.flatMap((step: { run?: string }) => step.run ?? []);
  expect(commands).toContain('pnpm driftbench validate all --seeds 1..3 --hidden --check-floor');
  expect(commands).toContain('pnpm driftbench validate all --check-handover');
  const system = workflow.jobs['system-full'].steps
    .map((step: { run?: string }) => step.run ?? '')
    .join('\n');
  expect(system).toContain('pnpm driftbench validate system --seeds 1..3 --hidden --all-levels');
  expect(system).toContain('test "$status" -eq 11');
}

/**
 * The timing tests run in the `timing` job and nowhere else: that job keeps the mode `only` on a GitHub-hosted
 * runner, and the jobs that run the whole suite keep the mode `skip`. A job set to `skip` there would leave the
 * seven timing tests running nowhere while every gate stays green.
 */
function assertTimingGuard(workflow: ReturnType<typeof parse>) {
  const timing = workflow.jobs.timing;
  expect(timing.env?.DRIFTBENCH_TIMING_TESTS).toBe('only');
  expect(timing['runs-on']).toBe('ubuntu-latest');
  for (const id of ['build', 'pr-affected'])
    expect(workflow.jobs[id].env?.DRIFTBENCH_TIMING_TESTS, id).toBe('skip');
  for (const [id, job] of Object.entries(workflow.jobs) as [string, { env?: Record<string, string> }][])
    if (id !== 'timing') expect(job.env?.DRIFTBENCH_TIMING_TESTS, id).not.toBe('only');
}

const OK = 'success,success,success,success,success,success,success,success,success,success';
const SKIPPED = 'skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped';
const ONE_RED = 'success,failure,success,success,success,success,success,success,success,success';
const GATE_CASES: [string, string, string, string, string, number][] = [
  // event, head ref, ref name, jobs, needs results, expected exit code
  ['pull_request', 'train/ci-speed', '', '', OK, 0],
  ['push', '', 'main', '', OK, 0],
  [
    'pull_request',
    'fix/ordinary',
    '',
    '',
    'skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped',
    1,
  ],
  ['pull_request', 'train-lookalike', '', '', OK, 1],
  // the release PR counts like a train PR; a feature PR into the release branch does not
  ['pull_request', 'release/next', '', '', OK, 0],
  ['pull_request', 'release/next', '', '', ONE_RED, 1],
  ['pull_request', 'release-lookalike', '', '', OK, 1],
  ['pull_request', 'feature/release/next', '', '', OK, 1],
  ['pull_request', 'feature/release-notes', '', '', SKIPPED, 1],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'build',
    'skipped,skipped,success,skipped,success,skipped,skipped,skipped,skipped,skipped',
    0,
  ],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'build,python',
    'skipped,skipped,success,skipped,success,success,skipped,skipped,skipped,skipped',
    0,
  ],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    '',
    'skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped',
    1,
  ],
  ['workflow_dispatch', '', 'train/9a', '', OK, 1],
  // a pre-flight dispatch (fast only, or no heavy job) never counts as a train pass
  ['workflow_dispatch', '', 'train/pre-9', 'fast', SKIPPED, 1],
  ['workflow_dispatch', '', 'train/pre-9', 'fast,unknown', SKIPPED, 1],
  // the list is matched without regard to case, as GitHub matches it
  ['workflow_dispatch', '', 'train/pre-9', 'FAST', SKIPPED, 1],
  ['workflow_dispatch', '', 'train/pre-9', 'Fast', SKIPPED, 1],
  // a list that names no real job runs nothing, so it never counts
  ['workflow_dispatch', '', 'train/9a', 'nonsense', SKIPPED, 1],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'build,nonsense',
    'skipped,skipped,success,skipped,success,skipped,skipped,skipped,skipped,skipped',
    1,
  ],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'BUILD',
    'skipped,skipped,success,skipped,success,skipped,skipped,skipped,skipped,skipped',
    0,
  ],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'build,fast',
    'skipped,skipped,success,skipped,success,skipped,skipped,skipped,skipped,skipped',
    0,
  ],
  // the timing job is a heavy job a dispatch can list
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'timing',
    'skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,success',
    0,
  ],
  ['workflow_dispatch', '', 'main', 'build', OK, 1],
  ['workflow_dispatch', '', 'main', 'build,python,bench', OK, 1],
  ['workflow_dispatch', '', 'train-lookalike', 'build', OK, 1],
  ['workflow_dispatch', '', 'feature/train/9', 'build', OK, 1],
  // a red or cancelled heavy job turns the gate red, on every kind of run that can count
  ['pull_request', 'train/ci-speed', '', '', ONE_RED, 1],
  [
    'pull_request',
    'train/ci-speed',
    '',
    '',
    'success,success,success,success,cancelled,success,success,success,success,success',
    1,
  ],
  ['push', '', 'main', '', ONE_RED, 1],
  // the timing job, last in the gate's needs, turns the gate red when it fails or is cancelled
  [
    'pull_request',
    'train/ci-speed',
    '',
    '',
    'success,success,success,success,success,success,success,failure',
    1,
  ],
  [
    'pull_request',
    'train/ci-speed',
    '',
    '',
    'success,success,success,success,success,success,success,cancelled',
    1,
  ],
  ['push', '', 'main', '', 'success,success,success,success,success,success,success,failure', 1],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'build',
    'skipped,skipped,success,skipped,failure,skipped,skipped,skipped,skipped,skipped',
    1,
  ],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'timing',
    'skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,failure',
    1,
  ],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'timing',
    'skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,skipped,cancelled',
    1,
  ],
  [
    'workflow_dispatch',
    '',
    'train/9a',
    'build',
    'skipped,skipped,success,skipped,cancelled,skipped,skipped,skipped,skipped,skipped',
    1,
  ],
];

/** Runs the train gate script for every case. A partial dispatch counts only on a train branch. */
function assertGate(command: string) {
  for (const [event, head, refName, jobs, results, expected] of GATE_CASES) {
    const result = spawnSync('bash', ['-c', command], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EVENT_NAME: event,
        HEAD_REF: head,
        REF_NAME: refName,
        JOBS: jobs,
        RESULTS: results,
      },
    });
    expect(result.status, `${event} ${head} ${refName} [${jobs}] ${results}`).toBe(expected);
    if (expected === 1) expect(result.stdout).toMatch(/::error::/);
    if (expected === 1 && event === 'workflow_dispatch' && /^fast/i.test(jobs) && results === SKIPPED)
      expect(result.stdout).toContain('pre-flight run, not a train pass');
    if (expected === 1 && event === 'pull_request' && head === 'fix/ordinary')
      expect(result.stdout).toContain('Merge through a train (train/<n>)');
  }
}

/** The gate waits for every heavy ci.yml job, so a red heavy job cannot sit beside a green gate. */
function assertGateWaits(workflow: ReturnType<typeof parse>) {
  const job = workflow.jobs['train-gate'];
  expect(job.if).toBe('always()');
  expect([...job.needs].sort()).toEqual([...CI_HEAVY].sort());
  // the fast and affected jobs are never inputs to the gate, so neither is a train pass
  expect(job.needs).not.toContain('pr-fast');
  expect(job.needs).not.toContain('pr-affected');
  const step = job.steps.find((s: { run?: string }) => s.run);
  expect(step.env.RESULTS).toBe("${{ join(needs.*.result, ',') }}");
  expect(step.run).not.toContain('${{');
}

/** The fast job runs on pull requests and on a fast dispatch on a train branch, and nowhere else. */
function assertFastBehaviour(workflow: ReturnType<typeof parse>) {
  const fast = (ctx: Ctx) => runs(ctx, 'pr-fast', workflow);
  expect(fast(ORDINARY_PR)).toBe(true);
  expect(fast(TRAIN_PR)).toBe(true);
  expect(fast(MAIN_PUSH)).toBe(false);
  for (const jobs of ['fast', 'FAST', 'Fast', 'build,fast', 'fast,build'])
    expect(fast(dispatchOn('refs/heads/train/pre-9', jobs))).toBe(true);
  for (const jobs of ['', 'build', 'fast-docs', 'xfast', 'fastx,build'])
    expect(fast(dispatchOn('refs/heads/train/pre-9', jobs))).toBe(false);
  for (const ref of [
    'refs/heads/main',
    'refs/heads/train-lookalike',
    'refs/heads/feature/train/9',
    'refs/tags/train/9',
  ])
    expect(fast(dispatchOn(ref, 'fast'))).toBe(false);
  // the fast job holds no affected-tests step: those run in pr affected
  expect(JSON.stringify(workflow.jobs['pr-fast'].steps)).not.toMatch(/--changed|Tests affected/);
}

/** pr affected runs on ordinary pull requests only: not on a draft, a stacked PR (base not main), a train PR, a push or a dispatch. */
function assertAffectedBehaviour(workflow: ReturnType<typeof parse>) {
  const job = workflow.jobs['pr-affected'];
  expect(job.name).toBe('pr affected');
  expect(job.if).toBe(AFFECTED_CONDITION);
  expect(job['timeout-minutes']).toBe(AFFECTED_TIMEOUT);
  const affected = (ctx: Ctx) => runs(ctx, 'pr-affected', workflow);
  expect(affected(ORDINARY_PR)).toBe(true);
  expect(affected({ ...ORDINARY_PR, draft: true })).toBe(false);
  // a stacked PR runs its own delta against its base (#1006), so it is no longer skipped
  expect(affected({ ...ORDINARY_PR, baseRef: 'feature/stack' })).toBe(true);
  expect(affected(TRAIN_PR)).toBe(false);
  expect(affected(RELEASE_PR)).toBe(false);
  expect(affected(FEATURE_PR)).toBe(true);
  expect(affected(MAIN_PUSH)).toBe(false);
  for (const jobs of ['fast', 'build', 'fast,build', ''])
    expect(affected(dispatchOn('refs/heads/train/pre-9', jobs))).toBe(false);
  expect(job.steps[0].with['fetch-depth']).toBe(0);
  const commands = job.steps.map((step: { run?: string }) => step.run);
  expect(commands).toContain(AFFECTED_COMMAND);
  // the base branch is fetched, then the affected tests diff against it; both read it from the environment
  const test = job.steps.find((step: { run?: string }) => step.run === AFFECTED_COMMAND);
  const fetch = job.steps.find((step: { run?: string }) => step.run === AFFECTED_FETCH);
  expect(fetch, 'base fetch step').toBeDefined();
  expect(commands.indexOf(AFFECTED_FETCH)).toBeLessThan(commands.indexOf(AFFECTED_COMMAND));
  for (const step of [test, fetch]) {
    expect(step.env?.BASE_REF).toBe(BASE_REF_ENV);
    expect(step.run).not.toContain('${{');
  }
  // a PR into release/next compares with release/next, a PR into main with main
  for (const base of ['release/next', 'main'])
    expect(evaluateTemplate(test.env.BASE_REF, { ...FEATURE_PR, baseRef: base })).toBe(base);
  expect(JSON.stringify(job.steps)).not.toContain('--changed origin/main');
  // the tests verify the build stamp, so the build gate runs before them
  expect(commands.indexOf('node tools/structure/api-surface.mjs --build --check')).toBeGreaterThan(-1);
  expect(commands.indexOf('node tools/structure/api-surface.mjs --build --check')).toBeLessThan(
    commands.indexOf(AFFECTED_COMMAND),
  );
  for (const step of job.steps) expect(step.if).toBeUndefined();
}

/**
 * A change of base runs pr affected again from a workflow of its own. ci.yml never runs on an `edited` event: a title edit
 * would start a second ci run on a head that already has results, with skipped train gate and pr affected checks.
 */
function assertRetargetBehaviour(retarget: ReturnType<typeof parse>, ci: ReturnType<typeof parse>) {
  expect(ci.on.pull_request.types).not.toContain('edited');
  expect(retarget.on).toEqual({ pull_request: { types: ['edited'] } });
  const job = retarget.jobs['pr-affected-retarget'];
  expect(Object.keys(retarget.jobs)).toEqual(['pr-affected-retarget']);
  // a name no reader or merge train looks up: it never stands in for `pr affected`
  expect(job.name).toBe('pr affected (retarget)');
  expect(job['timeout-minutes']).toBe(AFFECTED_TIMEOUT);
  const retargeted = (ctx: Ctx) => runs(ctx, 'pr-affected-retarget', retarget);
  const toMain: Ctx = { ...ORDINARY_PR, baseChanged: true };
  expect(retargeted(toMain)).toBe(true);
  // a title or body edit changes no base
  expect(retargeted({ ...toMain, baseChanged: false })).toBe(false);
  // a base change to any branch counts: the affected tests are read against the new base
  expect(retargeted({ ...toMain, baseRef: 'release/next' })).toBe(true);
  expect(retargeted({ ...toMain, baseRef: 'feature/stack' })).toBe(true);
  // a draft, a train PR and a release PR are skipped as in ci.yml
  expect(retargeted({ ...toMain, draft: true })).toBe(false);
  expect(retargeted({ ...TRAIN_PR, baseChanged: true })).toBe(false);
  expect(retargeted({ ...RELEASE_PR, baseChanged: true })).toBe(false);
  // the same steps as pr affected in ci.yml
  expect(job.steps).toEqual(ci.jobs['pr-affected'].steps);
  // two edits never cancel each other: a title edit must not cancel a retarget run in flight
  expect(String(evaluateTemplate(retarget.concurrency.group, { ...toMain, runId: '1' }))).not.toBe(
    String(evaluateTemplate(retarget.concurrency.group, { ...toMain, runId: '2' })),
  );
  expect(retarget.concurrency['cancel-in-progress']).toBe(false);
}

/** The docs checks run in every pr-fast run, whatever the diff: no step condition, no --changed. */
function assertFastDocs(workflow: ReturnType<typeof parse>) {
  const steps: { run?: string; if?: string }[] = workflow.jobs['pr-fast'].steps;
  for (const command of ['pnpm docs:reference --check', 'pnpm exec vitest run tools/docs --maxWorkers=2']) {
    const matching = steps.filter((step) => step.run === command);
    expect(matching, command).toHaveLength(1);
    expect(matching[0]?.if, command).toBeUndefined();
  }
}

describe('the validators workflow', () => {
  const workflow = parse(readFileSync(WORKFLOW, 'utf8'));
  const stepRuns = (job: string): string[] =>
    (workflow.jobs[job].steps as { run?: string }[]).flatMap((step) => (step.run ? [step.run] : []));
  it('runs all registered validators in full on every train PR and main push, without path filters', () => {
    assertTrainValidators(workflow);
  });
  it('rejects an extra trigger such as pull_request_target, and a missing workflow_dispatch', () => {
    const changed = structuredClone(workflow);
    changed.on.pull_request_target = {};
    expect(() => assertTrainValidators(changed)).toThrow();
    const missing = structuredClone(workflow);
    delete missing.on.workflow_dispatch;
    expect(() => assertTrainValidators(missing)).toThrow();
  });
  it('rejects a dispatch input other than a required jobs string', () => {
    const extra = structuredClone(workflow);
    extra.on.workflow_dispatch.inputs.ref = { type: 'string' };
    expect(() => assertTrainValidators(extra)).toThrow();
    const optional = structuredClone(workflow);
    optional.on.workflow_dispatch.inputs.jobs.required = false;
    expect(() => assertTrainValidators(optional)).toThrow();
  });
  it('rejects removing the train condition', () => {
    const changed = structuredClone(workflow);
    changed.jobs.ladders.if = changed.jobs.ladders.if.replace(TRAIN_CONDITION, "github.event_name == 'push'");
    expect(() => assertTrainValidators(changed)).toThrow();
  });
  it('rejects a dispatch that could run a job on main, or ignore the jobs list', () => {
    const anyRef = structuredClone(workflow);
    anyRef.jobs.ladders.if = anyRef.jobs.ladders.if.replace(
      " && startsWith(github.ref, 'refs/heads/train/')",
      '',
    );
    expect(() => assertDispatchBehaviour(anyRef, VALIDATORS_HEAVY)).toThrow();
    const ignoresList = structuredClone(workflow);
    ignoresList.jobs['system-full'].if = `${TRAIN_CONDITION} || github.event_name == 'workflow_dispatch'`;
    expect(() => assertDispatchBehaviour(ignoresList, VALIDATORS_HEAVY)).toThrow();
    const prefixMatch = structuredClone(workflow);
    prefixMatch.jobs.ladders.if = prefixMatch.jobs.ladders.if.replace("',{0},'", "'{0}'");
    expect(() => assertDispatchBehaviour(prefixMatch, VALIDATORS_HEAVY)).toThrow();
  });
  it('rejects path-filtering a ladder job or its execution step', () => {
    const jobFiltered = structuredClone(workflow);
    jobFiltered.jobs.ladders.if += " && needs.changes.outputs.validators == 'true'";
    expect(() => assertTrainValidators(jobFiltered)).toThrow();
    const stepFiltered = structuredClone(workflow);
    stepFiltered.jobs.ladders.steps.find((step: { run?: string }) => step.run?.includes('--check-floor')).if =
      "needs.changes.outputs.validators == 'true'";
    expect(() => assertTrainValidators(stepFiltered)).toThrow();
    const workflowFiltered = structuredClone(workflow);
    workflowFiltered.on.pull_request.paths = ['packages/validators/**'];
    expect(() => assertTrainValidators(workflowFiltered)).toThrow();
    const lightJob = structuredClone(workflow);
    lightJob.jobs.protect.if += " && needs.changes.outputs.any == 'true'";
    expect(() => assertNoPathFilters(lightJob)).toThrow();
  });
  it('rejects runs on main that cancel each other', () => {
    const cancelling = structuredClone(workflow);
    cancelling.concurrency['cancel-in-progress'] = true;
    expect(() => assertConcurrency(cancelling)).toThrow();
    const sharedGroup = structuredClone(workflow);
    sharedGroup.concurrency.group = 'validators-${{ github.ref }}';
    expect(() => assertConcurrency(sharedGroup)).toThrow();
  });
  it('measures the pointer bank on a dispatch on a train branch that names it, and nowhere else', () => {
    const job = workflow.jobs['pointer-measure'];
    const on = (ctx: Ctx) => runs(ctx, 'pointer-measure', workflow);
    const train = 'refs/heads/train/9a';
    for (const jobs of [
      'pointer-measure',
      'pointer-measure-one',
      'pointer-measure-full',
      'build,pointer-measure',
      'POINTER-MEASURE-ONE',
    ])
      expect(on(dispatchOn(train, jobs)), jobs).toBe(true);
    for (const jobs of ['', 'pointer', 'pointer-measure-docs', 'xpointer-measure', 'ladders,system-full'])
      expect(on(dispatchOn(train, jobs)), jobs).toBe(false);
    for (const ref of [
      'refs/heads/main',
      'refs/heads/train-lookalike',
      'refs/heads/feature/train/9',
      'refs/tags/train/9',
    ])
      expect(on(dispatchOn(ref, 'pointer-measure,pointer-measure-full')), ref).toBe(false);
    for (const ctx of [MAIN_PUSH, TRAIN_PR, ORDINARY_PR, RELEASE_PR]) expect(on(ctx)).toBe(false);
    // the shards: three for the trial, one for a single seed, ten for the gate measurement
    const shards = (jobs: string) =>
      evaluateTemplate(job.strategy.matrix.include, dispatchOn(train, jobs)) as {
        seeds: string;
        hidden: boolean;
      }[];
    expect(shards('pointer-measure').map((shard) => shard.seeds)).toEqual(['1..1', '2..2', '3..3']);
    expect(shards('pointer-measure').filter((shard) => shard.hidden)).toHaveLength(1);
    expect(shards('pointer-measure-one')).toEqual([{ seeds: '1..1', hidden: false }]);
    const full = shards('pointer-measure-full');
    expect(full).toHaveLength(10);
    expect(full.filter((shard) => shard.hidden)).toHaveLength(1);
    expect(full.flatMap((shard) => shard.seeds.split('..').map(Number))).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    // the report is the one `--items --all-levels --json` prints, and a level never fails the job
    const runsText = stepRuns('pointer-measure').join('\n');
    expect(runsText).toContain(
      'driftbench validate pointer --seeds "$SEEDS" $HIDDEN --items --all-levels --json',
    );
    expect(runsText).toContain('|| status=$?');
    expect(job['timeout-minutes']).toBe(300);
    for (const step of job.steps) expect(step.if).toBeUndefined();
  });
  it('checks every pull request for protected changes with the full history', () => {
    expect(workflow.jobs.protect.if).toBe("github.event_name == 'pull_request'");
    expect(workflow.jobs.protect.steps[0].with['fetch-depth']).toBe(0);
    expect(stepRuns('protect')).toContain(
      'pnpm driftbench validate protect --branch "$HEAD_REF" --base "origin/$BASE_REF"',
    );
  });
});

describe('merge train enforcement', () => {
  const workflow = parse(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  it('keeps every heavy CI job on trains and main, with no path filters', () => {
    assertWorkflowPolicy(workflow, CI_HEAVY);
    expect(workflow.jobs.build.strategy.matrix.node).toEqual([22, 24]);
    assertShards(workflow);
    expect(workflow.jobs.python.strategy.matrix.python).toEqual(['3.11', '3.12']);
  });
  it('runs the timing tests in the timing job only, and lets a dispatch list that job', () => {
    assertTimingGuard(workflow);
    const command: string = workflow.jobs['train-gate'].steps.find((step: { run?: string }) => step.run).run;
    expect(command).toContain(',guard,timing,fast,');
  });
  it('rejects a timing job that skips the timing tests, a pool that runs them, and a dispatch list without the job', () => {
    const skipping = structuredClone(workflow);
    skipping.jobs.timing.env.DRIFTBENCH_TIMING_TESTS = 'skip';
    expect(() => assertTimingGuard(skipping)).toThrow();
    const unset = structuredClone(workflow);
    delete unset.jobs.timing.env;
    expect(() => assertTimingGuard(unset)).toThrow();
    const onPool = structuredClone(workflow);
    onPool.jobs.timing['runs-on'] = "${{ vars.RUNNER_LABEL || 'ubuntu-latest' }}";
    expect(() => assertTimingGuard(onPool)).toThrow();
    const buildRunsThem = structuredClone(workflow);
    delete buildRunsThem.jobs.build.env;
    expect(() => assertTimingGuard(buildRunsThem)).toThrow();
    const command: string = workflow.jobs['train-gate'].steps.find((step: { run?: string }) => step.run).run;
    expect(() => assertGate(command.replace(',guard,timing,fast,', ',guard,fast,'))).toThrow();
  });
  it('rejects a pull_request_target trigger, a missing dispatch trigger and a skipped step on a heavy job', () => {
    const target = structuredClone(workflow);
    target.on.pull_request_target = {};
    expect(() => assertWorkflowPolicy(target, CI_HEAVY)).toThrow();
    const missing = structuredClone(workflow);
    delete missing.on.workflow_dispatch;
    expect(() => assertWorkflowPolicy(missing, CI_HEAVY)).toThrow();
    const skipped = structuredClone(workflow);
    skipped.jobs.build.steps[skipped.jobs.build.steps.length - 1].if = "github.event_name == 'push'";
    expect(() => assertWorkflowPolicy(skipped, CI_HEAVY)).toThrow();
  });
  it('rejects a build that skips tests in some shard, drops a shard, or loses a check', () => {
    const mutate = (change: (copy: ReturnType<typeof parse>) => void) => {
      const copy = structuredClone(workflow);
      change(copy);
      return copy;
    };
    const step = (copy: ReturnType<typeof parse>, job: string, run: string) =>
      copy.jobs[job].steps.find((each: Step) => each.run === run);
    expect(() =>
      assertWorkflowPolicy(
        mutate((c) => {
          step(c, 'build', SHARD_COMMAND).if = 'matrix.shard == 1';
        }),
        CI_HEAVY,
      ),
    ).toThrow();
    expect(() =>
      assertShards(
        mutate((c) => {
          c.jobs.build.strategy.matrix.shard = [1, 2, 3];
        }),
      ),
    ).toThrow();
    expect(() =>
      assertShards(
        mutate((c) => {
          step(c, 'build', SHARD_COMMAND).run = 'pnpm test --maxWorkers=2';
        }),
      ),
    ).toThrow();
    expect(() =>
      assertShards(
        mutate((c) => {
          step(c, 'prepare', PLAN_COMMAND).run =
            'node tools/ci/shard-plan.mjs --count 16 --out shard-plan.json';
        }),
      ),
    ).toThrow();
    expect(() =>
      assertShards(
        mutate((c) => {
          delete step(c, 'prepare', API_GATE).run;
        }),
      ),
    ).toThrow();
    expect(() =>
      assertShards(
        mutate((c) => {
          c.jobs.prepare.steps.find((each: Step) => each.uses?.startsWith('actions/upload-artifact@')).with[
            'include-hidden-files'
          ] = false;
        }),
      ),
    ).toThrow();
    expect(() =>
      assertShards(
        mutate((c) => {
          c.jobs.build.needs = [];
        }),
      ),
    ).toThrow();
    for (const command of CHECK_COMMANDS)
      expect(
        () =>
          assertShards(
            mutate((c) => {
              c.jobs.checks.steps = c.jobs.checks.steps.filter((each: Step) => each.run !== command);
            }),
          ),
        command,
      ).toThrow();
    // the gate waits for prepare and checks: a failed prepare skips every shard, and a skipped job passes the gate
    for (const id of ['prepare', 'checks'])
      expect(() =>
        assertGateWaits(
          mutate((c) => {
            c.jobs['train-gate'].needs = c.jobs['train-gate'].needs.filter((n: string) => n !== id);
          }),
        ),
      ).toThrow();
    // a dispatch that names build or checks runs prepare, and one that names neither does not
    const prepared = (jobs: string) => runs(dispatchOn('refs/heads/train/9a', jobs), 'prepare', workflow);
    expect(prepared('build')).toBe(true);
    expect(prepared('checks')).toBe(true);
    expect(prepared('python')).toBe(false);
    expect(runs(dispatchOn('refs/heads/main', 'build'), 'prepare', workflow)).toBe(false);
  });
  it('rejects a dispatch that could run a heavy job on main, or ignore the jobs list', () => {
    const anyRef = structuredClone(workflow);
    for (const id of CI_HEAVY)
      anyRef.jobs[id].if = anyRef.jobs[id].if.replace(" && startsWith(github.ref, 'refs/heads/train/')", '');
    expect(() => assertDispatchBehaviour(anyRef, CI_HEAVY)).toThrow();
    const ignoresList = structuredClone(workflow);
    ignoresList.jobs.bench.if = `${TRAIN_CONDITION} || github.event_name == 'workflow_dispatch'`;
    expect(() => assertDispatchBehaviour(ignoresList, CI_HEAVY)).toThrow();
  });
  it('rejects path filters on any job or step', () => {
    const filtered = structuredClone(workflow);
    filtered.jobs.build.if += " && needs.changes.outputs.code == 'true'";
    expect(() => assertNoPathFilters(filtered)).toThrow();
    const action = structuredClone(workflow);
    action.jobs.guard.steps.unshift({ uses: 'dorny/paths-filter@v3' });
    expect(() => assertNoPathFilters(action)).toThrow();
    const triggerFiltered = structuredClone(workflow);
    triggerFiltered.on.workflow_dispatch.paths = ['x'];
    expect(() => assertNoPathFilters(triggerFiltered)).toThrow();
  });
  it('rejects runs on main that cancel each other', () => {
    const cancelling = structuredClone(workflow);
    cancelling.concurrency['cancel-in-progress'] = true;
    expect(() => assertConcurrency(cancelling)).toThrow();
    const sharedGroup = structuredClone(workflow);
    sharedGroup.concurrency.group = 'ci-${{ github.ref }}';
    expect(() => assertConcurrency(sharedGroup)).toThrow();
    const prCancelOff = structuredClone(workflow);
    prCancelOff.concurrency['cancel-in-progress'] = false;
    expect(() => assertConcurrency(prCancelOff)).toThrow();
  });
  it('declares train gate as required and fails ordinary PRs with the merge instruction', () => {
    const job = workflow.jobs['train-gate'];
    // the job is named `train gate` on every head that may satisfy the requirement
    for (const ctx of [
      TRAIN_PR,
      MAIN_PUSH,
      dispatchOn('refs/heads/train/9a', 'build'),
      dispatchOn('refs/heads/main', 'build'),
    ])
      expect(evaluateTemplate(job.name, ctx)).toBe('train gate');
    assertGateWaits(workflow);
    const policy = readFileSync(new URL('../../../CONTRIBUTING.md', import.meta.url), 'utf8');
    expect(policy).toContain('`train gate` must be required in branch protection');
    const command = job.steps.find((step: { run?: string }) => step.run).run;
    assertGate(command);
  });
  it("never lets an ordinary PR's train gate reach success", () => {
    const job = workflow.jobs['train-gate'];
    const others = [
      TRAIN_PR,
      RELEASE_PR,
      MAIN_PUSH,
      dispatchOn('refs/heads/train/9a', 'build'),
      dispatchOn('refs/heads/main', 'build'),
    ];
    // the job passes on an ordinary PR under another name, so no job check named `train gate` can turn green there
    expect(evaluateTemplate(job.name, ORDINARY_PR)).not.toBe('train gate');
    // the release PR is judged under the real name, as a train PR is; a feature PR into the release branch is not
    expect(evaluateTemplate(job.name, RELEASE_PR)).toBe('train gate');
    expect(evaluateTemplate(job.name, TRAIN_PR)).toBe('train gate');
    expect(evaluateTemplate(job.name, FEATURE_PR)).not.toBe('train gate');
    for (const ctx of LOOKALIKE_PRS)
      expect(evaluateTemplate(job.name, ctx), ctx.headRef).not.toBe('train gate');
    // the real gate script runs on every other head and keeps rejecting an ordinary PR's head if it is ever run
    const gate = job.steps.find((s: { name?: string }) => s.name === 'Require the full merge train');
    expect(Boolean(evaluate(gate.if, ORDINARY_PR))).toBe(false);
    expect(Boolean(evaluate(gate.if, FEATURE_PR))).toBe(false);
    for (const ctx of others) expect(Boolean(evaluate(gate.if, ctx))).toBe(true);
    // the status named `train gate` is held pending, with its text, on an ordinary PR and nowhere else
    const hold = job.steps.find((s: { name?: string }) => s.name?.startsWith('Hold the train gate pending'));
    expect(Boolean(evaluate(hold.if, ORDINARY_PR))).toBe(true);
    expect(Boolean(evaluate(hold.if, FEATURE_PR))).toBe(true);
    for (const ctx of LOOKALIKE_PRS) expect(Boolean(evaluate(hold.if, ctx)), ctx.headRef).toBe(true);
    for (const ctx of others) expect(Boolean(evaluate(hold.if, ctx))).toBe(false);
    expect(hold.run).toContain('state=pending');
    expect(hold.run).toContain("context='train gate'");
    expect(hold.run).toContain("description='waits for the merge train'");
    expect(hold.run).not.toMatch(/state=(success|failure|error)/);
    expect(hold.run).not.toContain('${{');
    expect(hold.env.HEAD_SHA).toBe('${{ github.event.pull_request.head.sha }}');
    expect(job.permissions.statuses).toBe('write');
    // the pending post is the only step that touches the status, and it is the only one that can
    const writers = job.steps.filter((s: { run?: string }) => /statuses/.test(s.run ?? ''));
    expect(writers).toEqual([hold]);
  });
  it('rejects a gate that lets a dispatch count outside a train branch, or with an empty list', () => {
    const command: string = workflow.jobs['train-gate'].steps.find((step: { run?: string }) => step.run).run;
    expect(() => assertGate(command.replace(/REF_NAME/g, 'HEAD_REF'))).toThrow();
    expect(() => assertGate(command.replace('-z "$JOBS"', '-z "x"'))).toThrow();
    expect(() => assertGate(command.replace('[[ "$REF_NAME" != train/* ]]', 'false'))).toThrow();
  });
  it('rejects a gate that does not wait for every heavy job, or ignores a red one', () => {
    const noNeeds = structuredClone(workflow);
    delete noNeeds.jobs['train-gate'].needs;
    expect(() => assertGateWaits(noNeeds)).toThrow();
    for (const id of CI_HEAVY) {
      const missing = structuredClone(workflow);
      missing.jobs['train-gate'].needs = missing.jobs['train-gate'].needs.filter((n: string) => n !== id);
      expect(() => assertGateWaits(missing)).toThrow();
    }
    const skippedWhenRed = structuredClone(workflow);
    delete skippedWhenRed.jobs['train-gate'].if;
    expect(() => assertGateWaits(skippedWhenRed)).toThrow();
    const command: string = workflow.jobs['train-gate'].steps.find((s: { run?: string }) => s.run).run;
    // the same script without its result check lets a red heavy job through
    const blind = command.replace(
      /if \[\[ ",\$RESULTS," == \*,failure,\* \|\| ",\$RESULTS," == \*,cancelled,\* \]\]; then/,
      'if false; then',
    );
    expect(blind).not.toBe(command);
    expect(() => assertGate(blind)).toThrow();
    expect(() => assertGate(command.replace('*,cancelled,*', '*,never,*'))).toThrow();
  });
  it('passes the gate its dispatch inputs through the environment, never inline in the script', () => {
    const step = workflow.jobs['train-gate'].steps.find((s: { run?: string }) => s.run);
    expect(step.env.REF_NAME).toBe('${{ github.ref_name }}');
    expect(step.env.JOBS).toBe('${{ inputs.jobs }}');
    expect(step.run).not.toContain('${{');
  });
  it('scans the commits of a dispatched train branch with gitleaks, never "no commits"', () => {
    const scan = workflow.jobs.guard.steps.find((s: { name?: string }) => s.name === 'Secret scan');
    expect(scan.run).toContain('workflow_dispatch');
    expect(scan.run).toContain('origin/main..${GITHUB_SHA}');
  });
  it('runs a bounded fast check on every PR with the train entry checks and no affected tests', () => {
    const job = workflow.jobs['pr-fast'];
    expect(job.name).toBe('pr fast');
    expect(job.if).toBe(FAST_CONDITION);
    // about 3 minutes of work: the limit is 10, on a pull request and on a pre-flight dispatch
    expect(job['timeout-minutes']).toBe(FAST_TIMEOUT);
    expect(job.steps[0].with['fetch-depth']).toBe(0);
    const commands = job.steps.flatMap((step: { run?: string }) => step.run ?? '');
    expect(commands).toContain('pnpm lint');
    expect(commands).toContain('pnpm typecheck');
    expect(commands).toContain('node tools/structure/api-surface.mjs --build --check');
    expect(commands).toContain('node packages/cli/dist/bin.js --version');
    expect(commands).toContain('pnpm docs:reference --check');
    expect(commands).toContain('pnpm exec vitest run tools/docs --maxWorkers=2');
    // the affected tests moved to pr affected: the old shape (a step in this job) fails here
    expect(commands).not.toContain(AFFECTED_COMMAND);
    for (const id of ['build']) expect(workflow.jobs[id].if).toBe(heavyCondition(id));
  });
  it('runs the fast job on a pre-flight dispatch listing fast, and on no other dispatch', () => {
    assertFastBehaviour(workflow);
    const anyRef = structuredClone(workflow);
    anyRef.jobs['pr-fast'].if = anyRef.jobs['pr-fast'].if.replace(
      " && startsWith(github.ref, 'refs/heads/train/')",
      '',
    );
    expect(() => assertFastBehaviour(anyRef)).toThrow();
    const ignoresList = structuredClone(workflow);
    ignoresList.jobs['pr-fast'].if =
      "github.event_name == 'pull_request' || github.event_name == 'workflow_dispatch'";
    expect(() => assertFastBehaviour(ignoresList)).toThrow();
    const prefixMatch = structuredClone(workflow);
    prefixMatch.jobs['pr-fast'].if = prefixMatch.jobs['pr-fast'].if.replace("',{0},'", "'{0}'");
    expect(() => assertFastBehaviour(prefixMatch)).toThrow();
    const pullOnly = structuredClone(workflow);
    pullOnly.jobs['pr-fast'].if = "github.event_name == 'pull_request'";
    expect(() => assertFastBehaviour(pullOnly)).toThrow();
  });
  it('rejects the old shape, with the affected tests inside pr fast', () => {
    assertFastBehaviour(workflow);
    const inside = structuredClone(workflow);
    inside.jobs['pr-fast'].steps.push({
      name: 'Tests affected by this PR',
      run: AFFECTED_COMMAND,
    });
    expect(() => assertFastBehaviour(inside)).toThrow();
  });
  it('reports the affected tests in a separate job that is not required and not a gate input', () => {
    assertAffectedBehaviour(workflow);
    assertGateWaits(workflow);
    const missing = structuredClone(workflow);
    delete missing.jobs['pr-affected'];
    expect(() => assertAffectedBehaviour(missing)).toThrow();
    for (const [field, value] of [
      ['if', "github.event_name == 'pull_request'"],
      ['timeout-minutes', 20],
    ] as const) {
      const changed = structuredClone(workflow);
      changed.jobs['pr-affected'][field] = value;
      expect(() => assertAffectedBehaviour(changed), field).toThrow();
    }
    const noBuild = structuredClone(workflow);
    noBuild.jobs['pr-affected'].steps = noBuild.jobs['pr-affected'].steps.filter(
      (step: { run?: string }) => step.run !== 'node tools/structure/api-surface.mjs --build --check',
    );
    expect(() => assertAffectedBehaviour(noBuild)).toThrow();
    const wrongBase = structuredClone(workflow);
    wrongBase.jobs['pr-affected'].steps.find((step: { run?: string }) => step.run === AFFECTED_COMMAND).run =
      'pnpm test --maxWorkers=2 --changed origin/main~1 --passWithNoTests';
    expect(() => assertAffectedBehaviour(wrongBase)).toThrow();
    // the old fixed base: a PR into release/next would run all of release/next's difference from main
    const fixedMain = structuredClone(workflow);
    fixedMain.jobs['pr-affected'].steps.find((step: { run?: string }) => step.run === AFFECTED_COMMAND).run =
      'pnpm test --maxWorkers=2 --changed origin/main --passWithNoTests';
    expect(() => assertAffectedBehaviour(fixedMain)).toThrow();
    const noFetch = structuredClone(workflow);
    noFetch.jobs['pr-affected'].steps = noFetch.jobs['pr-affected'].steps.filter(
      (step: { run?: string }) => step.run !== AFFECTED_FETCH,
    );
    expect(() => assertAffectedBehaviour(noFetch)).toThrow();
    const inline = structuredClone(workflow);
    inline.jobs['pr-affected'].steps.find(
      (step: { run?: string }) => step.run === AFFECTED_COMMAND,
    ).env.BASE_REF = '${{ github.head_ref }}';
    expect(() => assertAffectedBehaviour(inline)).toThrow();
    const gated = structuredClone(workflow);
    gated.jobs['train-gate'].needs.push('pr-affected');
    expect(() => assertGateWaits(gated)).toThrow();
  });
  it('runs pr affected after a change of base from a workflow of its own, and never on a title edit', () => {
    const retarget = parse(
      readFileSync(new URL('../../../.github/workflows/pr-affected-retarget.yml', import.meta.url), 'utf8'),
    );
    assertRetargetBehaviour(retarget, workflow);
    const onEdit = structuredClone(workflow);
    onEdit.on.pull_request.types.push('edited');
    expect(() => assertRetargetBehaviour(retarget, onEdit)).toThrow();
    const anyEdit = structuredClone(retarget);
    anyEdit.jobs['pr-affected-retarget'].if = "github.event.pull_request.base.ref == 'main'";
    expect(() => assertRetargetBehaviour(anyEdit, workflow)).toThrow();
    const mainOnly = structuredClone(retarget);
    mainOnly.jobs['pr-affected-retarget'].if += " && github.event.pull_request.base.ref == 'main'";
    expect(() => assertRetargetBehaviour(mainOnly, workflow)).toThrow();
    const sameName = structuredClone(retarget);
    sameName.jobs['pr-affected-retarget'].name = 'pr affected';
    expect(() => assertRetargetBehaviour(sameName, workflow)).toThrow();
    const drifted = structuredClone(retarget);
    drifted.jobs['pr-affected-retarget'].steps.pop();
    expect(() => assertRetargetBehaviour(drifted, workflow)).toThrow();
  });
  it('always runs the docs checks in the fast job, and fails if a docs step is removed or made conditional', () => {
    assertFastDocs(workflow);
    for (const command of ['pnpm docs:reference --check', 'pnpm exec vitest run tools/docs --maxWorkers=2']) {
      const removed = structuredClone(workflow);
      removed.jobs['pr-fast'].steps = removed.jobs['pr-fast'].steps.filter(
        (step: { run?: string }) => step.run !== command,
      );
      expect(() => assertFastDocs(removed), command).toThrow();
      const conditional = structuredClone(workflow);
      conditional.jobs['pr-fast'].steps.find((step: { run?: string }) => step.run === command).if =
        "github.event_name == 'push'";
      expect(() => assertFastDocs(conditional), command).toThrow();
    }
  });
  it('fails the gate on a dispatch that ran no heavy job or names an unknown job, in any letter case', () => {
    const command: string = workflow.jobs['train-gate'].steps.find((s: { run?: string }) => s.run).run;
    expect(() => assertGate(command)).not.toThrow();
    const noSuccessCheck = command.replace('[[ ",$RESULTS," != *,success,* ]]', 'false');
    expect(noSuccessCheck).not.toBe(command);
    expect(() => assertGate(noSuccessCheck)).toThrow();
    const noLowercase = command.replace("tr '[:upper:]' '[:lower:]'", 'cat');
    expect(noLowercase).not.toBe(command);
    expect(() => assertGate(noLowercase)).toThrow();
    const noIdCheck = command.replace('for id in ${jobs_lc//,/ }; do', 'for id in; do');
    expect(noIdCheck).not.toBe(command);
    expect(() => assertGate(noIdCheck)).toThrow();
    const gateWaitsForFast = structuredClone(workflow);
    gateWaitsForFast.jobs['train-gate'].needs.push('pr-fast');
    expect(() => assertGateWaits(gateWaitsForFast)).toThrow();
  });
});

describe('the protect list and the frame files', () => {
  it('protects the complete benchmark frame and both enforcement workflows from executor changes', () => {
    const files = [
      'benchmarks/run.ts',
      'benchmarks/support/scorer.ts',
      'benchmarks/slices/planted-verify.json',
      'benchmarks/floors.json',
      'benchmarks/cassettes/haiku.json',
      'benchmarks/evidence/haiku.json',
      'benchmarks/test/floors.test.ts',
      'tools/bench-lint.mjs',
      'tools/bench-lint.test.mjs',
      'tools/bench-lint-future.mjs',
      'packages/cli/src/commands/bench.ts',
      'packages/cli/src/commands/bench-record.ts',
      '.github/workflows/ci.yml',
      '.github/workflows/bench-record.yml',
    ];
    expect(protectedChanges('exec/replace-bench', files)).toEqual(files);
    expect(protectedChanges('feat/maintainer-record', files)).toEqual([]);
    expect(protectedChanges('exec/other', ['benchmarks-old/run.ts', 'tools/other.mjs'])).toEqual([]);
  });

  it('protects every file of the frame, the bank and hardness modules, the bank fixtures and the validator tests', () => {
    for (const file of [
      'packages/validators/src/bank.ts',
      'packages/validators/src/hardness.ts',
      'packages/validators/src/floors.ts',
      'packages/validators/src/journal.ts',
      'packages/validators/src/ladder.ts',
      'packages/validators/fixtures/judges/good.cassette.json',
      'packages/validators/test/judges/ladder.test.ts',
      'validators/floors.json',
      'validators/EXECUTOR.md',
    ]) {
      expect(protectedChanges('exec/x', [file])).toEqual([file]);
    }
  });
});

describe('the benchmark workflows', () => {
  it('enforces public imports and replays every slice against its floor in CI', () => {
    const workflow = parse(
      readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
    );
    const runs = workflow.jobs.bench.steps.flatMap((step: { run?: string }) => step.run ?? []);
    expect(runs).toContain('node tools/bench-lint.mjs');
    expect(runs).toContain('node --import tsx benchmarks/cli.ts replay --slice all --check-floor');
    expect(Object.keys(workflow.on)).toEqual(expect.arrayContaining(['pull_request', 'push']));
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('keeps the developer bench shortcut pointed at the repository entry', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(manifest.scripts.bench).toBe('tsx benchmarks/cli.ts');
  });

  it('records only by manual dispatch, with bounded spend and artifact review before a maintainer commit', () => {
    const workflow = parse(
      readFileSync(new URL('../../../.github/workflows/bench-record.yml', import.meta.url), 'utf8'),
    );
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.slice.required).toBe(true);
    expect(inputs.model.options).toEqual(['haiku', 'gpt-6-luna', 'gemini-3.5-flash-lite']);
    expect(inputs['spend-cap-usd'].required).toBe(true);
    expect(Object.keys(inputs).sort()).toEqual(['model', 'slice', 'spend-cap-usd']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.haiku['runs-on']).toContain('self-hosted');
    expect(workflow.jobs.haiku['runs-on']).toContain('claude-cli');
    for (const job of Object.values(workflow.jobs) as {
      steps: { run?: string; uses?: string; with?: Record<string, string> }[];
    }[]) {
      const commands = job.steps.flatMap((step) => step.run ?? []).join('\n');
      expect(commands).toContain(
        'bench record --slice "$BENCH_SLICE" --model "$BENCH_MODEL" --spend-cap-usd "$BENCH_SPEND_CAP_USD"',
      );
      expect(commands).not.toMatch(/git (?:push|commit)/);
      expect(commands).not.toContain('${{ inputs.');
      expect(commands).not.toContain('--openai-input-usd-per-million');
      expect(commands).not.toContain('--openai-output-usd-per-million');
      const upload = job.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
      expect(upload?.with?.path).toContain('benchmarks/cassettes/');
      expect(upload?.with?.path).toContain('benchmarks/evidence/');
    }
  });
});

describe('the pinned catch list', () => {
  it('refuses an executor branch that edits a validator catch.json, and leaves other branches alone', () => {
    expect(protectedChanges('exec/blocks-1', ['validators/blocks/catch.json'])).toEqual([
      'validators/blocks/catch.json',
    ]);
    expect(protectedChanges('exec/blocks-1', ['validators/blocks/journal.jsonl'])).toEqual([]);
    expect(protectedChanges('fix/blocks', ['validators/blocks/catch.json'])).toEqual([]);
  });
});
