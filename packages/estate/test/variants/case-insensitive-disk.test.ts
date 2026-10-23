import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The folder listings the emulated disk has looked up in the current test, so a folder is listed once. */
const listed = vi.hoisted(() => new Map<string, string[]>());

/**
 * A disk that ignores case, in any test run. A Mac's disk opens `Notes.md` as `notes.md`; a Linux disk does not,
 * so the case rule is only observable on one of them unless the other is made to behave like it. This file
 * wraps the file calls the product makes by path (stat, lstat, read, realpath, copy) so that each path component
 * is looked up in its folder's listing ignoring case, as such a disk does, and listings stay exact. The
 * expectations are those of `links-and-case.test.ts`: the same setup reads the same on every disk.
 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const { sep, isAbsolute, resolve } = await import('node:path');
  /** The path as a case-insensitive disk would open it: each component matched ignoring case in its folder. */
  async function fold(path: string): Promise<string> {
    if (!isAbsolute(path)) return path;
    let at: string = sep;
    for (const part of resolve(path)
      .split(sep)
      .filter((piece) => piece !== '')) {
      let names = listed.get(at);
      if (names === undefined) {
        names = await real.readdir(at).catch(() => [] as string[]);
        listed.set(at, names);
      }
      const found = names.includes(part)
        ? part
        : names.find((name) => name.toLowerCase() === part.toLowerCase());
      at = `${at === sep ? '' : at}${sep}${found ?? part}`;
    }
    return at;
  }
  const byPath =
    <A extends unknown[], R>(call: (path: string, ...rest: A) => Promise<R>) =>
    async (path: unknown, ...rest: A): Promise<R> =>
      call(typeof path === 'string' ? await fold(path) : (path as string), ...rest);
  const overrides = {
    stat: byPath(real.stat as (p: string, ...r: unknown[]) => Promise<unknown>),
    lstat: byPath(real.lstat as (p: string, ...r: unknown[]) => Promise<unknown>),
    readFile: byPath(real.readFile as (p: string, ...r: unknown[]) => Promise<unknown>),
    realpath: byPath(real.realpath as (p: string, ...r: unknown[]) => Promise<unknown>),
    copyFile: async (from: string, to: string, mode?: number) => real.copyFile(await fold(from), to, mode),
  };
  return { ...real, ...overrides, default: { ...real, ...overrides } };
});

import { place } from './claude-layout';
import { cleanup, observe, write } from './harness';
import { exactLinks, expectedOf, MATRIX, refKey, specOf } from './spec';

beforeEach(() => listed.clear());
afterEach(cleanup);

describe('on a disk that ignores case, a setup reads as it does on a disk that keeps it', () => {
  it('emulates the disk it claims to (a name in other letters opens the file)', async () => {
    const { stat } = await import('node:fs/promises');
    const root = await write({ 'docs/Notes.md': '# Notes\n' });
    expect((await stat(`${root}/docs/NOTES.md`)).isFile()).toBe(true);
  });

  it.each(MATRIX.filter((variant) => variant.mismatch > 0))(
    'finds what the spec says (seed $seed, $mismatch of the links in other letters)',
    async (variant) => {
      const spec = specOf(variant.seed, variant.mismatch);
      const expected = expectedOf(spec);
      const placed = place(spec);
      const obs = await observe(await write(placed.files), placed.paths);
      expect(obs.count('unresolved-link')).toBe(expected.unresolved);
      expect(obs.count('orphan')).toBe(expected.orphans);
      expect(obs.twins).toEqual([]);
      for (const cap of spec.caps)
        for (const ref of cap.refs) expect(obs.isCopied(refKey(cap, ref))).toBe(true);
    },
  );

  it.each(MATRIX.filter((variant) => variant.mismatch === 0))(
    'finds no unresolved link when every link is exact (seed $seed)',
    async (variant) => {
      const placed = place(exactLinks(specOf(variant.seed, variant.mismatch)));
      const obs = await observe(await write(placed.files), placed.paths);
      expect(obs.count('unresolved-link')).toBe(0);
      expect(obs.twins).toEqual([]);
    },
  );
});
