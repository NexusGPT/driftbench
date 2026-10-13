import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const fake = fileURLToPath(
  new URL('../../../examples/estates/fixture/live/fake/claude.mjs', import.meta.url),
);
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function dispatches(fields: string): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), 'estate-helper-metadata-'));
  folders.push(root);
  await mkdir(join(root, '.claude/agents'), { recursive: true });
  await writeFile(
    join(root, 'CLAUDE.md'),
    '| Ask | Helper |\n| Audit archive records | `archive-auditor` |\n',
  );
  await writeFile(
    join(root, '.claude/agents/definition.md'),
    `---\n${fields}\n---\nReview archive records and report errors.\n`,
  );
  const output = execFileSync(process.execPath, [fake, '-p', 'Audit archive records.'], {
    cwd: root,
    env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: join(root, 'config') },
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const row = JSON.parse(line);
      return Array.isArray(row.message?.content)
        ? row.message.content
            .filter(
              (part: { type: string; name?: string }) => part.type === 'tool_use' && part.name === 'Agent',
            )
            .map((part: { input: { subagent_type: string } }) => part.input.subagent_type)
        : [];
    });
}

it('dispatches a project helper by its declared name, independent of the filename', async () => {
  expect(await dispatches('name: archive-auditor\ndescription: Audit archive records.')).toEqual([
    'archive-auditor',
  ]);
});

it('does not invent a helper name when its frontmatter omits name', async () => {
  expect(await dispatches('description: Audit archive records.')).toEqual([]);
});

it('does not route a standing instruction to a helper with no description', async () => {
  expect(await dispatches('name: archive-auditor')).toEqual([]);
});
