import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

describe('standing files in subfolders of the project', () => {
  it('reads a CLAUDE.md in a subfolder as standing prose, and skips ignored and hidden folders', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      'src/ledger/CLAUDE.md': '# Folder notes\n\nAlways keep the totals in whole cents.\n',
      'src/ledger/deep/CLAUDE.local.md': '# Local\n\nNever round twice.\n',
      'node_modules/pkg/CLAUDE.md': '# Not ours\n',
      '.git/CLAUDE.md': '# Not ours\n',
      'src/ledger/notes.md': '# Not standing\n',
    });
    const reader = new ClaudeCodeReader();
    const raw = await reader.read(root);
    expect(raw.files.filter((file) => file.kind === 'standing').map((file) => file.path)).toEqual([
      'CLAUDE.md',
      'src/ledger/CLAUDE.md',
      'src/ledger/deep/CLAUDE.local.md',
    ]);
    expect(raw.prose.map((chunk) => chunk.file)).toContain('src/ledger/CLAUDE.md');
    expect(await reader.listFiles(root)).toEqual(
      expect.arrayContaining(['src/ledger/CLAUDE.md', 'src/ledger/deep/CLAUDE.local.md']),
    );
  });

  it('leaves a subfolder standing file out of the size ceiling, which counts what loads at start', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      'src/big/CLAUDE.md': `${'a'.repeat(41_000)}\n`,
    });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(lintEstate(map, raw).findings.filter((finding) => finding.code === 'OVERSIZE')).toEqual([]);
  });
});
