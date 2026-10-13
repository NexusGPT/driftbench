import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

async function lintOf(command: string, extra: Record<string, string> = {}) {
  const root = await estate({
    'CLAUDE.md': '# Rules\n',
    '.claude/settings.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }),
    '.claude/hooks/lib/run.py': '#!/usr/bin/env python3\n',
    ...extra,
  });
  const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return {
    guard: raw.guards[0],
    missing: lintEstate(map, raw).findings.filter((finding) => finding.code === 'MISSING_SCRIPT'),
  };
}

describe('a dispatcher that names a hook script the estate does not hold', () => {
  it('reports the missing hook as a missing script, and keeps the dispatcher as what runs', async () => {
    const { guard, missing } = await lintOf(
      'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/lib/run.py gone-hook',
    );
    expect(guard).toMatchObject({ script: '.claude/hooks/lib/run.py', missingTarget: 'gone-hook' });
    expect(missing.map((finding) => finding.message)).toEqual([
      'the guard runs .claude/hooks/lib/run.py, which hands it to gone-hook, a script that does not exist',
    ]);
  });

  it('reports nothing when the named hook exists, or when the word is a flag value or an id', async () => {
    expect(
      (
        await lintOf('python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/lib/run.py block-push', {
          '.claude/hooks/block-push.py': '#!/usr/bin/env python3\n',
        })
      ).missing,
    ).toEqual([]);
    expect(
      (await lintOf('python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/lib/run.py --mode strict')).missing,
    ).toEqual([]);
    expect((await lintOf('python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/lib/run.py ID 42')).missing).toEqual(
      [],
    );
  });
});
