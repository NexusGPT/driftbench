import { describe, expect, it } from 'vitest';
import { pathMentions } from '../../src/scan/code';

const read = (line: string, extensionless = true) =>
  pathMentions(line, extensionless ? { extensionless: true } : {}).map((found) => [found.path, found.syntax]);

describe('a path with no file extension, read by its syntax', () => {
  it('is read from a link destination, and from a delimited name that holds a folder separator', () => {
    expect(read('Read [the entry](references/leaf) and [the tool](tool).')).toEqual([
      ['references/leaf', 'link'],
      ['tool', 'link'],
    ]);
    expect(read('Run `bin/tool`, open "docs/guide" and <notes/page> or **notes/bold**.')).toEqual([
      ['bin/tool', 'code-span'],
      ['docs/guide', 'quoted'],
      ['notes/page', 'angle'],
      ['notes/bold', 'bold'],
    ]);
  });

  it('is not read without the option, as before', () => {
    expect(read('Read [the entry](references/leaf) and `bin/tool`.', false)).toEqual([]);
    expect(read('Read [the entry](references/leaf.md) and `bin/tool.sh`.', false)).toEqual([
      ['bin/tool.sh', 'code-span'],
      ['references/leaf.md', 'link'],
    ]);
  });

  it('is not read from a word, a phrase, a folder, a dot segment or a section', () => {
    expect(read('Use `tool` and `git status` and `cd src/app` and "plain words".')).toEqual([]);
    expect(read('See [folder](references/), [here](.), [up](..), [top](#top), [q](?x=1).')).toEqual([]);
    expect(read('Mail [us](mailto:team@example.org) or [go](https://example.org/guide).')).toEqual([]);
    expect(read('Write `out/<date>`, `notes/*` and `a/b | c`.')).toEqual([]);
  });

  it('reads a loose pair as a bare path, which the graph treats as a word unless a file answers', () => {
    expect(
      pathMentions('Use and/or when it helps.', { extensionless: true }).map((found) => found.bare),
    ).toEqual([true]);
  });

  it('keeps a dot-relative form and drops an anchor and a line number', () => {
    expect(read('Read [x](./leaf#part) and `./bin/tool:12`.')).toEqual([
      ['./bin/tool', 'code-span'],
      ['./leaf', 'link'],
    ]);
  });
});
