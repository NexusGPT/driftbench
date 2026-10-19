import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../src/index';
import { answer, estate, NOW, scanFixture, structurePointer } from './support';

describe('estate lint', () => {
  it('finds every defect planted in the fixture, and nothing else', async () => {
    const { map, raw } = await scanFixture();
    const result = lintEstate(map, raw);
    const found = result.findings.filter((finding) => finding.code !== 'UNENFORCED');
    expect(found.map((finding) => [finding.code, finding.subject])).toEqual([
      // The recorded labellers read the sentence that names currency-table.md as a condition, so the file shows
      // as an orphan with the planted one.
      ['ORPHAN', '.claude/skills/invoice-reconcile/references/currency-table.md'],
      ['ORPHAN', '.claude/skills/invoice-reconcile/references/old-tolerances.md'],
      ['UNREACHABLE', '.claude/agents/inbox-triager.md'],
      ['MISSING_REFERENCE', 'reference.weekly-report.read-references-kpi-definitions-md'],
      ['UNANCHORED_GUARD', 'python3 .claude/guards/ledger-guard.py'],
      ['REGISTRY_ROW', 'reply-length.py'],
      ['REGISTRY_GUARD', 'G6'],
    ]);
    expect(result.counts.UNENFORCED).toBe(57);
    expect(result.failed).toBe(true);
  });

  it('reports an oversize set of standing instructions against the ceiling', async () => {
    const { map, raw } = await scanFixture();
    const characters = raw.files
      .filter((file) => file.kind === 'standing' || file.kind === 'memory')
      .reduce((sum, file) => sum + file.text.length, 0);
    expect(lintEstate(map, raw, { ceiling: characters }).counts.OVERSIZE).toBe(0);
    const over = lintEstate(map, raw, { ceiling: characters - 1 });
    expect(
      over.findings.filter((finding) => finding.code === 'OVERSIZE').map((finding) => finding.message),
    ).toEqual([
      `the standing instructions hold ${characters} characters, over the ceiling of ${characters - 1}`,
    ]);
  });

  it('passes a clean estate, where unenforced rules alone do not fail the lint', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n\nNever touch the vault folder at all.\n',
      '.claude/settings.json': JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/guards/g.sh' }] }],
        },
      }),
      '.claude/guards/g.sh': '#!/bin/sh\nexit 0\n',
    });
    const port = new FakeModelPort([
      answer('CLAUDE.md', [
        {
          kind: 'instruction',
          title: 'No vault',
          quote: 'Never touch the vault folder at all.',
          evidence: [{ type: 'custom', name: 'v' }],
        },
      ]),
    ]);
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), port, now: NOW });
    const result = lintEstate(map, raw);
    expect(result.findings.map((finding) => finding.code)).toEqual(['UNENFORCED']);
    expect(result.failed).toBe(false);
  });

  it('reports a guard whose script is missing, and quote drift after the estate changed', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n\nRead `.claude/guide.md` before editing a page.\n',
      '.claude/guide.md': '# Guide\n',
      '.claude/settings.json': JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/guards/gone.sh' }] }],
        },
      }),
    });
    const { map, raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    const changed = {
      ...raw,
      files: raw.files.map((file) =>
        file.path === 'CLAUDE.md' ? { ...file, text: '# Rules\n\nRead it whenever.\n' } : file,
      ),
    };
    const codes = lintEstate(map, changed).findings.map((finding) => finding.code);
    expect(codes).toContain('MISSING_SCRIPT');
    expect(codes.filter((code) => code === 'QUOTE_DRIFT')).toHaveLength(1);
  });
});
