import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

async function gates(line: string) {
  const root = await estate({
    '.claude/skills/a/SKILL.md': `---\nname: a\ndescription: Does a.\n---\n\n${line}\n`,
    '.claude/skills/a/references/rules.md': '# Rules\n',
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.atoms
    .filter((atom) => atom.kind === 'gate')
    .map((atom) => {
      const pair = atom.evidence.find((item) => item.type === 'ordered') as
        | { before: string; after: string }
        | undefined;
      return [atom.fields?.first, atom.fields?.path, `${pair?.before}>${pair?.after}`];
    });
}

const RULES = ['references/rules.md', '.claude/skills/a/references/rules.md', 'Read>Edit'];

describe('gates in other wordings', () => {
  it.each([
    'Read `references/rules.md` first, then edit the label.',
    'Never edit a shelf without reading `references/rules.md`.',
    'Do not edit a shelf without first reading `references/rules.md`.',
    'Edit a parcel only after reading `references/rules.md`.',
    'Editing a parcel? Read `references/rules.md` first.',
    'Prior to editing a shelf, read `references/rules.md`.',
  ])('reads %s', async (line) => {
    expect(await gates(line)).toEqual([RULES]);
  });

  it('reads the file a markdown link names as the first thing to read', async () => {
    expect(await gates('Before editing a route: read [the rules](references/rules.md).')).toEqual([
      ['references/rules.md', '.claude/skills/a/references/rules.md', 'Read>Edit'],
    ]);
  });

  it.each([
    'The phrase "before editing: read the notes" is only an example of a gate.',
    'Never read `references/rules.md` before editing a route; the draft is private.',
    'Do not read `references/rules.md` before you edit it.',
    'Never mind without reading `references/rules.md`.',
    'Read `references/rules.md` first, then lunch.',
    'Prior to 9 in the morning, read `references/rules.md`.',
  ])('reads no gate in %s', async (line) => {
    expect(await gates(line)).toEqual([]);
  });

  it('keeps a gate whose file is quoted with double quotes', async () => {
    expect(await gates('Before editing a route: read "references/rules.md".')).toEqual([RULES]);
  });
});
