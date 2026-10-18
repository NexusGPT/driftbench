import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../src/index';
import { answer, estate, NOW } from './support';

const SETTINGS = JSON.stringify(
  {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/guards/g.sh' }],
        },
      ],
    },
  },
  null,
  2,
);

/** A rule with the situation its answer declares, and a guard whose message is one literal. */
async function enforcedBy(rule: string, situation: string | undefined, literal: string) {
  const root = await estate({
    'CLAUDE.md': `# Rules\n\n- **R1.** ${rule}\n`,
    '.claude/settings.json': SETTINGS,
    '.claude/guards/g.sh': `#!/bin/sh\necho "${literal}" >&2\nexit 2\n`,
  });
  const port = new FakeModelPort([
    answer('CLAUDE.md', [
      {
        kind: 'instruction',
        title: 'Rule',
        quote: rule,
        ...(situation ? { situation } : {}),
        evidence: [{ type: 'custom', name: 'r' }],
      },
    ]),
  ]);
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), port, now: NOW });
  return map.atoms.find((atom) => atom.kind === 'guard')?.fields?.enforces;
}

describe('a guard message that quotes the situation of a rule alone repeats when the rule applies, not the rule', () => {
  it('links a message that reaches past the situation the rule declares', async () => {
    expect(
      await enforcedBy(
        'When the user asks to stop, stop all work.',
        'the user asks to stop',
        'the user asks to stop, stop all work',
      ),
    ).toEqual([{ atom: 'instruction.standing.rule', by: 'quote' }]);
  });

  it('links nothing for a message that is the declared situation and no more', async () => {
    expect(
      await enforcedBy(
        'When the user asks to stop, stop all work.',
        'the user asks to stop',
        'the user asks to stop',
      ),
    ).toEqual([]);
  });

  it('reads no condition word: a situation in another language works the same way', async () => {
    const rule = 'Dès que le coffre est ouvert, ne le touchez pas.';
    expect(await enforcedBy(rule, 'le coffre est ouvert', 'le coffre est ouvert')).toEqual([]);
    expect(await enforcedBy(rule, 'le coffre est ouvert', 'ne le touchez pas')).toEqual([
      { atom: 'instruction.standing.rule', by: 'quote' },
    ]);
  });

  it('reads no condition word: a rule with no declared situation is repeated by any of its passages', async () => {
    expect(
      await enforcedBy('When the user asks to stop, stop all work.', undefined, 'the user asks to stop'),
    ).toEqual([{ atom: 'instruction.standing.rule', by: 'quote' }]);
  });
});
