import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { answer, estate, NOW } from '../support';

async function enforced(registry: Record<string, string>) {
  const root = await estate({
    'CLAUDE.md': '# Rules\n\n- **R1.** Keep the draft unsent.\n- **R2.** Always log the run.\n',
    '.claude/settings.json': JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'sh .claude/guards/g.sh' }] }],
      },
    }),
    '.claude/guards/g.sh': '#!/bin/sh\nexit 0\n',
    ...registry,
  });
  const port = new FakeModelPort([
    answer('CLAUDE.md', [
      {
        kind: 'instruction',
        title: 'No send',
        quote: 'Keep the draft unsent.',
        evidence: [{ type: 'custom', name: 'unsent' }],
      },
      {
        kind: 'instruction',
        title: 'Log',
        quote: 'Always log the run.',
        evidence: [{ type: 'custom', name: 'log' }],
      },
    ]),
  ]);
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), port, now: NOW });
  return map.atoms.filter((atom) => atom.enforcement.length > 0).map((atom) => atom.title);
}

describe('rule labels in a registry, whatever their case', () => {
  it('matches a lower-case label of a markdown registry to the rule it names', async () => {
    expect(
      await enforced({
        '.claude/guards/CHECK-REGISTRY.md': '| Id | Guard | Enforces |\n|---|---|---|\n| G1 | g.sh | r1 |\n',
      }),
    ).toEqual(['No send']);
  });

  it('matches a lower-case label of a JSON registry, as a string or an object', async () => {
    expect(
      await enforced({
        '.claude/guards/check-registry.json': JSON.stringify({
          checks: [{ id: 'G1', guard: 'g.sh', enforces: ['r1', { id: 'r2' }] }],
        }),
      }),
    ).toEqual(['No send', 'Log']);
  });

  it('still names no rule with a label no rule carries', async () => {
    expect(
      await enforced({
        '.claude/guards/CHECK-REGISTRY.md': '| Id | Guard | Enforces |\n|---|---|---|\n| G1 | g.sh | r7 |\n',
      }),
    ).toEqual([]);
  });
});
