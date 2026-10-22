import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, HAND_ROLES, NOW, readRaw } from '../support';
import { CASES } from './cases';

const SETTINGS = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/shell.py' }],
      },
    ],
    Stop: [{ hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/reply.py' }] }],
  },
});

const RULES = [
  '# Rules',
  '',
  '- **R1.** Never delete a file under the archive folder.',
  '- **R2.** Keep every reply under 900 characters unless asked.',
  '- **R3.** Always name the order number in a reply about an order.',
  '',
].join('\n');

const REGISTRY = [
  '# Checks',
  '',
  '| Status | Meaning |',
  '|---|---|',
  '| enforce | the check blocks |',
  '',
  '| id | adapter | event | fires when | rollout |',
  '|---|---|---|---|---|',
  '| K1 | shell | PreToolUse | a command deletes in the archive, against R1 | enforce |',
  '| K2 | `reply.py` | Stop | a reply breaks "Keep every reply under 900 characters" | observe |',
  '| K3 | judge | Stop | a reply about an order leaves out the number | off |',
  '',
  '| Code | Script | Rules |',
  '|---|---|---|',
  '| K4 | reply.py | R3 |',
  '',
].join('\n');

describe('the check registry, any column set', () => {
  it('reads every table whose first column holds ids, and finds each row its guard', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS,
      '.claude/hooks/shell.py': '# Runs K1.\nimport sys\nsys.exit(0)\n',
      '.claude/hooks/reply.py': 'import sys\nsys.exit(0)\n',
      '.claude/hooks/CHECK-REGISTRY.md': REGISTRY,
    });
    const raw = await readRaw(root);
    expect(
      raw.registry.map((row) => [row.id, row.guard, row.event ?? '', row.state ?? '', row.enforces]),
    ).toEqual([
      ['K1', 'shell.py', 'PreToolUse', 'enforce', [{ id: 'R1' }]],
      ['K2', 'reply.py', 'Stop', 'observe', [{ quote: 'Keep every reply under 900 characters' }]],
      ['K3', 'judge', 'Stop', 'off', []],
      ['K4', 'reply.py', '', '', [{ id: 'R3' }]],
    ]);
    expect(raw.registry[0]?.at).toEqual({
      file: '.claude/hooks/CHECK-REGISTRY.md',
      startLine: 9,
      endLine: 9,
      quote: '| K1 | shell | PreToolUse | a command deletes in the archive, against R1 | enforce |',
    });
  });

  it('links each guard to the rules of every row that names it, by id and by quoted passage', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS,
      '.claude/hooks/shell.py': '# Runs K1.\nimport sys\nsys.exit(0)\n',
      '.claude/hooks/reply.py': 'import sys\nsys.exit(0)\n',
      '.claude/hooks/CHECK-REGISTRY.md': REGISTRY,
    });
    const answers = {
      family: 'test',
      model: 'by hand',
      async complete() {
        return JSON.stringify({
          chunk: 'CLAUDE.md',
          atoms: [
            {
              kind: 'instruction',
              title: 'Never delete in the archive',
              quote: 'Never delete a file under the archive folder.',
              evidence: [{ type: 'tool_not_called', label: 'Bash' }],
            },
            {
              kind: 'register',
              title: 'Short replies',
              quote: 'Keep every reply under 900 characters unless asked.',
              evidence: [{ type: 'tool_not_called', label: 'Write' }],
            },
            {
              kind: 'instruction',
              title: 'Name the order number',
              quote: 'Always name the order number in a reply about an order.',
              evidence: [{ type: 'tool_not_called', label: 'Write' }],
            },
          ],
        });
      },
    };
    const { map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      registryRoles: HAND_ROLES,
      port: answers,
      now: NOW,
    });
    const guards = map.atoms.filter((atom) => atom.kind === 'guard');
    expect(
      guards.map((guard) => [
        guard.fields?.name,
        guard.fields?.registry,
        guard.fields?.registryRows,
        guard.fields?.state,
      ]),
    ).toEqual([
      ['shell.py', 'K1', undefined, 'enforce'],
      ['reply.py', 'K2', ['K2', 'K4'], 'observe'],
    ]);
    const enforced = Object.fromEntries(
      map.atoms
        .filter((atom) => ['instruction', 'register'].includes(atom.kind))
        .map((atom) => [atom.title, atom.enforcement]),
    );
    expect(enforced).toEqual({
      'Never delete in the archive': ['guard.settings.pretooluse-bash-guard-shell-py'],
      'Short replies': ['guard.settings.stop-guard-reply-py'],
      'Name the order number': ['guard.settings.stop-guard-reply-py'],
    });
  });

  it('reads the reader-cases registry: the first table by its guard column, the second by its ids', async () => {
    const raw = await readRaw(CASES);
    const table = raw.registry.filter((row) => row.origin !== 'catalogue');
    expect(table.map((row) => [row.id, row.guard, row.state ?? ''])).toEqual([
      ['G1', 'block-force-push.sh', ''],
      ['W1', 'block-force-push.sh', 'enforce'],
      ['W2', 'block-force-push.sh', 'observe'],
      ['C2', 'C2', 'observe'],
      ['W3', 'claim-window.py', 'enforce'],
      ['W4', 'claim-window.py', 'observe'],
      ['W5', 'claim-window.py', 'observe'],
      ['HANDBACK', 'claim-window.py', 'observe'],
      ['STOP-WAKE', 'claim-window.py', 'observe'],
      ['W6', 'claim-window.py', 'observe'],
      ['W7', 'block-force-push.sh', 'enforce'],
      ['W8', 'claim-window.py', 'observe'],
      ['W9', 'claim-window.py', 'observe'],
    ]);
    expect(raw.registry.find((row) => row.id === 'W2')?.enforces).toEqual([
      { quote: 'Never run `git push --force` on any branch' },
    ]);
  });

  it('splits an id cell that names several checks, and keeps a cell of words as one id', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/settings.json': SETTINGS,
      '.claude/hooks/shell.py': '# Runs K1, G2, G3, G9, HANDBACK and STOP-WAKE.\nimport sys\n',
      '.claude/hooks/reply.py': 'import sys\n',
      '.claude/hooks/CHECK-REGISTRY.md': [
        '| Id | Adapter | Fires when |',
        '|---|---|---|',
        '| `G2` `G3` `G9` | shell | R1 |',
        '| HANDBACK` / `STOP-WAKE | shell | R1 |',
        '| G2, G3 | shell | R1 |',
        '| Reply length | `reply.py` | R2 |',
        '',
      ].join('\n'),
    });
    const raw = await readRaw(root);
    expect(raw.registry.map((row) => [row.id, row.guard, row.at.startLine])).toEqual([
      ['G2', 'shell.py', 3],
      ['G3', 'shell.py', 3],
      ['G9', 'shell.py', 3],
      ['HANDBACK', 'shell.py', 4],
      ['STOP-WAKE', 'shell.py', 4],
      ['G2', 'shell.py', 5],
      ['G3', 'shell.py', 5],
      ['Reply length', 'reply.py', 6],
    ]);
  });

  it('maps an adapter short name to the one guard whose file name ends with it, and reads backticked ids among words', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/settings.json': JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [
                { type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/nexus-fs-firewall.py' },
              ],
            },
            {
              hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/nexus-awareness.py' }],
            },
            { hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/old-awareness.py' }] },
          ],
        },
      }),
      '.claude/hooks/nexus-fs-firewall.py': 'pass\n',
      '.claude/hooks/nexus-awareness.py': 'pass\n',
      '.claude/hooks/old-awareness.py': 'pass\n',
      '.claude/hooks/CHECK-REGISTRY.md': [
        '| id | adapter | event | fires when | rollout |',
        '|---|---|---|---|---|',
        '| F1 | fs-firewall | PreToolUse | a write lands outside the root | enforce |',
        '| A1 | awareness | PreToolUse | a turn starts | observe |',
        '| `HANDBACK` / `STOP-WAKE` hold | fs-firewall | Stop | a hand back | observe |',
        '',
      ].join('\n'),
    });
    const raw = await readRaw(root);
    expect(raw.registry.map((row) => [row.id, row.guard])).toEqual([
      ['F1', 'nexus-fs-firewall.py'],
      // Two guards end with -awareness: the short name names neither.
      ['A1', 'awareness'],
      ['HANDBACK', 'nexus-fs-firewall.py'],
      ['STOP-WAKE', 'nexus-fs-firewall.py'],
    ]);
  });
});
