import { describe, expect, it } from 'vitest';
import { checkAnswer, type LabelSet, parseLabelSets, setHash } from '../../src/pointer';
import { denseUser } from '../../src/pointer/dense';

// A harbour's mooring notes: the act a rule governs holds the two calls of one tool, in the order they run.
const NESTED = `labels:
  - set: mooring
    description: What the harbour notes ask.
    spans:
      - { name: act, description: the act the rule governs }
      - { name: first-call, description: the call that must come first, within: act }
      - { name: second-call, description: the call that must come second, within: act }
    labels:
      - name: gate
        description: A unit that sets an order, one call before another.
        spans: [act, first-call, second-call]
        atom: { kind: gate }
      - name: remark
        description: A unit that states how things are.
`;

const TEXT = 'Check the tide table before you cast off the stern line.';
const at = (clause: string) => {
  const from = TEXT.indexOf(clause);
  if (from < 0) throw new Error(`no clause ${clause}`);
  return { from, to: from + clause.length };
};

function load(text: string): LabelSet {
  const parsed = parseLabelSets(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets[0] as LabelSet;
}

const set = load(NESTED);
const window = { id: 'w', path: 'w.md', headingPath: [], units: [{ n: 1, text: TEXT, index: 0 }] };
const check = (spans: unknown[]) =>
  checkAnswer(set, window, [{ units: '1', label: 'gate', spans: spans as never }]);

describe('a span kind nested in another', () => {
  it('reads the parent a kind is within, and changes the hash of the set', () => {
    expect(set.spans?.map((kind) => [kind.name, kind.within])).toEqual([
      ['act', undefined],
      ['first-call', 'act'],
      ['second-call', 'act'],
    ]);
    const flat = load(NESTED.replaceAll(', within: act', ''));
    expect(setHash(set)).not.toBe(setHash(flat));
  });

  it('accepts two spans nested in the span of the act, sorted with the parent first', () => {
    const checked = check([
      { kind: 'second-call', ...at('cast off the stern line') },
      { kind: 'first-call', ...at('Check the tide table') },
      { kind: 'act', from: 0, to: TEXT.length },
    ]);
    expect(checked.refusals).toEqual([]);
    expect(checked.accepted.get(1)?.spans?.map((span) => span.kind)).toEqual([
      'act',
      'first-call',
      'second-call',
    ]);
  });

  it('refuses the whole entry, with its own reason, for each way a nested span is wrong', () => {
    const cases: Array<[string, unknown[], RegExp]> = [
      [
        'no span of the parent kind',
        [{ kind: 'first-call', ...at('Check the tide table') }],
        /is not inside a span of the kind act/,
      ],
      [
        'a span that leaves the parent',
        [
          { kind: 'act', ...at('before you cast off') },
          { kind: 'first-call', ...at('Check the tide table') },
        ],
        /is not inside a span of the kind act/,
      ],
      [
        'a span that starts inside the parent and ends after it',
        [
          { kind: 'act', ...at('Check the tide table') },
          { kind: 'first-call', ...at('tide table before') },
        ],
        /is not inside a span of the kind act/,
      ],
      [
        'two nested spans that overlap',
        [
          { kind: 'act', from: 0, to: TEXT.length },
          { kind: 'first-call', ...at('Check the tide table before') },
          { kind: 'second-call', ...at('before you cast off') },
        ],
        /overlaps another span/,
      ],
      [
        'a span of a kind that is not nested, over another',
        [
          { kind: 'act', from: 0, to: 20 },
          { kind: 'act', from: 10, to: 30 },
        ],
        /overlaps another span/,
      ],
    ];
    for (const [name, spans, reason] of cases) {
      const checked = check(spans);
      expect(checked.refusals, name).toHaveLength(1);
      expect(checked.refusals[0], name).toMatch(reason);
      expect(checked.accepted.size, name).toBe(0);
    }
  });

  it('refuses a set whose nesting cannot be followed', () => {
    const cases: Array<[string, string, string]> = [
      [
        'a parent the set does not declare',
        NESTED.replace('within: act }\n      - { name: second', 'within: nosuch }\n      - { name: second'),
        'the span kind first-call is within nosuch, which the set does not declare',
      ],
      [
        'a kind within itself',
        NESTED.replace(
          '{ name: act, description: the act the rule governs }',
          '{ name: act, description: the act the rule governs, within: act }',
        ),
        'the span kind act is within itself',
      ],
      [
        'a loop of two kinds',
        NESTED.replace(
          '{ name: act, description: the act the rule governs }',
          '{ name: act, description: the act the rule governs, within: first-call }',
        ),
        'the span kinds act and first-call are within each other',
      ],
      [
        'a label that carries a nested kind without its parent',
        NESTED.replace('spans: [act, first-call, second-call]', 'spans: [first-call, second-call]'),
        'the label gate carries the span kind first-call, which is within act, and not act',
      ],
    ];
    for (const [name, text, message] of cases) {
      expect(parseLabelSets(text), name).toEqual({ ok: false, message });
    }
  });

  it('tells the labeler which span a kind sits in, only for a set that nests', () => {
    expect(denseUser(set, window)).toContain(
      '- first-call: the call that must come first (inside the act span)',
    );
    expect(denseUser(load(NESTED.replaceAll(', within: act', '')), window)).not.toContain('inside the');
  });

  it('lets a span lie inside every ancestor of its kind, to any depth', () => {
    const deep = load(
      NESTED.replace(
        'within: act }\n      - { name: second-call, description: the call that must come second, within: act }',
        'within: act }\n      - { name: second-call, description: the call that must come second, within: first-call }',
      ),
    );
    const checked = checkAnswer(deep, window, [
      {
        units: '1',
        label: 'gate',
        spans: [
          { kind: 'act', from: 0, to: TEXT.length },
          { kind: 'first-call', ...at('Check the tide table before you cast off') },
          { kind: 'second-call', ...at('cast off') },
        ] as never,
      },
    ]);
    expect(checked.refusals).toEqual([]);
    expect(checked.accepted.get(1)?.spans?.map((span) => span.kind)).toEqual([
      'act',
      'first-call',
      'second-call',
    ]);
  });
});
