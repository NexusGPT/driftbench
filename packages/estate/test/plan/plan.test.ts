import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  cellKey,
  PHRASE_NOTE,
  PlanInputError,
  parsePlanText,
  renderPlan,
  renderPlanSummary,
  summaryPathOf,
  toEstateSpaceMap,
} from '../../src/index';
import { FIXTURE } from '../support';
import { approvedFixture, edited } from './support';

describe('the estate plan', () => {
  it('renders the same bytes for the same map and options, and parses back to the same plan', async () => {
    const map = await approvedFixture();
    const first = buildPlan(map);
    const second = buildPlan(await approvedFixture());
    expect(renderPlan(second.plan)).toBe(renderPlan(first.plan));
    expect(renderPlanSummary(second.plan, second.details)).toBe(renderPlanSummary(first.plan, first.details));
    const parsed = parsePlanText(renderPlan(first.plan));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.plan).toEqual(first.plan);
    expect(renderPlan(buildPlan(map, { t: 1 }).plan)).not.toBe(renderPlan(first.plan));
  });

  it('matches the committed fixture plan and its summary', async () => {
    const built = buildPlan(await approvedFixture());
    expect(await readFile(join(FIXTURE, 'plan.yaml'), 'utf8')).toBe(renderPlan(built.plan));
    expect(await readFile(join(FIXTURE, 'plan.summary.json'), 'utf8')).toBe(
      renderPlanSummary(built.plan, built.details),
    );
  });

  it('counts the summary from the rows: cells, phrases, kinds, test types, unenforced atoms', async () => {
    const map = await approvedFixture();
    const { plan, details } = buildPlan(map);
    const { summary } = plan;
    expect(summary.cells).toBe(new Set(plan.rows.map(cellKey)).size);
    expect(summary.cellsWithoutPhrase).toBe(summary.cells);
    expect(details.notes).toContain(PHRASE_NOTE);
    expect(Object.values(summary.perTestType).reduce((sum, n) => sum + n, 0)).toBe(plan.rows.length);
    expect(details.rows.total).toBe(details.rows.contract + details.rows.journey + details.rows.pairwise);
    expect(summary.coveringArraySize).toBe(details.rows.pairwise);
    expect(summary.perKind.instruction).toBe(120);
    expect(summary.perKind.setting).toBeUndefined();
    expect(details.noContract).toHaveLength(4);
    expect(summary.unenforcedAtoms).toEqual(
      map.atoms
        .filter(
          (atom) => ['instruction', 'gate', 'register'].includes(atom.kind) && atom.enforcement.length === 0,
        )
        .map((atom) => atom.id),
    );
    expect(summary.unenforcedAtoms).toHaveLength(51);
    expect(summary.edgesWithoutJourney).toBe(7);
    expect(details.gridCells).toBe(1_992_646_656_000);
    expect(details.tuples.covered).toBe(details.tuples.allowed);
  });

  it('leaves unapproved atoms out of the rows and the unenforced list', async () => {
    const id = 'instruction.standing.tell-the-user-about-a-late';
    const map = edited(await approvedFixture(), (copy) => {
      const atom = copy.atoms.find((candidate) => candidate.id === id);
      if (atom) atom.approved = false;
    });
    const { plan, details } = buildPlan(map);
    expect(plan.rows.some((row) => row.atomIds.includes(id))).toBe(false);
    expect(plan.summary.unenforcedAtoms).not.toContain(id);
    expect(details.unapproved).toBe(1);
  });

  it('marks the negative controls as rows of their own, each with its mode', async () => {
    const { plan } = buildPlan(await approvedFixture());
    for (const type of ['outside_trigger', 'route_near_miss', 'guard_negative'] as const) {
      const rows = plan.rows.filter((row) => row.testType === type);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.id.startsWith(`${type}.`)).toBe(true);
    }
    expect(plan.rows.find((row) => row.testType === 'guard_negative')?.mode).toBe('unit');
    expect(plan.rows.find((row) => row.testType === 'guard_positive')?.mode).toBe('replay');
    expect(plan.rows.every((row) => row.status === 'proposed' && row.weight === 1)).toBe(true);
  });

  it('drops a situation value the constraint list forbids with the target, and says so', async () => {
    const map = await approvedFixture();
    const space = toEstateSpaceMap(map);
    const helper = 'subagent.route-planner.helper-route-planner';
    space.constraints.push({
      forbid: { 'atoms.subagent': helper, estate_hazard: 'dead_helper' },
      reason: 'test',
    });
    const { plan, details } = buildPlan(map, { space });
    const row = plan.rows.find((candidate) => candidate.id === `stop_resume.${helper}`);
    expect(row?.cell).toEqual({ 'atoms.subagent': helper });
    expect(details.adjusted).toEqual([
      {
        row: `stop_resume.${helper}`,
        reason: 'the constraint list forbids session_state=helpers_running, estate_hazard=dead_helper',
      },
    ]);
  });

  it('refuses a space map whose targets are not approved atoms of the map, under their kind', async () => {
    const map = await approvedFixture();
    const space = toEstateSpaceMap(map);
    const target = space.dimensions.find((dimension) => dimension.id === 'atoms.gate');
    target?.values.push({ id: 'gate.standing.not-in-the-map', title: 'x' });
    expect(() => buildPlan(map, { space })).toThrow(PlanInputError);
    const unapproved = edited(map, (copy) => {
      const atom = copy.atoms.find(
        (candidate) => candidate.id === 'gate.standing.read-git-status-before-commit-to',
      );
      if (atom) atom.approved = false;
    });
    expect(() => buildPlan(unapproved, { space: toEstateSpaceMap(map) })).toThrow(/not approved/);
  });

  it('writes the summary beside the plan', () => {
    expect(summaryPathOf('/x/plan.yaml')).toBe('/x/plan.summary.json');
    expect(summaryPathOf('/x/plan.yml')).toBe('/x/plan.summary.json');
    expect(summaryPathOf('/x/plan')).toBe('/x/plan.summary.json');
  });
});
