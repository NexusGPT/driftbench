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
