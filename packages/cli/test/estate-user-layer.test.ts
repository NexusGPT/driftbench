import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Handle the ${name} chores. Use when the user asks for the ${name} chores.\n---\n\n# ${name}\n`;

async function folder(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-user-layer-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const saved = process.env.HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.HOME;
  else process.env.HOME = saved;
});

describe('driftbench estate scan and lint read the user-level skill layer', () => {
  it('reads the skills of the current user by default, and says how many', async () => {
    process.env.HOME = await folder({ '.claude/skills/pier-notes/SKILL.md': skill('pier-notes') });
    const root = await folder({ '.claude/skills/dock-roster/SKILL.md': skill('dock-roster') });
    const scanned = await run(['estate', 'scan', root, '--no-model', '--out', join(root, 'map.yaml')], root);
    expect(scanned.code).toBe(0);
    expect(scanned.out).toContain('User skill layer: 1 skill read; 0 left out');
    const map = await readFile(join(root, 'map.yaml'), 'utf8');
    expect(map).toContain('~/.claude/skills/pier-notes/SKILL.md');
    expect(map).not.toContain('userSkills');
    // Lint reads the layer again where it lies, and its findings name the files of the layer.
    const linted = await run(['estate', 'lint', join(root, 'map.yaml')], root);
    expect(linted.out).toContain('~/.claude/skills/pier-notes/SKILL.md');
  }, 60_000);

  it('reads the folder --user-skills names, and none with --no-user-skills, which the map records', async () => {
    process.env.HOME = await folder({ '.claude/skills/pier-notes/SKILL.md': skill('pier-notes') });
    const team = await folder({ 'shared/tide-chart/SKILL.md': skill('tide-chart') });
    const root = await folder({ '.claude/skills/dock-roster/SKILL.md': skill('dock-roster') });

    const named = await run(
      [
        'estate',
        'scan',
        root,
        '--no-model',
        '--user-skills',
        join(team, 'shared'),
        '--out',
        join(root, 'named.yaml'),
      ],
      root,
    );
    expect(named.code).toBe(0);
    const namedMap = await readFile(join(root, 'named.yaml'), 'utf8');
    expect(namedMap).toContain('~/.claude/skills/tide-chart/SKILL.md');
    expect(namedMap).not.toContain('pier-notes');
    expect(namedMap).not.toContain(team);

    const none = await run(
      ['estate', 'scan', root, '--no-model', '--no-user-skills', '--out', join(root, 'none.yaml')],
      root,
    );
    expect(none.code).toBe(0);
    expect(none.out).not.toContain('User skill layer');
    const noneMap = await readFile(join(root, 'none.yaml'), 'utf8');
    expect(noneMap).toContain('userSkills: false');
    expect(noneMap).not.toContain('pier-notes');

    // Lint reads the estate as the scan did: no layer for the map that says none, whatever the home folder holds.
    const linted = await run(['estate', 'lint', join(root, 'none.yaml')], root);
    expect(linted.out).not.toContain('pier-notes');
  }, 60_000);
});
