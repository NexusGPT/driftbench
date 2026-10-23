import { describe, expect, it } from 'vitest';
import { cut } from '../../src/pointer/cut';

const indent = (text: string, first: string, rest: string) =>
  text
    .split('\n')
    .map((line, index) => `${index === 0 ? first : rest}${line}`)
    .join('\n');
const tableCell = (text: string) =>
  `| Header |\n| --- |\n| ${text.replaceAll('|', '\\|').replaceAll('\n', '<br>')} |`;

const containers = [
  {
    name: 'directive',
    wrap: (text: string) => `:::note\n${text}\n:::`,
    suffix: ['scope', 'note'],
    prose: 'sentence',
  },
  {
    name: 'footnote',
    wrap: (text: string) => `Body.[^n]\n\n${indent(text, '[^n]: ', '    ')}`,
    suffix: ['scope', '[^n]'],
    prose: 'sentence',
  },
  {
    name: 'alert',
    wrap: (text: string) => `> [!NOTE]\n>\n${indent(text, '> ', '> ')}`,
    suffix: ['scope', '[!NOTE]'],
    prose: 'block_quote',
  },
  {
    name: 'list item',
    wrap: (text: string) => indent(text, '- ', '  '),
    suffix: ['scope'],
    prose: 'list_item',
  },
  {
    name: 'quote',
    wrap: (text: string) => indent(text, '> ', '> '),
    suffix: ['scope'],
    prose: 'block_quote',
  },
  // GFM cells contain phrasing nodes, not child blocks. Each block syntax is deliberately literal cell text.
  { name: 'table cell (literal child syntax)', wrap: tableCell, suffix: ['scope'], prose: 'table_cell' },
];
const blocks = [
  { name: 'paragraph', text: 'Child prose.', kind: undefined },
  { name: 'HTML block', text: '<role>\nChild prose.\n</role>', kind: undefined },
  { name: 'list', text: '- Child list.', kind: 'list_item' },
  { name: 'table', text: '| Child header |\n| --- |\n| Child cell |', kind: 'table_cell' },
  { name: 'code', text: '```text\nChild code.\n```', kind: 'opaque' },
  { name: 'math', text: '$$\nChild = 1.\n$$', kind: 'opaque' },
];

describe('every container carries context through every child block', () => {
  for (const container of containers) {
    for (const block of blocks) {
      it(`${container.name} × ${block.name}`, () => {
        const input = `::::scope\n${container.wrap(block.text)}\n::::\n`;
        const found = cut(input).units.filter((unit) => unit.text.includes('Child'));
        const cell = container.prose === 'table_cell';
        expect(found).toHaveLength(!cell && block.name === 'table' ? 2 : 1);
        for (const unit of found) {
          expect(unit.path).toEqual(container.suffix);
          expect(unit.container).toBe(cell ? 'table_cell' : (block.kind ?? container.prose));
        }
      });
    }
  }

  it('table cell × inline HTML preserves its inherited suffix and remains a cell', () => {
    const found = cut(`::::scope\n${tableCell('<span>Child inline.</span>')}\n::::\n`).units.filter((unit) =>
      unit.text.includes('Child'),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      text: '<span>Child inline.</span>',
      path: ['scope'],
      container: 'table_cell',
    });
  });
});

// Exact probes from codex-review-objects at a7be957a; prose classification is part of the contract too.
describe('HTML reviewer regressions from PR #1419', () => {
  const cases = [
    ['directive', ':::note\n<role>\nKeep this.\n</role>\n:::\n', ['note'], 'sentence'],
    ['footnote', 'Body.[^n]\n\n[^n]: <role>\n    Keep this.\n    </role>\n', ['[^n]'], 'sentence'],
    ['alert', '> [!NOTE]\n> <role>\n> Keep this.\n> </role>\n', ['[!NOTE]'], 'block_quote'],
  ] as const;
  for (const [name, input, path, container] of cases) {
    it(`HTML inside ${name} preserves context and prose classification`, () => {
      const found = cut(input).units.filter((unit) => unit.text.includes('Keep this.'));
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ path: [...path], container });
    });
  }
});

// A reparse uses parser-relative indentation but every emitted offset still addresses the original source.
describe('HTML source offsets after removing container prefixes', () => {
  for (const eol of ['\n', '\r\n', '\r']) {
    for (const prefix of ['    ', '\t']) {
      it(`preserves BOM and ${JSON.stringify(eol)} offsets with ${JSON.stringify(prefix)} indentation`, () => {
        const input = `\ufeff# Outside${eol}${eol}[^n]: <role>${eol}${prefix}First line.${eol}${prefix}Second line.${eol}${prefix}</role>${eol}`;
        const found = cut(input).units.filter((unit) => unit.path.includes('[^n]'));
        expect(found.map((unit) => [unit.text, unit.container, unit.path])).toEqual([
          ['First line.', 'sentence', ['Outside', '[^n]']],
          ['Second line.', 'sentence', ['Outside', '[^n]']],
        ]);
        for (const unit of found) {
          expect(unit.start).toBe(input.indexOf(unit.text));
          expect(unit.end).toBe(unit.start + unit.text.length);
        }
      });
    }
  }

  it('preserves real code indentation within a footnote HTML block', () => {
    const input = '[^n]: <div>\n    Child prose.\n\n        Child code.\n    </div>\n';
    expect(cut(input).units.map((unit) => [unit.text, unit.container, unit.path])).toEqual([
      ['Child prose.', 'sentence', ['[^n]']],
      ['Child code.', 'opaque', ['[^n]']],
    ]);
  });

  it('keeps an alert type on later paragraphs when its first paragraph spans parser slabs', () => {
    const input = '> [!NOTE]\n> First line\n> second line\n> third line.\n>\n> Later paragraph.\n';
    expect(cut(input, { slabLines: 2 }).units.map((unit) => unit.path)).toEqual([['[!NOTE]'], ['[!NOTE]']]);
  });

  it('does not recognize a later marker as an alert when a parser slab starts there', () => {
    const input = '> Ordinary line\n> second line\n> [!NOTE]\n> Later paragraph.\n>\n> Next paragraph.\n';
    expect(cut(input, { slabLines: 2 }).units.map((unit) => [unit.text, unit.path])).toEqual([
      ['Ordinary line\n> second line\n> [!NOTE]\n> Later paragraph.', []],
      ['Next paragraph.', []],
    ]);
  });
});
