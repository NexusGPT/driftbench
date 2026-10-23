import { describe, expect, it } from 'vitest';
import { cut } from '../../src/pointer';

// Invented text. Each case is a structure the cutter reads from its syntax, not from its words.
const units = (source: string) =>
  cut(source).units.map((unit) => ({
    container: unit.container,
    text: unit.text,
    path: unit.path,
    key: unit.key,
  }));

describe('the cutter on footnotes, alerts, directives, math and TOML or JSON front matter', () => {
  it('keeps a footnote reference in the sentence it follows, and cuts a definition like prose under its label', () => {
    const found = units('Hang the lamp.[^1] Coil the rope.\n\n[^1]: Never leave it lit. Check it twice.\n');
    expect(found.map((unit) => unit.text)).toEqual([
      'Hang the lamp.[^1]',
      'Coil the rope.',
      'Never leave it lit.',
      'Check it twice.',
    ]);
    expect(found.slice(2).every((unit) => unit.path.join('/') === '[^1]')).toBe(true);
  });

  it('keeps the marker of an alert out of every unit and ends the path with its type', () => {
    const found = units('# Ropes\n\n> [!WARNING]\n> Hang the lamp.\n> Coil the rope.\n');
    expect(found.map((unit) => unit.text)).toEqual(['# Ropes', 'Hang the lamp.\n> Coil the rope.']);
    expect(found[1]?.path).toEqual(['Ropes', '[!WARNING]']);
    // Exactly GitHub's five types are alerts; any other `[!X]`, in any case, is an ordinary quote.
    for (const type of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])
      expect(units(`> [!${type}]\n> Hang it.\n`)[0]).toMatchObject({
        text: 'Hang it.',
        path: [`[!${type}]`],
      });
    for (const marker of ['[!note]', '[!DANGER]', '[!INFO]'])
      expect(units(`> ${marker}\n> Hang it.\n`)[0]).toMatchObject({
        text: `${marker}\n> Hang it.`,
        path: [],
      });
  });

  it('reads the strings of TOML and JSON front matter as units keyed by their path', () => {
    const toml = units(
      '+++\ntitle = "A title"\ntags = ["one two", "three four"]\n\n[owner]\nname = "Mo Li"\n+++\n\nBody.\n',
    );
    expect(
      toml.filter((unit) => unit.container === 'front_matter_value').map((unit) => [unit.key, unit.text]),
    ).toEqual([
      ['$.title', 'A title'],
      ['$.tags[0]', 'one two'],
      ['$.tags[1]', 'three four'],
      ['$.owner.name', 'Mo Li'],
    ]);
    const json = units('{\n  "title": "A title",\n  "tags": ["one two"]\n}\n\nBody.\n');
    expect(json.map((unit) => [unit.container, unit.key ?? '', unit.text])).toEqual([
      ['front_matter_value', '$.title', 'A title'],
      ['front_matter_value', '$.tags[0]', 'one two'],
      ['sentence', '', 'Body.'],
    ]);
    // The object ends where a JSON parser finishes the value: braces in a string, an escaped quote and a nested object
    // do not end it early, and a brace that does not end its line is no front matter.
    const hard = units('{\n  "title": "a } b \\" c",\n  "owner": { "name": "Mo Li" }\n}\n\nBody.\n');
    expect(hard.map((unit) => [unit.container, unit.key ?? '', unit.text])).toEqual([
      ['front_matter_value', '$.title', 'a } b \\" c'],
      ['front_matter_value', '$.owner.name', 'Mo Li'],
      ['sentence', '', 'Body.'],
    ]);
    expect(units('{ "a": "b" } and more words here.\n')[0]?.container).toBe('sentence');
    // A TOML file that does not parse is one opaque unit, like a YAML that does not parse.
    expect(units('+++\ntitle = \n+++\n\nBody.\n')[0]?.container).toBe('opaque');
  });

  it('keeps the marker lines of a container directive out of every unit and ends the path with its name', () => {
    const found = units('# Ropes\n\n:::warning\nHang the lamp.\n:::\n\nCoil the rope.\n');
    expect(found.map((unit) => [unit.text, unit.path.join('/')])).toEqual([
      ['# Ropes', ''],
      ['Hang the lamp.', 'Ropes/warning'],
      ['Coil the rope.', 'Ropes'],
    ]);
  });

  it('reads a directive label as one unit, its attributes as no unit, and a longer fence as the outer one', () => {
    expect(
      units(':::note[Check first]\nHang the lamp.\n:::\n').map((u) => [u.text, u.path.join('/')]),
    ).toEqual([
      ['Check first', 'note'],
      ['Hang the lamp.', 'note'],
    ]);
    expect(units(':::tip{#id .wide}\nHang the lamp.\n:::\n').map((u) => [u.text, u.path.join('/')])).toEqual([
      ['Hang the lamp.', 'tip'],
    ]);
    expect(
      units('::::outer[Mind the gap]{.x}\n:::inner\nHang the lamp.\n:::\n::::\n').map((u) => [
        u.text,
        u.path.join('/'),
      ]),
    ).toEqual([
      ['Mind the gap', 'outer'],
      ['Hang the lamp.', 'outer/inner'],
    ]);
  });

  it('cuts a display math block as one opaque unit and leaves a price in prose alone', () => {
    const found = units('$$\nx = 1. y = 2.\n$$\n\nIt costs $5. It lasts $6.\n');
    expect(found[0]).toMatchObject({ container: 'opaque', text: '$$\nx = 1. y = 2.\n$$' });
    expect(found.slice(1).map((unit) => unit.text)).toEqual(['It costs $5.', 'It lasts $6.']);
  });

  it('ends no sentence at a full stop inside a number or before a lower-case word', () => {
    expect(units('Pay 3.5 euros. Keep the receipt.\n').map((unit) => unit.text)).toEqual([
      'Pay 3.5 euros.',
      'Keep the receipt.',
    ]);
    expect(units('It opens at six. then it shuts.\n').map((unit) => unit.text)).toEqual([
      'It opens at six. then it shuts.',
    ]);
  });
});

// Exact counterexamples from reviewer run 39879178984 (0aadf80ca).
describe('reviewer regressions from PR #1419', () => {
  it('an alert preserves a first content line beginning with emphasis', () => {
    expect(units('> [!NOTE]\n> **Keep this.**\n')).toEqual([
      { text: '**Keep this.**', path: ['[!NOTE]'], container: 'block_quote', key: undefined },
    ]);
  });
  it('an alert preserves a first content line beginning with inline code', () => {
    expect(units('> [!TIP]\n> `keep` this.\n')).toEqual([
      { text: '`keep` this.', path: ['[!TIP]'], container: 'block_quote', key: undefined },
    ]);
  });
  it('every alert paragraph has its alert type', () => {
    expect(
      units('> [!NOTE]\n> First paragraph.\n>\n> Second paragraph.\n').map((u) => [u.text, u.path]),
    ).toEqual([
      ['First paragraph.', ['[!NOTE]']],
      ['Second paragraph.', ['[!NOTE]']],
    ]);
  });
  it('a marker in the second paragraph does not turn an ordinary quote into an alert', () => {
    expect(
      units('> Ordinary paragraph.\n>\n> [!NOTE]\n> Later paragraph.\n').map((u) => [u.text, u.path]),
    ).toEqual([
      ['Ordinary paragraph.', []],
      ['[!NOTE]\n> Later paragraph.', []],
    ]);
  });
  it('TOML nested tables inherit the current array-table index', () => {
    const input =
      '+++\n[[servers]]\nname="alpha"\n[servers.meta]\nregion="north"\n[[servers]]\nname="beta"\n[servers.meta]\nregion="south"\n+++\n';
    expect(units(input).map((u) => [u.text, u.key])).toEqual([
      ['alpha', '$.servers[0].name'],
      ['north', '$.servers[0].meta.region'],
      ['beta', '$.servers[1].name'],
      ['south', '$.servers[1].meta.region'],
    ]);
  });
  it('a directive name ends the path of its heading and table cells too', () => {
    expect(
      units(':::note\n# Inner\n\n| Head |\n| --- |\n| Cell |\n:::\n').map((u) => [u.container, u.path]),
    ).toEqual([
      ['heading', ['note']],
      ['table_cell', ['Inner', 'note']],
      ['table_cell', ['Inner', 'note']],
    ]);
  });
  it('a footnote label ends the path of its table cells too', () => {
    const found = units('Body.[^n]\n\n[^n]: | Head |\n    | --- |\n    | Cell |\n');
    expect(found.filter((u) => u.container === 'table_cell').map((u) => u.path)).toEqual([
      ['[^n]'],
      ['[^n]'],
    ]);
  });
});
