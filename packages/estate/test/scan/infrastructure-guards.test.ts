import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const command = (script: string, args = '') => ({
  type: 'command',
  command: `python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/${script}${args}`,
});
const settings = (scripts: Array<[string, string?]>) =>
  JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: scripts.map(([script, args]) => command(script, args)) }],
    },
  });
const registry = [
  '# Check registry',
  '',
  '| Id | Guard | Event | Enforces | Verdict |',
  '|---|---|---|---|---|',
  '| G1 | check-a.py | PreToolUse | R1 | deny |',
  '| G2 | check-b.py | PreToolUse | R2 | deny |',
  '',
].join('\n');
const check = '"""Stops a risky command."""\nimport sys\nsys.exit(0)\n';

async function rows(files: Record<string, string>): Promise<string[]> {
  const root = await estate({
    'CLAUDE.md': '# Rules\n',
    '.claude/hooks/CHECK-REGISTRY.md': registry,
    '.claude/hooks/check-a.py': check,
    '.claude/hooks/check-b.py': check,
    ...files,
  });
  const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return lintEstate(map, raw)
    .findings.filter((finding) => finding.code === 'REGISTRY_ROW')
    .map((finding) => finding.subject);
}

describe('a launcher or a long-lived process is not a check', () => {
  it('still asks for a registry row for a plain script guard', async () => {
    expect(
      await rows({
        '.claude/settings.json': settings([['check-a.py'], ['check-b.py'], ['plain.py']]),
        '.claude/hooks/plain.py': check,
      }),
    ).toEqual(['plain.py']);
  });

  it('needs no row for a script that runs other guards', async () => {
    expect(
      await rows({
        '.claude/settings.json': settings([['check-a.py'], ['check-b.py'], ['router.py']]),
        '.claude/hooks/router.py':
          'import subprocess, sys\nTABLE = {"Bash": ".claude/hooks/check-a.py"}\nsubprocess.run([sys.executable, TABLE["Bash"]])\n',
      }),
    ).toEqual([]);
  });

  it('needs no row for the dispatcher a settings command runs, only for the script it hands over', async () => {
    expect(
      await rows({
        '.claude/settings.json': settings([
          ['check-a.py'],
          ['check-b.py'],
          ['launch.py', ' .claude/hooks/worker.py'],
        ]),
        '.claude/hooks/launch.py': 'import sys, runpy\nrunpy.run_path(sys.argv[1])\n',
        '.claude/hooks/worker.py': check,
      }),
    ).toEqual(['worker.py']);
  });

  it('needs no row for a long-lived process, and asks for one from a script that merely loops once', async () => {
    const daemon = 'import time\nwhile True:\n    time.sleep(5)\n    print("tick")\n';
    const bounded = 'for item in range(3):\n    print(item)\n';
    expect(
      await rows({
        '.claude/settings.json': settings([['check-a.py'], ['check-b.py'], ['watch.py'], ['once.py']]),
        '.claude/hooks/watch.py': daemon,
        '.claude/hooks/once.py': bounded,
      }),
    ).toEqual(['once.py']);
  });

  it('needs no row for a script that binds and listens on a socket, and asks for one from a client that only connects', async () => {
    const server =
      'import socket, selectors\nsock = socket.socket(socket.AF_UNIX)\nsock.bind("/tmp/x.sock")\nsock.listen()\nconn, _ = sock.accept()\n';
    const client = 'import socket\nsock = socket.socket(socket.AF_UNIX)\nsock.connect("/tmp/x.sock")\n';
    expect(
      await rows({
        '.claude/settings.json': settings([['check-a.py'], ['check-b.py'], ['serve.py'], ['ask.py']]),
        '.claude/hooks/serve.py': server,
        '.claude/hooks/ask.py': client,
      }),
    ).toEqual(['ask.py']);
  });

  it('needs no row for a launcher whose command hands it another estate script, with no source evidence', async () => {
    expect(
      await rows({
        '.claude/settings.json': settings([
          ['check-a.py'],
          ['check-b.py'],
          ['launch.py', ' .claude/hooks/worker.py'],
        ]),
        '.claude/hooks/launch.py': 'print("launcher")\n',
        '.claude/hooks/worker.py': check,
      }),
    ).toEqual([]);
  });

  it('asks for a row from a script whose command only hands it data', async () => {
    expect(
      await rows({
        '.claude/settings.json': settings([['check-a.py'], ['check-b.py'], ['plain.py', ' rules.json']]),
        '.claude/hooks/plain.py': check,
        '.claude/hooks/rules.json': '{}\n',
      }),
    ).toEqual(['plain.py']);
  });
});
