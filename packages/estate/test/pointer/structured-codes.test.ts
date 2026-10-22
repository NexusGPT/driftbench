import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, pointer, scanEstate } from '../../src/index';
import { AtomBuilder } from '../../src/scan';
import { estate, NOW } from '../support';
import { BAKERY, load, plantedDense, windowOf } from './support';

// Invented files and sets: a harbour office. Every check here reads a code or a field, never a message text.

describe('the cassette miss names the environment', () => {
  const wire: pointer.Wire = { labeler: 'planted', body: { model: 'm-1', user: 'Lock the door.' } };
  const meta = {
    path: 'hall.md',
    window: 'hall.md#1',
    promptVersion: 'p1',
    schemaVersion: 's1',
    set: 'a',
    setHash: 'h1',
    model: 'm-1',
    cutDigest: 'cd1',
    cls: 'system2',
    run: '1',
  };
  const recorded = () => {
    const cassette = new pointer.Cassette();
    cassette.put(wire, pointer.readableOf(wire, meta), {
      labels: [{ units: '1', label: 'x' }],
      returnedModel: 'm-1',
      stopReason: 'end_turn',
      usage: { input: 1, output: 1 },
    });
    return cassette;
  };
  const missOf = (over: Partial<typeof meta>): pointer.CassetteMiss => {
    try {
      recorded().get(wire, pointer.readableOf(wire, { ...meta, ...over }));
    } catch (cause) {
      if (cause instanceof pointer.CassetteMiss) return cause;
      throw cause;
    }
    throw new Error('the request was answered');
  };

  it('carries the Node and ICU versions when the cut digest differs', () => {
    const miss = missOf({ cutDigest: 'cd2' });
    expect(miss.code).toBe('cassette-miss');
    expect(miss.differs).toContain('cutDigest');
    expect(miss.environment).toEqual({ node: process.versions.node, icu: process.versions.icu ?? '' });
  });

  it('carries no environment when the cut digest is the same', () => {
    const miss = missOf({ model: 'm-2' });
    expect(miss.differs).not.toContain('cutDigest');
    expect(miss.environment).toBeUndefined();
  });
});

describe('malformed set and label names', () => {
  const label = (name: string, extra = '') =>
    `      - name: ${name}\n        description: A unit named ${name}.\n${extra}`;
  const set = (name: string, labels: string) =>
    `  - set: ${name}\n    description: A set.\n    labels:\n${labels}`;
  const cases: Array<[string, string, Record<string, string>]> = [
    [
      'a set declared twice',
      `labels:\n${set('dup', label('a'))}${set('dup', label('b'))}`,
      { code: 'set-duplicate', reason: 'duplicate', set: 'dup' },
    ],
    [
      'the reserved label none',
      `labels:\n${set('s1', label('none'))}`,
      { code: 'label-name-reserved', reason: 'reserved', set: 's1', label: 'none' },
    ],
    [
      'a label declared twice',
      `labels:\n${set('s2', label('twice') + label('twice'))}`,
      { code: 'label-duplicate', reason: 'duplicate', set: 's2', label: 'twice' },
    ],
    [
      'a label name with a space',
      `labels:\n${set('s3', label('bad name'))}`,
      { code: 'label-name-invalid', reason: 'not-an-identifier', set: 's3', label: 'bad name' },
    ],
    [
      'a target that is not required',
      `labels:\n${set('s4', label('odd', '        target: optional\n'))}`,
      { code: 'label-target-invalid', reason: 'target-is-required-only', set: 's4', label: 'odd' },
    ],
    [
      'a set name with a capital',
      `labels:\n${set('Bad', label('a'))}`,
      { code: 'set-name-invalid', reason: 'not-an-identifier', set: 'Bad' },
    ],
    [
      'more than three examples',
      `labels:\n${set(
        'many',
        label(
          'voice',
          '        examples: ["one is here.", "two is here.", "three is here.", "four is here."]\n',
        ),
      )}`,
      { code: 'label-examples-too-many', reason: 'more-than-three-examples', set: 'many', label: 'voice' },
    ],
  ];

  it.each(cases)('%s gives a code, the offending name and a reason', (_name, yaml, want) => {
    const read = pointer.parseLabelSetsDetailed(yaml);
    expect(read.ok).toBe(false);
    expect(read).toMatchObject(want);
  });

  it.each(cases)('%s leaves the text-only result as it was', (_name, yaml) => {
    const detailed = pointer.parseLabelSetsDetailed(yaml);
    const plain = pointer.parseLabelSets(yaml);
    expect(detailed.ok).toBe(false);
    expect(plain).toEqual({ ok: false, message: detailed.ok ? '' : detailed.message });
  });

  it('gives a code to the nesting and declaration refusals as well', () => {
    const base = (spans: string, labels: string) =>
      `labels:\n  - set: s\n    description: A set.\n    spans:\n${spans}    labels:\n${labels}`;
    const kinds = '      - { name: act, description: the act }\n';
    const rule = '      - { name: rule, description: A rule., spans: [act] }\n';
    const undeclared = pointer.parseLabelSetsDetailed(base(kinds, rule.replace('[act]', '[nosuch]')));
    expect(undeclared).toMatchObject({
      ok: false,
      code: 'label-span-kind-undeclared',
      set: 's',
      label: 'rule',
      kind: 'nosuch',
    });
    const itself = pointer.parseLabelSetsDetailed(
      base('      - { name: act, description: the act, within: act }\n', rule),
    );
    expect(itself).toMatchObject({ ok: false, code: 'span-kind-within-itself', set: 's', kind: 'act' });
    const twice = pointer.parseLabelSetsDetailed(base(kinds + kinds, rule));
    expect(twice).toMatchObject({ ok: false, code: 'span-kind-duplicate', set: 's', kind: 'act' });
    expect(pointer.parseLabelSetsDetailed('labels: [')).toMatchObject({
      ok: false,
      code: 'label-file-not-yaml',
    });
  });
});

describe('a set a system 1 labeler cannot serve', () => {
  const [bake] = load(BAKERY) as [pointer.LabelSet];
  const gated = load(
    `${BAKERY}      - name: gate-line\n        description: A unit that sets one act before another.\n        target: required\n`,
  )[0] as pointer.LabelSet;

  it('carries a code and the set on the error a scan throws', async () => {
    const labeler = pointer.createJevLabeler({ env: {}, replayOnly: true });
    await expect(
      pointer.pointerScan({
        files: [{ path: 'notes.md', text: 'Welcome every customer with a smile.\n' }],
        sets: [gated],
        labelling: pointer.singleLabelling(labeler),
        cassette: new pointer.Cassette(),
        mode: 'replay',
      }),
    ).rejects.toMatchObject({ code: 'set-needs-system2', set: 'counter-voice' });
  });

  it('carries the code and the set on the error that asks for a system 2 labeler', () => {
    const failure = (() => {
      try {
        pointer.askedLabels(gated, false);
      } catch (cause) {
        return cause;
      }
      return undefined;
    })();
    expect(failure).toBeInstanceOf(pointer.LabelerConfigError);
    expect(failure).toMatchObject({ code: 'set-needs-system2', set: 'counter-voice' });
    expect(pointer.askedLabels(bake, false)).toHaveLength(3);
  });

  it('gives the failed build of a labelling a code, and leaves the text-only result alone', async () => {
    const options = { env: {}, record: false, cwd: '.' };
    const detailed = await pointer.buildLabellingDetailed([], options);
    expect(detailed).toMatchObject({ ok: false, code: 'labeler-count' });
    expect(await pointer.buildLabelling([], options)).toEqual({
      ok: false,
      message: detailed.ok ? '' : detailed.message,
    });
  });
});

describe('check mode names the changed files', () => {
  const SETS = load(
    'labels:\n  - set: duty\n    description: What the notes ask.\n    labels:\n      - name: order\n        description: A unit that asks.\n',
  );
  const files = (quay: string) => [
    { path: 'quay.md', text: quay },
    { path: 'office.md', text: 'The office opens at nine.\n' },
  ];
  const everything = plantedDense((window) => [{ units: `1-${window.units.length}`, label: 'order' }]);
  const scan = (quay: string, previous?: pointer.Ledger) =>
    pointer.pointerScan({
      files: files(quay),
      sets: SETS,
      labelling: pointer.singleLabelling(everything),
      cassette: new pointer.Cassette(),
      mode: 'record',
      ...(previous ? { previous } : {}),
    });

  it('passes on a fresh ledger and lists the paths of a stale one', async () => {
    const first = await scan('Coil the ropes on the red post.\n');
    const text = pointer.renderLedger(first.ledger);
    expect(pointer.checkLedger(text, first.ledger)).toEqual({ ok: true });
    const second = await scan('Hang the lamp before dusk.\n', first.ledger);
    const stale = pointer.checkLedger(text, second.ledger);
    expect(stale).toMatchObject({ ok: false, code: 'ledger-out-of-date', files: ['quay.md'] });
    expect(stale.ok ? [] : stale.files).toEqual(['quay.md']);
  });

  it('lists every path when there is no ledger file to check against', async () => {
    const first = await scan('Coil the ropes on the red post.\n');
    const none = pointer.checkLedger(undefined, first.ledger);
    expect(none).toMatchObject({ ok: false, code: 'ledger-out-of-date', files: ['office.md', 'quay.md'] });
  });
});

describe('a choice answer that is no vector', () => {
  const [bake] = load(BAKERY) as [pointer.LabelSet];
  const vector = (n: number, values: Record<string, number>) =>
    Object.fromEntries(Object.entries(values).map(([name, p]) => [pointer.choiceKey(n, name), p]));

  it('gives the refusal a code, the window, the unit and the sum', () => {
    const answer = {
      probabilities: {
        ...vector(1, { greeting: 0.5, 'price-claim': 0.5, 'allergen-line': 0.5, none: 0.5 }),
        ...vector(2, { greeting: 0.7, 'price-claim': 0.1, 'allergen-line': 0.1, none: 0.1 }),
      },
      returnedModel: 'm',
      stopReason: 'answered',
      usage: { input: 0, output: 0 },
    };
    const opinions = pointer.choiceOpinions(answer, windowOf(2), pointer.askedLabels(bake, false));
    expect(opinions.refusalRecords).toEqual([
      {
        code: 'no-vector',
        detail: opinions.refusals[0],
        window: 'notes.md#1',
        unit: '1',
        sum: 2,
      },
    ]);
  });

  it('reaches the result of a scan, one record for each text', async () => {
    const choice: pointer.Labeler = {
      id: 'planted-choice',
      cls: 'system1',
      family: 'planted',
      model: 'planted-c1',
      settings: { question: 'choice' },
      maxUnits: (_set, wanted) => wanted,
      render: (set, window) => ({
        labeler: 'planted-choice',
        body: { set: set.set, window: window.id, units: window.units.map((unit) => unit.text) },
      }),
      opinions: (answer, set, window) =>
        pointer.choiceOpinions(answer, window, pointer.askedLabels(set, true)),
      async call(_wire, set, window) {
        const probabilities: Record<string, number> = {};
        for (const unit of window.units) {
          const row =
            unit.n === 1
              ? { greeting: 0.5, 'price-claim': 0.5, 'allergen-line': 0.5, none: 0.5 }
              : { none: 1 };
          for (const name of [...pointer.askedLabels(set, true).map((entry) => entry.name), 'none']) {
            probabilities[pointer.choiceKey(unit.n, name)] = (row as Record<string, number>)[name] ?? 0;
          }
        }
        return {
          probabilities,
          returnedModel: 'planted-c1',
          stopReason: 'answered',
          usage: { input: 1, output: 0 },
        };
      },
    };
    const result = await pointer.pointerScan({
      files: [{ path: 'notes.md', text: 'Welcome every customer.\n\nA loaf costs two coins.\n' }],
      sets: [bake],
      labelling: pointer.singleLabelling(choice),
      cassette: new pointer.Cassette(),
      mode: 'record',
    });
    expect(result.refusals).toHaveLength(1);
    expect(result.refusalRecords).toHaveLength(1);
    expect(result.refusalRecords[0]).toMatchObject({
      code: 'no-vector',
      detail: result.refusals[0],
      unit: '1',
      sum: 2,
    });
  });
});

describe('the answer of a labeler', () => {
  const SPANNED = `labels:
  - set: gates
    description: A set for the codes.
    spans:
      - { name: act, description: the clause that says what the reader does }
      - { name: part, description: a part of the act, within: act }
    links:
      - { name: tool, description: the tool the unit asks for, values: [alpha, beta] }
      - { name: topic, description: the skill the unit is about, to: [skill] }
    labels:
      - name: order
        description: A unit that tells the reader what to do.
        spans: [act, part]
        links: [tool, topic]
        atom: { kind: instruction, polarity: obligation }
      - name: pair
        description: A unit that sets one act before another.
        target: required
      - name: remark
        description: A unit that only says how things are.
`;
  const [set] = load(SPANNED) as [pointer.LabelSet];
  const window: pointer.Window = {
    id: 'notes.md#1',
    path: 'notes.md',
    headingPath: [],
    units: [
      { n: 1, text: 'Move the red crate to the quay, then return the red crate.', index: 0 },
      { n: 2, text: 'Tie the bow line first.', index: 1 },
      { n: 3, text: 'Count the boats twice.', index: 2 },
    ],
  };
  const check = (entries: pointer.Labelled[], context: pointer.LabelContext = {}) =>
    pointer.checkAnswer(set, window, entries, context);

  it('gives a refused unit range its code and the range as written', () => {
    const past = check([{ units: '2-5', label: 'remark' }]);
    expect(past.refusalRecords).toEqual([
      expect.objectContaining({
        code: 'units-leave-window',
        units: '2-5',
        window: 'notes.md#1',
        set: 'gates',
        detail: past.refusals[0],
      }),
    ]);
    const malformed = check([{ units: 'two', label: 'remark' }]);
    expect(malformed.refusalRecords[0]).toMatchObject({ code: 'units-malformed', units: 'two' });
    const twice = check([
      { units: '1-2', label: 'remark' },
      { units: '2', label: 'remark' },
    ]);
    expect(twice.refusalRecords[0]).toMatchObject({ code: 'units-already-labelled', units: '2' });
  });

  it('gives a label that needs a target its code, the label and the units', () => {
    const none = check([{ units: '1', label: 'pair' }]);
    expect(none.accepted.size).toBe(0);
    expect(none.refusalRecords).toEqual([
      expect.objectContaining({
        code: 'target-required',
        label: 'pair',
        units: '1',
        detail: none.refusals[0],
      }),
    ]);
    expect(check([{ units: '1', label: 'remark', target: 2 }]).refusalRecords[0]).toMatchObject({
      code: 'target-not-taken',
      label: 'remark',
      target: '2',
    });
    expect(check([{ units: '1', label: 'nosuch' }]).refusalRecords[0]).toMatchObject({
      code: 'label-not-in-set',
      label: 'nosuch',
    });
  });

  it('gives a dropped span its code, the unit, the kind and the clause', () => {
    const text = (words: string) =>
      check([{ units: '1', label: 'order', spans: [{ kind: 'act', text: words }] }]);
    expect(text('the red crate').droppedRecords[0]).toMatchObject({
      code: 'span-text-repeated',
      unit: '1',
      kind: 'act',
      span: 'the red crate',
      label: 'order',
      window: 'notes.md#1',
    });
    expect(text('a green barrel').droppedRecords[0]).toMatchObject({
      code: 'span-text-absent',
      unit: '1',
      kind: 'act',
      span: 'a green barrel',
    });
    const overlap = check([
      {
        units: '1',
        label: 'order',
        spans: [
          { kind: 'act', from: 0, to: 20 },
          { kind: 'act', from: 10, to: 30 },
        ],
      },
    ]);
    expect(overlap.droppedRecords).toEqual([
      expect.objectContaining({ code: 'span-overlap', unit: '1', kind: 'act', span: '10-30' }),
    ]);
    const outside = check([{ units: '1', label: 'order', spans: [{ kind: 'part', from: 0, to: 4 }] }]);
    expect(outside.droppedRecords).toEqual([
      expect.objectContaining({ code: 'span-outside-parent', unit: '1', kind: 'part', parent: 'act' }),
    ]);
    const leaves = check([{ units: '1', label: 'order', spans: [{ kind: 'act', from: 0, to: 500 }] }]);
    expect(leaves.droppedRecords[0]).toMatchObject({ code: 'span-offsets-invalid', kind: 'act' });
    const relabelled = check([{ units: '1', label: 'order', spans: [{ kind: 'nosuch', from: 0, to: 4 }] }]);
    expect(relabelled.droppedRecords[0]).toMatchObject({ code: 'span-kind-not-allowed', kind: 'nosuch' });
    for (const item of [
      ...text('the red crate').droppedRecords,
      ...overlap.droppedRecords,
      ...outside.droppedRecords,
    ]) {
      expect(item.detail.startsWith('notes.md#1: ')).toBe(true);
    }
  });

  it('gives a dropped link its code, the kind and the target', () => {
    const repeated = check(
      [
        {
          units: '2',
          label: 'order',
          links: [
            { kind: 'tool', to: 'alpha' },
            { kind: 'tool', to: 'beta' },
          ],
        },
      ],
      {
        candidates: {
          tool: [
            { id: 'alpha', label: 'alpha' },
            { id: 'beta', label: 'beta' },
          ],
        },
      },
    );
    expect(repeated.droppedRecords).toEqual([
      expect.objectContaining({ code: 'link-kind-repeated', kind: 'tool', target: 'beta' }),
    ]);
    const unlisted = check(
      [{ units: '2', label: 'order', links: [{ kind: 'topic', to: 'skill.nothing' }] }],
      { candidates: { topic: [{ id: 'skill.moorings', label: 'moorings' }] } },
    );
    expect(unlisted.droppedRecords).toEqual([
      expect.objectContaining({ code: 'link-target-unlisted', kind: 'topic', target: 'skill.nothing' }),
    ]);
    const notAllowed = check([{ units: '2', label: 'remark', links: [{ kind: 'tool', to: 'alpha' }] }]);
    expect(notAllowed.droppedRecords[0]).toMatchObject({ code: 'label-carries-no-links', label: 'remark' });
  });

  it('gives a malformed spans list a refusal code', () => {
    const empty = check([{ units: '1', label: 'order', spans: [] }]);
    expect(empty.refusalRecords[0]).toMatchObject({ code: 'spans-malformed', label: 'order' });
  });

  it('reaches the result of a scan beside each text, in the same order', async () => {
    const labeler = plantedDense((win) =>
      win.units.map((unit) =>
        unit.n === 1
          ? { units: '1', label: 'order', spans: [{ kind: 'act', text: 'nothing like it' }] }
          : { units: String(unit.n), label: 'pair' },
      ),
    );
    const result = await pointer.pointerScan({
      files: [{ path: 'notes.md', text: 'Move the crate.\n\nTie the bow line.\n' }],
      sets: [set],
      labelling: pointer.singleLabelling(labeler),
      cassette: new pointer.Cassette(),
      mode: 'record',
    });
    expect(result.refusals).toHaveLength(1);
    expect(result.refusalRecords.map((item) => item.detail)).toEqual(result.refusals);
    expect(result.refusalRecords[0]).toMatchObject({ code: 'target-required', label: 'pair' });
    expect(result.dropped).toHaveLength(1);
    expect(result.droppedRecords.map((item) => item.detail)).toEqual(result.dropped);
    expect(result.droppedRecords[0]).toMatchObject({ code: 'span-text-absent', kind: 'act' });
  });

  it('gives a window that could not be read its code, on a recording and on a replay', async () => {
    const files = [{ path: 'notes.md', text: 'Move the crate.\n\nTie the bow line.\n' }];
    const cassette = new pointer.Cassette();
    const failing = plantedDense(() => [], [], {
      fail: () => new pointer.LabelerError('the answer is not JSON', { code: 'answer-not-json' }),
    });
    const recording = await pointer.pointerScan({
      files,
      sets: [set],
      labelling: pointer.singleLabelling(failing),
      cassette,
      mode: 'record',
    });
    expect(recording.failed.length).toBeGreaterThan(0);
    expect(recording.failedRecords.map((item) => item.detail)).toEqual(recording.failed);
    expect(recording.failedRecords[0]).toMatchObject({
      code: 'answer-not-json',
      window: 'notes.md#1',
      set: 'gates',
      labeler: 'planted',
    });
    const replay = await pointer.pointerScan({
      files,
      sets: [set],
      labelling: pointer.singleLabelling({ ...failing, call: undefined }),
      cassette: pointer.Cassette.parse(cassette.render()),
      mode: 'replay',
    });
    expect(replay.failedRecords.map((item) => item.code)).toEqual(
      recording.failedRecords.map((item) => item.code),
    );
    const other = await pointer.pointerScan({
      files,
      sets: [set],
      labelling: pointer.singleLabelling(
        plantedDense(() => [], [], {
          fail: () => new pointer.LabelerError('the answer has no labels list', { code: 'answer-no-labels' }),
        }),
      ),
      cassette: new pointer.Cassette(),
      mode: 'record',
    });
    expect(other.failedRecords[0]).toMatchObject({ code: 'answer-no-labels' });
  });

  const FILES = [{ path: 'notes.md', text: 'Move the crate.\n\nTie the bow line.\n' }];
  const scanWith = (error: Error, cassette: pointer.Cassette, mode: 'record' | 'replay') =>
    pointer.pointerScan({
      files: FILES,
      sets: [set],
      labelling: pointer.singleLabelling(plantedDense(() => [], [], { fail: () => error })),
      cassette,
      mode,
    });

  it('records the code of the error, and reads an entry with no code as unknown', async () => {
    const coded = new pointer.Cassette();
    const error = new pointer.LabelerError('a reason', { code: 'answer-not-json' });
    await scanWith(error, coded, 'record');
    const answers = [...coded.entries.values()].map((entry) => entry.answer);
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) {
      expect(answer).toMatchObject({ refused: 'unreadable', code: 'answer-not-json' });
    }
    const old = pointer.Cassette.parse(coded.render());
    for (const entry of old.entries.values()) delete entry.answer.code;
    const replay = await scanWith(new Error('never called'), old, 'replay');
    expect(replay.failed.length).toBeGreaterThan(0);
    expect(replay.failed.every((text) => text.endsWith('a reason'))).toBe(true);
    expect(replay.failedRecords.map((item) => item.code)).toEqual(replay.failed.map(() => 'unknown'));
  });

  it('gives an error raised with no code the one explicit code unknown', async () => {
    const bare = new pointer.LabelerError('the answer is not JSON');
    expect(bare.code).toBe(pointer.UNKNOWN_CODE);
    expect(pointer.UNKNOWN_CODE).toBe('unknown');
    const result = await scanWith(bare, new pointer.Cassette(), 'record');
    expect(result.failed.length).toBeGreaterThan(0);
    expect(result.failedRecords.map((item) => item.code)).toEqual(result.failed.map(() => 'unknown'));
  });

  it('sets the code of each unreadable answer where the answer is read', () => {
    const thrown = (run: () => unknown): string => {
      try {
        run();
      } catch (cause) {
        return cause instanceof pointer.LabelerError ? cause.code : 'not a labeler error';
      }
      return 'no error';
    };
    const dense = (text: string, expected: { window?: string; set?: string } = {}) =>
      thrown(() => pointer.parseDenseAnswer(text, expected));
    expect(dense('Sure! Here you go')).toBe('answer-not-json');
    expect(dense('{"window":"w#2","labels":[]}', { window: 'w#1' })).toBe('answer-window-mismatch');
    expect(dense('{"set":"b","labels":[]}', { set: 'a' })).toBe('answer-set-mismatch');
    expect(dense('{"note":"no list"}')).toBe('answer-no-labels');
    expect(dense('{"labels":[{"label":"x"}]}')).toBe('answer-entry-malformed');
    const user = (cls: 'system1' | 'system2', payload: unknown): string =>
      thrown(() => pointer.userAnswer(cls, payload, 'm'));
    expect(user('system2', 'text')).toBe('answer-not-object');
    expect(user('system1', { labels: [] })).toBe('answer-no-probabilities');
  });

  it('reads the code of an unlocated span from the field, never from its text', () => {
    const unlocated = 'the text is not in the unit';
    const span = (extra: Record<string, unknown>) =>
      check([
        { units: '1', label: 'order', spans: [{ kind: 'act', from: -1, to: -1, unlocated, ...extra }] },
      ]).droppedRecords[0];
    expect(span({ unlocatedCode: 'span-text-repeated' })).toMatchObject({ code: 'span-text-repeated' });
    expect(span({ unlocatedCode: 'span-text-absent' })).toMatchObject({ code: 'span-text-absent' });
    expect(span({})).toMatchObject({ code: 'unknown', kind: 'act' });
  });
});

describe('the atoms of a scan', () => {
  const FILES = {
    'CLAUDE.md': [
      '# Harbour office',
      '',
      'Hang the lamp before dusk',
      '',
      'Only when the fog comes in',
      '',
      'Never leave the gate open',
      '',
    ].join('\n'),
  };
  const SET = `labels:
  - set: duty
    description: What the harbour notes ask of a reader.
    spans:
      - { name: act, description: the clause that says what the reader does }
    labels:
      - name: order
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: spoken
        description: A unit whose atom needs the act clause.
        spans: [act]
        atom: { kind: instruction, polarity: obligation, situation: $span.act }
      - name: locator
        description: A unit that locates a file.
        atom: { kind: reference, locate: true }
      - name: weather
        description: A unit that only describes the sea.
        atom: { kind: tool }
      - name: remark
        description: A unit that states how things are.
      - name: when
        description: A unit that states when another unit applies.
        target: required
        condition: true
`;
  const scan = async (rows: pointer.Labelled[]) => {
    const root = await estate(FILES);
    const parsed = pointer.parseLabelSets(SET);
    if (!parsed.ok) throw new Error(parsed.message);
    const labeler = plantedDense((window) =>
      window.path === 'CLAUDE.md' ? rows : [{ units: `1-${window.units.length}`, label: 'none' }],
    );
    return scanEstate({
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
  };

  // Units of CLAUDE.md: 1 heading, 2 lamp, 3 fog, 4 gate.
  it('gives an unbuildable atom kind its code and the kind', async () => {
    const { pointer: done } = await scan([{ units: '2', label: 'weather' }]);
    expect(done?.atomRefusalRecords).toEqual([
      expect.objectContaining({
        code: 'atom-kind-unbuildable',
        kind: 'tool',
        label: 'weather',
        set: 'duty',
        path: 'CLAUDE.md',
        unit: expect.any(String),
        detail: done?.atomRefusals[0],
      }),
    ]);
  });

  it('gives a condition whose target holds no atom its code, the unit and the target', async () => {
    const { pointer: done } = await scan([
      { units: '2', label: 'remark' },
      { units: '3', label: 'when', target: 2 },
    ]);
    const entries = done?.ledger.entries ?? [];
    const condition = entries.find((entry) => entry.quote === 'Only when the fog comes in');
    const target = entries.find((entry) => entry.quote === 'Hang the lamp before dusk');
    expect(done?.atomRefusalRecords).toEqual([
      expect.objectContaining({
        code: 'condition-unattached',
        unit: condition?.id,
        target: target?.id,
        label: 'when',
      }),
    ]);
  });

  it('gives an unfilled template its code and the unit', async () => {
    const { pointer: done } = await scan([{ units: '2', label: 'spoken' }]);
    const lamp = done?.ledger.entries.find((entry) => entry.quote === 'Hang the lamp before dusk');
    expect(done?.atomRefusalRecords).toEqual([
      expect.objectContaining({ code: 'template-unfilled', unit: lamp?.id, label: 'spoken', set: 'duty' }),
    ]);
  });

  it('gives a locate with no file named its code and the unit', async () => {
    const { pointer: done } = await scan([{ units: '2', label: 'locator' }]);
    const lamp = done?.ledger.entries.find((entry) => entry.quote === 'Hang the lamp before dusk');
    expect(done?.atomRefusalRecords).toEqual([
      expect.objectContaining({ code: 'file-not-named', unit: lamp?.id, label: 'locator' }),
    ]);
  });

  it('gives a repeated atom its code, the second unit and the atom it repeats', () => {
    const text = FILES['CLAUDE.md'];
    const builder = new AtomBuilder(
      new Map([['CLAUDE.md', { path: 'CLAUDE.md', kind: 'standing' as const, text }]]),
    );
    const quote = 'Hang the lamp before dusk';
    const first = builder.add({
      kind: 'instruction',
      title: 'Lamp',
      at: { file: 'CLAUDE.md', startLine: 3, endLine: 3, quote },
      evidence: [{ type: 'text', must: ['lamp'], mustNot: [] }],
    });
    const unit = pointer.cut(text).units.find((candidate) => candidate.text === quote);
    if (!unit) throw new Error('the unit is missing');
    const [set] = load(SET) as [pointer.LabelSet];
    const made = pointer.pointerAtoms(
      [{ path: 'CLAUDE.md', index: 0, unit, id: 'abcdefghij', set, label: 'order', source: 'cassette:x' }],
      new Map([['CLAUDE.md', text]]),
      builder,
      'planted',
    );
    expect(made.duplicateRecords).toEqual([
      {
        code: 'atom-duplicate',
        detail: made.duplicates[0],
        unit: 'abcdefghij',
        set: 'duty',
        label: 'order',
        path: 'CLAUDE.md',
        repeats: first.id,
      },
    ]);
  });

  it('gives a span that is no exact slice its code, the kind and the offsets', () => {
    const text = FILES['CLAUDE.md'];
    const builder = new AtomBuilder(
      new Map([['CLAUDE.md', { path: 'CLAUDE.md', kind: 'standing' as const, text }]]),
    );
    const unit = pointer.cut(text).units.find((candidate) => candidate.text === 'Hang the lamp before dusk');
    if (!unit) throw new Error('the unit is missing');
    const [set] = load(SET) as [pointer.LabelSet];
    const made = pointer.pointerAtoms(
      [
        {
          path: 'CLAUDE.md',
          index: 0,
          unit,
          id: 'abcdefghij',
          set,
          label: 'order',
          spans: [{ kind: 'act', from: 3, to: 3 }],
          source: 'cassette:x',
        },
      ],
      new Map([['CLAUDE.md', text]]),
      builder,
      'planted',
    );
    expect(made.refusalRecords).toEqual([
      expect.objectContaining({ code: 'span-not-exact-slice', kind: 'act', span: '3-3', unit: 'abcdefghij' }),
    ]);
  });
});

describe('the settings file', () => {
  const read = (text: string) => pointer.parsePointerSettingsDetailed(JSON.parse(text));

  it('gives a threshold outside 0 to 1 a code, the key and the reason', () => {
    const out = read('{ "threshold": { "pass_at": 1.5, "fail_at": -0.1 } }');
    expect(out.ok).toBe(false);
    expect(out.ok ? [] : out.issues).toEqual([
      { code: 'threshold-out-of-range', key: 'pass_at', reason: 'out-of-range' },
      { code: 'threshold-out-of-range', key: 'fail_at', reason: 'out-of-range' },
    ]);
  });

  it('gives a not-a-number threshold its own code and a wrong type another', () => {
    const nan = pointer.parsePointerSettingsDetailed({ threshold: { margin_cut: Number.NaN } });
    expect(nan.ok ? [] : nan.issues).toEqual([
      { code: 'threshold-not-finite', key: 'margin_cut', reason: 'not-finite' },
    ]);
    const text = pointer.parsePointerSettingsDetailed({ threshold: { labeler: 'high' } });
    expect(text.ok ? [] : text.issues).toEqual([
      { code: 'threshold-not-a-number', key: 'labeler', reason: 'not-a-number' },
    ]);
  });

  it('gives a key that is no threshold a code and the key as written', () => {
    const out = pointer.parsePointerSettingsDetailed({ threshold: { pass: 0.8 } });
    expect(out.ok ? [] : out.issues).toEqual([
      { code: 'threshold-unknown-key', key: 'pass', reason: 'not-a-threshold' },
    ]);
  });

  it('lists one issue for each error text, in the same order, and leaves the text-only result alone', () => {
    const value = { labels: [], labeler: 'system3:x', threshold: { pass: 0.8, fail_at: 2 }, ledger: 4 };
    const detailed = pointer.parsePointerSettingsDetailed(value);
    const plain = pointer.parsePointerSettings(value);
    expect(detailed.ok).toBe(false);
    expect(plain).toEqual({ ok: false, errors: detailed.ok ? [] : detailed.errors });
    expect(detailed.ok ? [] : detailed.issues.map((issue) => issue.key)).toEqual([
      'labels',
      'labeler',
      'pass',
      'fail_at',
      'ledger',
    ]);
    expect(detailed.ok ? 0 : detailed.issues.length).toBe(detailed.ok ? 0 : detailed.errors.length);
  });
});
