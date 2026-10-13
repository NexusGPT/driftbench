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

describe('the validators workflow', () => {
  const workflow = parse(readFileSync(WORKFLOW, 'utf8'));
  const runs = (job: string): string[] =>
    (workflow.jobs[job].steps as { run?: string }[]).flatMap((step) => (step.run ? [step.run] : []));
  it('runs every validator on seeds 1 to 3 and the hidden seed with the floors enforced, on push and pull request', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push']);
    expect(runs('ladders')).toContain('pnpm driftbench validate all --seeds 1..3 --hidden --check-floor');
    expect(runs('ladders')).toContain('pnpm driftbench validate all --check-handover');
  });
  it('checks every pull request for protected changes with the full history', () => {
    expect(workflow.jobs.protect.if).toBe("github.event_name == 'pull_request'");
    expect(workflow.jobs.protect.steps[0].with['fetch-depth']).toBe(0);
    expect(runs('protect')).toContain(
      'pnpm driftbench validate protect --branch "$HEAD_REF" --base "origin/$BASE_REF"',
    );
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
    expect(runs).toContain('pnpm driftbench bench replay --slice all --check-floor');
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('records only by manual dispatch, with bounded spend and artifact review before a maintainer commit', () => {
    const workflow = parse(
      readFileSync(new URL('../../../.github/workflows/bench-record.yml', import.meta.url), 'utf8'),
    );
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.slice.required).toBe(true);
    expect(inputs.model.options).toEqual(['haiku', 'gpt-6-luna']);
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
