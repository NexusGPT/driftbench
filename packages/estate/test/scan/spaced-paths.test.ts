import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../../src/index';
import { namedPaths } from '../../src/scan/code';
import { estate, NOW } from '../support';

describe('file names containing spaces', () => {
  it.each([
    '`references/team notes.md`',
    '[team notes](<references/team notes.md>)',
    '[team notes](<references/team notes.md#limits> "Team notes")',
  ])('reads one whole path from %s', (markup) => {
    expect(namedPaths(`Read ${markup} for the invoice.`)).toEqual(['references/team notes.md']);
  });
  it('does not read command examples, folder names or web links as files', () => {
    expect(
      namedPaths(
        'Example: `cat notes.md | wc -l`, `node references/check.js --all`, `references/`, [web](<https://example.com/team notes.md>).',
      ),
    ).toEqual([]);
  });
  it('resolves and lints a spaced reference, preserving its exact quote', async () => {
    const quote = 'Read `references/team notes.md` for the invoice.';
    const root = await estate({
      '.claude/skills/reconcile/SKILL.md': `---\nname: reconcile\ndescription: Reconcile an invoice.\n---\n${quote}`,
      '.claude/skills/reconcile/references/team notes.md': '# Notes\n',
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.find((atom) => atom.kind === 'reference')).toMatchObject({
      fields: { path: '.claude/skills/reconcile/references/team notes.md', exists: true },
      provenance: { quote },
    });
    expect(
      lintEstate(map, raw).findings.filter((f) => f.code === 'MISSING_REFERENCE' || f.code === 'ORPHAN'),
    ).toEqual([]);
  });
  it('keeps a simple execution or command example separate from a literal file name', () => {
    expect(namedPaths('Run `cat notes.md`.')).toEqual([]);
    expect(namedPaths('Example: `cat notes.md`.')).toEqual([]);
    expect(namedPaths('Read `cat notes.md`.')).toEqual(['cat notes.md']);
  });
});
