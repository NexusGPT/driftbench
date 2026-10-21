import { describe, expect, it, vi } from 'vitest';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import { constructAsk, type MapAtom } from '../../src/ladders/estate/reference-ask';

// A planted run of one obligation row, its one atom, and one complete spec whose ask code wrote (fictional data).
const state = vi.hoisted(() => ({ run: {} as unknown, verdicts: [] as unknown[] }));
vi.mock('../../src/ladders/estate/pipeline', async (original) => ({
  ...(await original<typeof import('../../src/ladders/estate/pipeline')>()),
  estateRun: vi.fn(async () => state.run),
}));
vi.mock('../../src/ladders/estate/levels', async (original) => ({
  ...(await original<typeof import('../../src/ladders/estate/levels')>()),
  specVerdicts: vi.fn(async () => state.verdicts),
}));

const ONE: MapAtom = {
  id: 'instruction.one',
  kind: 'instruction',
  title: 'Sort the inbox every morning',
  fields: { note: 'Approving a refill needs the pharmacist.' },
};
const TWO: MapAtom = { id: 'instruction.two', kind: 'instruction', title: 'Close the berth log at noon' };
const GUARD: MapAtom = {
  id: 'guard.edits',
  kind: 'guard',
  title: 'Edits are checked',
  fields: { matcher: 'Edit|Write' },
};
const ATOMS = new Map([ONE, TWO, GUARD].map((atom) => [atom.id, atom]));

/** The record of "Please go ahead with Approving a refill.": the act row and the span of ONE's note. */
const GO_AHEAD = {
  ask: 'Please {act}.[ {situation}.]',
  act: 'go ahead with {span}',
  spans: [{ slot: 'act', atom: 'instruction.one', field: 'fields.note', from: 0, to: 18 }],
};

function plant(ask: string, askBuild: unknown, askFrom: string) {
  const row = {
    id: 'obligation.one',
    atomIds: ['instruction.one'],
    testType: 'obligation',
    mode: 'replay',
    cell: {},
  };
  state.run = {
    bank: { situations: [] },
    plan: { plan: { rows: [row] } },
    scanned: { map: { atoms: [ONE, TWO, GUARD] } },
  };
  state.verdicts = [
    {
      complete: true,
      valid: true,
      distinct: true,
      spec: {
        record: { id: 'one', row: row.id, testType: row.testType },
        loaded: {
          spec: {
            tags: ['ask:code', 'test:obligation'],
            metadata: {
              estate: {
                ask: 'code',
                askFrom,
                ...(askBuild === undefined ? {} : { askBuild }),
                planRow: row.id,
                atoms: row.atomIds,
                testType: row.testType,
              },
            },
            blocks: [{ when: { user: ask } }],
          },
        },
      },
    },
  ];
}

const item = async () => (await genAsksFamily().evaluate(1047)).get('gen.asks.asks-approved');

describe('gen.asks.asks-approved rebuilds each code-written ask from its record and the map', () => {
  it('control: the ask its record describes, cut from the row atom, holds', async () => {
    plant('Please go ahead with Approving a refill.', [GO_AHEAD], 'instruction.one (fields.note)');
    expect(await item()).toMatchObject({ pass: true });
  });

  // The reviewer's four counterexamples (comment 6314768851): an unrelated fixed act, and a forged source.
  for (const ask of [
    'Please edit a file here.',
    'Please open a file here.',
    'Please look something up on the web.',
  ])
    it(`refuses an unrelated fixed act with no construction record: ${ask}`, async () => {
      plant(ask, undefined, 'instruction.one (title)');
      expect((await item())?.pass).toBe(false);
    });

  it('refuses a true span attributed to a source the map does not hold', async () => {
    plant('Please go ahead with Approving a refill.', [GO_AHEAD], 'missing-atom.nonexistent');
    expect((await item())?.pass).toBe(false);
  });

  it('refuses the same ask built from an atom outside the row', async () => {
    const elsewhere = {
      ...GO_AHEAD,
      spans: [{ slot: 'act', atom: 'instruction.two', field: 'title', from: 0, to: 15 }],
    };
    plant('Please go ahead with Close the berth.', [elsewhere], 'instruction.two (title)');
    expect((await item())?.pass).toBe(false);
  });

  it('refuses an ask that differs from its record by one word, and a record that claims a fixed act', async () => {
    plant('Please go ahead with approving a refill.', [GO_AHEAD], 'instruction.one (fields.note)');
    expect((await item())?.pass).toBe(false);
    plant(
      'Please edit a file here.',
      [{ ask: 'Please {act}.[ {situation}.]', act: 'edit a file here', spans: [] }],
      'instruction.one (title)',
    );
    expect((await item())?.pass).toBe(false);
  });
});

describe('constructAsk builds one ask from a record, or refuses it', () => {
  const row = new Set(['instruction.one']);
  it('builds the ask from the rows and the verbatim slice', () => {
    expect(constructAsk(GO_AHEAD, ATOMS, row)).toEqual({ text: 'Please go ahead with Approving a refill.' });
    expect(
      constructAsk(
        {
          ask: 'Please {act}.[ {situation}.]',
          act: '{span}',
          situation: '{span}',
          spans: [
            { slot: 'act', atom: 'instruction.one', field: 'title', from: 0, to: 14 },
            { slot: 'situation', atom: 'instruction.one', field: 'fields.note', from: 0, to: 18 },
          ],
        },
        ATOMS,
        row,
      ),
    ).toEqual({ text: 'Please Sort the inbox. Approving a refill.' });
  });

  it('refuses an atom outside the row, a cut inside a word, a row not in the table, a missing or unused span', () => {
    const refused = (record: unknown, allowed = row) => 'refused' in constructAsk(record, ATOMS, allowed);
    expect(refused(GO_AHEAD, new Set(['instruction.two']))).toBe(true);
    expect(refused({ ...GO_AHEAD, spans: [{ ...GO_AHEAD.spans[0], from: 1 }] })).toBe(true);
    expect(refused({ ...GO_AHEAD, spans: [{ ...GO_AHEAD.spans[0], to: 17 }] })).toBe(true);
    expect(refused({ ...GO_AHEAD, act: 'go on with {span}' })).toBe(true);
    expect(refused({ ...GO_AHEAD, spans: [] })).toBe(true);
    expect(refused({ ...GO_AHEAD, spans: [...GO_AHEAD.spans, GO_AHEAD.spans[0]] })).toBe(true);
    expect(refused({ ...GO_AHEAD, spans: [{ ...GO_AHEAD.spans[0], field: 'fields.missing' }] })).toBe(true);
    expect(refused(undefined)).toBe(true);
  });

  it('refuses a fixed tool act the table ties to no tool, whatever guard the record names', () => {
    const record = {
      ask: 'Please {act}.[ {situation}.]',
      act: 'edit a file here',
      spans: [],
      tool: { atom: 'guard.edits', name: 'Edit' },
    };
    expect(constructAsk(record, ATOMS, new Set(['guard.edits']))).toMatchObject({
      refused: expect.stringContaining('does not tie'),
    });
  });
});
