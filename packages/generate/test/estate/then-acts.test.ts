import { describe, expect, it } from 'vitest';
import { brokenAtoms, findSituation, relatedAtoms } from '../../src/estate/build-row';
import type { EstateAtom, EstateEvidence, PhraseBank, Situation } from '../../src/estate/inputs';
import { stageModel, type ThenContext, thenOf } from '../../src/estate/then';

/** A shop estate written by hand for these tests: two skills, a step list, a few rules. Fictional. */

function atom(id: string, evidence: EstateEvidence[], extra: Partial<EstateAtom> = {}): EstateAtom {
  return { id, kind: 'instruction', title: `Title of ${id}`, approved: true, evidence, ...extra };
}

function stage(id: string, next: string[], anytime = false): EstateAtom {
  return atom(`stage.${id}`, [{ type: 'stage_reached', name: id }], {
    kind: 'stage',
    fields: { id, next, anytime },
    provenance: { file: '.agents/flow.json', quote: id },
  });
}

const STAGES = [stage('draft', ['check']), stage('check', ['ship']), stage('ship', [])];

const ctx: ThenContext = {
  stages: stageModel(STAGES),
  skills: new Set(['price-check', 'restock']),
  customChecks: new Set(['ordered', 'some_call', 'stage_seen']),
  stepFiles: new Set(['.agents/flow.json']),
};

describe('ordered pairs that tell the right act apart', () => {
  it('pins the earlier act on the path the gate names, so another read does not stand in for it', () => {
    const gate = atom('gate.price-check.read-tariffs', [{ type: 'ordered', before: 'Read', after: 'Edit' }], {
      kind: 'gate',
      fields: { first: 'notes/tariffs.md', trigger: 'you edit a price' },
    });
    expect(thenOf([gate], 'positive', ctx).ordered).toEqual([
      { before: 'Read~notes/tariffs.md', after: 'Edit' },
    ]);
    // A first act in words, not a path, keeps the bare label.
    const loose = atom('gate.x', [{ type: 'ordered', before: 'Read', after: 'Edit' }], {
      kind: 'gate',
      fields: { first: 'the notes', trigger: 'you edit' },
    });
    expect(thenOf([loose], 'positive', ctx).ordered).toEqual([{ before: 'Read', after: 'Edit' }]);
  });

  it('holds the pair on the same file when the later act takes the object by a pronoun', () => {
    const same = atom(
      'gate.standing.read-then-change',
      [{ type: 'ordered', before: 'Read', after: 'Edit' }],
      {
        kind: 'gate',
        provenance: { file: 'AGENTS.md', quote: 'Always read a price list before you change it.' },
      },
    );
    expect(thenOf([same], 'positive', ctx).ordered).toEqual([
      { before: 'Read', after: 'Edit', key: 'file_path' },
    ]);
    const other = atom('gate.standing.read-guide', [{ type: 'ordered', before: 'Read', after: 'Edit' }], {
      kind: 'gate',
      provenance: { file: 'AGENTS.md', quote: 'Read the style guide before you edit any page.' },
    });
    expect(thenOf([other], 'positive', ctx).ordered).toEqual([{ before: 'Read', after: 'Edit' }]);
  });
});

describe('a reference to the step list, and a guard of every turn', () => {
  it('expects the list walked to its closing stage, not a read of the list file', () => {
    const ref = atom(
      'reference.standing.flow',
      [{ type: 'tool_called', label: 'Read', input: { file_path: { contains: '.agents/flow.json' } } }],
      { kind: 'reference' },
    );
    const then = thenOf([ref], 'positive', ctx);
    expect(then.references).toEqual([]);
    expect(then.stage).toBe('ship');
    // Any other file is still an expected read.
    const doc = atom(
      'reference.standing.doc',
      [{ type: 'tool_called', label: 'Read', input: { file_path: { contains: 'notes/tariffs.md' } } }],
      { kind: 'reference' },
    );
    expect(thenOf([doc], 'positive', ctx).references).toEqual([
      { path: '**/notes/tariffs.md', count: { min: 1 } },
    ]);
  });

  it('controls a guard of an every-turn event by its blocking verdicts, a tool guard by not firing', () => {
    const stop = atom('guard.settings.stop-length', [{ type: 'guard', name: 'length.sh' }], {
      kind: 'guard',
      fields: { event: 'Stop', name: 'length.sh' },
    });
    expect(thenOf([stop], 'negative', ctx).guards).toEqual([
      { name: 'length.sh', verdict: 'deny', count: 0 },
      { name: 'length.sh', verdict: 'block', count: 0 },
    ]);
    const tool = atom('guard.settings.pre-push', [{ type: 'guard', name: 'push.sh' }], {
      kind: 'guard',
      fields: { event: 'PreToolUse', name: 'push.sh' },
    });
    expect(thenOf([tool], 'negative', ctx).guards).toEqual([{ name: 'push.sh', count: 0 }]);
    const warned = atom('guard.settings.stop-warn', [{ type: 'guard', name: 'tone.sh', verdict: 'warn' }], {
      kind: 'guard',
      fields: { event: 'Stop', name: 'tone.sh' },
    });
    expect(thenOf([warned], 'negative', ctx).guards).toEqual([
      { name: 'tone.sh', verdict: 'warn', count: 0 },
    ]);
  });

  it('compiles a command the rule forbids, named by command, into no matching Bash call', () => {
    const rule = atom('instruction.standing.no-reset', [
      { type: 'custom', name: 'command_absent', options: { command: 'git reset --hard' } },
    ]);
    expect(thenOf([rule], 'positive', ctx).someCalls).toEqual([
      { label: 'Bash', input: { command: { contains: 'git reset --hard' } }, count: 0 },
    ]);
  });
});

describe('the situation of a row', () => {
  const skill = (name: string) =>
    atom(`skill.${name}`, [], {
      kind: 'skill',
      provenance: { file: `.agents/skills/${name}/SKILL.md`, quote: name },
    });
  const gate = atom(
    'gate.standing.read-restock-rules',
    [{ type: 'ordered', before: 'Read', after: 'Edit' }],
    {
      kind: 'gate',
      fields: { first: '.agents/skills/restock/rules.md', path: '.agents/skills/restock/rules.md' },
    },
  );
  const missing = atom('reference.price-check.gone', [], {
    kind: 'reference',
    fields: { path: '.agents/skills/price-check/gone.md', exists: false },
  });
  const atoms = [skill('price-check'), skill('restock'), gate, missing];
  const situation = (id: string, members: string[]): Situation => ({
    id,
    title: id,
    use: 'pressure',
    atoms: members,
    phrases: [{ text: `ask of ${id}`, lang: 'en', approved: true }],
  });
  const bank: PhraseBank = {
    version: 1,
    estate: 'shop',
    mapHash: 'x',
    workspaces: [],
    situations: [
      situation('price-check-pressure', ['skill.price-check', gate.id, missing.id]),
      situation('restock-pressure', ['skill.restock', gate.id]),
    ],
  };

  it('prefers the unit whose folder holds the path the rule names', () => {
    const related = relatedAtoms(gate, atoms);
    expect([...related]).toEqual(['skill.restock']);
    const row = { atomIds: [gate.id], cell: {} };
    expect(findSituation(bank, 'pressure', row)?.id).toBe('price-check-pressure');
    expect(findSituation(bank, 'pressure', row, related)?.id).toBe('restock-pressure');
  });

  it('prefers a situation whose unit names no missing file, unless the row tests that file', () => {
    const rule = atom('instruction.standing.be-brief', []);
    const open: PhraseBank = {
      ...bank,
      situations: [
        situation('price-check-pressure', ['skill.price-check', rule.id, missing.id]),
        situation('restock-pressure', ['skill.restock', rule.id]),
      ],
    };
    const broken = brokenAtoms([...atoms, rule]);
    expect([...broken]).toEqual([missing.id]);
    expect(findSituation(open, 'pressure', { atomIds: [rule.id], cell: {} }, new Set(), broken)?.id).toBe(
      'restock-pressure',
    );
    expect(findSituation(open, 'pressure', { atomIds: [missing.id], cell: {} }, new Set(), broken)?.id).toBe(
      'price-check-pressure',
    );
  });
});
