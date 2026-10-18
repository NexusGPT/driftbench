import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { plantedLadder } from '../../validators/test/support';
import { validateCommand } from '../src/commands/validate';

let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  root = await mkdtemp(join(tmpdir(), 'cli-floor-directory-'));
  const { ladder } = plantedLadder([]);
  const deps = {
    root,
    ladders: () => ({ planted: ladder }),
    readHead: () => 'abcdef0123456789abcdef0123456789abcdef01',
  };
  let out = '';
  let err = '';
  const io = {
    cwd: root,
    out: (text: string) => {
      out += text;
    },
    err: (text: string) => {
      err += text;
    },
  };
  return { deps, io, output: () => ({ out, err }) };
}

it('creates validators/ when an evidenced floor is first raised', async () => {
  const { deps, io, output } = await fixture();
  expect(await validateCommand('planted', { seeds: '1..3', hidden: true, json: true }, io, deps)).toBe(3);
  await writeFile(join(root, 'evidence.json'), output().out);
  expect(existsSync(join(root, 'validators'))).toBe(false);
  expect(
    await validateCommand(
      'floors',
      { raise: 'planted', evidence: 'evidence.json', ladderVersion: '1' },
      io,
      deps,
      '3',
    ),
  ).toBe(0);
  expect(output().err).toBe('');
  const file = JSON.parse(await readFile(join(root, 'validators/floors.json'), 'utf8'));
  expect(file.floors).toEqual({ planted: 3 });
  expect(file.ladderVersion).toEqual({ planted: 1 });
  const before = await readFile(join(root, 'validators/floors.json'), 'utf8');
  expect(
    await validateCommand(
      'floors',
      { raise: 'planted', evidence: 'evidence.json', ladderVersion: '1' },
      io,
      deps,
      '2',
    ),
  ).toBe(1);
  expect(await readFile(join(root, 'validators/floors.json'), 'utf8')).toBe(before);
});

it('does not create validators/ when the evidence is refused', async () => {
  const { deps, io, output } = await fixture();
  await writeFile(join(root, 'evidence.json'), '{}');
  expect(
    await validateCommand(
      'floors',
      { raise: 'planted', evidence: 'evidence.json', ladderVersion: '1' },
      io,
      deps,
      '3',
    ),
  ).toBe(1);
  expect(output().err).toContain('Refused:');
  expect(existsSync(join(root, 'validators'))).toBe(false);
});
