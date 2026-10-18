import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { blankFences } from '../../src/scan/text';
import { estate, NOW } from '../support';

const skill = '.claude/skills/reconcile/SKILL.md';
const body = '---\nname: reconcile\ndescription: Reconcile an invoice.\n---\n\n';

describe('comments are not instructions or references', () => {
  it('does not read gates, hazards or references inside single and multiline comments', async () => {
    const root = await estate({
      [skill]:
        body +
        [
          '<!-- Before editing: read `references/hidden.md`. -->',
          '<!--',
          'After compaction, reopen the tracker.',
          'Read `references/hidden.md` before booking a credit note.',
          '-->',
          'Read `references/real.md` for the invoice.',
        ].join('\n'),
      '.claude/skills/reconcile/references/hidden.md': '# Hidden\n',
      '.claude/skills/reconcile/references/real.md': '# Real\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'gate' || a.kind === 'hazard')).toEqual([]);
    const references = map.atoms.filter((a) => a.kind === 'reference');
    expect(references).toHaveLength(1);
    expect(references[0]?.fields?.path).toBe('.claude/skills/reconcile/references/real.md');
    expect(references[0]?.provenance.startLine).toBe(11);
  });

  it('keeps visible prose around an inline comment and its original line number', () => {
    const text = 'Visible. <!-- ignored\nAfter restart, do the wrong thing. --> Keep going.\nReal line.';
    const masked = blankFences(text);
    expect(masked.split('\n')).toHaveLength(3);
    expect(masked).not.toContain('restart');
    expect(masked).toContain('Visible.');
    expect(masked.split('\n')[1]).toContain('Keep going.');
    expect(masked.split('\n')[2]).toBe('Real line.');
  });

  it('keeps an unclosed comment hidden through the end of the file', () => {
    expect(blankFences('Real line.\n<!--\nAfter compaction, read secret.md.')).not.toContain('compaction');
  });
  it('carries comment state across prose chunks and does not discover a root file named only in a comment', async () => {
    const root = await estate({
      [skill]:
        body +
        [
          '<!--',
          'Draft instructions are hidden and must stay hidden.',
          'Before editing: read `ghost.md`.',
          'After compaction, read `ghost.md`.',
          '-->',
          'Read `references/real.md` for the invoice.',
        ].join('\n'),
      'ghost.md': '# Hidden root guide\n',
      '.claude/skills/reconcile/references/real.md': '# Real\n',
    });
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader({ chunkCharacters: 35 }),
      now: NOW,
    });
    expect(raw.prose.length).toBeGreaterThan(1);
    expect(raw.files.map((file) => file.path)).not.toContain('ghost.md');
    expect(map.atoms.filter((a) => a.kind === 'gate' || a.kind === 'hazard')).toEqual([]);
    expect(map.atoms.filter((a) => a.kind === 'reference').map((a) => a.fields?.path)).toEqual([
      '.claude/skills/reconcile/references/real.md',
    ]);
  });

  it('keeps the original quote when visible reference prose contains an inline comment', async () => {
    const quote = 'Read `references/real.md` <!-- hidden note --> for the invoice.';
    const root = await estate({
      [skill]: body + quote,
      '.claude/skills/reconcile/references/real.md': '# Real\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.find((a) => a.kind === 'reference')?.provenance.quote).toBe(quote);
  });

  it('does not let a comment marker in a code example hide later visible prose', () => {
    expect(blankFences('```html\n<!-- example\n```\nVisible prose.')).toContain('Visible prose.');
  });
  it('does not treat quoted comment or fence markers in frontmatter as body markup', async () => {
    const root = await estate({
      [skill]:
        '---\nname: reconcile\ndescription: "A literal <!-- marker"\n---\nRead `references/real.md`.\n',
      '.claude/skills/reconcile/references/real.md': '# Real\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'reference').map((a) => a.fields?.path)).toEqual([
      '.claude/skills/reconcile/references/real.md',
    ]);
  });
  it('does not add a helper dispatch edge for a comment split across chunks', async () => {
    const root = await estate({
      [skill]:
        body +
        '<!--\nHidden draft of the helper call.\nDispatch the `auditor` agent for the invoice.\n-->\nKeep the invoice open.',
      '.claude/agents/auditor.md':
        '---\nname: auditor\ndescription: Audit an invoice.\n---\nRead the invoice.',
    });
    const { map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader({ chunkCharacters: 30 }),
      now: NOW,
    });
    expect(map.edges.filter((edge) => edge.kind === 'dispatch')).toEqual([]);
  });

  it('does not resolve a reference through an alias declared only in a comment', async () => {
    const root = await estate({
      [skill]:
        body +
        '<!-- `REF` = `.claude/skills/reconcile/private` -->\n`REF` = `.claude/skills/reconcile/references`\nRead `REF/guide.md`.',
      '.claude/skills/reconcile/private/guide.md': '# Private\n',
      '.claude/skills/reconcile/references/guide.md': '# Real\n',
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(raw.aliases?.REF).toEqual(['.claude/skills/reconcile/references']);
    expect(map.atoms.find((atom) => atom.kind === 'reference')?.fields?.path).toBe(
      '.claude/skills/reconcile/references/guide.md',
    );
  });
});
