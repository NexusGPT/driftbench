import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  diffEstateMaps,
  diffGuardStates,
  estateImpact,
  type GuardState,
  guardNeed,
  guardStateBeside,
  loadGuardState,
  parseGuardState,
  renderEstateDiff,
  renderImpact,
} from '../../src/index';
import { estate } from '../support';
import { atom, estateMap } from './support';

const map = estateMap([
  atom('guard.settings.force', '"force.sh"', {
    kind: 'guard',
    producedBy: 'code',
    file: '.claude/settings.json',
  }),
  atom('guard.settings.ledger', '"ledger.py"', {
    kind: 'guard',
    producedBy: 'code',
    file: '.claude/settings.json',
    line: 2,
  }),
  atom('instruction.standing.rule', 'Never force push.', { line: 3 }),
]);

const evidence = { log: 'logs/ledger.decisions.jsonl', decisions: 40, wrong: 0 };

describe('parseGuardState', () => {
  it('reads a state file whose entries are the guard atoms of the map', () => {
    const parsed = parseGuardState(
      [
        'version: 1',
        'guards:',
        '  - { guard: guard.settings.force, mode: enforce, since: 2026-09-01 }',
        '  - guard: guard.settings.ledger',
        '    mode: warn',
        '    evidence: { log: logs/ledger.decisions.jsonl, decisions: 40, wrong: 0 }',
        '',
      ].join('\n'),
      map,
    );
    expect(parsed.ok && parsed.state.guards.map((entry) => [entry.guard, entry.mode])).toEqual([
      ['guard.settings.force', 'enforce'],
      ['guard.settings.ledger', 'warn'],
    ]);
  });

  it('refuses an unknown atom, a rule named as a guard, a guard listed twice and a guard with no state', () => {
    const parsed = parseGuardState(
      [
        'version: 1',
        'guards:',
        '  - { guard: guard.settings.force, mode: enforce }',
        '  - { guard: guard.settings.force, mode: warn }',
        '  - { guard: instruction.standing.rule, mode: warn }',
        '  - { guard: guard.settings.gone, mode: observe }',
      ].join('\n'),
      map,
    );
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.errors).toEqual([
      'guard.settings.force has two entries',
      'instruction.standing.rule is an atom of kind instruction, not a guard',
      'guard.settings.gone is not an atom of the map',
      'the guard guard.settings.ledger has no state',
    ]);
  });

  it('refuses a mode outside observe, warn and enforce, and text that is not YAML', () => {
    const mode = parseGuardState(
      'version: 1\nguards:\n  - { guard: guard.settings.force, mode: block }\n',
      map,
    );
    expect(!mode.ok && mode.errors[0]).toMatch(/^guards\.0\.mode: /);
    expect(parseGuardState('version: [1', map).ok).toBe(false);
  });

  it('reads the file beside the map, and treats a missing one as no state unless it was named', async () => {
    const root = await estate({
      'v2/guard-state.yaml': 'version: 1\nguards:\n  - { guard: guard.settings.force, mode: warn }\n',
    });
    expect(guardStateBeside(join(root, 'v2', 'map.yaml'))).toBe(join(root, 'v2', 'guard-state.yaml'));
    const missing = await loadGuardState(join(root, 'v1', 'guard-state.yaml'), map, false);
    expect(missing).toEqual({ ok: true, state: undefined });
    const named = await loadGuardState(join(root, 'v1', 'guard-state.yaml'), map, true);
    expect(named.ok).toBe(false);
    const short = await loadGuardState(join(root, 'v2', 'guard-state.yaml'), map, false);
    expect(!short.ok && short.errors).toEqual(['the guard guard.settings.ledger has no state']);
  });
});

describe('diffGuardStates and guardNeed', () => {
  const before: GuardState = {
    version: 1,
    guards: [
      { guard: 'g.promote', mode: 'warn' },
      { guard: 'g.demote', mode: 'enforce' },
      { guard: 'g.same', mode: 'observe' },
      { guard: 'g.dropped', mode: 'warn' },
    ],
  };
  const after: GuardState = {
    version: 1,
    guards: [
      { guard: 'g.promote', mode: 'enforce', evidence },
      { guard: 'g.demote', mode: 'warn' },
      { guard: 'g.same', mode: 'observe' },
      { guard: 'g.new', mode: 'enforce' },
    ],
  };

  it('compares the mode of every guard across the two versions', () => {
    expect(diffGuardStates(before, after)).toEqual([
      { guard: 'g.promote', from: 'warn', to: 'enforce', move: 'promoted', evidence },
      { guard: 'g.demote', from: 'enforce', to: 'warn', move: 'demoted' },
      { guard: 'g.same', from: 'observe', to: 'observe', move: 'unchanged' },
      { guard: 'g.new', from: null, to: 'enforce', move: 'added' },
      { guard: 'g.dropped', from: 'warn', to: null, move: 'removed' },
    ]);
    expect(diffGuardStates(undefined, before).every((entry) => entry.move === 'added')).toBe(true);
  });

  it('needs a person for a promotion without clean evidence and for every demotion', () => {
    const [promoted, demoted, same, added, dropped] = diffGuardStates(before, after);
    if (!promoted || !demoted || !same || !added || !dropped) throw new Error('five transitions');
    expect(guardNeed(promoted)).toBeUndefined();
    expect(guardNeed({ ...promoted, evidence: undefined })).toBe(
      'the guard g.promote went from warn to enforce with no decision evidence',
    );
    expect(guardNeed({ ...promoted, evidence: { ...evidence, decisions: 0 } })).toContain(
      'no decision evidence',
    );
    expect(guardNeed({ ...promoted, evidence: { ...evidence, wrong: 2 } })).toBe(
      'the guard g.promote went from warn to enforce although 2 of 40 decisions were marked wrong',
    );
    expect(guardNeed(demoted)).toBe('confirm the demotion of g.demote from enforce to warn');
    expect(guardNeed(same)).toBeUndefined();
    expect(guardNeed(added)).toBe('the guard g.new went from no state to enforce with no decision evidence');
    expect(guardNeed({ ...added, to: 'observe' })).toBeUndefined();
    expect(guardNeed(dropped)).toBeUndefined();
  });
});

describe('guard state in the diff and the impact', () => {
  const guards = diffGuardStates(
    {
      version: 1,
      guards: [
        { guard: 'guard.settings.force', mode: 'enforce' },
        { guard: 'guard.settings.ledger', mode: 'warn' },
      ],
    },
    {
      version: 1,
      guards: [
        { guard: 'guard.settings.force', mode: 'enforce' },
        { guard: 'guard.settings.ledger', mode: 'enforce', evidence },
      ],
    },
  );
  const diff = diffEstateMaps(map, map, { guards });

  it('prints the guards that changed state, with their evidence', () => {
    expect(renderEstateDiff(diff)).toContain(
      '  Guards: 1 of 2 changed enforcement state:\n    promoted guard.settings.ledger: warn to enforce (evidence: 40 decisions, 0 wrong, logs/ledger.decisions.jsonl)',
    );
  });

  it('regenerates the tests of a promoted guard, and needs no person when the evidence is clean', () => {
    const tests = [
      { id: 't-ledger', path: '/t/l.yaml', file: 'l.yaml', atoms: ['guard.settings.ledger'] },
      { id: 't-force', path: '/t/f.yaml', file: 'f.yaml', atoms: ['guard.settings.force'] },
    ];
    const report = estateImpact(diff, tests);
    expect(report.regenerate).toEqual([
      { test: 't-ledger', file: 'l.yaml', atoms: [{ atom: 'guard.settings.ledger', why: 'guard_state' }] },
    ]);
    expect(report.guards).toEqual([
      {
        guard: 'guard.settings.ledger',
        move: 'promoted',
        from: 'warn',
        to: 'enforce',
        tests: ['t-ledger'],
        need: null,
      },
    ]);
    expect(report.needsPerson).toEqual([]);
    expect(renderImpact(report)).toContain(
      'Guards whose enforcement state changed:\n  promoted guard.settings.ledger: warn to enforce; tests: t-ledger',
    );

    const bare = diffEstateMaps(map, map, {
      guards: guards.map((entry) => ({ ...entry, evidence: undefined })),
    });
    expect(estateImpact(bare, tests).needsPerson).toEqual([
      'the guard guard.settings.ledger went from warn to enforce with no decision evidence',
    ]);
  });
});
