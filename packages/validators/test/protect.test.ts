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

const TRAIN_CONDITION = "github.event_name == 'push' || startsWith(github.head_ref, 'train/')";

/** Conditions and steps must keep the complete validators on every train and main push. */
function assertTrainValidators(workflow: ReturnType<typeof parse>) {
  expect(workflow.on.pull_request).toBeDefined();
  expect(workflow.on.push.branches).toContain('main');
  for (const trigger of [workflow.on.pull_request, workflow.on.push]) {
    expect(trigger.paths).toBeUndefined();
    expect(trigger['paths-ignore']).toBeUndefined();
  }
  for (const id of ['ladders', 'system-full']) {
    const job = workflow.jobs[id];
    expect(job.if).toBe(TRAIN_CONDITION);
    for (const step of job.steps) expect(step.if).toBeUndefined();
  }
  const commands = workflow.jobs.ladders.steps.flatMap((step: { run?: string }) => step.run ?? []);
  expect(commands).toContain('pnpm driftbench validate all --seeds 1..3 --hidden --check-floor');
  expect(commands).toContain('pnpm driftbench validate all --check-handover');
  const system = workflow.jobs['system-full'].steps
    .map((step: { run?: string }) => step.run ?? '')
    .join('\n');
  expect(system).toContain('pnpm driftbench validate system --seeds 1..3 --hidden --all-levels');
  expect(system).toContain('test "$status" -eq 11');
}

describe('the validators workflow', () => {
  const workflow = parse(readFileSync(WORKFLOW, 'utf8'));
  const runs = (job: string): string[] =>
    (workflow.jobs[job].steps as { run?: string }[]).flatMap((step) => (step.run ? [step.run] : []));
  it('runs all registered validators in full on every train PR and main push, without path filters', () => {
    assertTrainValidators(workflow);
  });
  it('rejects removing the train condition', () => {
    const changed = structuredClone(workflow);
    changed.jobs.ladders.if = "github.event_name == 'push'";
    expect(() => assertTrainValidators(changed)).toThrow();
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
  });
  it('checks every pull request for protected changes with the full history', () => {
    expect(workflow.jobs.protect.if).toBe("github.event_name == 'pull_request'");
    expect(workflow.jobs.protect.steps[0].with['fetch-depth']).toBe(0);
    expect(runs('protect')).toContain(
      'pnpm driftbench validate protect --branch "$HEAD_REF" --base "origin/$BASE_REF"',
    );
  });
});

describe('merge train enforcement', () => {
  const workflow = parse(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  it('keeps every heavy CI job on trains and main, with no path filters', () => {
    expect(workflow.on.pull_request).toBeDefined();
    expect(workflow.on.push.branches).toContain('main');
    for (const trigger of [workflow.on.pull_request, workflow.on.push]) {
      expect(trigger.paths).toBeUndefined();
      expect(trigger['paths-ignore']).toBeUndefined();
    }
    for (const id of [
      'bench',
      'research-replay',
      'build',
      'python',
      'comparison-replay',
      'viewer-journey',
      'guard',
    ]) {
      expect(workflow.jobs[id].if).toBe(TRAIN_CONDITION);
    }
    expect(workflow.jobs.build.strategy.matrix.node).toEqual([22, 24]);
    expect(workflow.jobs.python.strategy.matrix.python).toEqual(['3.11', '3.12']);
  });
  it('declares train gate as required and fails ordinary PRs with the merge instruction', () => {
    const job = workflow.jobs['train-gate'];
    expect(job.name).toBe('train gate');
    expect(job.if).toBeUndefined();
    const policy = readFileSync(new URL('../../../CONTRIBUTING.md', import.meta.url), 'utf8');
    expect(policy).toContain('`train gate` must be required in branch protection');
    const command = job.steps.find((step: { run?: string }) => step.run).run;
    for (const [event, head, expected] of [
      ['pull_request', 'train/ci-speed', 0],
      ['push', '', 0],
      ['pull_request', 'fix/ordinary', 1],
      ['pull_request', 'train-lookalike', 1],
    ] as const) {
      const result = spawnSync('bash', ['-c', command], {
        encoding: 'utf8',
        env: { ...process.env, EVENT_NAME: event, HEAD_REF: head },
      });
      expect(result.status).toBe(expected);
      if (expected === 1) expect(result.stdout).toContain('Merge through a train (train/<n>)');
    }
  });
  it('runs a bounded fast check on every PR with full diff history and affected tests', () => {
    const job = workflow.jobs['pr-fast'];
    expect(job.name).toBe('pr fast');
    expect(job.if).toBe("github.event_name == 'pull_request'");
    expect(job['timeout-minutes']).toBe(8);
    expect(job.steps[0].with['fetch-depth']).toBe(0);
    const commands = job.steps.flatMap((step: { run?: string }) => step.run ?? []);
    expect(commands).toContain('pnpm lint');
    expect(commands).toContain('pnpm typecheck');
    expect(commands).toContain('node tools/structure/api-surface.mjs --build --check');
    expect(commands).toContain('pnpm test --maxWorkers=2 --changed origin/main --passWithNoTests');
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
