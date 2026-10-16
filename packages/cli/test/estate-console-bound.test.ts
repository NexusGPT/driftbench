import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plan, PlanDetails } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import { planReport } from '../src/commands/estate-plan';
import { estateStatsCommand } from '../src/commands/estate-stats';
import type { Io } from '../src/io';

const fixture = fileURLToPath(new URL('../../../examples/estates/fixture/', import.meta.url));

it('bounds the plan console even when every detail list grows', () => {
  const plan = {
    summary: {
      cells: 1,
      coveringArraySize: 1,
      perKind: {},
      perTestType: {},
      unenforcedAtoms: [],
      cellsWithoutPhrase: 1,
      edgesWithoutJourney: 100_000,
    },
  } as unknown as Plan;
  const details = {
    rows: { total: 1, contract: 1, journey: 0, pairwise: 0 },
    t: 2,
    k: 3,
    seed: 1,
    tuples: { covered: 1, allowed: 1 },
    gridCells: 1,
    noContract: [],
    unapproved: 0,
    droppedConstraints: 0,
    uncoveredEdges: Array.from({ length: 100_000 }, () => ({
      from: 'a',
      to: 'b',
      kind: 'reference',
      reason: 'unreached',
    })),
    adjusted: Array.from({ length: 100_000 }, () => ({ row: 'a', reason: 'changed' })),
    notes: Array.from({ length: 100_000 }, () => 'Unresolved detail.'),
  } as PlanDetails;
  const output = planReport(plan, details, 'plan.yaml', 'plan.summary.json');
  expect(output.split('\n').length).toBeLessThan(30);
  expect(output.length).toBeLessThan(3000);
  expect(output).toContain('100000');
  expect(output).toContain('plan.summary.json');
  expect(output).not.toContain('Unresolved detail.');
});

describe('stats file and console', () => {
  it('writes a complete report and keeps the default console to counts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'estate-stats-report-'));
    let output = '';
    let errors = '';
    const io: Io = {
      cwd: root,
      out: (s) => {
        output += s;
      },
      err: (s) => {
        errors += s;
      },
    };
    const code = await estateStatsCommand(
      {
        map: join(fixture, 'approved.yaml'),
        plan: join(fixture, 'plan.yaml'),
        specs: root,
        out: 'stats.json',
      },
      io,
    );
    expect(errors).toBe('');
    expect(code).toBe(0);
    expect(output).toContain('Full report: stats.json');
    expect(output.split('\n').length).toBeLessThan(30);
    const report = JSON.parse(await readFile(join(root, 'stats.json'), 'utf8'));
    expect(report.coverage.kinds.skill.atoms).toBeGreaterThan(0);
    expect(report.reach).toEqual([]);
  });
});
