import { mkdir, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

it.each([
  'guide.md',
  'documents/guide.md',
  'CLAUDE.local.md',
  '.claude/memory/guide.md',
  '.claude/skills/parcels/SKILL.md',
  'nested/CLAUDE.md',
  '.mcp.json',
  'driftbench.estate.yaml',
])('never reads or lists an external symlink at %s', async (path) => {
  const outside = await estate({ 'secret.md': 'FICTIONAL EXTERNAL CONTENT\n' });
  const root = await estate({ 'CLAUDE.md': `# Parcels\nRead \`${path}\` first.\n` });
  await mkdir(dirname(join(root, path)), { recursive: true });
  await symlink(join(outside, 'secret.md'), join(root, path));
  const reader = new ClaudeCodeReader();
  const raw = await reader.read(root);
  expect(raw.files.map((file) => file.path)).not.toContain(path);
  expect(raw.notes).toContainEqual({ file: path, message: expect.stringContaining('external') });
  expect(await reader.listFiles(root)).not.toContain(path);
  if (/guide\.md$/.test(path)) {
    const { map } = await scanEstate({ root, reader, now: NOW });
    const reference = map.atoms.find((atom) => atom.kind === 'reference');
    expect(reference?.fields?.external).toBe(true);
    expect(reference?.fields?.exists).toBe(false);
  }
});

it.each(['.claude/skills', 'nested'])('does not walk an external directory link at %s', async (path) => {
  const outside = await estate({
    'parcels/SKILL.md': '---\nname: fictional-parcels\n---\nExternal parcel notes.\n',
    'CLAUDE.md': '# External fictional standing instructions\n',
  });
  const root = await estate({ 'CLAUDE.md': '# Parcels\n' });
  await mkdir(dirname(join(root, path)), { recursive: true });
  await symlink(outside, join(root, path));
  const reader = new ClaudeCodeReader();
  const raw = await reader.read(root);
  expect(raw.files.map((file) => file.path)).toEqual(['CLAUDE.md']);
  expect(raw.notes).toContainEqual({ file: path, message: expect.stringContaining('external') });
  expect(await reader.listFiles(root)).toEqual(['CLAUDE.md']);
});
