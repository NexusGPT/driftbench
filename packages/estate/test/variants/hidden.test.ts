import { afterEach, describe, expect, it } from 'vitest';
import { ALWAYS_LOADED, type Files, HIDINGS, junkOf, place } from './claude-layout';
import { cleanup, observe, write } from './harness';
import { setupOf } from './setups';
import { specOf } from './spec';

afterEach(cleanup);

/**
 * Rule (parts kept out): a part the owner of the setup keeps out of it, or that is not the setup's, is not part
 * of it. A rule an owner writes (an ignore file, the setup file) hides the part from the reader, from the
 * labelers, from the checks and from a copy, whatever the form of the rule; one that brings a part back brings
 * it back. A copy of the runtime's own layout folder found inside it is another setup's, and a folder a tool
 * tagged as a cache is no one's: neither is read. A file that merely looks like these is read. A part the runtime
 * always loads is read whatever a rule says. A file of rules is no content: adding one changes no finding.
 */

const SEEDS = [3, 8, 14];

describe('a part kept out of the setup is not part of it', () => {
  for (const form of HIDINGS) {
    for (const seed of SEEDS) {
      const label = `${form.name} (seed ${seed})`;

      it(`${form.hides ? 'hides' : 'keeps'} the part: ${label}`, async () => {
        const { files, paths, junk } = setupOf(seed, form, true);
        const obs = await observe(await write(files), paths);
        if (form.hides) {
          expect(obs.isRead(junk.key)).toBe(false);
          expect(obs.reachedLabeler(junk.key)).toBe(false);
          expect(obs.isNamed(junk.key)).toBe(false);
          expect(obs.isCopied(junk.key)).toBe(false);
        } else {
          expect(obs.isRead(junk.key)).toBe(true);
        }
      });

      it(`changes no finding by the part it hides: ${label}`, async () => {
        const withPart = setupOf(seed, form, true);
        const without = setupOf(seed, form, false);
        const a = await observe(await write(withPart.files), withPart.paths);
        const b = await observe(await write(without.files), without.paths);
        if (form.hides) {
          expect(a.counts).toEqual(b.counts);
          expect(a.readCount).toBe(b.readCount);
          expect(a.map.atoms.map((atom) => atom.id)).toEqual(b.map.atoms.map((atom) => atom.id));
        } else {
          // The part is one more input of the setup.
          expect(a.readCount).toBe(b.readCount + 1);
        }
      });
    }
  }

  for (const seed of SEEDS) {
    it(`a file of rules is no content (seed ${seed})`, async () => {
      const plain = setupOf(seed, undefined, false);
      const a = await observe(await write(plain.files), plain.paths);
      for (const form of HIDINGS.filter((candidate) => candidate.name.includes('ignore file'))) {
        const ruled = setupOf(seed, form, false);
        const b = await observe(await write(ruled.files), ruled.paths);
        expect(b.counts, form.name).toEqual(a.counts);
      }
    });
  }

  it('reads a part the runtime always loads, whatever a rule says', async () => {
    const base = setupOf(3, undefined, false);
    const files: Files = {
      ...base.files,
      '.gitignore': `${ALWAYS_LOADED.map((part) => part.path).join('\n')}\n`,
      ...Object.fromEntries(ALWAYS_LOADED.map((part) => [part.path, part.text])),
    };
    const paths = new Map(base.paths);
    for (const part of ALWAYS_LOADED) paths.set(part.key, part.path);
    const obs = await observe(await write(files), paths);
    for (const part of ALWAYS_LOADED) expect(obs.isRead(part.key)).toBe(true);
  });

  it('applies a rule file inside a unit to that unit only', async () => {
    const seed = Array.from({ length: 40 }, (_, index) => index + 1).find(
      (candidate) => specOf(candidate, 0).caps.length >= 2,
    );
    expect(seed).toBeDefined();
    const spec = specOf(seed ?? 1, 0);
    const [first, second] = spec.caps;
    if (!first || !second) throw new Error('the spec holds fewer than two capabilities');
    const placed = place(spec);
    const mine = junkOf(first);
    const theirs = junkOf(second);
    const files: Files = {
      ...placed.files,
      [`${mine.folder}/.gitignore`]: 'scratch/\n',
      ...mine.files,
      ...theirs.files,
    };
    const paths = new Map(placed.paths).set(mine.key, mine.path).set(theirs.key, theirs.path);
    const obs = await observe(await write(files), paths);
    expect(obs.isRead(mine.key)).toBe(false);
    expect(obs.isRead(theirs.key)).toBe(true);
  });
});
