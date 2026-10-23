import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

async function run(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

/** An invented estate: the files are written under a folder of their own, beside a place for the map. */
async function estate(files: Record<string, string>): Promise<{ top: string; root: string }> {
  const top = await mkdtemp(join(tmpdir(), 'driftbench-estate-root-'));
  const root = join(top, 'agent');
  await mkdir(root, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return { top, root };
}

const STANDING = '# Harbour assistant\n\nAlways answer in the language of the user.\n';
const GUARD = '#!/bin/sh\nexit 0\n';
const RENDERED = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/guards/check.sh' }],
      },
    ],
  },
});

describe('driftbench estate scan on a root with no layout', () => {
  it('warns, writes the map, exits 1, and lint never calls the map clean', async () => {
    const { top } = await estate({ 'skills/tide/SKILL.md': '# Tide\n', 'hooks/check.sh': GUARD });
    const scan = await run(['estate', 'scan', 'agent', '--no-model', '--out', 'map.yaml'], top);
    expect(scan.code).toBe(1);
    expect(scan.out).toContain('holds no CLAUDE.md, no .claude/ folder and no settings.json');
    expect(scan.out).toContain('0 atoms');
    const lint = await run(['estate', 'lint', 'map.yaml'], top);
    expect(lint.code).toBe(1);
    expect(lint.out).toContain('EMPTY_MAP');
    expect(lint.out).not.toContain('Clean.');
  });
});

describe('driftbench estate scan and the settings file', () => {
  it('says that no guard wiring is read when the estate holds no settings file, and still exits 0', async () => {
    const { top } = await estate({ 'CLAUDE.md': STANDING, '.claude/guards/check.sh': GUARD });
    const scan = await run(['estate', 'scan', 'agent', '--no-model', '--out', 'map.yaml'], top);
    expect(scan.code).toBe(0);
    expect(scan.out).toContain('Settings: ');
    expect(scan.out).toContain('holds no .claude/settings.json, so no guard wiring is read (0 guards)');
    expect(scan.out).toContain('--settings <file>');
  });

  it('reads a rendered copy given with --settings, and lint needs the same file again', async () => {
    const { top } = await estate({ 'CLAUDE.md': STANDING, '.claude/guards/check.sh': GUARD });
    await writeFile(join(top, 'rendered.json'), RENDERED);
    const scan = await run(
      ['estate', 'scan', 'agent', '--no-model', '--settings', 'rendered.json', '--out', 'map.yaml'],
      top,
    );
    expect(scan.code).toBe(0);
    expect(scan.out).not.toContain('no guard wiring is read');
    expect(scan.out).toMatch(/guard\s+1/);
    expect(await readFile(join(top, 'map.yaml'), 'utf8')).toContain('settings: true');

    const without = await run(['estate', 'lint', 'map.yaml'], top);
    expect(without.code).toBe(2);
    expect(without.err).toContain('pass --settings <file>');

    const lint = await run(['estate', 'lint', 'map.yaml', '--settings', 'rendered.json'], top);
    expect(lint.err).toBe('');
    expect(lint.out).not.toContain('QUOTE_DRIFT');
  });

  it('refuses --settings when the estate holds its own settings file, and a file that is not there', async () => {
    const { top } = await estate({ 'CLAUDE.md': STANDING, '.claude/settings.json': '{}\n' });
    await writeFile(join(top, 'rendered.json'), RENDERED);
    const own = await run(
      ['estate', 'scan', 'agent', '--no-model', '--settings', 'rendered.json', '--out', 'map.yaml'],
      top,
    );
    expect(own.code).toBe(2);
    expect(own.err).toContain('holds its own .claude/settings.json');
    const gone = await run(
      ['estate', 'scan', 'agent', '--no-model', '--settings', 'missing.json', '--out', 'map.yaml'],
      top,
    );
    expect(gone.code).toBe(2);
    expect(gone.err).toContain('Cannot find the settings file');
  });
});
