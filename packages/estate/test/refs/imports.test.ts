import { mkdir, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, importMentions, referenceGraph } from '../../src/index';
import { estate } from '../support';

const written = (line: string, prefix = '@') => importMentions(line, prefix).map((found) => found.written);

describe('the import syntax', () => {
  it('reads a path after the prefix, anywhere in a line, at its start or after a space', () => {
    expect(written('@rules/a.md')).toEqual(['rules/a.md']);
    expect(written('See @rules/a.md for the details.')).toEqual(['rules/a.md']);
    expect(written('- team conventions @rules/a.md')).toEqual(['rules/a.md']);
    expect(written('| @rules/a.md | note |')).toEqual(['rules/a.md']);
    expect(written('Read @one.md and @two/three.md first')).toEqual(['one.md', 'two/three.md']);
  });

  it('ends the path at the first space unless each space is written with a backslash', () => {
    expect(written('@Design\\ Docs/api.md is long')).toEqual(['Design Docs/api.md']);
    expect(written('@Design Docs/api.md')).toEqual(['Design']);
  });

  it('keeps sentence punctuation out of the path', () => {
    expect(written('See @rules/a.md.')).toEqual(['rules/a.md']);
    expect(written('(see @rules/a.md, then stop)')).toEqual(['rules/a.md']);
  });

  it('reads nothing inside a code span anywhere in the line, a link label included', () => {
    expect(written('[see `run @rules/a.md`](https://example.org/page)')).toEqual([]);
    expect(written('[`go @rules/a.md` explained](notes.md) and `then @rules/b.md` as text')).toEqual([]);
    expect(written('**bold `x @rules/a.md`** and _it `y @rules/b.md`_')).toEqual([]);
    expect(written('[the `use @a.md` page](u) then @real.md')).toEqual(['real.md']);
    expect(written('``two @rules/a.md ticks`` and `@rules/b.md`')).toEqual([]);
    expect(written('![image `alt @rules/a.md`](picture.png)')).toEqual([]);
  });

  it('reads nothing inside a code span, inside a word or from a quoted path', () => {
    expect(written('Write `@rules/a.md` to keep the text as it is.')).toEqual([]);
    expect(written('Mail ops@example.org about it.')).toEqual([]);
    expect(written('@"rules/a b.md"')).toEqual([]);
    expect(written("@'rules/a.md'")).toEqual([]);
    expect(written('@ alone')).toEqual([]);
  });

  it('takes the prefix the rule names', () => {
    expect(written('See $rules/a.md now', '$')).toEqual(['rules/a.md']);
    expect(written('See @rules/a.md now', '$')).toEqual([]);
  });
});

const read = async (files: Record<string, string>) => new ClaudeCodeReader().read(await estate(files));

describe('imports in the reference graph', () => {
  it('links an import to the file it names, read from the importer folder and from nowhere else', async () => {
    const raw = await read({
      '.claude/CLAUDE.md': '# Rules\n\n@rules/near.md\n@rules/far.md\n',
      '.claude/rules/near.md': '- Keep replies short.\n',
      'rules/far.md': '- Ask before deleting.\n',
    });
    const graph = referenceGraph(raw);
    expect(graph.links.map((link) => [link.kind, link.from, link.to])).toEqual([
      ['includes', '.claude/CLAUDE.md', '.claude/rules/near.md'],
    ]);
    expect(graph.dangling.map((entry) => [entry.mention.written, entry.outcome, entry.path])).toEqual([
      ['rules/far.md', 'missing', '.claude/rules/far.md'],
    ]);
  });

  it('follows a chain, each import read from the folder of the file that holds it', async () => {
    const raw = await read({
      'CLAUDE.md': '# Rules\n\nSee @one/first.md for the details.\n',
      'one/first.md': '# First\n\n@two/second.md\n',
      'one/two/second.md': '# Second\n\nImports @third.md here.\n',
      'one/two/third.md': '- Keep replies short.\n',
    });
    const links = referenceGraph(raw).links.map((link) => `${link.from} -> ${link.to}`);
    expect(links).toEqual([
      'CLAUDE.md -> one/first.md',
      'one/first.md -> one/two/second.md',
      'one/two/second.md -> one/two/third.md',
    ]);
  });

  it('ends a cycle of imports, with a link for every import in it', async () => {
    const raw = await read({
      'CLAUDE.md': '# Rules\n\n@a.md\n',
      'a.md': '# A\n\n@b.md\n',
      'b.md': '# B\n\n@a.md\n',
    });
    const links = referenceGraph(raw)
      .links.map((link) => `${link.from} -> ${link.to}`)
      .sort();
    expect(links).toEqual(['CLAUDE.md -> a.md', 'a.md -> b.md', 'b.md -> a.md']);
  });

  it('puts a path outside the estate apart from a missing one, and says nothing of a lone word', async () => {
    const raw = await read({
      'CLAUDE.md':
        '# Rules\n\n@~/notes/mine.md\n@/opt/shared/notes.md\n@../beside/notes.md\n@absent/notes.md\n@mention\n',
    });
    const outcomes = referenceGraph(raw).dangling.map((entry) => [entry.mention.written, entry.outcome]);
    expect(outcomes).toEqual([
      ['~/notes/mine.md', 'external'],
      ['/opt/shared/notes.md', 'external'],
      ['../beside/notes.md', 'external'],
      ['absent/notes.md', 'missing'],
    ]);
  });

  it('reads an import in a standing file only, not in a skill body', async () => {
    const raw = await read({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/ab/SKILL.md':
        '---\nname: ab\ndescription: Handles ab work.\n---\n\nMention @handle in a sentence.\n',
    });
    expect(referenceGraph(raw).entries.filter((entry) => entry.mention.import)).toEqual([]);
  });
});

describe('an import that is a cycle, or that leads out of the estate by a link the reader denied', () => {
  it('resolves a file that imports itself, and a pair that import each other: a cycle is no missing file', async () => {
    const raw = await read({
      'CLAUDE.md': '# Rules\n\n@CLAUDE.md\n@one.md\n',
      'one.md': '# One\n\n@two.md\n@one.md\n',
      'two.md': '# Two\n\n@one.md\n',
    });
    const graph = referenceGraph(raw);
    expect(graph.dangling).toEqual([]);
    expect(graph.links.map((link) => `${link.from} -> ${link.to}`).sort()).toEqual([
      'CLAUDE.md -> CLAUDE.md',
      'CLAUDE.md -> one.md',
      'one.md -> one.md',
      'one.md -> two.md',
      'two.md -> one.md',
    ]);
  });

  it('reports an import through a link the reader denied as outside the estate, never as missing', async () => {
    const outside = await estate({ 'a.md': '- Keep replies short.\n' });
    const root = await estate({ 'CLAUDE.md': '# Rules\n\n@rules/a.md\n@rules/b.md\n' });
    await mkdir(dirname(join(root, 'rules')), { recursive: true });
    await symlink(outside, join(root, 'rules'));
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.externals).toEqual(expect.arrayContaining(['rules/a.md']));
    const graph = referenceGraph(raw);
    expect(graph.dangling.map((entry) => [entry.mention.written, entry.outcome])).toEqual([
      ['rules/a.md', 'external'],
      ['rules/b.md', 'external'],
    ]);
    expect(graph.links).toEqual([]);
  });

  it('still reports a missing import beside a denied one', async () => {
    const outside = await estate({ 'a.md': '- Keep replies short.\n' });
    const root = await estate({ 'CLAUDE.md': '# Rules\n\n@rules/a.md\n@absent/c.md\n' });
    await symlink(outside, join(root, 'rules'));
    const graph = referenceGraph(await new ClaudeCodeReader().read(root));
    expect(graph.dangling.map((entry) => [entry.mention.written, entry.outcome])).toEqual([
      ['rules/a.md', 'external'],
      ['absent/c.md', 'missing'],
    ]);
  });
});
