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
      - name: check
        description: A unit that tells the reader to check something first.
        links: [limit]
        atom: { kind: gate }
      - name: wording
        description: A unit that sets how the reader replies.
        links: [limit]
        atom: { kind: register }
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

  it('lets a set of limits sit beside the set of rules: the bound unit points across sets', async () => {
    const two = `${SET.replace(/ {6}- name: bound[\s\S]*$/, '')}  - set: bounds
    description: The numbers of the harbour notes.
    links:
      - name: limit
        description: A number the unit sets, with how a quantity is compared with it.
        values: [lt, le, gt, ge]
        number: true
    labels:
      - name: bound
        description: A unit that states a number that limits another unit.
        target: required
        condition: true
        links: [limit]
`;
    const parsed = pointer.parseLabelSets(two);
    if (!parsed.ok) throw new Error(parsed.message);
    const root = await estate({
      'CLAUDE.md': ['# Harbour office', '', '- Warn the skipper', '- Five minutes', ''].join('\n'),
    });
    const labeler = plantedDense((window, set) => {
      if (window.path !== 'CLAUDE.md') return [{ units: `1-${window.units.length}`, label: 'none' }];
      return set.set === 'duty'
        ? [
            { units: '1', label: 'remark' },
            { units: '2', label: 'order' },
            { units: '3', label: 'remark' },
          ]
        : ([
            { units: '1-2', label: 'none' },
            {
              units: '3',
              label: 'bound',
              target: 2,
              links: [{ kind: 'limit', to: 'le', value: 5, unit: 'minutes' }],
            },
          ] as pointer.Labelled[]);
    });
    const result = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: {
        sets: parsed.sets,
        labelling: pointer.singleLabelling(labeler),
        cassette: new pointer.Cassette(),
        mode: 'record',
      },
    });
    expect(atomOf(result, 'Warn the skipper')?.fields?.condition).toEqual([
      { limit: 5, comparison: 'le', unit: 'minutes' },
    ]);
    expect(result.pointer?.atomRefusals).toEqual([]);
  });

  it('lets a unit that states its own limit give it to its atom in another set', async () => {
    const two = `${SET.replace(/ {6}- name: bound[\s\S]*$/, '')}  - set: bounds
    description: The numbers of the harbour notes.
    links:
      - name: limit
        description: A number the unit sets, with how a quantity is compared with it.
        values: [lt, le, gt, ge]
        number: true
    labels:
      - name: own
        description: A unit that is an instruction and states a number that limits it.
        links: [limit]
`;
    const parsed = pointer.parseLabelSets(two);
    if (!parsed.ok) throw new Error(parsed.message);
    const root = await estate({
      'CLAUDE.md': ['# Harbour office', '', '- Warn the skipper within five minutes', ''].join('\n'),
    });
    const labeler = plantedDense((window, set) => {
      if (window.path !== 'CLAUDE.md') return [{ units: `1-${window.units.length}`, label: 'none' }];
      return set.set === 'duty'
        ? [
            { units: '1', label: 'remark' },
            { units: '2', label: 'order' },
          ]
        : ([
            { units: '1', label: 'none' },
            { units: '2', label: 'own', links: [{ kind: 'limit', to: 'le', value: 5, unit: 'minutes' }] },
          ] as pointer.Labelled[]);
    });
    const result = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: {
        sets: parsed.sets,
        labelling: pointer.singleLabelling(labeler),
        cassette: new pointer.Cassette(),
        mode: 'record',
      },
    });
    expect(atomOf(result, 'Warn the skipper within five minutes')?.fields?.condition).toEqual([
      { limit: 5, comparison: 'le', unit: 'minutes' },
    ]);
  });

  it.each([
    ['an unknown comparison', { kind: 'limit', to: 'more', value: 2 }],
    ['an empty unit', { kind: 'limit', to: 'le', value: 2, unit: '  ' }],
    ['to: none', { kind: 'limit', to: 'none', value: 2 }],
  ])('drops a limit with %s, keeps the label and makes no condition', async (_name, link) => {
    const result = await play([link]);
    const atom = atomOf(result, 'Warn the skipper when a boat is overdue');
    expect(atom).toBeDefined();
    expect(atom?.fields).not.toHaveProperty('condition');
  });

  it('makes one condition of identical limits on one unit, and keeps different ones', async () => {
    const same = { kind: 'limit', to: 'le', value: 2, unit: 'days' };
    const result = await play([same, { ...same }, { kind: 'limit', to: 'le', value: 3, unit: 'days' }]);
    expect(atomOf(result, 'Warn the skipper when a boat is overdue')?.fields?.condition).toEqual([
      { limit: 2, comparison: 'le', unit: 'days' },
      { limit: 3, comparison: 'le', unit: 'days' },
    ]);
  });

  it('accepts a limit on a gate atom', async () => {
    const root = await estate({
      'CLAUDE.md': ['# Harbour office', '', '- Check the tide table', ''].join('\n'),
    });
    const labeler = plantedDense((window) =>
      window.path === 'CLAUDE.md'
        ? ([
            { units: '1', label: 'remark' },
            { units: '2', label: 'check', links: [{ kind: 'limit', to: 'le', value: 2, unit: 'hours' }] },
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
    const gate = result.map.atoms.find(
      (atom) => atom.kind === 'gate' && atom.provenance.quote === 'Check the tide table',
    );
    expect(gate?.fields?.condition).toEqual([{ limit: 2, comparison: 'le', unit: 'hours' }]);
  });

  it('drops a limit on any other kind of atom, and says which unit gave it', async () => {
    const root = await estate({
      'CLAUDE.md': ['# Harbour office', '', '- Reply in the skipper language', ''].join('\n'),
    });
    const labeler = plantedDense((window) =>
      window.path === 'CLAUDE.md'
        ? ([
            { units: '1', label: 'remark' },
            { units: '2', label: 'wording', links: [{ kind: 'limit', to: 'le', value: 2, unit: 'lines' }] },
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
    const register = result.map.atoms.find((atom) => atom.kind === 'register');
    expect(register).toBeDefined();
    expect(register?.fields).not.toHaveProperty('condition');
    expect(result.pointer?.atomRefusals).toHaveLength(1);
  });

  it('puts no condition on a unit that gave no limit', async () => {
    const result = await play(undefined);
    expect(atomOf(result, 'Close the gate at dusk')?.fields).not.toHaveProperty('condition');
  });
});
