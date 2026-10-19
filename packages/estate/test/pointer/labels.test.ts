import { describe, expect, it } from 'vitest';
import {
  AGENT_RULES_SET,
  checkAnswer,
  expandUnits,
  type LabelSet,
  parseLabelSets,
  setHash,
} from '../../src/pointer';

// Two invented sets on the same units: one for a bakery's counter notes, one for a harbour's mooring notes.
const TWO_SETS = `labels:
  - set: counter-voice
    description: How the counter notes of a bakery are worded.
    labels:
      - name: greeting
        description: A unit that fixes how a customer is welcomed.
        examples:
          - "Say good morning first."
      - name: price-claim
        description: A unit that states what a loaf costs.
  - set: mooring
    description: What the harbour notes ask of a skipper.
    labels:
      - name: order
        description: A unit that tells the skipper to tie up in a given way.
        target: required
        atom: { kind: gate }
      - name: remark
        description: A unit that only says how the quay is.
`;

function load(text: string): LabelSet[] {
  const parsed = parseLabelSets(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
}

describe('label sets', () => {
  it('reads a user set and the shipped set with the same parser', () => {
    expect(load(TWO_SETS).map((set) => set.set)).toEqual(['counter-voice', 'mooring']);
    const shipped = load(AGENT_RULES_SET);
    expect(shipped[0]?.labels.map((label) => label.name)).toEqual([
      'rule',
      'prohibition',
      'gate',
      'reply-rule',
      'condition',
      'example',
      'description',
    ]);
  });

  it('refuses a duplicate set, a duplicate label, the reserved name and a bad name', () => {
    const one = 'labels:\n  - set: a\n    description: d\n    labels:\n      - { name: x, description: d }\n';
    expect(parseLabelSets(`${one}${one.replace('labels:\n', '')}`)).toMatchObject({
      ok: false,
      message: 'the set a is declared twice',
    });
    expect(
      parseLabelSets(
        one.replace(
          '- { name: x, description: d }',
          '- { name: x, description: d }\n      - { name: x, description: e }',
        ),
      ),
    ).toMatchObject({
      ok: false,
      message: 'the set a declares x twice',
    });
    expect(parseLabelSets(one.replace('name: x', 'name: none'))).toMatchObject({ ok: false });
    expect(parseLabelSets(one.replace('name: x', 'name: Not Ok'))).toMatchObject({ ok: false });
  });

  it('refuses a label with more than three examples and an unknown key', () => {
    const base =
      'labels:\n  - set: a\n    description: d\n    labels:\n      - name: x\n        description: d\n';
    expect(parseLabelSets(`${base}        examples: [a, b, c, d]\n`)).toMatchObject({ ok: false });
    expect(parseLabelSets(`${base}        colour: red\n`)).toMatchObject({ ok: false });
  });

  it('changes only the hash of the set that was edited', () => {
    const before = load(TWO_SETS);
    const after = load(
      TWO_SETS.replace('A unit that states what a loaf costs.', 'A unit that states a price.'),
    );
    expect(setHash(after[0] as LabelSet)).not.toBe(setHash(before[0] as LabelSet));
    expect(setHash(after[1] as LabelSet)).toBe(setHash(before[1] as LabelSet));
  });
});

describe('condition labels', () => {
  const set = (label: string) =>
    `labels:\n  - set: s\n    description: d\n    labels:\n      - name: when\n        description: States when another unit applies.\n${label}`;

  it('reads a condition label that asks for a target and builds no atom', () => {
    const parsed = parseLabelSets(set('        target: required\n        condition: true\n'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.sets[0]?.labels[0]?.condition).toBe(true);
  });

  it('refuses a condition label with no target, or with an atom', () => {
    const noTarget = parseLabelSets(set('        condition: true\n'));
    expect(noTarget).toEqual({
      ok: false,
      message: 'the label when is a condition and needs target: required',
    });
    const withAtom = parseLabelSets(
      set('        target: required\n        condition: true\n        atom: { kind: instruction }\n'),
    );
    expect(withAtom).toEqual({
      ok: false,
      message: 'the label when is a condition and builds no atom of its own: it takes no atom mapping',
    });
  });

  it('changes the hash of the set when a label becomes a condition', () => {
    const plain = parseLabelSets(set('        target: required\n'));
    const cond = parseLabelSets(set('        target: required\n        condition: true\n'));
    if (!plain.ok || !cond.ok) throw new Error('the sets parse');
    expect(setHash(cond.sets[0] as LabelSet)).not.toBe(setHash(plain.sets[0] as LabelSet));
  });
});

describe('unit ranges', () => {
  it('reads a number and a range, and nothing else', () => {
    expect(expandUnits('5')).toEqual([5]);
    expect(expandUnits('5-7')).toEqual([5, 6, 7]);
    expect(expandUnits('7-5')).toBeUndefined();
    expect(expandUnits('five')).toBeUndefined();
    expect(expandUnits('5,7')).toBeUndefined();
  });
});

describe('checking an answer', () => {
  const [counter, mooring] = load(TWO_SETS) as [LabelSet, LabelSet];
  const window = {
    id: 'notes.md#1',
    path: 'notes.md',
    headingPath: [],
    units: [1, 2, 3, 4].map((n) => ({ n, text: `unit ${n}`, index: n - 1 })),
  };

  it('accepts labels and ranges, and counts a unit named none as covered', () => {
    const checked = checkAnswer(counter, window, [
      { units: '1-2', label: 'greeting' },
      { units: '3', label: 'none' },
    ]);
    expect(checked.refusals).toEqual([]);
    expect([...checked.accepted.keys()]).toEqual([1, 2]);
    expect([...checked.covered]).toEqual([1, 2, 3]);
  });

  it('refuses a label that is not in the set, with the reason', () => {
    const checked = checkAnswer(counter, window, [{ units: '1', label: 'order' }]);
    expect(checked.refusals).toEqual(['notes.md#1: the label order is not in the set counter-voice']);
    expect(checked.accepted.size).toBe(0);
  });

  it('refuses a unit that is not in the window and a range that leaves it', () => {
    const checked = checkAnswer(counter, window, [
      { units: '9', label: 'greeting' },
      { units: '3-5', label: 'greeting' },
    ]);
    expect(checked.refusals).toHaveLength(2);
    expect(checked.accepted.size).toBe(0);
  });

  it('refuses a unit named twice and keeps the first answer', () => {
    const checked = checkAnswer(counter, window, [
      { units: '1-2', label: 'greeting' },
      { units: '2', label: 'price-claim' },
    ]);
    expect(checked.refusals).toEqual(['notes.md#1: "2" names a unit that is already labelled']);
    expect(checked.accepted.get(2)?.label).toBe('greeting');
  });

  it('needs a target inside the window on a label that asks for one, and refuses one on a label that takes none', () => {
    expect(checkAnswer(mooring, window, [{ units: '1', label: 'order' }]).refusals).toHaveLength(1);
    expect(checkAnswer(mooring, window, [{ units: '1', label: 'order', target: 8 }]).refusals).toHaveLength(
      1,
    );
    expect(checkAnswer(mooring, window, [{ units: '1', label: 'order', target: 3 }]).accepted.get(1)).toEqual(
      {
        label: 'order',
        target: 3,
      },
    );
    expect(checkAnswer(mooring, window, [{ units: '1', label: 'remark', target: 3 }]).refusals).toEqual([
      'notes.md#1: the label remark takes no target',
    ]);
  });

  it('refuses a target that is no number, and a target on none, and says why', () => {
    const set = load(TWO_SETS)[1] as LabelSet;
    const gate = set.labels.find((label) => label.target === 'required');
    const window = {
      id: 'w',
      path: 'w.md',
      headingPath: [],
      units: [1, 2, 3].map((n) => ({ n, text: `u${n}`, index: n - 1 })),
    };
    if (!gate) throw new Error('the set holds a label with a target');
    const string = checkAnswer(set, window, [
      { units: '1', label: gate.name, target: '2' as unknown as number },
    ]);
    expect(string.accepted.size).toBe(0);
    expect(string.refusals).toEqual([expect.stringContaining('is no unit number')]);
    const none = checkAnswer(set, window, [{ units: '1', label: 'none', target: 2 }]);
    expect(none.accepted.size).toBe(0);
    expect(none.refusals).toEqual([expect.stringContaining('none takes no target')]);
  });

  it('refuses a malformed range', () => {
    expect(checkAnswer(counter, window, [{ units: 'one', label: 'greeting' }]).refusals).toHaveLength(1);
  });
});

describe('spans and links in a label set', () => {
  const SPANS = `labels:
  - set: duty
    description: What the notes ask.
    spans:
      - { name: act, description: the clause that says what the reader does, polarity: true }
      - { name: mechanics, description: how something works }
    links:
      - { name: topic, description: the route this unit is about, to: [route, skill] }
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        spans: [act, mechanics]
        links: [topic]
        atom: { kind: instruction }
      - name: remark
        description: A unit that states how things are.
`;
  const set = load(SPANS)[0] as LabelSet;
  const window = {
    id: 'w',
    path: 'w.md',
    headingPath: [],
    units: [
      { n: 1, text: 'Read the log first. Never edit it.', index: 0 },
      { n: 2, text: 'The log is long.', index: 1 },
    ],
  };
  const context = { candidates: { topic: [{ id: 'route.a', label: 'Route A' }] } };
  const check = (entry: Record<string, unknown>) =>
    checkAnswer(set, window, [{ units: '1', label: 'rule', ...entry }], context);

  it('reads span kinds, link kinds and the kinds a label may carry', () => {
    expect(set.spans?.map((kind) => kind.name)).toEqual(['act', 'mechanics']);
    expect(set.links?.[0]?.to).toEqual(['route', 'skill']);
    expect(set.labels[0]?.spans).toEqual(['act', 'mechanics']);
  });

  it('refuses a label that names a kind the set does not declare, and a kind declared twice', () => {
    const missing = parseLabelSets(SPANS.replace('spans: [act, mechanics]', 'spans: [act, nosuch]'));
    expect(missing).toEqual({
      ok: false,
      message: 'the label rule names the span kind nosuch, which the set does not declare',
    });
    const twice = parseLabelSets(
      SPANS.replace(
        '      - { name: mechanics,',
        '      - { name: act, description: again }\n      - { name: mechanics,',
      ),
    );
    expect(twice).toEqual({ ok: false, message: 'the set duty declares the span kind act twice' });
    const link = parseLabelSets(SPANS.replace('links: [topic]', 'links: [nosuch]'));
    expect(link).toEqual({
      ok: false,
      message: 'the label rule names the link kind nosuch, which the set does not declare',
    });
  });

  it('changes the hash of the set with its span kinds', () => {
    const plain = load(SPANS.replace(/ {4}spans:\n(?: {6}- .*\n)+/, '').replace(/ {8}spans: .*\n/, ''))[0];
    expect(setHash(set)).not.toBe(setHash(plain as LabelSet));
  });

  it('accepts spans that are exact offsets of one unit, sorted, with a polarity where the kind has one', () => {
    const checked = check({
      spans: [
        { kind: 'act', from: 20, to: 34, polarity: 'prohibition' },
        { kind: 'act', from: 0, to: 19, polarity: 'obligation' },
      ],
      links: [{ kind: 'topic', to: 'route.a' }],
    });
    expect(checked.refusals).toEqual([]);
    expect(checked.accepted.get(1)?.spans).toEqual([
      { kind: 'act', from: 0, to: 19, polarity: 'obligation' },
      { kind: 'act', from: 20, to: 34, polarity: 'prohibition' },
    ]);
    expect(checked.accepted.get(1)?.links).toEqual([{ kind: 'topic', to: 'route.a' }]);
  });

  it('refuses the whole entry, with its own reason, for each way a span or a link is wrong', () => {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['a range', { units: '1-2', spans: [{ kind: 'act', from: 0, to: 3 }] }, /a range cannot carry spans/],
      [
        'a kind the label lacks',
        { spans: [{ kind: 'zzz', from: 0, to: 3 }] },
        /is not one the label rule may carry/,
      ],
      ['a fractional offset', { spans: [{ kind: 'act', from: 0.5, to: 3 }] }, /offsets are integers/],
      ['a negative offset', { spans: [{ kind: 'act', from: -1, to: 3 }] }, /offsets leave the unit/],
      ['an offset past the unit', { spans: [{ kind: 'act', from: 0, to: 99 }] }, /offsets leave the unit/],
      ['an empty span', { spans: [{ kind: 'act', from: 4, to: 4 }] }, /or are empty/],
      [
        'a polarity on a kind without one',
        { spans: [{ kind: 'mechanics', from: 0, to: 3, polarity: 'obligation' }] },
        /carries no polarity/,
      ],
      [
        'a polarity that is neither',
        { spans: [{ kind: 'act', from: 0, to: 3, polarity: 'maybe' }] },
        /obligation or prohibition/,
      ],
      [
        'an overlap',
        {
          spans: [
            { kind: 'act', from: 0, to: 10 },
            { kind: 'mechanics', from: 9, to: 12 },
          ],
        },
        /overlaps another span/,
      ],
      [
        'a link kind that is not declared',
        { links: [{ kind: 'nosuch', to: 'route.a' }] },
        /is not one the label rule may carry/,
      ],
      [
        'a link to an atom the request did not list',
        { links: [{ kind: 'topic', to: 'route.zzz' }] },
        /is not an atom the request listed for topic/,
      ],
      [
        'a link kind given twice',
        {
          links: [
            { kind: 'topic', to: 'route.a' },
            { kind: 'topic', to: 'none' },
          ],
        },
        /is given twice/,
      ],
      ['empty spans', { spans: [] }, /spans are a non-empty list/],
    ];
    for (const [name, entry, reason] of cases) {
      const checked = check(entry);
      expect(checked.accepted.size, name).toBe(0);
      expect(checked.covered.size, name).toBe(0);
      expect(checked.refusals, name).toHaveLength(1);
      expect(checked.refusals[0], name).toMatch(reason);
    }
  });

  it('measures offsets on the text the labeler reads, and keeps them as offsets of the raw unit', () => {
    // The labeler is shown each unit with its runs of white space made one space: offsets are counted there.
    const lines = {
      ...window,
      units: [{ n: 1, text: 'When the tide is out,\n    close the lower gate before dusk.', index: 0 }],
    };
    const shown = 'When the tide is out, close the lower gate before dusk.';
    const from = shown.indexOf('close');
    const to = from + 'close the lower gate'.length;
    const checked = checkAnswer(
      set,
      lines,
      [{ units: '1', label: 'rule', spans: [{ kind: 'act', from, to }] }],
      context,
    );
    expect(checked.refusals).toEqual([]);
    const kept = checked.accepted.get(1)?.spans?.[0];
    expect(lines.units[0]?.text.slice(kept?.from, kept?.to)).toBe('close the lower gate');
    // The raw text is longer than the text shown: an end past what was shown is outside the unit.
    const past = checkAnswer(
      set,
      lines,
      [{ units: '1', label: 'rule', spans: [{ kind: 'act', from, to: lines.units[0]?.text.length ?? 0 }] }],
      context,
    );
    expect(past.refusals[0]).toMatch(/offsets leave the unit/);
  });

  it('refuses a span kind the set declares but the label does not list', () => {
    const only = load(SPANS.replace('spans: [act, mechanics]', 'spans: [act]'))[0] as LabelSet;
    const checked = checkAnswer(
      only,
      window,
      [{ units: '1', label: 'rule', spans: [{ kind: 'mechanics', from: 0, to: 3 }] }],
      context,
    );
    expect(checked.accepted.size).toBe(0);
    expect(checked.refusals[0]).toMatch(/the kind "mechanics" is not one the label rule may carry/);
  });

  it('allows a link to none, and refuses spans or links on a label that carries none', () => {
    expect(check({ links: [{ kind: 'topic', to: 'none' }] }).accepted.get(1)?.links).toEqual([
      { kind: 'topic', to: 'none' },
    ]);
    const remark = checkAnswer(set, window, [
      { units: '2', label: 'remark', spans: [{ kind: 'act', from: 0, to: 3 }] },
    ]);
    expect(remark.refusals[0]).toMatch(/the label remark carries no spans/);
    const none = checkAnswer(set, window, [
      { units: '2', label: 'none', links: [{ kind: 'topic', to: 'none' }] },
    ]);
    expect(none.refusals[0]).toMatch(/carries no links/);
  });
});
