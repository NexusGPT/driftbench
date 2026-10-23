import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadStateLibraryWithDigest } from '../../../src/claude-code/live/states';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const RECORD = (id: string) =>
  `${JSON.stringify({ type: 'user', uuid: id, parentUuid: null, message: { role: 'user', content: id } })}\n`;

/** A library of two prefixes, written in the order b then a, in a new folder. */
async function library(): Promise<{ file: string; folder: string; text: string }> {
  const folder = await fs.mkdtemp(join(tmpdir(), 'driftbench-digest-'));
  const text = `${JSON.stringify({
    prefixes: { b: 'b.jsonl', a: 'a.jsonl' },
    states: { one: [{ op: 'resume', prefix: 'a' }], two: [{ op: 'resume', prefix: 'b' }] },
    events: {},
  })}\n`;
  await fs.writeFile(join(folder, 'library.json'), text);
  await fs.writeFile(join(folder, 'a.jsonl'), RECORD('a-1'));
  await fs.writeFile(join(folder, 'b.jsonl'), RECORD('b-1'));
  return { file: join(folder, 'library.json'), folder, text };
}

describe('the digest of a state library', () => {
  it('covers the library file and each prefix file, in the order of the prefix names', async () => {
    const { file, text } = await library();
    const { digest } = await loadStateLibraryWithDigest(file);
    expect(digest.prefixes).toEqual({
      a: { file: 'a.jsonl', sha256: sha(RECORD('a-1')) },
      b: { file: 'b.jsonl', sha256: sha(RECORD('b-1')) },
    });
    const a = `prefix a a.jsonl ${sha(RECORD('a-1'))}\n`;
    const b = `prefix b b.jsonl ${sha(RECORD('b-1'))}\n`;
    const expected = sha(`library ${sha(text)}\n${a}${b}`);
    expect(digest.sha256).toBe(expected);
    // The library file alone, as `sha256sum library.json` prints it.
    expect(digest.fileSha256).toBe(sha(text));
  });

  it('changes when a prefix file changes and the library file does not', async () => {
    const { file, folder } = await library();
    const before = (await loadStateLibraryWithDigest(file)).digest;
    expect((await loadStateLibraryWithDigest(file)).digest).toEqual(before);
    await fs.writeFile(join(folder, 'b.jsonl'), RECORD('b-2'));
    const after = (await loadStateLibraryWithDigest(file)).digest;
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.prefixes.a).toEqual(before.prefixes.a);
    expect(after.prefixes.b?.sha256).not.toBe(before.prefixes.b?.sha256);
  });

  it('reads each file once: the library, then every prefix file', async () => {
    const { file } = await library();
    const read = vi.mocked(fs.readFile);
    read.mockClear();
    await loadStateLibraryWithDigest(file);
    expect(read).toHaveBeenCalledTimes(3);
  });
});
