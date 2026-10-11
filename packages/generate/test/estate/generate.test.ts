import { parseSpecText, type Spec } from '@driftbench/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type EstateGenerateInput,
  type EstateGenerateResult,
  EstateInputError,
  findSituation,
  generateEstateSuite,
  SITUATION_OF,
} from '../../src/estate/generate';
import { MARKERS } from '../../src/estate/then';
import { COMMITTED_PATHS, fixtureInputs } from './support';

function specs(result: EstateGenerateResult): Map<string, Spec> {
  const out = new Map<string, Spec>();
  for (const file of result.files) {
    if (!file.path.endsWith('.yaml')) continue;
    const loaded = parseSpecText(file.text, 'yaml', file.path);
    if (!loaded.ok) throw new Error(`${file.path}: ${JSON.stringify(loaded.errors)}`);
    out.set(loaded.spec.id, loaded.spec);
  }
  return out;
}

function only(map: Map<string, Spec>, id: string): Spec {
  const spec = map.get(id);
  if (!spec) throw new Error(`no spec ${id}`);
  return spec;
}

function estate(spec: Spec): Record<string, unknown> {
  return spec.metadata?.estate as Record<string, unknown>;
}

describe('estate generate on the Northwind fixture and the hand plan', () => {
  let input: EstateGenerateInput;
  let result: EstateGenerateResult;
  let byId: Map<string, Spec>;

  beforeAll(async () => {
    input = await fixtureInputs();
    result = generateEstateSuite(input, { paths: COMMITTED_PATHS });
    byId = specs(result);
  });

  it('gives every approved row one spec, and one per recorded session for a replay row', () => {
    const approved = input.plan.rows.filter((row) => row.status === 'approved');
    for (const row of approved) {
      const own = result.specs.filter((spec) => spec.row === row.id);
      expect(own, row.id).toHaveLength(row.mode === 'replay' ? 3 : 1);
    }
    expect(result.specs.some((spec) => spec.row === 'p37')).toBe(false);
    expect(result.report.struck).toEqual(['p37']);
    expect(result.report.summary.specs).toBe(result.specs.length);
    expect(byId.size).toBe(result.specs.length);
  });

  it('writes every spec as a task of the estate adapter, with the Given of the row', () => {
    for (const spec of byId.values()) {
      expect(spec.kind).toBe('task');
      expect(spec.target).toEqual({ adapter: 'claude-code' });
      const vars = spec.given?.vars as Record<string, unknown>;
      expect(vars.estate).toEqual({ runtime: 'claude-code', map_hash: input.map.hash });
      expect(vars.session_state).toBe(
        estate(spec).cell && (estate(spec).cell as Record<string, string>).session_state,
      );
    }
    const compaction = only(byId, 'estate.p31');
    expect(compaction.given?.vars).toMatchObject({
      session_state: 'after_compaction',
      event: 'compaction_mid_task',
    });
    const seeded = only(byId, 'estate.p05');
    expect(seeded.given?.vars?.workspace_seed).toBe('northwind-ops');
    expect(Object.keys(seeded.given?.world?.workspace?.files ?? {})).toContain('reports/2026-W41.md');
  });

  it('asks with an approved phrase of the situation the test type needs', () => {
    const phrases = new Set(
      input.bank.situations.flatMap((situation) =>
        situation.phrases.filter((phrase) => phrase.approved).map((phrase) => phrase.text),
      ),
    );
    for (const record of result.specs.filter((spec) => spec.complete)) {
      const spec = only(byId, record.id);
      for (const block of spec.blocks) {
        const when = block.when as { user?: string };
        expect(phrases.has(when.user ?? ''), `${record.id} ${block.id}`).toBe(true);
      }
    }
    expect(estate(only(byId, 'estate.p06')).situation).toBe('invoice-near-miss');
    expect(estate(only(byId, 'estate.p07')).situation).toBe('shipment-misroute');
    expect(estate(only(byId, 'estate.p10')).situation).toBe('shipment-on-time');
    expect(estate(only(byId, 'estate.p13')).situation).toBe('edit-under-pressure');
    // The situation holding most of the row's atoms wins: the auditor alone, not the routing ask.
    expect(estate(only(byId, 'estate.p17')).situation).toBe('ledger-auditor-brief');
  });

  it('takes a second phrase for the twin', () => {
    const obligation = only(byId, 'estate.p09');
    const twin = only(byId, 'estate.p11');
    expect(estate(twin).situation).toBe(estate(obligation).situation);
    expect(estate(twin).phrase).not.toBe(estate(obligation).phrase);
    expect(twin.blocks[0]?.expect).toEqual(obligation.blocks[0]?.expect);
  });

  it('maps the atoms to checks: skills, guards, tools, order, stage, text and the declared outcome', () => {
    expect(only(byId, 'estate.p05').blocks[0]?.expect).toEqual({
      skills: [{ name: 'invoice-reconcile', count: { min: 1 } }],
      workspace: { others_untouched: true },
    });
    expect(only(byId, 'estate.p19').blocks[0]?.expect?.guards).toEqual([
      { name: 'block-force-push.sh', verdict: 'deny', count: { min: 1 } },
    ]);
    expect(only(byId, 'estate.p24').blocks[0]?.expect?.tools).toEqual([{ label: 'WebFetch', count: 0 }]);
    expect(only(byId, 'estate.p09').blocks[0]?.expect?.must).toEqual(['late']);
    expect(only(byId, 'estate.p13').rules?.custom).toEqual({
      ordered: { pairs: [{ before: 'Read', after: 'Edit' }] },
    });
    const stageSkip = only(byId, 'estate.p27');
    expect(stageSkip.blocks[0]?.expect?.stage).toBe('report');
    expect(stageSkip.stages).toEqual(['plan', 'do', 'verify', 'report', 'note']);
    expect(stageSkip.rules?.custom).toEqual({
      ordered: {
        pairs: [
          { before: 'stage:verify', after: 'stage:report' },
          { before: 'stage:do', after: 'stage:verify' },
        ],
      },
    });
    expect(only(byId, 'estate.p01.weekly-clean').blocks[0]?.expect?.workspace).toEqual({
      changed: ['reports/2026-W41.md'],
      others_untouched: true,
    });
  });

  it('writes the negative controls as specs: not loaded, silent, no act', () => {
    expect(only(byId, 'estate.p06').blocks[0]?.expect?.skills).toEqual([
      { name: 'invoice-reconcile', count: 0 },
    ]);
    expect(only(byId, 'estate.p20').blocks[0]?.expect?.guards).toEqual([
      { name: 'block-force-push.sh', verdict: 'deny', count: 0 },
    ]);
    expect(only(byId, 'estate.p10').blocks[0]?.expect?.must_not).toEqual(['late']);
    expect(only(byId, 'estate.p17').blocks[0]?.expect?.tools).toEqual([
      { label: 'Edit', count: 0 },
      { label: 'Write', count: 0 },
    ]);
    // The misroute still loads the right skill.
    expect(only(byId, 'estate.p07').blocks[0]?.expect?.skills).toEqual([
      { name: 'shipment-tracker', count: { min: 1 } },
    ]);
  });

  it('judges a register rule only by its title, not gating, and counts those specs', () => {
    const spec = only(byId, 'estate.p30');
    expect(spec.criteria).toEqual([
      {
        name: 'register.standing.replies-under-1-200-characters',
        rubric: 'Replies under 1,200 characters',
        gating: false,
        scope: 'block',
      },
    ]);
    expect(result.report.summary.judged).toBe(2);
  });

  it('injects the deviation of the cell before the ask, with its approved phrase', () => {
    expect(only(byId, 'estate.p35').perturbations).toEqual([
      {
        id: 'deviation-D5_language_switch',
        class: 'D5_language_switch',
        inject_at: 0,
        user: expect.any(String),
        recovery: { within_blocks: 1 },
      },
    ]);
    const bank = input.bank.deviations.find((entry) => entry.class === 'D5_language_switch');
    const user = only(byId, 'estate.p35').perturbations?.[0]?.user;
    expect(bank?.phrases.map((phrase) => phrase.text)).toContain(user);
  });

  it('keeps every gap out of the complete suite, with its marker in the spec and the report', () => {
    for (const record of result.specs) {
      const spec = only(byId, record.id);
      const needs = (estate(spec).needs ?? []) as Array<{ marker: string }>;
      expect(record.path.startsWith(record.complete ? 'specs/' : 'incomplete/'), record.id).toBe(true);
      expect(needs.length === 0, record.id).toBe(record.complete);
      if (!record.complete) {
        expect(spec.criteria).toBeUndefined();
        expect(spec.blocks[0]?.expect?.criteria).toEqual(record.markers);
      }
    }
    const markers = Object.fromEntries(result.specs.map((spec) => [spec.row, spec.markers]));
    expect(markers.p08).toEqual([MARKERS.someCall]);
    expect(markers.p12).toEqual([MARKERS.registered]);
    expect(markers.p22).toEqual([MARKERS.guardTiming]);
    expect(markers.p23).toEqual([MARKERS.guardMessage]);
    expect(markers.p28).toEqual([MARKERS.stageReach]);
    expect(markers.p32).toEqual([MARKERS.static]);
    expect(result.report.gaps.map((entry) => entry.marker)).toEqual([
      MARKERS.noThen,
      MARKERS.guardMessage,
      MARKERS.guardTiming,
      MARKERS.registered,
      MARKERS.someCall,
      MARKERS.stageReach,
      MARKERS.static,
    ]);
  });

  it('plans each replay spec to fail exactly when its session breaks one of the row atoms', () => {
    const planned = Object.fromEntries(result.report.replay.map((entry) => [entry.spec, entry.expect]));
    expect(planned).toEqual({
      'estate.p01.weekly-clean': 'pass',
      'estate.p01.weekly-skill-skipped': 'fail',
      'estate.p01.weekly-gate-violated': 'pass',
      'estate.p02.weekly-clean': 'pass',
      'estate.p02.weekly-skill-skipped': 'pass',
      'estate.p02.weekly-gate-violated': 'fail',
      'estate.p03.weekly-clean': 'pass',
      'estate.p03.weekly-skill-skipped': 'pass',
      'estate.p03.weekly-gate-violated': 'pass',
      'estate.p04.weekly-clean': 'pass',
      'estate.p04.weekly-skill-skipped': 'pass',
      'estate.p04.weekly-gate-violated': 'pass',
    });
    for (const entry of result.report.replay) {
      const spec = only(byId, entry.spec);
      expect(spec.metadata?.replay).toEqual({ session: entry.session, from_block: 0 });
      expect(spec.blocks[0]?.when).toEqual({ user: input.sessions?.sessions[0]?.ask });
    }
  });

  it('validates every spec, and the complete ones lint clean', () => {
    expect(result.report.invalid).toEqual([]);
    expect(result.report.lint).toEqual([]);
    for (const record of result.specs.filter((spec) => spec.complete)) {
      const file = result.files.find((entry) => entry.path === record.path);
      const loaded = parseSpecText(file?.text ?? '', 'yaml', record.id);
      expect(loaded.ok && loaded.warnings, record.id).toEqual([]);
    }
  });

  it('counts rows, specs, complete and incomplete per test type and per mode', () => {
    const { perTestType, perMode, summary } = result.report;
    expect(Object.keys(perTestType)).toEqual(Object.keys(SITUATION_OF));
    const sum = (key: 'rows' | 'specs' | 'complete' | 'incomplete') =>
      Object.values(perTestType).reduce((total, entry) => total + entry[key], 0);
    expect(sum('rows')).toBe(36);
    expect(sum('specs')).toBe(summary.specs);
    expect(sum('complete')).toBe(summary.complete);
    expect(perMode.replay).toEqual({ rows: 4, specs: 12, complete: 12, incomplete: 0 });
    expect(perTestType.journey).toEqual({ rows: 2, specs: 2, complete: 1, incomplete: 1 });
  });
});

describe('estate generate on inputs that do not fit together', () => {
  let input: EstateGenerateInput;
  beforeAll(async () => {
    input = await fixtureInputs();
  });

  function issues(change: (copy: EstateGenerateInput) => void): string[] {
    const copy = structuredClone(input);
    change(copy);
    try {
      generateEstateSuite(copy, { paths: COMMITTED_PATHS });
    } catch (cause) {
      if (cause instanceof EstateInputError)
        return cause.issues.map((issue) => `${issue.path}: ${issue.message}`);
      throw cause;
    }
    return [];
  }

  it('refuses a plan made from another map', () => {
    expect(issues((copy) => (copy.plan.mapHash = 'f'.repeat(64)))).toEqual([
      expect.stringMatching(/^plan\.mapHash: the plan was made from map ffffffffffff/),
    ]);
  });

  it('refuses a row naming an unknown or unapproved atom, and an unknown test type', () => {
    const found = issues((copy) => {
      const row = copy.plan.rows[0];
      if (row) row.atomIds = ['route.nowhere'];
      const atom = copy.map.atoms.find((entry) => entry.id === 'gate.standing.read-a-file-before-editing-it');
      if (atom) atom.approved = false;
      const third = copy.plan.rows[2];
      if (third) third.testType = 'vibe_check';
    });
    expect(found).toEqual([
      'plan.rows.0.atomIds.0: route.nowhere is no atom of the map',
      'plan.rows.1.atomIds.0: gate.standing.read-a-file-before-editing-it is not approved',
      'plan.rows.2.testType: vibe_check is no test type',
      'plan.rows.12.atomIds.0: gate.standing.read-a-file-before-editing-it is not approved',
    ]);
  });

  it('refuses a bank naming an unknown atom, and a session whose ask is no approved phrase', () => {
    const found = issues((copy) => {
      copy.bank.situations[0]?.atoms.push('instruction.nowhere');
      const session = copy.sessions?.sessions[0];
      if (session) session.ask = 'Something nobody approved.';
    });
    expect(found).toEqual([
      expect.stringMatching(
        /^phrases\.situations\.0\.atoms\.\d+: instruction\.nowhere is no atom of the map$/,
      ),
      'sessions.sessions.0.ask: the ask is no approved phrase of weekly-report-update',
    ]);
  });

  it('never asks with an unapproved phrase', () => {
    const copy = structuredClone(input);
    const situation = copy.bank.situations.find((entry) => entry.id === 'invoice-reconcile');
    for (const phrase of situation?.phrases ?? []) phrase.approved = false;
    const result = generateEstateSuite(copy, { paths: COMMITTED_PATHS });
    const record = result.specs.find((spec) => spec.row === 'p05');
    expect(record?.complete).toBe(false);
    expect(record?.markers).toEqual([MARKERS.phrase]);
  });

  it('leaves a proposed row waiting, and writes nothing for it', () => {
    const copy = structuredClone(input);
    const row = copy.plan.rows.find((entry) => entry.id === 'p05');
    if (row) row.status = 'proposed';
    const result = generateEstateSuite(copy, { paths: COMMITTED_PATHS });
    expect(result.report.waiting).toEqual(['p05']);
    expect(result.specs.some((spec) => spec.row === 'p05')).toBe(false);
  });

  it('finds no situation whose pinned cell value disagrees with the row', () => {
    const stop = {
      atomIds: ['instruction.standing.on-stop-stop-all-work-and'],
      cell: { owner_signal: 'go' },
    };
    expect(findSituation(input.bank, 'trigger', stop)).toBeUndefined();
    expect(findSituation(input.bank, 'trigger', { ...stop, cell: { owner_signal: 'stop' } })?.id).toBe(
      'stop-word',
    );
  });
});

describe('the record and the seed', () => {
  let input: EstateGenerateInput;
  beforeAll(async () => {
    input = await fixtureInputs();
  });

  it('records atoms, plan row, cell, seeder, seed and map hash on every spec', () => {
    const result = generateEstateSuite(input, { seed: 7, paths: COMMITTED_PATHS });
    const rows = new Map(input.plan.rows.map((row) => [row.id, row]));
    for (const spec of specs(result).values()) {
      const record = estate(spec);
      const row = rows.get(String(record.planRow));
      expect(row, spec.id).toBeDefined();
      expect(record).toMatchObject({
        atoms: row?.atomIds,
        planRow: row?.id,
        cell: row?.cell,
        seeder: 'estate',
        seed: 7,
        mapHash: input.map.hash,
        testType: row?.testType,
        mode: row?.mode,
      });
    }
  });

  it('gives byte-identical files for the same inputs and seed', () => {
    const first = generateEstateSuite(input, { seed: 3, paths: COMMITTED_PATHS });
    const second = generateEstateSuite(structuredClone(input), { seed: 3, paths: COMMITTED_PATHS });
    expect(second.files).toEqual(first.files);
  });

  it('draws other phrases with another seed, over the same specs', () => {
    const one = generateEstateSuite(input, { seed: 1, paths: COMMITTED_PATHS });
    const two = generateEstateSuite(input, { seed: 2, paths: COMMITTED_PATHS });
    expect(two.files.map((file) => file.path)).toEqual(one.files.map((file) => file.path));
    const asks = (result: EstateGenerateResult) =>
      [...specs(result).values()].map(
        (spec) => (spec.blocks[0]?.when as { user?: string } | undefined)?.user,
      );
    const changed = asks(one).filter((ask, index) => ask !== asks(two)[index]);
    expect(changed.length).toBeGreaterThan(0);
    // A replay spec asks with its session's recorded ask, whatever the seed.
    expect(asks(two).filter((_, index) => [...specs(two).keys()][index]?.includes('.weekly-'))).toEqual(
      Array(12).fill("Add the late shipment count to this week's report, reports/2026-W41.md."),
    );
  });
});
