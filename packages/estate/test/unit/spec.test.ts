import { chmod, cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, conditionsOf, traceUnitSpecs } from '../../src/index';
import { estate as written } from '../support';

// A fictional bakery estate, written for these tests: a guard on shell commands, a guard on the reply, a guard
// on the prompt, a script with a usage line, and a helper.
const NO_WIPE = `#!/usr/bin/env python3
"""Blocks a recursive delete of the orders folder."""
import json, sys
event = json.load(sys.stdin)
command = event.get("tool_input", {}).get("command", "")
if "rm -r" in command and "orders/" in command:
    print("Orders are kept: never delete the orders folder.", file=sys.stderr)
    sys.exit(2)
sys.exit(0)
`;
const SHORT = `#!/usr/bin/env python3
import json, sys
event = json.load(sys.stdin)
if len(event.get("last_assistant_message", "")) > 300:
    print("Keep replies short.", file=sys.stderr)
    sys.exit(2)
`;
const PAUSE = `#!/bin/sh
input=$(cat)
case "$input" in
  *'"prompt":"pause"'*) echo '{"additionalContext": "The baker asked for a pause."}' ;;
esac
exit 0
`;
const WEIGH = `#!/bin/sh
if [ "$#" -ne 2 ]; then
  echo "usage: weigh.sh <flour grams> <loaves>" >&2
  exit 2
fi
echo $(( $1 / $2 ))
`;
const ALLOW_ALL = 'import sys\nsys.stdin.read()\n';
const BLOCK_ALL = 'import sys\nsys.stdin.read()\nprint("no", file=sys.stderr)\nsys.exit(2)\n';

const FILES: Record<string, string> = {
  'CLAUDE.md': '# Bakery\n\nUse the `oven-plan` skill to plan the morning bake.\n',
  '.claude/settings.json': JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/no-wipe.py' }],
        },
      ],
      Stop: [
        { hooks: [{ type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/short.py' }] },
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/pause.sh' }] },
      ],
    },
  }),
  '.claude/hooks/no-wipe.py': NO_WIPE,
  '.claude/hooks/short.py': SHORT,
  '.claude/hooks/pause.sh': PAUSE,
  '.claude/skills/oven-plan/SKILL.md':
    '---\nname: oven-plan\ndescription: Plans the morning bake.\n---\n\nRun `scripts/weigh.sh` with the flour and the loaves.\n',
  '.claude/skills/oven-plan/scripts/weigh.sh': WEIGH,
  '.claude/agents/proofer.md':
    '---\nname: proofer\ndescription: Checks the dough rose enough.\ntools: Read\n---\n\nYou read the proofing log and say ready or wait.\n',
};

async function bakery(changes: Record<string, string> = {}): Promise<string> {
  const root = await written({ ...FILES, ...changes });
  for (const name of ['no-wipe.py', 'short.py', 'pause.sh'])
    await chmod(join(root, '.claude/hooks', name), 0o755);
  await chmod(join(root, '.claude/skills/oven-plan/scripts/weigh.sh'), 0o755);
  return root;
}

function spec(id: string, atoms: string[], block: string, rules = ''): Spec {
  const text = `id: ${id}
kind: task
title: ${id}
target: { adapter: claude-code }
blocks:
${block}
${rules}
metadata:
  estate:
    atoms: [${atoms.join(', ')}]
    mode: unit
`;
  const loaded = parseSpecText(text, 'yaml');
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.spec;
}

const QUIET = spec(
  'quiet',
  [],
  '  - user: List the orders.\n    expect:\n      guards:\n        - { name: no-wipe.py, verdict: deny, count: 0 }',
);
const FIRES = spec(
  'fires',
  [],
  '  - user: Delete the orders folder.\n    expect:\n      guards:\n        - { name: no-wipe.py, count: { min: 1 } }',
);
const LONG = spec(
  'long',
  [],
  '  - user: Tell me everything.\n    expect:\n      guards:\n        - { name: short.py, verdict: deny, count: { min: 1 } }',
);
const PAUSED = spec(
  'paused',
  [],
  '  - user: Pause, please.\n    expect:\n      guards:\n        - { name: pause.sh, count: { min: 1 } }',
);

async function trace(root: string, specs: Spec[]) {
  return traceUnitSpecs(
    specs.map((entry) => ({ file: `${entry.id}.yaml`, spec: entry })),
    { root, reader: new ClaudeCodeReader() },
  );
}

const firedNames = (blocks: Array<{ runtime?: { guards?: Array<{ name: string; verdict: string }> } }>) =>
  blocks.flatMap((block) => (block.runtime?.guards ?? []).map((run) => `${run.name} ${run.verdict}`));

describe('a unit spec run on its own', () => {
  it('reads what a guard tests from its source: literals, JSON pairs, lengths; never messages or field names', () => {
    expect(conditionsOf(NO_WIPE)).toEqual({ literals: ['rm -r', 'orders/'], fields: [], lengths: [] });
    expect(conditionsOf(SHORT)).toEqual({ literals: [], fields: [], lengths: [300] });
    expect(conditionsOf(PAUSE).fields).toEqual([['prompt', 'pause']]);
    expect(
      conditionsOf('case "$x" in\n  *"drop table"*|*"DROP TABLE"*) echo no >&2; exit 2 ;;\nesac\n').literals,
    ).toEqual(['drop table', 'DROP TABLE']);
  });

  it('fires each guard on events built from its own conditions, and keeps it quiet on a neutral act', async () => {
    const root = await bakery();
    const { traces } = await trace(root, [QUIET, FIRES, LONG, PAUSED]);
    expect(traces.map((entry) => entry.problems)).toEqual([[], [], [], []]);
    expect(firedNames(traces[0]?.blocks ?? [])).toEqual([]);
    expect(firedNames(traces[1]?.blocks ?? [])).toEqual(['no-wipe.py deny']);
    expect(firedNames(traces[2]?.blocks ?? [])).toEqual(['short.py deny']);
    expect(firedNames(traces[3]?.blocks ?? [])).toEqual(['pause.sh nudge']);
    const blocked = traces[1]?.guards.find((run) => run.decision === 'deny');
    expect(blocked?.message).toBe('Orders are kept: never delete the orders folder.');
    expect(blocked?.ms).toBeGreaterThanOrEqual(0);
  });

  it('sees a guard that allows everything stop firing, and one that blocks everything fire on the neutral act', async () => {
    const allowing = await trace(await bakery({ '.claude/hooks/no-wipe.py': ALLOW_ALL }), [QUIET, FIRES]);
    expect(firedNames(allowing.traces[1]?.blocks ?? [])).toEqual([]);
    const blocking = await trace(await bakery({ '.claude/hooks/no-wipe.py': BLOCK_ALL }), [QUIET, FIRES]);
    expect(firedNames(blocking.traces[0]?.blocks ?? [])).toEqual(['no-wipe.py deny']);
  });

  it('fails a spec whose guard the estate no longer runs', async () => {
    const root = await bakery({ '.claude/settings.json': JSON.stringify({ hooks: {} }) });
    const { traces } = await trace(root, [FIRES]);
    expect(traces[0]?.problems).toEqual(['the estate no longer runs the guard no-wipe.py']);
  });

  it('holds a script to its own argument contract, and a helper alone to its instructions', async () => {
    const root = await bakery();
    const work = await mkdtemp(join(tmpdir(), 'unit-spec-'));
    await cp(root, work, { recursive: true });
    const scriptSpec = spec(
      'weigh',
      ['script.oven-plan.script-scripts-weigh-sh'],
      '  - user: Plan the bake.\n    expect:\n      execution: { ran_code: true }',
    );
    const helperSpec = spec(
      'proofer',
      ['subagent.proofer.helper-proofer'],
      '  - user: Is the dough ready?\n    expect: {}',
    );
    const green = await trace(root, [scriptSpec, helperSpec]);
    expect(green.traces.map((entry) => entry.problems)).toEqual([[], []]);
    expect(green.traces[0]?.blocks[0]?.runtime?.skills).toEqual([{ name: 'oven-plan' }]);
    expect(green.traces[0]?.scripts[0]?.exit).toBe(2);

    await writeFile(
      join(work, '.claude/skills/oven-plan/scripts/weigh.sh'),
      '#!/bin/sh\necho broke >&2\nexit 1\n',
    );
    await writeFile(
      join(work, '.claude/agents/proofer.md'),
      '---\nname: proofer\ndescription: Checks the dough.\n---\n',
    );
    const broken = await trace(work, [scriptSpec, helperSpec]);
    expect(broken.traces[0]?.problems).toEqual([
      '.claude/skills/oven-plan/scripts/weigh.sh with no argument: exit 1, though the script reads none',
    ]);
    expect(broken.traces[1]?.problems).toEqual([
      '.claude/agents/proofer.md holds no instructions: a helper alone has nothing to run on',
    ]);
  });
});
