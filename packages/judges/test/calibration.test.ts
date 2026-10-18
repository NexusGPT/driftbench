import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assignmentTable,
  cassettePlayers as baseCassettePlayers,
  type CalibrationReport,
  type Cassette,
  calibrate,
  councilAssignment,
  createCouncil,
  FakeJudge,
  type JudgeClient,
  type LabelledBlock,
  type LoadedCriterion,
  labelRequest,
  loadAssignmentTable,
  loadCassette,
  loadCriteria,
  loadLabels,
  renderAssignmentTable,
  requestKey,
} from '../src/index';
import { ACME_JUDGES, ACME_MISSES, type Miss, scriptedCalibrationCassette } from './support/scripted';

const cassettePlayers = (cassette: Parameters<typeof baseCassettePlayers>[0]) =>
  baseCassettePlayers(cassette, { answerContract: 'legacy' });

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CRITERIA = join(ROOT, 'examples/acme/criteria');
const LABELS = join(ROOT, 'examples/acme/labels');
const CASSETTE = join(CRITERIA, 'calibration/cassette.json');
const TABLE = join(CRITERIA, 'calibration/assignments.yaml');

async function acme(): Promise<{
  criteria: LoadedCriterion[];
  labels: ReadonlyMap<string, readonly LabelledBlock[]>;
}> {
  const loaded = await loadCriteria(CRITERIA);
  const labels = await loadLabels(LABELS);
  expect(loaded.issues).toEqual([]);
  expect(labels.issues).toEqual([]);
  return { criteria: loaded.criteria, labels: labels.labels };
}

function row(report: CalibrationReport, criterion: string, judge: string) {
  const found = report.criteria.find((c) => c.criterion === criterion)?.judges.find((j) => j.judge === judge);
  if (!found) throw new Error(`no row for ${criterion} ${judge}`);
  return found;
}

function assignmentOf(report: CalibrationReport, criterion: string) {
  return report.criteria.find((c) => c.criterion === criterion)?.assignment;
}

async function scripted(misses: readonly Miss[]): Promise<CalibrationReport> {
  const { criteria, labels } = await acme();
  const cassette = scriptedCalibrationCassette(criteria, labels, { misses });
  return calibrate({ judges: cassettePlayers(cassette), criteria, labels });
}

describe('the Acme labels', () => {
  it('hold 40 hand-labelled blocks, 2 to 4 per criterion, each criterion with a pass and a fail', async () => {
    const { criteria, labels } = await acme();
    let total = 0;
    for (const criterion of criteria) {
      const blocks = labels.get(criterion.def.name) ?? [];
      expect(blocks.length, criterion.def.name).toBeGreaterThanOrEqual(2);
      expect(blocks.length, criterion.def.name).toBeLessThanOrEqual(4);
      expect(new Set(blocks.map((block) => block.label)), criterion.def.name).toEqual(
        new Set(['pass', 'fail']),
      );
      total += blocks.length;
    }
    expect(total).toBe(40);
  });
});

describe('loadLabels', () => {
  const VALID = `criterion: short
blocks:
  - id: short.1
    label: pass
    transcript: [{ role: agent, text: "Yes." }]
  - id: short.2
    label: fail
    transcript: [{ role: agent, text: "Yes. Sure. Of course." }]
`;

  async function load(files: Record<string, string>) {
    const dir = await mkdtemp(join(tmpdir(), 'judges-labels-'));
    try {
      for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
      return await loadLabels(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('loads a valid file', async () => {
    const { labels, issues } = await load({ 'short.yaml': VALID });
    expect(issues).toEqual([]);
    expect(labels.get('short')).toHaveLength(2);
  });

  const broken: Array<[string, Record<string, string>, RegExp]> = [
    [
      'a criterion that differs from the file',
      { 'long.yaml': VALID },
      /labels are for short, the file is long/,
    ],
    [
      'only one kind of label',
      { 'short.yaml': VALID.replace('label: fail', 'label: pass') },
      /needs a pass and a fail/,
    ],
    [
      'a label other than pass or fail',
      { 'short.yaml': VALID.replace('label: fail', 'label: maybe') },
      /label/,
    ],
    [
      'a block id used twice',
      { 'short.yaml': VALID, 'other.yaml': VALID.replace('criterion: short', 'criterion: other') },
      /block id short\.1 is also used/,
    ],
    ['text that is not YAML', { 'short.yaml': 'criterion: [' }, /not YAML/],
    ['an empty folder', {}, /no labels file/],
  ];
  for (const [label, files, message] of broken) {
    it(`reports ${label}`, async () => {
      const { issues } = await load(files);
      expect(issues.map((issue) => issue.message).join('\n')).toMatch(message);
    });
  }

  it('reports a folder that cannot be read', async () => {
    const { issues } = await loadLabels(join(tmpdir(), 'driftbench-no-such-labels'));
    expect(issues[0]?.message).toMatch(/cannot read the folder/);
  });
});

describe('calibrate on the committed Acme cassette', () => {
  it('reproduces the committed assignment table byte for byte', async () => {
    const { criteria, labels } = await acme();
    const report = await calibrate({
      judges: cassettePlayers(await loadCassette(CASSETTE)),
      criteria,
      labels,
    });
    expect(report.errors).toBe(0);
    expect(renderAssignmentTable(assignmentTable(report))).toBe(await readFile(TABLE, 'utf8'));
  });

  it('matches the scripted cassette it was written from: no answer drifted from its script', async () => {
    const { criteria, labels } = await acme();
    const committed = await loadCassette(CASSETTE);
    expect(scriptedCalibrationCassette(criteria, labels, { misses: ACME_MISSES })).toEqual(committed);
  });

  it('assigns by the bar: a judge under it moves the criterion to a class with three at the bar', async () => {
    const { criteria, labels } = await acme();
    const report = await calibrate({
      judges: cassettePlayers(await loadCassette(CASSETTE)),
      criteria,
      labels,
    });
    expect(assignmentOf(report, 'care_redirect')).toMatchObject({
      status: 'assigned',
      owner: 's1p-a',
      cls: 'system1',
    });
    // s1p-b mislabels one plain_language block: system 1 keeps two judges at the bar, system 2 takes it.
    expect(row(report, 'plain_language', 's1p-b')).toMatchObject({ meetsBar: false });
    expect(row(report, 'plain_language', 's1p-b').labels.kappa).toBeCloseTo(0.4, 10);
    expect(assignmentOf(report, 'plain_language')).toMatchObject({
      status: 'assigned',
      owner: 'google-chat',
      cls: 'system2',
      judges: ['google-chat', 'openai-chat', 'anthropic-chat'],
    });
    // openai-decisions obeys the planted instruction once in three repeats: 2 of 3 is not separation.
    expect(row(report, 'holds_instructions', 'openai-decisions').separation).toMatchObject({
      separated: 2,
      repeats: 3,
    });
    expect(assignmentOf(report, 'holds_instructions')).toMatchObject({ cls: 'system2' });
    // The task criterion: anthropic-chat reads the reply, not the changed cell, and never separates.
    expect(row(report, 'sheet_matches_catalog', 'anthropic-chat').separation.separated).toBe(0);
    expect(assignmentOf(report, 'sheet_matches_catalog')).toMatchObject({ owner: 's1p-a', cls: 'system1' });
  });

  it('leaves a criterion unassigned when no class seats three judges at the bar, and says why', async () => {
    const { criteria, labels } = await acme();
    const report = await calibrate({
      judges: cassettePlayers(await loadCassette(CASSETTE)),
      criteria,
      labels,
    });
    const ledger = assignmentOf(report, 'ledger_intact');
    expect(ledger?.status).toBe('unassigned');
    expect(ledger && 'reason' in ledger ? ledger.reason : '').toMatch(
      /system1 has 2 of 3 judges at the bar, system2 has 2 of 3.*s1p-b kappa 0\.40.*google-chat kappa 0\.50/,
    );
  });

  it('reports a Wilson interval on agreement and Krippendorff alpha across judges', async () => {
    const { criteria, labels } = await acme();
    const report = await calibrate({
      judges: cassettePlayers(await loadCassette(CASSETTE)),
      criteria,
      labels,
    });
    const agreement = row(report, 'care_redirect', 's1p-a').labels;
    expect(agreement).toMatchObject({ n: 4, agree: 4, kappa: 1 });
    expect(agreement.agreement.lower).toBeCloseTo(0.5101, 3);
    expect(agreement.agreement.upper).toBe(1);
    expect(report.criteria.find((c) => c.criterion === 'care_redirect')?.alpha).toBe(1);
    expect(report.criteria.find((c) => c.criterion === 'plain_language')?.alpha).toBeLessThan(1);
    const pooled = report.pooled.find((p) => p.judge === 's1p-a');
    expect(pooled).toMatchObject({ n: 40, agree: 38 });
  });
});

describe('calibrate with a cassette that makes one judge fail the bar', () => {
  it('assigns every criterion to the cheapest system 1 judge when every judge tells the truth', async () => {
    const report = await scripted([]);
    for (const criterion of report.criteria) {
      expect(criterion.assignment, criterion.criterion).toMatchObject({ status: 'assigned', owner: 's1p-a' });
    }
  });

  it('moves care_redirect to system 2 when s1p-b passes its fail fixture', async () => {
    const report = await scripted([
      { judge: 's1p-b', criterion: 'care_redirect', item: 'fail', answer: 'pass' },
    ]);
    expect(row(report, 'care_redirect', 's1p-b').misses).toEqual(['separates the fixture pair 0 of 3 times']);
    expect(assignmentOf(report, 'care_redirect')).toMatchObject({
      status: 'assigned',
      owner: 'google-chat',
      cls: 'system2',
      rejudge: ['s1p-a', 'openai-decisions', 's1p-b'],
    });
  });

  it('keeps the owner when a more expensive judge of another class fails', async () => {
    const report = await scripted([
      { judge: 'openai-chat', criterion: 'care_redirect', item: 'care_redirect.1', answer: 'fail' },
    ]);
    expect(row(report, 'care_redirect', 'openai-chat').meetsBar).toBe(false);
    expect(assignmentOf(report, 'care_redirect')).toMatchObject({ owner: 's1p-a', cls: 'system1' });
  });

  it('leaves care_redirect unassigned when a judge of each class fails', async () => {
    const report = await scripted([
      { judge: 's1p-b', criterion: 'care_redirect', item: 'fail', answer: 'pass' },
      { judge: 'anthropic-chat', criterion: 'care_redirect', item: 'pass', repeat: 2, answer: 'fail' },
    ]);
    expect(row(report, 'care_redirect', 'anthropic-chat').separation.separated).toBe(2);
    expect(assignmentOf(report, 'care_redirect')?.status).toBe('unassigned');
  });

  it('counts an answer that never parses as inconclusive, after asking again with the large budget', async () => {
    const { criteria, labels } = await acme();
    const cassette = scriptedCalibrationCassette(criteria, labels, {
      misses: [{ judge: 's1p-a', criterion: 'care_redirect', item: 'care_redirect.2', answer: 'unparsed' }],
    });
    const asked: string[] = [];
    const judges = cassettePlayers(cassette).map((player): JudgeClient => {
      if (player.id !== 's1p-a') return player;
      return {
        ...player,
        judge: (request) => {
          asked.push(`${request.criterion.name} ${request.budget}`);
          return player.judge(request);
        },
      };
    });
    const report = await calibrate({ judges, criteria, labels });
    const blocks = row(report, 'care_redirect', 's1p-a').labels.blocks;
    expect(blocks.find((b) => b.id === 'care_redirect.2')?.judged).toBe('inconclusive');
    expect(asked.filter((line) => line === 'care_redirect large')).toHaveLength(1);
    expect(row(report, 'care_redirect', 's1p-a').meetsBar).toBe(false);
  });

  it('counts a judge with no answer as an error and an inconclusive answer, never a pass', async () => {
    const { criteria, labels } = await acme();
    const cassette: Cassette = scriptedCalibrationCassette(criteria, labels);
    const [criterion] = criteria.filter((c) => c.def.name === 'care_redirect');
    const block = labels.get('care_redirect')?.find((b) => b.id === 'care_redirect.1');
    if (!criterion || !block) throw new Error('care_redirect.1 is missing');
    // Only the recording of a block labelled pass goes: a missing answer read as pass would agree with it.
    const key = requestKey(
      labelRequest(criterion, block),
      cassette.judges.find((j) => j.id === 's1p-a'),
    );
    cassette.entries = cassette.entries.filter((entry) => !(entry.judge === 's1p-a' && entry.key === key));
    const report = await calibrate({ judges: cassettePlayers(cassette), criteria, labels });
    expect(report.errors).toBe(1);
    const jev = row(report, 'care_redirect', 's1p-a');
    expect(jev.labels.blocks.find((b) => b.id === 'care_redirect.1')?.judged).toBe('inconclusive');
    expect(jev.misses.join(' ')).toMatch(/1 call\(s\) gave no answer/);
    expect(assignmentOf(report, 'care_redirect')).toMatchObject({ owner: 'google-chat' });
  });

  it('leaves out a judge of the agent family, and a mode with one class assigns inside it only', async () => {
    const { criteria, labels } = await acme();
    const cassette = scriptedCalibrationCassette(criteria, labels);
    const report = await calibrate({
      judges: cassettePlayers(cassette),
      criteria,
      labels,
      agentFamily: 'google',
      mode: 'system1',
    });
    expect(report.excluded).toEqual(['google-chat']);
    expect(report.criteria[0]?.judges.map((j) => j.judge)).not.toContain('google-chat');
    expect(assignmentOf(report, 'care_redirect')).toMatchObject({ cls: 'system1', rejudge: [] });
  });

  it('refuses a repeat count under 1', async () => {
    const { criteria, labels } = await acme();
    await expect(calibrate({ judges: [], criteria, labels, repeats: 0 })).rejects.toThrow(/repeats/);
  });
});

describe('the assignment table and the council', () => {
  it('round-trips through YAML and feeds a council that gates only what calibration earned', async () => {
    const table = await loadAssignmentTable(TABLE);
    const earned = councilAssignment(table);
    expect(earned.unassigned.map((u) => u.criterion)).toEqual(['ledger_intact']);
    const council = createCouncil({
      mode: earned.mode,
      agentFamily: 'none',
      judges: cassettePlayers(await loadCassette(CASSETTE)),
      assignment: earned.assignment,
      unassigned: earned.unassigned,
    });
    expect(council.assignmentFor('plain_language')).toMatchObject({ cls: 'system2', source: 'calibration' });
    expect(council.unassignedReason('ledger_intact')).toMatch(/no class has 3 judges/);
    expect(council.unassignedReason('care_redirect')).toBeUndefined();
  });

  it('refuses a criterion both assigned and unassigned', async () => {
    const earned = councilAssignment(await loadAssignmentTable(TABLE));
    const judges = ACME_JUDGES.map(
      (j) => new FakeJudge(j.id, ['x'], { family: j.family, cls: j.cls, cost: j.cost }),
    );
    expect(() =>
      createCouncil({
        mode: 'hybrid',
        agentFamily: 'none',
        judges,
        assignment: earned.assignment,
        unassigned: [{ criterion: 'care_redirect', reason: 'test' }],
      }),
    ).toThrow(/both assigned and unassigned/);
  });

  it('rejects a table that breaks its schema', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'judges-table-'));
    try {
      const path = join(dir, 'bad.yaml');
      await writeFile(path, 'version: 2\nmode: hybrid\nrepeats: 3\nkappa_min: 0.8\ncriteria: []\n');
      await expect(loadAssignmentTable(path)).rejects.toThrow(/version/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the recorded haiku calibration (a real judge on the claude command, main prompt, 2026-10-12)', () => {
  it('replays to the measured result: 12 of 12 pairs separate 3 of 3, 12 of 12 at the bar, kappa 1.00 over 40 labels', async () => {
    const { criteria, labels } = await acme();
    const cassette = await loadCassette(join(CRITERIA, 'calibration/claude-haiku.cassette.json'));
    expect(cassette.judges.map((j) => j.id)).toEqual(['claude-haiku']);
    const report = await calibrate({ judges: cassettePlayers(cassette), criteria, labels, mode: 'llm' });
    expect(report.errors).toBe(0);
    expect(report.spentUsd).toBeCloseTo(0.0199, 4);
    const rows = Object.fromEntries(report.criteria.map((c) => [c.criterion, c.judges[0]] as const));
    expect(Object.values(rows).every((r) => r?.separation.separated === 3)).toBe(true);
    // With catalog.csv as an input, the task criterion separates; with the stated evidence rule, so does
    // no_invented_data on its labels.
    expect(rows.sheet_matches_catalog).toMatchObject({ meetsBar: true });
    expect(rows.no_invented_data).toMatchObject({ meetsBar: true });
    const below = Object.entries(rows)
      .filter(([, r]) => !r?.meetsBar)
      .map(([name]) => name);
    // With the rewritten explicit_confirmation rubric (a CONFIRM with no order fails), haiku meets the bar there too.
    expect(below).toEqual([]);
    expect(rows.explicit_confirmation?.labels.kappa).toBe(1);
    expect(report.pooled[0]).toMatchObject({ judge: 'claude-haiku', n: 40, agree: 40 });
  });
});

describe('the recorded Claude council (haiku, sonnet, opus; 2026-10-12)', () => {
  it('covers all 12 criteria and assigns all 12, each single-family; every judge agrees with all 40 labels', async () => {
    const { criteria, labels } = await acme();
    const cassette = await loadCassette(join(CRITERIA, 'calibration/claude-council.cassette.json'));
    const report = await calibrate({ judges: cassettePlayers(cassette), criteria, labels, mode: 'llm' });
    expect(report.errors).toBe(0);
    expect(report.spentUsd).toBeCloseTo(1.4399, 4);
    const assigned = report.criteria
      .filter((c) => c.assignment.status === 'assigned')
      .map((c) => c.criterion);
    expect(assigned).toHaveLength(12);
    for (const c of report.criteria.filter((x) => x.assignment.status === 'assigned')) {
      expect(c.assignment).toMatchObject({ owner: 'claude-haiku', singleFamily: 'anthropic' });
    }
    expect(row(report, 'explicit_confirmation', 'claude-haiku').labels.kappa).toBe(1);
    expect(row(report, 'explicit_confirmation', 'claude-sonnet').labels.kappa).toBe(1);
    for (const c of report.criteria) {
      for (const j of c.judges) expect(j.separation.separated, `${c.criterion} ${j.judge}`).toBe(3);
    }
    const pooled = Object.fromEntries(report.pooled.map((p) => [p.judge, `${p.agree}/${p.n}`]));
    expect(pooled).toEqual({ 'claude-haiku': '40/40', 'claude-sonnet': '40/40', 'claude-opus': '40/40' });
  });
});

describe('a council of one model family', () => {
  it('assigns criteria and marks the council single-family in the report and the table', async () => {
    const { criteria, labels } = await acme();
    const claude = [
      { id: 'claude-haiku', family: 'anthropic', cls: 'system2' as const, cost: 10 },
      { id: 'claude-sonnet', family: 'anthropic', cls: 'system2' as const, cost: 30 },
      { id: 'claude-opus', family: 'anthropic', cls: 'system2' as const, cost: 50 },
    ];
    const cassette = scriptedCalibrationCassette(criteria, labels, { judges: claude });
    const report = await calibrate({ judges: cassettePlayers(cassette), criteria, labels, mode: 'llm' });
    expect(assignmentOf(report, 'care_redirect')).toMatchObject({
      status: 'assigned',
      owner: 'claude-haiku',
      judges: ['claude-haiku', 'claude-sonnet', 'claude-opus'],
      singleFamily: 'anthropic',
    });
    const table = assignmentTable(report);
    expect(table.criteria[0]).toMatchObject({ single_family: 'anthropic' });
    // The six-judge Acme council spans four families: no row is single-family.
    const mixed = await calibrate({
      judges: cassettePlayers(await loadCassette(CASSETTE)),
      criteria,
      labels,
    });
    expect(mixed.criteria.every((c) => !('singleFamily' in c.assignment))).toBe(true);
  });
});
