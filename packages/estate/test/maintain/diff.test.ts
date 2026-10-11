import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyQuote,
  diffEstateMaps,
  loadEstateMap,
  normaliseQuote,
  parseEstateDiff,
  renderEstateDiff,
} from '../../src/index';
import { FIXTURE } from '../support';
import { atom, estateMap } from './support';

describe('classifyQuote', () => {
  it('tells white space from meaning, by the normalised text', () => {
    expect(classifyQuote('Read a file first.', 'Read a file first.')).toBe('same');
    expect(classifyQuote('Read a file first.', 'Read  a file\n  first. ')).toBe('whitespace');
    expect(classifyQuote('late by two days', 'late by one day')).toBe('semantic');
    expect(classifyQuote('Never push.', 'never push.')).toBe('semantic');
    expect(classifyQuote('Never push.', 'Never push')).toBe('semantic');
    expect(normaliseQuote(' a\t b\n\nc ')).toBe('a b c');
  });
});

describe('diffEstateMaps', () => {
  const base = [
    atom('instruction.standing.keep', 'Keep the ledger.', { line: 3 }),
    atom('instruction.standing.wrap', 'Never send a draft without a yes.', { line: 4 }),
    atom('instruction.standing.late', 'A shipment is late after two days.', { line: 5 }),
    atom('register.standing.question', 'Ask at most one question.', { line: 6, kind: 'register' }),
    atom('instruction.standing.below', 'Below the change.', { line: 7 }),
    atom('instruction.standing.restate', 'Restated rule.', { line: 8 }),
    atom('instruction.standing.approve', 'Approval only.', { line: 9, approved: false }),
  ];
  const edges = [
    { from: 'instruction.standing.keep', to: 'register.standing.question', kind: 'cites' as const },
    { from: 'instruction.standing.wrap', to: 'instruction.standing.keep', kind: 'cites' as const },
  ];
  const next = [
    atom('instruction.standing.keep', 'Keep the ledger.', { line: 3 }),
    atom('instruction.standing.wrap', 'Never send a draft\n  without a yes.', { line: 4, endLine: 5 }),
    atom('instruction.standing.late', 'A shipment is late after one day.', { line: 6 }),
    atom('instruction.standing.below', 'Below the change.', { line: 7 }),
    atom('instruction.standing.restate', 'Restated rule.', {
      line: 8,
      evidence: [{ type: 'text', must: ['changed'] }],
    }),
    atom('instruction.standing.approve', 'Approval only.', { line: 9, approved: true }),
    atom('gate.standing.new', 'Before closing a month: Read the table.', { line: 10, kind: 'gate' }),
  ];
  const nextEdges = [
    { from: 'instruction.standing.wrap', to: 'instruction.standing.keep', kind: 'cites' as const },
    { from: 'gate.standing.new', to: 'instruction.standing.keep', kind: 'reference' as const },
  ];
  const diff = diffEstateMaps(estateMap(base, edges), estateMap(next, nextEdges), {
    oldPath: 'v1/map.yaml',
    newPath: 'v2/map.yaml',
  });

  it('lists added and removed atoms with their quotes', () => {
    expect(diff.atoms.added.map((entry) => entry.id)).toEqual(['gate.standing.new']);
    expect(diff.atoms.added[0]?.at.quote).toBe('Before closing a month: Read the table.');
    expect(diff.atoms.removed.map((entry) => entry.id)).toEqual(['register.standing.question']);
    expect(diff.atoms.removed[0]?.kind).toBe('register');
  });

  it('classifies a changed hash as white space, semantic or a move', () => {
    expect(diff.atoms.changed.map((entry) => [entry.id, entry.change])).toEqual([
      ['instruction.standing.wrap', 'whitespace'],
      ['instruction.standing.late', 'semantic'],
    ]);
    const late = diff.atoms.changed.find((entry) => entry.id === 'instruction.standing.late');
    expect(late?.before.quote).toBe('A shipment is late after two days.');
    expect(late?.after.quote).toBe('A shipment is late after one day.');
    expect(late?.before.startLine).toBe(5);
    expect(late?.after.startLine).toBe(6);
    expect(diff.atoms.moved).toEqual([]);
  });

  it('reports a moved atom apart from the changed ones', () => {
    const moved = diffEstateMaps(
      estateMap([atom('a.b.c', 'Same words.', { line: 3 })]),
      estateMap([atom('a.b.c', 'Same words.', { line: 5 })]),
    );
    expect(moved.atoms.changed).toEqual([]);
    expect(moved.atoms.moved).toEqual([
      {
        id: 'a.b.c',
        kind: 'instruction',
        title: 'a.b.c',
        from: { file: 'CLAUDE.md', startLine: 3, endLine: 3 },
        to: { file: 'CLAUDE.md', startLine: 5, endLine: 5 },
      },
    ]);
    expect(moved.summary.moved).toBe(1);
  });

  it('reports other fields that changed under the same quote, and never approval alone', () => {
    expect(diff.atoms.restated).toEqual([
      {
        id: 'instruction.standing.restate',
        kind: 'instruction',
        title: 'instruction.standing.restate',
        fields: ['evidence'],
      },
    ]);
    expect(diff.summary.unchanged).toBe(3);
  });

  it('lists edges added and removed', () => {
    expect(diff.edges.added).toEqual([
      { from: 'gate.standing.new', to: 'instruction.standing.keep', kind: 'reference' },
    ]);
    expect(diff.edges.removed).toEqual([
      { from: 'instruction.standing.keep', to: 'register.standing.question', kind: 'cites' },
    ]);
  });

  it('counts every class in the summary and stamps both maps', () => {
    expect(diff.summary).toEqual({
      added: 1,
      removed: 1,
      whitespace: 1,
      semantic: 1,
      moved: 0,
      restated: 1,
      unchanged: 3,
      edgesAdded: 1,
      edgesRemoved: 1,
    });
    expect(diff.old.path).toBe('v1/map.yaml');
    expect(diff.new.atoms).toBe(7);
    expect(diff.old.edges).toBe(2);
  });

  it('round-trips through JSON and refuses what is not a diff', () => {
    const parsed = parseEstateDiff(JSON.stringify(diff));
    expect(parsed.ok && parsed.diff).toEqual(diff);
    const broken = parseEstateDiff(JSON.stringify({ ...diff, version: 2 }));
    expect(broken.ok).toBe(false);
    expect(!broken.ok && broken.message).toContain('version');
    expect(parseEstateDiff('{').ok).toBe(false);
  });

  it('prints every class for a person', () => {
    const text = renderEstateDiff(diff);
    expect(text).toContain(
      'Atoms: 1 added, 1 removed, 2 changed (1 white space only, 1 semantic), 0 moved with the same quote, 1 restated, 3 unchanged.',
    );
    expect(text).toContain('  + gate.standing.new (gate) CLAUDE.md:10');
    expect(text).toContain('  - register.standing.question (register) CLAUDE.md:6');
    expect(text).toContain('      was: A shipment is late after two days.');
    expect(text).toContain('      now: A shipment is late after one day.');
    expect(text).toContain(
      'Changed, white space only:\n  ~ instruction.standing.wrap (instruction) CLAUDE.md:4-5',
    );
    expect(text).toContain('  * instruction.standing.restate: evidence');
    expect(text).toContain('Edges removed:\n  - instruction.standing.keep cites register.standing.question');
  });

  it('finds nothing between the fixture map and its approved copy: approval is not a change', async () => {
    const scanned = await loadEstateMap(join(FIXTURE, 'map.yaml'));
    const approved = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
    if (!scanned.ok || !approved.ok) throw new Error('fixture maps do not load');
    const none = diffEstateMaps(scanned.map, approved.map);
    expect(none.summary).toMatchObject({
      added: 0,
      removed: 0,
      whitespace: 0,
      semantic: 0,
      moved: 0,
      restated: 0,
    });
    expect(none.summary.unchanged).toBe(scanned.map.atoms.length);
    expect(none.edges).toEqual({ added: [], removed: [] });
  });
});
