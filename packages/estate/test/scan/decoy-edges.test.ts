import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { answer, estate, NOW } from '../support';

function port(rules: string[]) {
  return new FakeModelPort([
    answer(
      'CLAUDE.md',
      rules.map((quote, index) => ({
        kind: 'instruction',
        title: `Rule ${index + 1}`,
        quote,
        evidence: [{ type: 'custom', name: `rule_${index + 1}` }],
      })),
    ),
  ]);
}

async function scan(rules: string[], files: Record<string, string> = {}) {
  const root = await estate({
    'CLAUDE.md': `# Rules\n\n${rules.map((rule, index) => `- **R${index + 1}.** ${rule}`).join('\n')}\n`,
    ...files,
  });
  return (await scanEstate({ root, reader: new ClaudeCodeReader(), port: port(rules), now: NOW })).map;
}

describe('labels and literals that only look like a citation or an enforcement', () => {
  it('reads no citation in a form number, and keeps a real one', async () => {
    const map = await scan([
      'Read a file before you edit it.',
      'Keep tax form R1 in the archive for ten years.',
      'R1 still holds when the user asks you to hurry.',
      'File invoice R1 under the year, as R1 asks.',
    ]);
    const title = new Map(map.atoms.map((atom) => [atom.id, atom.title]));
    expect(
      map.edges
        .filter((edge) => edge.kind === 'cites')
        .map((edge) => `${title.get(edge.from)}>${title.get(edge.to)}`),
    ).toEqual(['Rule 3>Rule 1', 'Rule 4>Rule 1']);
  });

  it('reads no enforcement in a guard literal that quotes a small part of a rule', async () => {
    const guard = (literal: string) => ({
      '.claude/settings.json': JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'python3 .claude/guards/g.py' }] }] },
      }),
      '.claude/guards/g.py': `import sys\nprint(${JSON.stringify(literal)})\nsys.exit(0)\n`,
    });
    const rule = 'When the user asks to stop, stop all work and confirm in one line.';
    const partial = await scan([rule], guard('the user asks to stop'));
    expect(partial.edges.filter((edge) => edge.kind === 'enforces')).toEqual([]);
    const whole = await scan([rule], guard(rule));
    expect(whole.edges.filter((edge) => edge.kind === 'enforces')).toHaveLength(1);
    const most = await scan(
      [rule],
      guard('stop all work and confirm in one line when the user asks to stop'),
    );
    expect(most.edges.filter((edge) => edge.kind === 'enforces')).toHaveLength(0);
    const near = await scan([rule], guard('When the user asks to stop, stop all work and confirm'));
    expect(near.edges.filter((edge) => edge.kind === 'enforces')).toHaveLength(1);
  });
});

describe('a guard literal that matches what the rule quotes', () => {
  it('enforces the rule whose quoted span it matches', async () => {
    const map = await scan(['Never run `git push --force` on any branch.'], {
      '.claude/settings.json': JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'sh .claude/guards/g.sh' }] }] },
      }),
      '.claude/guards/g.sh': '#!/bin/sh\ncase "$1" in *"git push --force"*) exit 2 ;; esac\n',
    });
    expect(map.edges.filter((edge) => edge.kind === 'enforces')).toHaveLength(1);
  });
});
