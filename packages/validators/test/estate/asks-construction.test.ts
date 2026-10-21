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
  situation: 'When the inbox is full',
  provenance: { quote: 'Sort the inbox every morning before nine' },
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
const HAZARD: MapAtom = { id: 'hazard.compaction', kind: 'hazard', title: 'A compaction of the context' };
const ATOMS = new Map([ONE, TWO, GUARD, HAZARD].map((atom) => [atom.id, atom]));

/** The record of "Please handle this for me: Approving a refill.": the act row and the span of ONE. */
const GO_AHEAD = {
  ask: 'Please {act}.[ {situation}.]',
  act: 'handle this for me: {span}',
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
    scanned: { map: { atoms: [ONE, TWO, GUARD, HAZARD] } },
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
    plant('Please handle this for me: Approving a refill.', [GO_AHEAD], 'instruction.one (fields.note)');
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
    plant('Please handle this for me: Approving a refill.', [GO_AHEAD], 'missing-atom.nonexistent');
    expect((await item())?.pass).toBe(false);
  });

  it('refuses the same ask built from an atom outside the row', async () => {
    const elsewhere = {
      ...GO_AHEAD,
      spans: [{ slot: 'act', atom: 'instruction.two', field: 'fields.ask.text', from: 0, to: 15 }],
    };
    plant('Please handle this for me: Close the berth.', [elsewhere], 'instruction.two (title)');
    expect((await item())?.pass).toBe(false);
  });

  it('refuses an ask that differs from its record by one word, and a record that claims a fixed act', async () => {
    plant('Please handle this for me: approving a refill.', [GO_AHEAD], 'instruction.one (fields.note)');
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
    expect(refused({ ...GO_AHEAD, act: 'go ahead with {span}' })).toBe(true);
  });
});

// The hazard's fixed act is the one fixed act the table ties to no tool: its record has no tool, and askFrom
// names the hazard atom (lead ruling). Every other fixed act still needs a guard tool.
describe('a hazard asks its fixed act with no tool, and only a hazard does', () => {
  const RESUME = { ask: 'Please {act}.[ {situation}.]', act: 'go on with the task we were doing', spans: [] };
  const HAZARD_ROW = (askFrom: string, atoms = ['hazard.compaction']) => {
    plant('Please go on with the task we were doing.', [RESUME], askFrom);
    const run = state.run as { plan: { plan: { rows: Array<{ atomIds: string[] }> } } };
    for (const row of run.plan.plan.rows) row.atomIds = atoms;
    type Planted = { spec: { loaded: { spec: { metadata: { estate: { atoms: string[] } } } } } };
    const verdict = (state.verdicts as Planted[])[0];
    if (verdict) verdict.spec.loaded.spec.metadata.estate.atoms = atoms;
  };

  it('control: the hazard fixed act with askFrom naming the hazard atom holds', async () => {
    HAZARD_ROW('hazard.compaction (fields.hazard)');
    expect(await item()).toMatchObject({ pass: true });
  });

  it('refuses the hazard act credited to neutral, on a hazard row and on a row with no hazard', async () => {
    HAZARD_ROW('neutral');
    expect((await item())?.pass).toBe(false);
    HAZARD_ROW('neutral', ['instruction.one']);
    expect((await item())?.pass).toBe(false);
  });

  it('refuses the same record when askFrom names an atom that is no hazard', async () => {
    HAZARD_ROW('instruction.one (title)', ['instruction.one']);
    expect((await item())?.pass).toBe(false);
  });

  it('refuses a fixed tool act with no matching guard tool, whatever askFrom names', async () => {
    const edit = [{ ask: 'Please {act}.[ {situation}.]', act: 'edit a file here', spans: [] }];
    plant('Please edit a file here.', edit, 'guard.edits (matcher)');
    expect((await item())?.pass).toBe(false);
    plant('Please edit a file here.', edit, 'hazard.compaction (fields.hazard)');
    expect((await item())?.pass).toBe(false);
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
    // The quote and the trigger are taken whole, never sliced (lead ruling).
    expect('refused' in handle('provenance.quote', 0, 14)).toBe(true);
    expect('refused' in handle('fields.trigger', 0, 17)).toBe(true);
    // A situation is taken whole too (docs/estate.md section 5).
    expect('refused' in handle('situation', 0, 4)).toBe(true);
    expect(handle('situation', 0, 22)).toEqual({ text: 'Please handle this for me: When the inbox is full.' });
    expect('refused' in handle('title', 0, 14)).toBe(true);
  });
});

describe('constructAsk builds one ask from a record, or refuses it', () => {
  const row = new Set(['instruction.one']);
  it('builds the ask from the rows and the verbatim slice', () => {
    const handled = 'Please handle this for me: Approving a refill.';
    expect(constructAsk(GO_AHEAD, ATOMS, row)).toEqual({ text: handled });
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

  it('builds a fixed tool act for a guard that watches a tool the table ties to it, and refuses any other', () => {
    const guard = new Set(['guard.edits']);
    const record = (name: string, atom = 'guard.edits') => ({
      ask: 'Please {act}.[ {situation}.]',
      act: 'edit a file here',
      spans: [],
      tool: { atom, name },
    });
    expect(constructAsk(record('Edit'), ATOMS, guard)).toEqual({ text: 'Please edit a file here.' });
    expect(constructAsk(record('MadeUp'), ATOMS, guard)).toMatchObject({
      refused: expect.stringContaining('does not tie'),
    });
    // MultiEdit is tied to the act, and the guard does not watch it.
    expect('refused' in constructAsk(record('MultiEdit'), ATOMS, guard)).toBe(true);
    expect('refused' in constructAsk(record('Edit', 'instruction.one'), ATOMS, guard)).toBe(true);
    const { tool: _tool, ...untooled } = record('Edit');
    expect('refused' in constructAsk(untooled, ATOMS, guard)).toBe(true);
  });

  it('fills {tool} from the guard the record names, and {message} from a verbatim slice', () => {
    const guard = new Set(['guard.edits', 'instruction.one']);
    const call = {
      ask: 'Please make one {tool} call in this workspace.',
      spans: [],
      tool: { atom: 'guard.edits', name: 'Write' },
    };
    const one = 'Please make one Write call in this workspace.';
    expect(constructAsk(call, ATOMS, guard)).toEqual({ text: one });
    const bash = { ...call, tool: { atom: 'guard.edits', name: 'Bash' } };
    expect('refused' in constructAsk(bash, ATOMS, guard)).toBe(true);
    const message = {
      ask: '{message}',
      spans: [{ slot: 'ask', atom: 'instruction.one', field: 'fields.ask.text', from: 0, to: 18 }],
    };
    expect(constructAsk(message, ATOMS, guard)).toEqual({ text: 'Approving a refill' });
  });
});

// gen.asks.misroute-names-another, judged by structure (docs/estate.md section 5): a misroute asks the act alone, or an
// approved phrase of a misroute situation that holds the row's target. The review found it read English words.
describe('a misroute is judged by its construction or its situation, never by its words', () => {
  const misroute = async () => (await genAsksFamily().evaluate(1047)).get('gen.asks.misroute-names-another');
  const ACT_ALONE = {
    ask: 'Please {act}.[ {situation}.]',
    act: 'handle this for me: {span}',
    spans: GO_AHEAD.spans,
  };
  const ASKED = 'Please handle this for me: Approving a refill.';
  const FROM = 'instruction.one (fields.ask.text)';
  type Planted = { spec: { loaded: { spec: { metadata: { estate: Record<string, unknown> } } } } };
  const metaOf = () => (state.verdicts as Planted[])[0]?.spec.loaded.spec.metadata.estate ?? {};

  it('control: the act alone, built from the row atom, holds', async () => {
    plant(ASKED, [ACT_ALONE], FROM, 'misroute');
    expect(await misroute()).toMatchObject({ pass: true });
  });

  it('refuses a misroute with a situation, a tool, no record, or a span from outside the row', async () => {
    const withSituation = {
      ...ACT_ALONE,
      situation: '{span}',
      spans: [
        ...ACT_ALONE.spans,
        { slot: 'situation', atom: 'instruction.one', field: 'fields.ask.context', from: 0, to: 25 },
      ],
    };
    for (const record of [
      withSituation,
      { ...ACT_ALONE, tool: { atom: 'guard.edits', name: 'Edit' } },
      { ...ACT_ALONE, spans: [{ ...GO_AHEAD.spans[0], atom: 'instruction.two' }] },
    ]) {
      plant(ASKED, [record], FROM, 'misroute');
      expect((await misroute())?.pass, JSON.stringify(record)).toBe(false);
    }
    plant(ASKED, undefined, FROM, 'misroute');
    expect((await misroute())?.pass).toBe(false);
  });

  it('holds a bank phrase only when an approved misroute situation of the target holds it', async () => {
    const phrase = 'Use the supplier email skill for this.';
    const bank = (use: string, atoms: string[], approved: boolean) => {
      plant(phrase, undefined, 'instruction.one (title)', 'misroute');
      Object.assign(metaOf(), { ask: 'bank' });
      (state.run as { bank: unknown }).bank = {
        situations: [{ id: 's', use, atoms, phrases: [{ text: phrase, approved }] }],
      };
    };
    bank('misroute', ['instruction.one'], true);
    expect(await misroute()).toMatchObject({ pass: true });
    bank('trigger', ['instruction.one'], true);
    expect((await misroute())?.pass).toBe(false);
    bank('misroute', ['instruction.two'], true);
    expect((await misroute())?.pass).toBe(false);
    bank('misroute', ['instruction.one'], false);
    expect((await misroute())?.pass).toBe(false);
  });
});
