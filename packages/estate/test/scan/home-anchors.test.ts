import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, mapHome, scriptOf } from '../../src/index';
import { estate } from '../support';

/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: the shell expands the home variable. */

describe('home anchors', () => {
  it.each(['~/hooks/a.py', '$HOME/hooks/a.py', '${HOME}/hooks/a.py', '"$HOME"/hooks/a.py'])(
    'reads %s as anchored, with one spelling',
    (path) => {
      expect(scriptOf(`python3 ${path}`)).toEqual({ script: '~/hooks/a.py', anchored: true });
    },
  );

  it('maps a home form under the home folder, and nothing else', () => {
    expect(mapHome('$HOME/hooks/a.py', 'home')).toBe('home/hooks/a.py');
    expect(mapHome('${HOME}/hooks/a.py', '')).toBe('hooks/a.py');
    expect(mapHome('~/hooks/a.py', 'home')).toBe('home/hooks/a.py');
    expect(mapHome('~/hooks/a.py', undefined)).toBeUndefined();
    expect(mapHome('hooks/a.py', 'home')).toBeUndefined();
    expect(mapHome('$HOMES/hooks/a.py', 'home')).toBeUndefined();
  });

  it('finds the script under the home folder inside the estate', () => {
    const paths = new Set(['home/hooks/a.py']);
    expect(scriptOf('python3 "$HOME/hooks/a.py"', paths, undefined, 'home')).toEqual({
      script: 'home/hooks/a.py',
      anchored: true,
    });
  });

  it('maps a changed folder under the home folder', () => {
    const paths = new Set(['home/hooks/a.py']);
    expect(scriptOf('cd "$HOME/hooks" && python3 a.py', paths, undefined, 'home')).toEqual({
      script: 'home/hooks/a.py',
      anchored: true,
    });
  });

  const files = {
    'CLAUDE.md': '# Synthetic estate\n',
    '.claude/settings.json': JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 "${HOME}/guards/audit.py"' }] },
        ],
      },
    }),
    'userhome/guards/audit.py': '#!/usr/bin/env python3\n',
  };

  it('keeps a home guard external without a home folder', async () => {
    const root = await estate(files);
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.home).toBeUndefined();
    expect(raw.guards.map((guard) => [guard.script, guard.anchored])).toEqual([['~/guards/audit.py', true]]);
  });

  it('finds the guard script when the home folder is inside the estate', async () => {
    const root = await estate(files);
    const raw = await new ClaudeCodeReader({ home: join(root, 'userhome') }).read(root);
    expect(raw.home).toBe('userhome');
    expect(raw.guards.map((guard) => [guard.script, guard.anchored])).toEqual([
      ['userhome/guards/audit.py', true],
    ]);
  });

  it('keeps a home folder outside the estate unmapped', async () => {
    const root = await estate(files);
    const raw = await new ClaudeCodeReader({ home: join(root, '..', 'elsewhere') }).read(root);
    expect(raw.home).toBeUndefined();
    expect(raw.guards.map((guard) => guard.script)).toEqual(['~/guards/audit.py']);
  });

  it('refuses an empty home folder', () => {
    expect(() => new ClaudeCodeReader({ home: ' ' })).toThrow(RangeError);
  });
});
