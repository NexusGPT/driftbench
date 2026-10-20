import { describe, expect, it } from 'vitest';
import {
  diffEstateMaps,
  type EstateTest,
  estateImpact,
  renderEstateDiff,
  renderImpact,
} from '../../src/index';
import { cut, type Ledger, nextLedger } from '../../src/pointer';
import { atom, estateMap } from './support';

// An invented shed: three rules under one heading.
const SHED =
  '# Shed\n\n- Oil the hinges once a week\n- Lock the shed at dusk\n- Hang the rake on the left hook\n';
const scan = (text: string, previous?: Ledger) =>
  nextLedger([{ path: 'CLAUDE.md', cut: cut(text) }], previous, 'shed').ledger;
const v1 = scan(SHED);
const unitOf = (ledger: Ledger, quote: string) =>
  ledger.entries.find((entry) => entry.status === 'live' && entry.quote === quote)?.id as string;
const HINGES = unitOf(v1, 'Oil the hinges once a week');
const LOCK = unitOf(v1, 'Lock the shed at dusk');
const RAKE = unitOf(v1, 'Hang the rake on the left hook');

const onUnit = (id: string, quote: string, unit: string, line: number) =>
  atom(id, quote, { line, fields: { extraction: 'pointer', unit } });
const before = estateMap([
  onUnit('instruction.standing.oil-the-hinges', 'Oil the hinges once a week', HINGES, 3),
  onUnit('instruction.standing.lock-the-shed', 'Lock the shed at dusk', LOCK, 4),
  onUnit('instruction.standing.hang-the-rake', 'Hang the rake on the left hook', RAKE, 5),
]);
const test = (id: string, atoms: string[]): EstateTest => ({
  id,
  path: `/t/${id}.yaml`,
  file: `${id}.yaml`,
  atoms,
});

describe('the estate diff on ledger units', () => {
  it('pairs a removed and an added atom on one unit as one changed atom under its old id', () => {
    const text = SHED.replace('Lock the shed at dusk', 'Lock the shed and the gate at dusk');
    const v2 = scan(text, v1);
    expect(unitOf(v2, 'Lock the shed and the gate at dusk')).toBe(LOCK);
    const after = estateMap([
      onUnit('instruction.standing.oil-the-hinges', 'Oil the hinges once a week', HINGES, 3),
      onUnit(
        'instruction.standing.lock-the-shed-and-the-gate',
        'Lock the shed and the gate at dusk',
        LOCK,
        4,
      ),
      onUnit('instruction.standing.hang-the-rake', 'Hang the rake on the left hook', RAKE, 5),
    ]);
    const diff = diffEstateMaps(before, after, { ledgers: { before: v1, after: v2 } });
    expect(diff.atoms.added).toEqual([]);
    expect(diff.atoms.removed).toEqual([]);
    expect(diff.atoms.changed).toEqual([
      expect.objectContaining({
        id: 'instruction.standing.lock-the-shed',
        now: 'instruction.standing.lock-the-shed-and-the-gate',
        change: 'semantic',
      }),
    ]);
    expect(diff.units?.rerun).toEqual([
      { unit: LOCK, why: ['changed'], atoms: ['instruction.standing.lock-the-shed'] },
    ]);
    expect(diff.units?.advisory.map((ref) => ref.unit).sort()).toEqual([HINGES, RAKE].sort());
    expect(renderEstateDiff(diff)).toContain(', now instruction.standing.lock-the-shed-and-the-gate');
    expect(renderEstateDiff(diff)).toContain('Units whose links rerun: 1; advisory only: 2.');

    const impact = estateImpact(diff, [
      test('shed-lock', ['instruction.standing.lock-the-shed']),
      test('shed-rake', ['instruction.standing.hang-the-rake']),
    ]);
    expect(impact.regenerate).toEqual([
      {
        test: 'shed-lock',
        file: 'shed-lock.yaml',
        atoms: [{ atom: 'instruction.standing.lock-the-shed', why: 'semantic' }],
      },
    ]);
    expect(impact.units?.rerun).toEqual([]);
    expect(impact.units?.advisory).toEqual([
      {
        test: 'shed-rake',
        file: 'shed-rake.yaml',
        atoms: [{ atom: 'instruction.standing.hang-the-rake', unit: RAKE, why: ['context'] }],
      },
    ]);
  });

  it('reruns the tests of the section of a new unit, as they are, and says so', () => {
    const text = `${SHED}- Sweep the floor before you leave\n`;
    const v2 = scan(text, v1);
    const after = estateMap([
      ...before.atoms,
      onUnit(
        'instruction.standing.sweep-the-floor',
        'Sweep the floor before you leave',
        unitOf(v2, 'Sweep the floor before you leave'),
        6,
      ),
    ]);
    const diff = diffEstateMaps(before, after, { ledgers: { before: v1, after: v2 } });
    expect(diff.units?.counts).toMatchObject({ new: 1, context: 1 });
    expect(diff.units?.rerun.map((ref) => ref.unit).sort()).toEqual([HINGES, LOCK, RAKE].sort());
    const impact = estateImpact(diff, [test('shed-hinges', ['instruction.standing.oil-the-hinges'])]);
    expect(impact.regenerate).toEqual([]);
    expect(impact.units?.rerun).toEqual([
      {
        test: 'shed-hinges',
        file: 'shed-hinges.yaml',
        atoms: [
          {
            atom: 'instruction.standing.oil-the-hinges',
            unit: HINGES,
            why: [`new unit ${unitOf(v2, 'Sweep the floor before you leave')} beside it`],
          },
        ],
      },
    ]);
    expect(impact.unaffected.tests).toBe(0);
    expect(renderImpact(impact)).toContain('Rerun as they are, a unit their atoms sit on reruns:');
  });

  it('reads no units without the ledgers, and leaves the diff as it was', () => {
    const diff = diffEstateMaps(before, before);
    expect(diff.units).toBeUndefined();
    expect(estateImpact(diff, []).units).toBeUndefined();
  });
});
