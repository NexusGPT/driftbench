import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

async function scriptLines(body: string[]) {
  const root = await estate({
    'CLAUDE.md': '# Rules\n',
    '.claude/skills/a/scripts/tally.py': '#!/usr/bin/env python3\n"""Tallies."""\n',
    '.claude/skills/a/SKILL.md': ['---', 'name: a', 'description: Does a.', '---', '', ...body, ''].join(
      '\n',
    ),
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.atoms
    .filter((atom) => atom.kind === 'script')
    .map((atom) => [atom.provenance.file, atom.provenance.startLine, atom.fields?.named]);
}

describe('the line that names a script', () => {
  it('anchors the script on the line that runs it by its path, not a passing mention', async () => {
    expect(
      await scriptLines([
        'The old tally.py was slow; never mind it.',
        'Run `python3 scripts/tally.py ID` to count.',
      ]),
    ).toEqual([['.claude/skills/a/SKILL.md', 7, true]]);
  });

  it('prefers a backticked name over a bare one, and keeps the only mention', async () => {
    expect(await scriptLines(['Ignore tally.py notes.', 'Run `tally.py` nightly.'])).toEqual([
      ['.claude/skills/a/SKILL.md', 7, true],
    ]);
    expect(await scriptLines(['The tally.py script counts.'])).toEqual([
      ['.claude/skills/a/SKILL.md', 6, true],
    ]);
  });
});
