import { describe, expect, it } from 'vitest';
import {
  Cassette,
  checkAnswer,
  createAnthropicLabeler,
  type Labelled,
  type LabelSet,
  offsetSpans,
  pointerAtoms,
  pointerScan,
  singleLabelling,
  type Window,
} from '../../src/pointer';
import { AtomBuilder } from '../../src/scan';
import { load, plantedDense } from './support';

// Invented files and sets: a harbour office. Where a comment is masked and an answer is dropped, the drop
// keeps its code and its fields, and the comment never leaves. Every check reads a code or a field, never a
// message text.

const SPANNED = `labels:
  - set: gates
    description: A set for the codes.
    spans:
      - { name: act, description: the clause that says what the reader does }
    links:
      - { name: topic, description: the skill the unit is about, to: [skill] }
    labels:
      - name: order
        description: A unit that tells the reader what to do.
        spans: [act]
        links: [topic]
`;
const [SET] = load(SPANNED) as [LabelSet];

const windowOf = (...texts: string[]): Window => ({
  id: 'quay.md#1',
  path: 'quay.md',
  headingPath: [],
  units: texts.map((text, index) => ({ n: index + 1, text, index })),
});

describe('a link to a candidate listed by a hash', () => {
  const window = windowOf('Moor the skiff.', 'Lock the shed.');
  const context = {
    candidates: {
      topic: [
        { id: 'skill.moorings', label: 'Moor (comment) here', shown: 'atom-1a2b3c4d5e' },
        { id: 'skill.sheds', label: 'Sheds' },
      ],
    },
  };
  const linked = (to: string) =>
    checkAnswer(SET, window, [{ units: '1', label: 'order', links: [{ kind: 'topic', to }] }], context);

  it('resolves the hash the labeler echoes to the real atom, with nothing dropped', () => {
    const read = linked('atom-1a2b3c4d5e');
    expect(read.accepted.get(1)?.links).toEqual([{ kind: 'topic', to: 'skill.moorings' }]);
    expect(read.dropped).toEqual([]);
    expect(read.droppedRecords).toEqual([]);
    expect(linked('skill.sheds').accepted.get(1)?.links).toEqual([{ kind: 'topic', to: 'skill.sheds' }]);
  });

  it('drops an unlisted hash with the code link-target-unlisted and its fields', () => {
    const read = linked('atom-0000000000');
    expect(read.accepted.get(1)?.links).toBeUndefined();
    expect(read.droppedRecords).toEqual([
      expect.objectContaining({
        code: 'link-target-unlisted',
        units: '1',
        kind: 'topic',
        target: 'atom-0000000000',
        label: 'order',
        window: 'quay.md#1',
        detail: read.dropped[0],
      }),
    ]);
  });

  it('drops the real id of a candidate the request listed by its hash, with the same code', () => {
    const read = linked('skill.moorings');
    expect(read.accepted.get(1)?.links).toBeUndefined();
    expect(read.droppedRecords).toEqual([
      expect.objectContaining({ code: 'link-target-unlisted', kind: 'topic', target: 'skill.moorings' }),
    ]);
  });
});

describe('a span in a unit that holds a comment', () => {
  // Raw, `the gate` sits twice in the unit (once inside the comment); masked, it sits once, after it.
  const UNIT = 'Shut <!-- the gate is ZZSECRETSPANZZ --> the gate before dusk, then the lamp and the lamp.';
  const window = windowOf(UNIT);
  const real = UNIT.indexOf('the gate before');
  const spanned = (text: string): Labelled[] => [
    { units: '1', label: 'order', spans: [{ kind: 'act', text }] },
  ];

  const asWords = (text: string) => checkAnswer(SET, window, spanned(text));
  const asOffsets = (text: string) => checkAnswer(SET, window, offsetSpans(spanned(text), window));
  for (const [how, read] of [
    ['as words', asWords],
    ['as offsets', asOffsets],
  ] as const) {
    it(`locates the text in the masked unit and maps it back to the real offsets (${how})`, () => {
      const found = read('the gate');
      expect(found.droppedRecords).toEqual([]);
      const to = real + 'the gate'.length;
      expect(found.accepted.get(1)?.spans).toEqual([{ kind: 'act', from: real, to }]);
      expect(UNIT.slice(real, to)).toBe('the gate');
    });

    it(`drops a missing text as span-text-absent, a repeated one as span-text-repeated (${how})`, () => {
      expect(read('a green barrel').droppedRecords).toEqual([
        expect.objectContaining({ code: 'span-text-absent', unit: '1', kind: 'act', window: 'quay.md#1' }),
      ]);
      // The words of the comment are not in the text the labeler was shown.
      expect(read('ZZSECRETSPANZZ').droppedRecords).toEqual([
        expect.objectContaining({ code: 'span-text-absent', unit: '1', kind: 'act' }),
      ]);
      expect(read('the lamp').droppedRecords).toEqual([
        expect.objectContaining({ code: 'span-text-repeated', unit: '1', kind: 'act' }),
      ]);
    });
  }
});

describe('a scan that drops a link with its code sends no comment', () => {
  const HELPERS = load(`labels:
  - set: helpers
    description: Units that hand work to a helper.
    links:
      - name: dispatches
        description: The helper agent the unit hands work to.
        to: [subagent]
    labels:
      - name: dispatch
        description: A unit that hands work to a helper.
        links: [dispatches]
`);
  const MAKER = load(`labels:
  - set: maker
    description: Every unit becomes an atom.
    labels:
      - name: item
        description: A unit.
        atom: { kind: instruction }
`);
  const token = 'ZZSECRETCODESZZ';
  const body = `${token} "quoted" a/b\\c`;
  const needles = [
    token,
    token.toLowerCase(),
    body,
    JSON.stringify(body).slice(1, -1),
    encodeURIComponent(body),
    encodeURIComponent(token),
  ];
  const QUAY = `Hang the lamp <!-- ${body} --> before dusk.\n\nLock the shed.\n\nCall the pilot.\n`;
  const FILES = [{ path: 'quay.md', text: QUAY }];
  const UNLISTED = 'atom-0000000000';

  async function atomsOf() {
    const labeler = plantedDense((window) =>
      window.units.map((unit) => ({ units: String(unit.n), label: 'item' })),
    );
    const made = await pointerScan({
      files: FILES,
      sets: MAKER,
      labelling: singleLabelling(labeler),
      cassette: new Cassette(),
      mode: 'record',
    });
    const source = { path: 'quay.md', kind: 'standing' as const, text: QUAY };
    const builder = new AtomBuilder(new Map([['quay.md', source]]));
    const built = pointerAtoms(made.labelled, new Map([['quay.md', QUAY]]), builder, 'planted');
    return built.accepted.map((atom) => ({ id: atom.id, kind: 'subagent', title: atom.title }));
  }

  /** The labeler links unit 1 to the hash of the commented atom and unit 2 to a hash no request listed. */
  function answering(bodies: string[]) {
    return async (_url: string, init: RequestInit): Promise<Response> => {
      const sent = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const content = sent.messages[0]?.content ?? '';
      bodies.push(content);
      const hashed = content.split('\n').find((line) => /^ {4}atom-[0-9a-f]{10} {2}/.test(line));
      const to = hashed?.trim().split(' ')[0];
      const text = JSON.stringify({
        labels: [
          { units: '1', label: 'dispatch', links: [{ kind: 'dispatches', to }] },
          { units: '2', label: 'dispatch', links: [{ kind: 'dispatches', to: UNLISTED }] },
          { units: '3', label: 'none' },
        ],
      });
      const reply = {
        content: [{ type: 'text', text }],
        model: 'm',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return new Response(JSON.stringify(reply), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
  }

  it('resolves the hash, drops the unlisted id with its code, and leaks no comment anywhere', async () => {
    const atoms = await atomsOf();
    const commented = atoms.find((atom) => atom.title.includes(token));
    if (!commented) throw new Error('the commented atom is missing');
    const bodies: string[] = [];
    const cassette = new Cassette();
    const scan = (mode: 'record' | 'replay') => {
      const options = mode === 'record' ? { key: 'k', runs: 1, fetch: answering(bodies) } : { runs: 1 };
      return pointerScan({
        files: FILES,
        sets: HELPERS,
        labelling: singleLabelling(createAnthropicLabeler(options)),
        cassette,
        mode,
        atoms,
      });
    };
    const first = await scan('record');
    for (const result of [first, await scan('replay')]) {
      const links = result.labelled.flatMap((unit) => unit.links ?? []);
      expect(links).toEqual([{ kind: 'dispatches', to: commented.id }]);
      expect(result.droppedRecords).toEqual([
        expect.objectContaining({
          code: 'link-target-unlisted',
          units: '2',
          kind: 'dispatches',
          target: UNLISTED,
          label: 'dispatch',
        }),
      ]);
      expect(result.droppedRecords.map((item) => item.detail)).toEqual(result.dropped);
    }
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.join('\n')).not.toContain(commented.id);
    const found: string[] = [];
    const records = [first.dropped, first.droppedRecords, first.refusals, first.refusalRecords];
    for (const [place, text] of [
      ['request', bodies.join('\n')],
      ['cassette', cassette.render()],
      ['records', JSON.stringify(records)],
    ] as const) {
      for (const needle of needles) if (text.includes(needle)) found.push(`${place} holds ${needle}`);
    }
    expect(found).toEqual([]);
  });
});
