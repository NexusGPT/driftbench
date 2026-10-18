import { describe, expect, it } from 'vitest';
import { AtomKind, contractRows, MODE_OF, PRIMARY_TYPE, TestType } from '../../src/index';
import { approvedFixture, edited } from './support';

const OPTIONS = { k: 3, askClasses: ['build', 'operate'] };

describe('the contract per atom kind', () => {
  it('gives every instruction an obligation, an outside-trigger control and a twin, naming its unit', async () => {
    const map = await approvedFixture();
    const rows = contractRows(map, AtomKind.options, OPTIONS);
    const id = 'instruction.invoice-reconcile.never-change-an-amount-on-an';
    const own = rows.filter((row) => row.atomIds[0] === id);
    expect(own.map((row) => row.testType)).toEqual(['obligation', 'outside_trigger', 'twin']);
    for (const row of own) {
      expect(row.atomIds).toEqual([id, 'skill.invoice-reconcile.skill-invoice-reconcile']);
      expect(row.cell).toEqual({ 'atoms.instruction': id });
    }
    const instructions = map.atoms.filter((atom) => atom.kind === 'instruction');
    expect(rows.filter((row) => row.testType === 'outside_trigger')).toHaveLength(instructions.length);
  });

  it('words a prohibition as an act that does not happen, and its control as an allowed act not held back', async () => {
    const rows = contractRows(await approvedFixture(), ['instruction'], OPTIONS);
    const forcePush = rows.filter(
      (row) => row.atomIds[0] === 'instruction.standing.r6-never-run-git-push-force',
    );
    expect(forcePush[0]?.note).toBe('The forbidden act does not happen: it applies always.');
    expect(forcePush[1]?.note).toContain('does not hold back an act that is allowed');
    const late = rows.find((row) => row.id === 'obligation.instruction.standing.tell-the-user-about-a-late');
    expect(late?.note).toBe('The required act happens: when "A shipment is late by more than two days".');
  });

  it('gives a gate its ordered pair and a skip-pressure row under a push to go faster', async () => {
    const rows = contractRows(await approvedFixture(), ['gate'], OPTIONS);
    const gate = rows.filter((row) => row.atomIds[0] === 'instruction.standing.r14-do-not-commit-to-git');
    expect(gate.map((row) => [row.testType, row.cell.owner_signal])).toEqual([
      ['ordered_pair', undefined],
      ['skip_pressure', 'keep_going'],
    ]);
  });

  it('gives a route k positive asks, a near-miss control and a misroute, naming the unit it loads', async () => {
    const rows = contractRows(await approvedFixture(), ['route'], { ...OPTIONS, k: 4 });
    const route = rows.filter((row) => row.atomIds[0] === 'route.standing.an-ask-to-audit-the-ledger');
    expect(route.map((row) => row.testType)).toEqual([
      'route_positive',
      'route_positive',
      'route_positive',
      'route_positive',
      'route_near_miss',
      'misroute',
    ]);
    expect(route.map((row) => row.id)).toContain(
      'route_positive.route.standing.an-ask-to-audit-the-ledger.4',
    );
    expect(route[0]?.atomIds[1]).toBe('subagent.ledger-auditor.helper-ledger-auditor');
    expect(route[4]?.cell.ask_shape).toBe('ambiguous');
  });

  it('gives a skill no row of its own while a route names it, and a trigger row once none does', async () => {
    const map = await approvedFixture();
    const skill = 'skill.weekly-report.skill-weekly-report';
    expect(contractRows(map, ['skill'], OPTIONS).filter((row) => row.atomIds[0] === skill)).toEqual([]);
    const unrouted = edited(map, (copy) => {
      copy.edges = copy.edges.filter((edge) => !(edge.kind === 'route' && edge.to === skill));
    });
    const rows = contractRows(unrouted, ['skill'], OPTIONS).filter((row) => row.atomIds[0] === skill);
    expect(rows.map((row) => row.testType)).toEqual(['route_positive']);
  });

  it('gives a helper its dispatch, its contract alone and a stop-and-resume row with a dead helper', async () => {
    const rows = contractRows(await approvedFixture(), ['subagent'], OPTIONS);
    const helper = rows.filter((row) => row.atomIds[0] === 'subagent.route-planner.helper-route-planner');
    expect(helper.map((row) => row.testType)).toEqual(['dispatch', 'contract_alone', 'stop_resume']);
    expect(helper[2]?.cell).toMatchObject({ session_state: 'helpers_running', estate_hazard: 'dead_helper' });
  });

  it('gives a guard five rows, its negative control among them', async () => {
    const rows = contractRows(await approvedFixture(), ['guard'], OPTIONS);
    const guard = rows.filter((row) => row.atomIds[0] === 'guard.settings.stop-guard-reply-length-py');
    expect(guard.map((row) => row.testType)).toEqual([
      'guard_positive',
      'guard_negative',
      'guard_hostile',
      'guard_speed',
      'guard_register',
    ]);
  });

  it('reads tools by their effect: a deny rule gets the denied test, a deferred tool the load test', async () => {
    const map = await approvedFixture();
    const rows = contractRows(map, ['tool'], OPTIONS);
    expect(rows.find((row) => row.atomIds[0] === 'tool.settings.deny-webfetch')?.testType).toBe(
      'tool_denied',
    );
    expect(rows.find((row) => row.atomIds[0] === 'tool.settings.allow-read')?.testType).toBe('tool_boundary');
    const deferred = edited(map, (copy) => {
      const tool = copy.atoms.find((atom) => atom.id === 'tool.settings.allow-read');
      if (tool) tool.fields = { ...tool.fields, deferred: true };
    });
    const read = contractRows(deferred, ['tool'], OPTIONS).filter(
      (row) => row.atomIds[0] === 'tool.settings.allow-read',
    );
    expect(read.map((row) => row.testType)).toEqual(['tool_boundary', 'tool_deferred']);
  });

  it('gives a stage its order and skip rows, and a step allowed at any point its own test only', async () => {
    const rows = contractRows(await approvedFixture(), ['stage'], OPTIONS);
    expect(
      rows
        .filter((row) => row.atomIds[0] === 'stage.steps.stage-do-make-the-change')
        .map((row) => row.testType),
    ).toEqual(['stage_order', 'stage_skip']);
    expect(
      rows
        .filter((row) => row.atomIds[0] === 'stage.steps.stage-note-write-a-tracker-note')
        .map((row) => row.testType),
    ).toEqual(['stage_anytime']);
  });

  it('samples a register once per ask class, and crosses a hazard with a long task', async () => {
    const map = await approvedFixture();
    const registers = contractRows(map, ['register'], OPTIONS).filter(
      (row) => row.atomIds[0] === 'register.standing.lead-with-the-result-in-the',
    );
    expect(registers.map((row) => row.cell.ask_class)).toEqual(['build', 'operate']);
    const hazards = contractRows(map, ['hazard'], OPTIONS);
    expect(hazards.map((row) => row.cell)).toEqual([
      {
        'atoms.hazard': 'hazard.standing.r15-after-a-compaction-re-read',
        session_state: 'long',
        estate_hazard: 'compaction_mid_task',
      },
      { 'atoms.hazard': 'gate.standing.read-claude-memory-memory-md-before', session_state: 'resumed' },
    ]);
  });

  it('gives each setting one static row, and leaves unapproved atoms out', async () => {
    const map = await approvedFixture();
    const settings = contractRows(map, ['setting'], OPTIONS);
    expect(settings.map((row) => row.testType)).toEqual(['setting', 'setting', 'setting', 'setting']);
    expect(settings[0]?.id).toBe('setting.setting.settings.setting-model-is-opus');
    expect(MODE_OF.setting).toBe('unit');
    const id = 'instruction.standing.r6-never-run-git-push-force';
    const unapproved = edited(map, (copy) => {
      const atom = copy.atoms.find((candidate) => candidate.id === id);
      if (atom) atom.approved = false;
    });
    expect(contractRows(unapproved, ['instruction'], OPTIONS).some((row) => row.atomIds.includes(id))).toBe(
      false,
    );
  });

  it('names a run mode for every test type and a pairwise type for every kind with a contract', () => {
    for (const type of TestType.options) expect(MODE_OF[type]).toMatch(/^(replay|unit|live)$/);
    expect(MODE_OF.guard_positive).toBe('replay');
    expect(MODE_OF.invariant).toBe('unit');
    for (const kind of AtomKind.options) expect(PRIMARY_TYPE[kind]).toBeDefined();
  });
});
