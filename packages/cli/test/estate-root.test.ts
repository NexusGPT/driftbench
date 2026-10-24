import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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

const GUARD = '#!/bin/sh\nexit 0\n';

describe('driftbench estate scan on a root with no layout', () => {
  it('warns, writes the map, exits 1, and lint never calls the map clean', async () => {
    const { top } = await estate({ 'skills/tide/SKILL.md': '# Tide\n', 'hooks/check.sh': GUARD });
    const scan = await run(['estate', 'scan', 'agent', '--no-model', '--out', 'map.yaml'], top);
    expect(scan.code).toBe(1);
    expect(scan.out).toContain('holds no CLAUDE.md, no .claude/ folder and no settings.json');
    expect(scan.out).toContain('0 atoms');
    const lint = await run(['estate', 'lint', 'map.yaml'], top);
    // The merged lint contract: a map with no atom ran no check, exits 0 and is never called clean.
    expect(lint.code).toBe(0);
    expect(lint.out).toContain('Not run: no check had an input.');
    expect(lint.out).not.toContain('Clean.');
  });
});
