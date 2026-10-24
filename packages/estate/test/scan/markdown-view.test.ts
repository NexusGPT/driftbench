import { describe, expect, it } from 'vitest';
import { markdownView, scanImports } from '../../src/scan/markdown-view';

const view = (...lines: string[]) => markdownView(lines.join('\n'));

describe('the lines a path reader looks at', () => {
  it('keeps the line count, whatever the document holds', () => {
    const text = ['# T', '', '    code', '', 'a `b', 'c` d', '', '- e'].join('\n');
    expect(markdownView(text).lines).toHaveLength(text.split('\n').length);
  });

  it('blanks every line of an indented code block, a tab-indented one and one inside a list item', () => {
    expect(view('Text.', '', '    Read `notes/a.md`.', '    more', '', 'After.').lines).toEqual([
      'Text.',
      '',
      '',
      '',
      '',
      'After.',
    ]);
    expect(view('Text.', '', '\tRead `notes/a.md`.', '', 'After.').lines[2]).toBe('');
    expect(view('- item', '', '      Read `notes/a.md`.', '', '- next').lines[2]).toBe('');
  });

  it('keeps an indented line that CommonMark reads as text: a list continuation and a lazy line', () => {
    expect(view('- item', '  more `notes/a.md`', '', 'para', '    lazy `notes/b.md`').lines).toEqual([
      '- item',
      '  more `notes/a.md`',
      '',
      'para',
      '    lazy `notes/b.md`',
    ]);
  });

  it('turns a code span over several lines into one span on its first line', () => {
    const lines = view('See `some words', 'notes/a.md more` here.', 'Next `x`.').lines;
    expect(lines[0]).toBe('See `some words notes/a.md more`');
    expect(lines[1]).toBe(' '.repeat('notes/a.md more`'.length) + ' here.');
    expect(lines[2]).toBe('Next `x`.');
    const three = view('`a', 'b', 'c` end').lines;
    expect(three[0]).toBe('`a b c`');
    expect(three[1]).toBe('');
    expect(three[2]?.trim()).toBe('end');
  });

  it('leaves a code span with a backtick in it wrapped in a longer fence', () => {
    expect(view('x ``a ` b', 'c`` y').lines[0]).toBe('x `` a ` b c ``');
  });

  it('keeps definitions, links, images and quoted names, which a path reader reads', () => {
    const lines = ['[r]: notes/a.md', '[t](notes/b.md) ![i](notes/c.png) "notes/d.md"'];
    expect(markdownView(lines.join('\n')).lines).toEqual(lines);
  });
});

describe('the text a person reads', () => {
  it('has the runs of a paragraph, a list, a quote, a heading and a link label', () => {
    const runs = view(
      '# Head @a.md',
      '',
      '- item @b.md',
      '',
      '> quote @c.md',
      '',
      '[go @d.md now](u)',
      '',
      '*it @e.md*',
    ).texts;
    expect(runs.map((run) => run.value)).toEqual([
      'Head @a.md',
      'item @b.md',
      'quote @c.md',
      'go @d.md now',
      'it @e.md',
    ]);
    expect(runs.map((run) => run.line)).toEqual([1, 3, 5, 7, 9]);
  });

  it('has no run for code, a definition, an image, an autolink destination or an HTML block', () => {
    const runs = view(
      '`@a.md` and ``@b.md``',
      '',
      '    @c.md',
      '',
      '[r]: @d.md',
      '',
      '![alt @e.md](pic.png)',
      '',
      '<https://example.org/@f.md>',
      '',
      '<div>',
      '@g.md',
      '</div>',
    ).texts;
    expect(
      runs.map((run) => run.value).filter((value) => value.includes('@') && !value.includes('example')),
    ).toEqual([]);
  });

  it('numbers an import by the line it stands on in a paragraph that runs over several lines', () => {
    const found = view('first line', 'second @one.md', 'third @two.md').imports('@');
    expect(found).toEqual([
      { written: 'one.md', line: 2 },
      { written: 'two.md', line: 3 },
    ]);
  });
});

describe('scanImports', () => {
  it('starts at the beginning of a run or after a space, and ends at a space not written with a backslash', () => {
    expect(scanImports('@a/b.md and @c.md.', '@').map((found) => found.written)).toEqual(['a/b.md', 'c.md']);
    expect(scanImports('name@host and @Design\\ Docs/x.md ok', '@').map((found) => found.written)).toEqual([
      'Design Docs/x.md',
    ]);
    expect(scanImports('@"quoted.md" and @', '@')).toEqual([]);
  });
});

describe('fenced blocks and comments are taken from the parse', () => {
  it('blanks a fenced block opened on a list item line, an ordered item line, in a quote and in a nested item', () => {
    expect(view('- ```text', '  `notes/a.md`', '  ```', 'after `notes/b.md`').lines).toEqual([
      '',
      '',
      '',
      'after `notes/b.md`',
    ]);
    expect(view('1. ~~~md', '   `notes/a.md`', '   ~~~', 'after').lines).toEqual(['', '', '', 'after']);
    expect(view('> ```text', '> `notes/a.md`', '> ```', '', 'after').lines).toEqual([
      '',
      '',
      '',
      '',
      'after',
    ]);
    expect(view('- outer', '  - ```text', '    `notes/a.md`', '    ```', 'after').lines.slice(1)).toEqual([
      '',
      '',
      '',
      'after',
    ]);
  });

  it('keeps the text after a block whose closing fence is indented as its list item is', () => {
    expect(view('- ```text', '  example', '  ```', '', 'after @x.md').imports('@')).toEqual([
      { written: 'x.md', line: 5 },
    ]);
  });

  it('blanks an HTML comment of one line, of several, mid-sentence and in a list item, and keeps the rest', () => {
    expect(view('Before <!-- hidden `a.md` --> after `b.md`').lines[0]?.replace(/\s+/g, ' ')).toBe(
      'Before after `b.md`',
    );
    expect(view('<!--', 'hidden `a.md`', '-->', 'kept `b.md`').lines.map((line) => line.trim())).toEqual([
      '',
      '',
      '',
      'kept `b.md`',
    ]);
    expect(view('- item <!-- hidden `a.md` --> kept `b.md`').lines[0]?.replace(/\s+/g, ' ')).toBe(
      '- item kept `b.md`',
    );
    expect(view('<!-- one --> kept <!-- two --> `b.md`').lines[0]?.replace(/\s+/g, ' ')).toBe(' kept `b.md`');
  });

  it('keeps a comment shown in code: a code span holds it as text', () => {
    expect(view('Write `<!-- x -->` literally.').lines).toEqual(['Write `<!-- x -->` literally.']);
  });

  it('reads an import in emphasis and in strong emphasis, and none in an image description', () => {
    expect(
      view('**@a.md** and _@b.md_')
        .imports('@')
        .map((found) => found.written),
    ).toEqual(['a.md', 'b.md']);
    expect(view('![see @c.md here](p.png)').imports('@')).toEqual([]);
  });

  it('ends a fenced block at the end of its list item: an unindented line is outside it, and a fence after it opens another', () => {
    // CommonMark: `example` is not indented as the item is, so the item (and the block) ended before it.
    expect(view('- ```text', 'example', '  ```', '', 'after @x.md').imports('@')).toEqual([]);
    expect(view('- ```text', 'example `notes/a.md`', 'after').lines[1]).toBe('example `notes/a.md`');
  });
});
