import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { stringifyGeneratedYaml } from '../../src/seed/yaml';

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
  undefined,
  Infinity,
  NaN,
];
const options = { lineWidth: 0, aliasDuplicateObjects: false };

describe('generated YAML serialization', () => {
  it('matches the reference bytes across nested arrays, maps, scalars and unsupported values', () => {
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
        'a: b': values[(index * 3) % values.length],
      };
      expect(stringifyGeneratedYaml(value)).toBe(stringify(value, options));
    }
  });

  it('matches primitive and plain-text spellings without YAML node construction', () => {
    for (const value of [
      'null',
      'Null',
      'NULL',
      'true',
      'True',
      'TRUE',
      'false',
      'False',
      'FALSE',
      'tRuE',
      'NaN',
      'Infinity',
      'yes',
      'no',
      'hello world',
      'a ',
      ' a',
      'a: b',
      '---',
      '.',
      '_',
      'a--.',
      'a # comment',
    ]) {
      expect(stringifyGeneratedYaml({ value })).toBe(stringify({ value }, options));
    }
    for (let index = 0; index < 1000; index += 1) {
      const value = Math.sin(index) * 10 ** ((index % 617) - 308);
      expect(stringifyGeneratedYaml({ value })).toBe(stringify({ value }, options));
    }
  });

  it('retains library behavior for complex keys, shared objects, dates and long cache runs', () => {
    const shared = { a: 'one', b: 1 };
    for (const value of [
      { first: shared, second: shared },
      { 'multi\nline': 1 },
      { date: new Date('2020-01-01') },
      { custom: { toJSON: () => ({ replaced: true }) } },
      { custom: Object.defineProperty({}, 'toJSON', { value: () => 42 }) },
      { custom: Object.defineProperty({}, 'toJSON', { get: () => () => 42 }) },
      { sparse: new Array(2) },
      {
        get accessed() {
          return 'value';
        },
      },
      [shared, [], {}, null],
    ])
      expect(stringifyGeneratedYaml(value)).toBe(stringify(value, options));
    for (let index = 0; index < 5000; index += 1) {
      const value = { id: `case-${index}`, constant: 'same', number: index };
      expect(stringifyGeneratedYaml(value)).toBe(stringify(value, options));
    }
  });
});
