import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assignmentTable,
  calibrate,
  cassettePlayers,
  councilAssignment,
  createCouncil,
  FakeJudge,
  type JudgeRequest,
  loadCassette,
  loadCriteria,
  loadLabels,
} from '../src/index';

/**
 * The cheapest-judge rule: each criterion goes to the one cheapest judge at the bar, which then judges it
 * alone. Measured on the recorded Claude council (haiku, sonnet, opus on 12 Acme criteria).
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CRITERIA = join(ROOT, 'examples/acme/criteria');

async function council() {
  const { criteria } = await loadCriteria(CRITERIA);
  const { labels } = await loadLabels(join(ROOT, 'examples/acme/labels'));
  const cassette = await loadCassette(join(CRITERIA, 'calibration/claude-council.cassette.json'));
  return calibrate({ judges: cassettePlayers(cassette), criteria, labels, mode: 'llm', rule: 'cheapest' });
}

describe('the cheapest-judge rule', () => {
  it('assigns 12 of 12: haiku where it meets the bar, sonnet on explicit_confirmation', async () => {
    const report = await council();
    const owners = Object.fromEntries(
      report.criteria.map((c) => [
        c.criterion,
        c.assignment.status === 'assigned' ? c.assignment.owner : 'none',
      ]),
    );
    expect(Object.values(owners).filter((o) => o === 'none')).toEqual([]);
    expect(owners.explicit_confirmation).toBe('claude-sonnet');
    expect(Object.entries(owners).filter(([, o]) => o === 'claude-haiku')).toHaveLength(11);
    for (const c of report.criteria) {
      expect(c.assignment, c.criterion).toMatchObject({ judges: [expect.any(String)], rejudge: [] });
    }
  });

  it('gives the measured cost per call of each owner on its criterion', async () => {
    const report = await council();
    const explicit = report.criteria.find((c) => c.criterion === 'explicit_confirmation');
    const sonnet = explicit?.judges.find((j) => j.judge === 'claude-sonnet');
    expect(sonnet?.calls).toBe(9);
    expect(sonnet?.spentUsd).toBeGreaterThan(0);
    const table = assignmentTable(report);
    const entry = table.criteria.find((c) => c.criterion === 'explicit_confirmation');
    expect(entry).toMatchObject({ owner: 'claude-sonnet', judges: ['claude-sonnet'] });
    expect(entry && 'cost_per_call_usd' in entry ? entry.cost_per_call_usd : 0).toBeCloseTo(
      (sonnet?.spentUsd ?? 0) / 9,
      6,
    );
  });

  it('keeps the council rule as the default', async () => {
    const { criteria } = await loadCriteria(CRITERIA);
    const { labels } = await loadLabels(join(ROOT, 'examples/acme/labels'));
    const cassette = await loadCassette(join(CRITERIA, 'calibration/claude-council.cassette.json'));
    const report = await calibrate({ judges: cassettePlayers(cassette), criteria, labels, mode: 'llm' });
    expect(report.criteria.find((c) => c.criterion === 'explicit_confirmation')?.assignment.status).toBe(
      'unassigned',
    );
  });
});

describe('a council row of one judge', () => {
  const REQUEST: JudgeRequest = {
    criterion: { name: 'explicit_confirmation', rubric: 'The order follows CONFIRM.' },
    transcript: [{ role: 'user', text: 'CONFIRM' }],
  };

  it('takes the one judge as the verdict, and refuses a row of two', async () => {
    const judges = ['a', 'b', 'c'].map(
      (id) =>
        new FakeJudge(id, [{ outcome: id === 'b' ? 'fail' : 'pass', reasoning: id }], {
          family: 'lab',
          cls: 'system2',
        }),
    );
    const solo = {
      criterion: 'explicit_confirmation',
      cls: 'system2' as const,
      judges: ['b'],
      rejudge: [],
      source: 'calibration' as const,
    };
    const result = await createCouncil({
      mode: 'llm',
      judges,
      agentFamily: 'none',
      assignment: [solo],
    }).judge(REQUEST);
    expect(result).toMatchObject({ outcome: 'fail', split: false });
    expect(result.votes.map((v) => v.judge)).toEqual(['b']);
    expect(() =>
      createCouncil({
        mode: 'llm',
        judges,
        agentFamily: 'none',
        assignment: [{ ...solo, judges: ['a', 'b'] }],
      }),
    ).toThrow(/1 or 3 different judges/);
  });

  it('round-trips through the table into a council', async () => {
    const report = await council();
    const earned = councilAssignment(assignmentTable(report));
    const row = earned.assignment.find((r) => r.criterion === 'explicit_confirmation');
    expect(row).toMatchObject({ judges: ['claude-sonnet'], rejudge: [], source: 'calibration' });
  });
});
