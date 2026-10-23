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
