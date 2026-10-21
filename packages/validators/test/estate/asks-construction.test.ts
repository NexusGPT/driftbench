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
  provenance: { quote: 'Sort the inbox every morning before nine.' },
  fields: {
    ask: { text: 'Approving a refill needs the pharmacist.', context: 'When the pharmacist is in' },
    labelSpans: [{ kind: 'governed-action', from: 0, to: 28 }],
    trigger: 'sorting the inbox early',
  },
};
const TWO: MapAtom = {
  id: 'instruction.two',
  kind: 'instruction',
  title: 'Close the berth log at noon',
  fields: { ask: { text: 'Close the berth log at noon' } },
};
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
  spans: [{ slot: 'act', atom: 'instruction.one', field: 'fields.ask.text', from: 0, to: 18 }],
};

function plant(ask: string, askBuild: unknown, askFrom: string, testType = 'obligation') {
  const row = {
    id: `${testType}.one`,
    atomIds: ['instruction.one'],
    testType,
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
            tags: ['ask:code', `test:${testType}`],
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
      spans: [{ slot: 'act', atom: 'instruction.two', field: 'fields.ask.text', from: 0, to: 15 }],
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

// The reviewer's neutral-construction cases (run 39596922050): a fixed row built alone is neutral, and every
// field of a record is consumed.
const OUTSIDE = 'What kinds of things can you help me with? One sentence, and please change nothing.';

describe('a fixed row built alone is neutral; a record holds no field the construction leaves unused', () => {
  it('control: the fixed outside ask, recorded with its row alone and askFrom neutral, holds', async () => {
    plant(OUTSIDE, [{ ask: OUTSIDE, spans: [] }], 'neutral', 'outside_trigger');
    expect(await item()).toMatchObject({ pass: true });
  });

  it('refuses the same record with an unused tool that claims a source atom', async () => {
    const tool = { atom: 'instruction.one', name: 'MadeUp' };
    plant(OUTSIDE, [{ ask: OUTSIDE, spans: [], tool }], 'instruction.one', 'outside_trigger');
    expect((await item())?.pass).toBe(false);
    plant(OUTSIDE, [{ ask: OUTSIDE, spans: [] }], 'instruction.one', 'outside_trigger');
    expect((await item())?.pass).toBe(false);
  });

  it('refuses an unknown field, an act or a situation the row never uses, and a tool on an act with a span', () => {
    const row = new Set(['instruction.one', 'guard.edits']);
    const refused = (record: object) => 'refused' in constructAsk(record, ATOMS, row);
    expect(refused({ ask: OUTSIDE, spans: [] })).toBe(false);
    expect(refused({ ask: OUTSIDE, spans: [], note: 'x' })).toBe(true);
    expect(refused({ ask: OUTSIDE, spans: [], act: '{span}' })).toBe(true);
    expect(refused({ ask: OUTSIDE, spans: [], situation: '{span}' })).toBe(true);
    expect(refused({ ...GO_AHEAD, tool: { atom: 'guard.edits', name: 'Edit' } })).toBe(true);
  });
});

describe('the verbatim source text of an atom gives a span, in the handle-this-for-me row', () => {
  const row = new Set(['instruction.one']);
  it('builds from the quote and from the trigger, and still refuses metadata', () => {
    const handle = (field: string, from: number, to: number) =>
      constructAsk(
        {
          ask: 'Please {act}.[ {situation}.]',
          act: 'handle this for me: {span}',
          spans: [{ slot: 'act', atom: 'instruction.one', field, from, to }],
        },
        ATOMS,
        row,
      );
    expect(handle('provenance.quote', 0, 40)).toEqual({
      text: 'Please handle this for me: Sort the inbox every morning before nine.',
    });
    const early = 'Please handle this for me: sorting the inbox early.';
    expect(handle('fields.trigger', 0, 23)).toEqual({ text: early });
    expect('refused' in handle('provenance.quote', 1, 40)).toBe(true);
    expect('refused' in handle('title', 0, 14)).toBe(true);
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
            { slot: 'act', atom: 'instruction.one', field: 'governed-action', from: 0, to: 14 },
            { slot: 'situation', atom: 'instruction.one', field: 'fields.ask.context', from: 0, to: 25 },
          ],
        },
        ATOMS,
        row,
      ),
    ).toEqual({ text: 'Please Sort the inbox. When the pharmacist is in.' });
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

  // The reviewer's forgeries (run 39594440076): words from metadata, and a slice with no word in it.
  it('refuses a span from a field that declares no act, and a slice of space or punctuation alone', () => {
    const one = GO_AHEAD.spans[0];
    const refused = (span: object) => 'refused' in constructAsk({ ...GO_AHEAD, spans: [span] }, ATOMS, row);
    expect(refused({ ...one, field: 'id', from: 0, to: 15 })).toBe(true);
    expect(refused({ ...one, field: 'kind', from: 0, to: 11 })).toBe(true);
    expect(refused({ ...one, field: 'title', from: 0, to: 14 })).toBe(true);
    expect(refused({ ...one, from: 9, to: 10 })).toBe(true);
    expect(refused({ ...one, from: 39, to: 40 })).toBe(true);
    // A cut of the quote outside the labelled governed action.
    expect(refused({ ...one, field: 'governed-action', from: 29, to: 35 })).toBe(true);
    expect(refused({ ...one, field: 'governed-action', from: 0, to: 14 })).toBe(false);
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
