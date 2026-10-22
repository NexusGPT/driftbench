import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, pointer, scanEstate, variables } from '../../src/index';
import { estate, NOW } from '../support';
import { plantedDense } from './support';

// An invented harbour office: nothing here names a real estate.
const FILES = {
  'CLAUDE.md': [
    '# Harbour office',
    '',
    '- Warn the skipper when a boat is overdue',
    '- Close the gate at dusk',
    '',
  ].join('\n'),
};

const SET = `labels:
  - set: duty
    description: What the harbour notes ask of a reader.
    links:
      - name: limit
        description: A number the unit sets, with how a quantity is compared with it for the unit to hold.
        values: [lt, le, gt, ge]
        number: true
    labels:
      - name: order
        description: A unit that tells the reader what to do.
        links: [limit]
        atom: { kind: instruction, polarity: obligation }
      - name: remark
        description: A unit that states how things are.
      - name: bound
        description: A unit that states a number that limits another unit.
        target: required
        condition: true
        links: [limit]
`;

const sets = () => {
  const parsed = pointer.parseLabelSets(SET);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
};

const play = async (links: unknown) => {
  const root = await estate(FILES);
  const labeler = plantedDense((window) =>
    window.path === 'CLAUDE.md'
      ? [
          { units: '1', label: 'remark' },
          { units: '2', label: 'order', links } as pointer.Labelled,
          { units: '3', label: 'order' },
        ]
      : [{ units: `1-${window.units.length}`, label: 'none' }],
  );
  return scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: {
      sets: sets(),
      labelling: pointer.singleLabelling(labeler),
      cassette: new pointer.Cassette(),
      mode: 'record',
    },
  });
};

const atomOf = (result: Awaited<ReturnType<typeof play>>, quote: string) =>
  result.map.atoms.find((atom) => atom.provenance.quote === quote);

describe('a labeller returns a numeric limit as structured fields', () => {
  it('reads a set that declares a numeric link kind, and refuses one with no closed list', () => {
    expect(pointer.parseLabelSets(SET).ok).toBe(true);
    const open = SET.replace(
      'values: [lt, le, gt, ge]\n        number: true',
      'to: [instruction]\n        number: true',
    );
    expect(pointer.parseLabelSets(open).ok).toBe(false);
  });

  it('puts the limit, comparison and unit of the answer in fields.condition of the atom, with no word read', async () => {
    const result = await play([{ kind: 'limit', to: 'le', value: 2, unit: 'days' }]);
    const atom = atomOf(result, 'Warn the skipper when a boat is overdue');
    expect(atom?.fields?.condition).toEqual([{ limit: 2, comparison: 'le', unit: 'days' }]);
    expect(atom && variables.conditionsOf(atom)).toEqual([
      { limit: 2, comparison: 'le', unit: 'days', base: atom?.id },
    ]);
  });

  it('keeps several limits of a unit, and a limit with no unit', async () => {
    const result = await play([
      { kind: 'limit', to: 'ge', value: 1 },
      { kind: 'limit', to: 'lt', value: 30, unit: 'minutes' },
    ]);
    expect(atomOf(result, 'Warn the skipper when a boat is overdue')?.fields?.condition).toEqual([
      { limit: 1, comparison: 'ge' },
      { limit: 30, comparison: 'lt', unit: 'minutes' },
    ]);
  });

  it('drops a limit whose value is no finite number, with its reason, and keeps the label', async () => {
    const result = await play([{ kind: 'limit', to: 'le', value: '2' }]);
    const atom = atomOf(result, 'Warn the skipper when a boat is overdue');
    expect(atom).toBeDefined();
    expect(atom?.fields).not.toHaveProperty('condition');
    expect(result.pointer?.dropped.join('\n')).toContain('limit');
  });

  it('puts the limit a bound unit states on the atom of the unit it points at, beside the unit id', async () => {
    const root = await estate({
      'CLAUDE.md': ['# Harbour office', '', '- Warn the skipper', '- Five minutes', ''].join('\n'),
    });
    const labeler = plantedDense((window) =>
      window.path === 'CLAUDE.md'
        ? ([
            { units: '1', label: 'remark' },
            { units: '2', label: 'order' },
            {
              units: '3',
              label: 'bound',
              target: 2,
              links: [{ kind: 'limit', to: 'le', value: 5, unit: 'minutes' }],
            },
          ] as pointer.Labelled[])
        : [{ units: `1-${window.units.length}`, label: 'none' }],
    );
    const result = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: {
        sets: sets(),
        labelling: pointer.singleLabelling(labeler),
        cassette: new pointer.Cassette(),
        mode: 'record',
      },
    });
    const atom = atomOf(result, 'Warn the skipper');
    const condition = atom?.fields?.condition as unknown[];
    expect(condition).toHaveLength(2);
    expect(condition).toContainEqual({ limit: 5, comparison: 'le', unit: 'minutes' });
    expect(atom && variables.conditionsOf(atom).map((entry) => entry.limit)).toEqual([5]);
  });

  it('puts no condition on a unit that gave no limit', async () => {
    const result = await play(undefined);
    expect(atomOf(result, 'Close the gate at dusk')?.fields).not.toHaveProperty('condition');
  });
});
