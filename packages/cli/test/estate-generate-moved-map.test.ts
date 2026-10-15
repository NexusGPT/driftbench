import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

/**
 * A map copied away from its estate, next to files of its own: `estate generate` must not take that folder
 * for the estate, or every expected read becomes a missing file. A small repotting estate written here.
 */

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

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

type Report = { gaps?: Array<{ marker: string }> };

describe('estate generate with a map moved away from its estate', () => {
  it('checks reads against the files the map knows, as it does in the estate itself', async () => {
    const work = await mkdtemp(join(tmpdir(), 'repot-'));
    const estate = join(work, 'estate');
    await write(estate, {
      'CLAUDE.md': '# Garden centre\n\nBe brief.\n',
      '.claude/skills/repot/SKILL.md':
        '---\nname: repot\ndescription: Use when the user asks to repot a plant.\n---\n# Repot\n\nRead `references/soil.md` when you choose the soil.\n',
      '.claude/skills/repot/references/soil.md': '# Soil\n\nCactus: sandy mix.\n',
    });
    const map = join(estate, 'map.yaml');
    const plan = join(estate, 'plan.yaml');
    expect((await run(['estate', 'scan', estate, '--no-model', '--out', map], work)).code).toBe(0);
    expect((await run(['estate', 'plan', map, '--out', plan], work)).code).toBe(0);
    expect((await run(['estate', 'plan', 'approve', plan, '--all'], work)).code).toBe(0);

    // The copy sits beside other files, none of them the estate's.
    const moved = join(work, 'moved');
    await write(moved, { 'notes.md': '# Notes\n' });
    await copyFile(map, join(moved, 'map.yaml'));
    await copyFile(plan, join(moved, 'plan.yaml'));

    const inPlace = await run(
      ['estate', 'generate', '--map', map, '--plan', plan, '--out', join(work, 'a')],
      work,
    );
    const away = await run(
      [
        'estate',
        'generate',
        '--map',
        join(moved, 'map.yaml'),
        '--plan',
        join(moved, 'plan.yaml'),
        '--out',
        join(work, 'b'),
      ],
      work,
    );
    expect(away.out).toContain('holds none of the files the map quotes');
    expect(away.code).toBe(inPlace.code);
    const markers = async (dir: string) =>
      (
        (JSON.parse(await readFile(join(dir, 'estate-generate-report.json'), 'utf8')) as Report).gaps ?? []
      ).map((gap) => gap.marker);
    expect(await markers(join(work, 'b'))).toEqual(await markers(join(work, 'a')));
    expect(await markers(join(work, 'b'))).not.toContain('needs-existing-file');
  }, 120_000);
});
