import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assignmentTable,
  type CalibrationReport,
  type Cassette,
  calibrate,
  cassettePlayers,
  councilAssignment,
  createCouncil,
  FakeJudge,
  type JudgeClient,
  type LabelledBlock,
  type LoadedCriterion,
  loadAssignmentTable,
  loadCassette,
  loadCriteria,
  loadLabels,
  renderAssignmentTable,
} from '../src/index';
import { ACME_JUDGES, ACME_MISSES, type Miss, scriptedCalibrationCassette } from './support/scripted';

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
      owner: 'jev-a',
      cls: 'system1',
    });
    // jev-b mislabels one plain_language block: system 1 keeps two judges at the bar, system 2 takes it.
    expect(row(report, 'plain_language', 'jev-b')).toMatchObject({ meetsBar: false });
    expect(row(report, 'plain_language', 'jev-b').labels.kappa).toBeCloseTo(0.4, 10);
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
    expect(assignmentOf(report, 'sheet_matches_catalog')).toMatchObject({ owner: 'jev-a', cls: 'system1' });
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
      /system1 has 2 of 3 judges at the bar, system2 has 2 of 3.*jev-b kappa 0\.40.*google-chat kappa 0\.50/,
    );
  });

  it('reports a Wilson interval on agreement and Krippendorff alpha across judges', async () => {
    const { criteria, labels } = await acme();
    const report = await calibrate({
      judges: cassettePlayers(await loadCassette(CASSETTE)),
      criteria,
      labels,
    });
    const agreement = row(report, 'care_redirect', 'jev-a').labels;
    expect(agreement).toMatchObject({ n: 4, agree: 4, kappa: 1 });
    expect(agreement.agreement.lower).toBeCloseTo(0.5101, 3);
    expect(agreement.agreement.upper).toBe(1);
    expect(report.criteria.find((c) => c.criterion === 'care_redirect')?.alpha).toBe(1);
    expect(report.criteria.find((c) => c.criterion === 'plain_language')?.alpha).toBeLessThan(1);
    const pooled = report.pooled.find((p) => p.judge === 'jev-a');
    expect(pooled).toMatchObject({ n: 40, agree: 38 });
  });
});

describe('calibrate with a cassette that makes one judge fail the bar', () => {
  it('assigns every criterion to the cheapest system 1 judge when every judge tells the truth', async () => {
    const report = await scripted([]);
    for (const criterion of report.criteria) {
      expect(criterion.assignment, criterion.criterion).toMatchObject({ status: 'assigned', owner: 'jev-a' });
    }
  });

  it('moves care_redirect to system 2 when jev-b passes its fail fixture', async () => {
    const report = await scripted([
      { judge: 'jev-b', criterion: 'care_redirect', item: 'fail', answer: 'pass' },
    ]);
    expect(row(report, 'care_redirect', 'jev-b').misses).toEqual(['separates the fixture pair 0 of 3 times']);
    expect(assignmentOf(report, 'care_redirect')).toMatchObject({
      status: 'assigned',
      owner: 'google-chat',
      cls: 'system2',
      rejudge: ['jev-a', 'openai-decisions', 'jev-b'],
    });
  });

  it('keeps the owner when a more expensive judge of another class fails', async () => {
    const report = await scripted([
      { judge: 'openai-chat', criterion: 'care_redirect', item: 'care_redirect.1', answer: 'fail' },
    ]);
    expect(row(report, 'care_redirect', 'openai-chat').meetsBar).toBe(false);
    expect(assignmentOf(report, 'care_redirect')).toMatchObject({ owner: 'jev-a', cls: 'system1' });
  });

  it('leaves care_redirect unassigned when a judge of each class fails', async () => {
    const report = await scripted([
      { judge: 'jev-b', criterion: 'care_redirect', item: 'fail', answer: 'pass' },
      { judge: 'anthropic-chat', criterion: 'care_redirect', item: 'pass', repeat: 2, answer: 'fail' },
    ]);
    expect(row(report, 'care_redirect', 'anthropic-chat').separation.separated).toBe(2);
    expect(assignmentOf(report, 'care_redirect')?.status).toBe('unassigned');
  });

  it('counts an answer that never parses as inconclusive, after asking again with the large budget', async () => {
    const { criteria, labels } = await acme();
    const cassette = scriptedCalibrationCassette(criteria, labels, {
      misses: [{ judge: 'jev-a', criterion: 'care_redirect', item: 'care_redirect.2', answer: 'unparsed' }],
    });
    const asked: string[] = [];
    const judges = cassettePlayers(cassette).map((player): JudgeClient => {
      if (player.id !== 'jev-a') return player;
      return {
        ...player,
        judge: (request) => {
          asked.push(`${request.criterion.name} ${request.budget}`);
          return player.judge(request);
        },
      };
    });
    const report = await calibrate({ judges, criteria, labels });
    const blocks = row(report, 'care_redirect', 'jev-a').labels.blocks;
    expect(blocks.find((b) => b.id === 'care_redirect.2')?.judged).toBe('inconclusive');
    expect(asked.filter((line) => line === 'care_redirect large')).toHaveLength(1);
    expect(row(report, 'care_redirect', 'jev-a').meetsBar).toBe(false);
  });

  it('counts a judge with no answer as an error and keeps it under the bar', async () => {
    const { criteria, labels } = await acme();
    const cassette: Cassette = scriptedCalibrationCassette(criteria, labels);
    cassette.entries = cassette.entries.filter(
      (entry) => !(entry.judge === 'jev-a' && entry.criterion === 'care_redirect'),
    );
    const report = await calibrate({ judges: cassettePlayers(cassette), criteria, labels });
    expect(report.errors).toBeGreaterThan(0);
    expect(row(report, 'care_redirect', 'jev-a').misses.join(' ')).toMatch(/gave no answer/);
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
