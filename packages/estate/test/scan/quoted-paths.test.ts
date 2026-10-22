import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { namedPaths } from '../../src/scan/code';
import { estate, NOW, structurePointer } from '../support';

describe('a file path in prose quotes', () => {
  it.each(["'references/guide.md'", '"references/guide.md"'])('reads %s as one file path', (markup) => {
    expect(namedPaths(`Read ${markup} for the invoice.`)).toEqual(['references/guide.md']);
  });
  it('does not turn a link title or a quote within a command into an extra reference', () => {
    expect(namedPaths('[the notes](references/real.md "ghost.md")')).toEqual(['references/real.md']);
    expect(namedPaths('Example: `cat "notes.md" | wc -l` prints the count.')).toEqual([]);
    expect(namedPaths('The sentence "Read notes.md before editing" is an example.')).toEqual([]);
    expect(namedPaths('See "https://example.com/notes.md".')).toEqual([]);
  });
  it('resolves the quoted path and preserves its source quote', async () => {
    const quote = 'Read "references/guide.md" for the invoice.';
    const root = await estate({
      '.claude/skills/reconcile/SKILL.md': `---\nname: reconcile\ndescription: Reconcile an invoice.\n---\n${quote}`,
      '.claude/skills/reconcile/references/guide.md': '# Guide\n',
    });
    const { map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    expect(map.atoms.find((a) => a.kind === 'reference')).toMatchObject({
      fields: { path: '.claude/skills/reconcile/references/guide.md', exists: true },
      provenance: { quote },
    });
  });
  it('reads the quoted file destination of an HTML link', () => {
    expect(namedPaths('Read <a href="references/guide.md">the guide</a>.')).toEqual(['references/guide.md']);
  });
});
