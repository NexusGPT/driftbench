import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { parseBlockYaml } from '../src/spec/block-yaml';

const values = [
  'hello',
  'true',
  'null',
  '1',
  '0x10',
  'a: b',
  'a # b',
  "it's fine",
  'hello\nworld',
  '\nfirst\n',
  'trailing\n',
  '  leading\nnext',
  'a\n\nb',
  '',
  'é',
  '😃',
  -0,
  1e25,
  0.5,
  true,
  false,
  null,
  [],
  {},
];

describe('block YAML acceleration', () => {
  it('matches the reference parser on nested canonical documents and scalar spellings', () => {
    let accelerated = 0;
    for (let index = 0; index < 500; index += 1) {
      const value = {
        id: `case-${index}`,
        blocks: [
          {
            first: values[index % values.length],
            second: values[(index * 7) % values.length],
            nested: [[1, 2], { x: true, child: { y: 'yes' } }],
          },
        ],
        empty: {},
        list: [],
      };
      const text = `# comment\n${stringify(value, { lineWidth: 0, aliasDuplicateObjects: false })}`;
      const fast = parseBlockYaml(text);
      if (fast) {
        accelerated += 1;
        expect(fast.value, text).toEqual(parse(text));
      }
    }
    expect(accelerated).toBeGreaterThan(300);
  });

  it('does not share mutable collections between parses or confuse scalar cache eviction', () => {
    const text = 'object: {}\narray: []\nflag: true\nzero: -0\n';
    const first = parseBlockYaml(text)?.value as { object: Record<string, unknown>; array: unknown[] };
    first.object.changed = true;
    first.array.push('changed');
    expect(parseBlockYaml(text)?.value).toEqual(parse(text));
    for (let index = 0; index < 5000; index += 1) {
      const source = `value: word-${index}\n`;
      expect(parseBlockYaml(source)?.value).toEqual({ value: `word-${index}` });
    }
    expect(parseBlockYaml(text)?.value).toEqual(parse(text));
  });

  it('matches reference parsing for deterministic nested documents and whitespace mutations', () => {
    let state = 1;
    const random = () => {
      state = Math.imul(state, 1664525) + 1013904223;
      return (state >>> 0) / 2 ** 32;
    };
    const value = (depth: number): unknown => {
      if (depth > 3 || random() < 0.55) return values[Math.floor(random() * values.length)];
      if (random() < 0.4) return Array.from({ length: Math.floor(random() * 4) }, () => value(depth + 1));
      return { first: value(depth + 1), second: value(depth + 1) };
    };
    for (let index = 0; index < 300; index += 1) {
      const reference = stringify({ root: value(0) }, { lineWidth: 0, aliasDuplicateObjects: false });
      for (const text of [
        reference,
        reference.trimEnd(),
        reference.replaceAll('  ', ' '),
        reference.replaceAll(': ', ':  '),
      ]) {
        const fast = parseBlockYaml(text);
        if (fast) expect(fast.value, text).toEqual(parse(text, { uniqueKeys: true }));
      }
    }
  });

  it.each([
    'x: true\nx: false\n',
    'x: &a [1, 2]\ny: *a\n',
    'x: !!str 123\n',
    'x: a # comment\n',
    'x: { y: 1 }\n',
    'x: [1, 2]\n',
    'x: >-\n  folded\n  text\n',
    'x: |-\n    extra indent\n',
    'x: |-\n   three spaces\n',
    'x: |\n\n',
    'x: |\n  no final newline',
    'x: |-\n  \n',
    'x: |2-\n    leading\n',
    'x: |+\n  tail\n\n',
    'x: a\n  continuation\n',
    'x: "\\x41"\n',
    'x: "unclosed\n',
    'x: 1\n---\ny: 2\n',
    '---\nx: 1\n',
    'x: 1\n\tbad: 2\n',
    'x: 1\n  bad: 2\n',
    'x: 1\nx: 2\n',
    'x:\n  true: 1\n',
    'x:\n  "quoted key": 1\n',
    'x: \0\n',
    '\ufeffx: 1\n',
    'x: 1\n\u00a0y: 2\n',
    'x:\n  - y: 1\n  - y: 2\n',
    '__proto__:\n  polluted: true\n',
    'x: 0x10\ny: 0o77\nz: .inf\n',
    'x: NULL\ny: False\nz: 2026-01-02\n',
  ])('defers unsupported forms without accepting a different value: %j', (text) => {
    const fast = parseBlockYaml(text);
    if (fast) expect(fast.value).toEqual(parse(text, { uniqueKeys: true }));
  });
});
