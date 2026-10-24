// Where a document writes a mention decides whether it is one. The rule, from CommonMark and the Claude Code memory
// documentation ("import parsing skips Markdown code spans and fenced code blocks"):
//
//   - a mention is read in the text a person reads: a paragraph, a list item, a quote, a heading, a table row, a link
//     label, emphasis; a link destination, a definition and an image destination are paths by their syntax;
//   - a mention is not read in code, wherever it stands: a code span over one line or several, an indented block
//     (after a blank line, in a list item, with a tab), a fenced block of any length or character; an `@` import is
//     not read in a definition, an image description, a destination or an HTML block either.
//
// The tables below are the rule, one row per construct. A mention that is read makes a link or, since its file does
// not exist, a missing reference; one that is not read makes nothing.
import { describe, expect, it } from 'vitest';
import { from, outcome, unresolvedLinks } from './links';
import { observe } from './observe';
import { IMPORT_LINK, MENTION_LINK } from './vocabulary';

type Context = { key: string; document: (mention: string) => string[]; reads: boolean };

const IMPORT = '@rules/absent.md';

/** Where an `@` import stands. `reads` is whether the runtime loads the file it names. */
const IMPORT_CONTEXTS: Context[] = [
  { key: 'a paragraph', document: (m) => [`See ${m} first.`], reads: true },
  { key: 'the start of a line', document: (m) => [m], reads: true },
  { key: 'a soft line break', document: (m) => ['first line', `second ${m}`], reads: true },
  { key: 'a list item', document: (m) => [`- team ${m}`], reads: true },
  { key: 'an ordered list item', document: (m) => [`1. team ${m}`], reads: true },
  { key: 'a list item, continued', document: (m) => ['- item', `  more ${m}`], reads: true },
  { key: 'a block quote', document: (m) => [`> quoted ${m}`], reads: true },
  { key: 'a heading', document: (m) => [`## Head ${m}`], reads: true },
  { key: 'emphasis', document: (m) => [`*see ${m} here*`], reads: true },
  { key: 'strong emphasis', document: (m) => [`**see ${m} here**`], reads: true },
  { key: 'a link label', document: (m) => [`[go ${m} now](https://example.org/page)`], reads: true },
  {
    key: 'a link label that ends at the import',
    document: (m) => [`[go ${m}](https://example.org/page)`],
    reads: true,
  },
  { key: 'a table row', document: (m) => [`| case | ${m} |`], reads: true },
  { key: 'a lazy line after a paragraph', document: (m) => ['paragraph', `    lazy ${m}`], reads: true },
  { key: 'strong emphasis around the import', document: (m) => [`**${m}**`], reads: true },
  { key: 'emphasis around the import', document: (m) => [`_${m}_`], reads: true },
  {
    key: 'text after a fenced block opened on a list item line',
    document: (m) => ['- ```text', '  example', '  ```', '', `Then ${m} stays read.`],
    reads: true,
  },
  {
    key: 'text after a fenced block opened on an ordered item line',
    document: (m) => ['1. ~~~md', '   example', '   ~~~', '', `Then ${m} stays read.`],
    reads: true,
  },
  {
    key: 'text after a fenced block opened in a quote',
    document: (m) => ['> ```text', '> example', '> ```', '', `Then ${m} stays read.`],
    reads: true,
  },
  {
    key: 'a line that starts with a comment, an HTML block',
    document: (m) => [`<!-- hidden --> ${m}`],
    reads: false,
  },
  {
    key: 'text after a comment in a sentence',
    document: (m) => [`Before <!-- hidden --> then ${m}`],
    reads: true,
  },
  {
    key: 'a fenced block opened on a list item line',
    document: (m) => ['- ```text', `  ${m}`, '  ```'],
    reads: false,
  },
  {
    key: 'a fenced block opened on an ordered item line',
    document: (m) => ['1. ~~~md', `   ${m}`, '   ~~~'],
    reads: false,
  },
  {
    key: 'a fenced block opened in a quote',
    document: (m) => ['> ```text', `> ${m}`, '> ```'],
    reads: false,
  },
  {
    key: 'a fenced block opened in a nested list item',
    document: (m) => ['- outer', '  - ```text', `    ${m}`, '    ```'],
    reads: false,
  },
  { key: 'a comment over several lines', document: (m) => ['<!--', m, '-->'], reads: false },
  { key: 'a comment in a sentence', document: (m) => [`Before <!-- ${m} --> after`], reads: false },
  { key: 'a comment in a list item', document: (m) => [`- item <!-- ${m} -->`], reads: false },
  { key: 'a code span', document: (m) => [`Write \`${m}\` as text.`], reads: false },
  { key: 'a double-backtick code span', document: (m) => [`Write \`\`${m}\`\` as text.`], reads: false },
  {
    key: 'a code span over two lines',
    document: (m) => ['A `span of words', `${m} more words\` end.`],
    reads: false,
  },
  { key: 'a code span over three lines', document: (m) => ['`a', m, 'c` end'], reads: false },
  { key: 'an indented code block', document: (m) => ['Text.', '', `    ${m}`], reads: false },
  { key: 'a tab-indented code block', document: (m) => ['Text.', '', `\t${m}`], reads: false },
  {
    key: 'an indented code block in a list item',
    document: (m) => ['- item', '', `      ${m}`],
    reads: false,
  },
  { key: 'a fenced block', document: (m) => ['```text', m, '```'], reads: false },
  {
    key: 'a four-backtick fenced block holding a shorter fence',
    document: (m) => ['````', '```', m, '````'],
    reads: false,
  },
  { key: 'a tilde fenced block', document: (m) => ['~~~', m, '~~~'], reads: false },
  { key: 'a link definition', document: (m) => [`[ref]: ${m}`], reads: false },
  { key: 'an image description', document: (m) => [`![picture ${m}](picture.png)`], reads: false },
  { key: 'a link destination', document: (m) => [`[label](${m})`], reads: false },
  { key: 'an autolink', document: (m) => [`<https://example.org/${m}>`], reads: false },
  { key: 'an HTML block', document: (m) => ['<div>', m, '</div>'], reads: false },
  { key: 'an HTML comment', document: (m) => [`<!-- ${m} -->`], reads: false },
];

/** Where a path stands. A path in a link destination or a definition is a path by its syntax, a code span's too. */
const PATH = 'notes/absent.md';
const PATH_CONTEXTS: Context[] = [
  { key: 'a code span', document: (p) => [`Read \`${p}\` first.`], reads: true },
  { key: 'a list item', document: (p) => [`- read \`${p}\``], reads: true },
  { key: 'a block quote', document: (p) => [`> read \`${p}\``], reads: true },
  { key: 'a heading', document: (p) => [`## Read \`${p}\``], reads: true },
  { key: 'a table row', document: (p) => ['| case | read |', '|---|---|', `| a | \`${p}\` |`], reads: true },
  { key: 'a link destination', document: (p) => [`Read [the notes](${p}).`], reads: true },
  { key: 'a link definition', document: (p) => [`Read [the notes][r].`, '', `[r]: ${p}`], reads: true },
  { key: 'a link definition in angle brackets', document: (p) => [`[r]: <${p}>`], reads: true },
  { key: 'an image destination', document: (p) => [`![the notes](${p})`], reads: true },
  { key: 'a quoted name', document: (p) => [`Read "${p}" first.`], reads: true },
  {
    key: 'a code span, continued in a list item',
    document: (p) => ['- item', `  more \`${p}\``],
    reads: true,
  },
  { key: 'a lazy line after a paragraph', document: (p) => ['paragraph', `    lazy \`${p}\``], reads: true },
  {
    key: 'text after a fenced block opened on a list item line',
    document: (p) => ['- ```text', '  example', '  ```', '', `Then read \`${p}\`.`],
    reads: true,
  },
  {
    key: 'text after a fenced block opened on an ordered item line',
    document: (p) => ['1. ~~~md', '   example', '   ~~~', '', `Then read \`${p}\`.`],
    reads: true,
  },
  {
    key: 'text after a fenced block opened in a quote',
    document: (p) => ['> ```text', '> example', '> ```', '', `Then read \`${p}\`.`],
    reads: true,
  },
  {
    key: 'text after a comment on the same line',
    document: (p) => [`<!-- hidden --> read \`${p}\``],
    reads: true,
  },
  {
    key: 'a fenced block opened on a list item line',
    document: (p) => ['- ```text', `  Read \`${p}\``, '  ```'],
    reads: false,
  },
  {
    key: 'a fenced block opened on an ordered item line',
    document: (p) => ['1. ~~~md', `   Read \`${p}\``, '   ~~~'],
    reads: false,
  },
  {
    key: 'a fenced block opened in a quote',
    document: (p) => ['> ```text', `> Read \`${p}\``, '> ```'],
    reads: false,
  },
  {
    key: 'a fenced block opened in a nested list item',
    document: (p) => ['- outer', '  - ```text', `    Read \`${p}\``, '    ```'],
    reads: false,
  },
  { key: 'an image description', document: (p) => [`![see ${p} here](picture.png)`], reads: false },
  { key: 'a comment over several lines', document: (p) => ['<!--', `Read \`${p}\``, '-->'], reads: false },
  { key: 'a comment in a sentence', document: (p) => [`Before <!-- read \`${p}\` --> after`], reads: false },
  {
    key: 'a code span over two lines, holding the path as a word',
    document: (p) => ['A `span of words', `${p} more words\` end.`],
    reads: false,
  },
  { key: 'an indented code block', document: (p) => ['Text.', '', `    Read \`${p}\` first.`], reads: false },
  {
    key: 'a tab-indented code block',
    document: (p) => ['Text.', '', `\tRead \`${p}\` first.`],
    reads: false,
  },
  {
    key: 'an indented code block in a list item',
    document: (p) => ['- item', '', `      Read \`${p}\` first.`],
    reads: false,
  },
  { key: 'a fenced block', document: (p) => ['```text', `Read \`${p}\` first.`, '```'], reads: false },
  {
    key: 'a four-backtick block holding a shorter fence',
    document: (p) => ['````', '```', `Read \`${p}\`.`, '````'],
    reads: false,
  },
  { key: 'an HTML comment', document: (p) => [`<!-- Read \`${p}\` -->`], reads: false },
];

async function read(document: string[], extra: Record<string, string> = {}) {
  return observe({ 'CLAUDE.md': ['# Rules', '', ...document, ''].join('\n'), ...extra }, [
    { id: 'namer', path: 'CLAUDE.md' },
  ]);
}

describe('an @ import is read where a person reads text and nowhere else', () => {
  for (const context of IMPORT_CONTEXTS) {
    it(`${context.reads ? 'reads' : 'skips'} it in ${context.key}`, async () => {
      const observed = await read(context.document(IMPORT));
      const missing = unresolvedLinks(observed, IMPORT_LINK, 'namer');
      expect(missing).toHaveLength(context.reads ? 1 : 0);
      expect(from(observed, 'namer', IMPORT_LINK)).toHaveLength(context.reads ? 1 : 0);
      expect(outcome(observed, 'references').status).toBe(
        context.reads ? 'fail' : outcome(observed, 'references').status,
      );
    });
  }

  it('reads the path of an import in a link label up to the end of the label, not the destination after it', async () => {
    const observed = await read(['[go @rules/found.md](https://example.org/page)'], {
      'rules/found.md': '- Keep replies short.\n',
    });
    // The label's import is the file beside the importer: it resolves, and nothing swallows `](...)`.
    expect(unresolvedLinks(observed, IMPORT_LINK, 'namer')).toEqual([]);
    expect(from(observed, 'namer', IMPORT_LINK)).toHaveLength(1);
  });
});

describe('a path is read where a document writes one and nowhere it shows code', () => {
  for (const context of PATH_CONTEXTS) {
    it(`${context.reads ? 'reads' : 'skips'} it in ${context.key}`, async () => {
      const observed = await read(context.document(PATH));
      expect(unresolvedLinks(observed, MENTION_LINK, 'namer')).toHaveLength(context.reads ? 1 : 0);
    });
  }

  describe('with no file type', () => {
    // A code span or a quoted name with no file type is a missing path when its first folder is one the estate
    // holds; `.claude` is the layout, which the reader always walks. A link destination or a definition is a path by
    // its syntax, whatever its folder.
    const bare = '.claude/notes/absent';
    const held = { '.claude/notes/kept.md': '# Kept\n' };
    const READ_WITHOUT_TYPE = PATH_CONTEXTS.filter(
      (context) => context.reads && !context.key.includes('code span, continued'),
    );
    for (const context of READ_WITHOUT_TYPE) {
      it(`reads it in ${context.key}`, async () => {
        const observed = await read(context.document(bare), held);
        expect(unresolvedLinks(observed, MENTION_LINK, 'namer')).toHaveLength(1);
      });
    }

    it('reads a destination in angle brackets that holds a space, as a link and as a definition', async () => {
      for (const document of [['Read [a](<notes/my leaf>).'], ['[r]: <notes/my leaf>']]) {
        const observed = await read(document, { 'notes/kept.md': '# Kept\n' });
        expect(unresolvedLinks(observed, MENTION_LINK, 'namer')).toHaveLength(1);
        const found = await read(document, { 'notes/my leaf': 'leaf\n' });
        expect(from(found, 'namer', MENTION_LINK)).toHaveLength(1);
        expect(unresolvedLinks(found, MENTION_LINK, 'namer')).toEqual([]);
      }
    });

    it('lists, never drops, a definition or an angle destination with a pair of words and no folder', async () => {
      for (const document of [['[r]: <yes/no>'], ['Read [a](<yes/no>).'], ['[r]: yes/no']]) {
        const observed = await read(document);
        const references = outcome(observed, 'references');
        // Link destinations are paths by syntax: a missing one fails.
        expect(references.status).toBe('fail');
      }
    });
  });
});
