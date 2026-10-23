import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { capAtomFile, defectiveCap, type Files, place } from './claude-layout';
import { cleanup, observe, write } from './harness';
import type { CapUnit } from './spec';

const saved = process.env.HOME;
afterEach(async () => {
  if (saved === undefined) delete process.env.HOME;
  else process.env.HOME = saved;
  await cleanup();
});

/**
 * Rule (sources): a capability is checked as a capability, wherever the runtime loads it from. One loaded from
 * a second source (a folder of the user, a shared kit inside the setup, a folder elsewhere) has the same
 * defects found as one loaded from the project, and its parts are named by the source they were read in, so
 * two sources never share a name and no source is named by a string that is not its folder.
 */

const CAP: CapUnit = { name: 'quarrywillow', refs: [], links: [] };

type Source = {
  name: string;
  /** The files that go in the setup, and the folder the reader is told to read as a second source (if any). */
  put(token: string): Promise<{ files: Files; second?: (root: string) => string }>;
};

const SOURCES: Source[] = [
  { name: 'the project', put: async () => ({ files: defectiveCap(CAP, '.claude/skills').files }) },
  {
    name: 'a shared kit inside the setup',
    put: async (token) => ({
      files: defectiveCap(CAP, `${token}/skills`).files,
      second: (root) => join(root, token, 'skills'),
    }),
  },
  {
    name: 'a folder under the home folder',
    put: async (token) => {
      const home = await write({ '.keep': '' });
      process.env.HOME = home;
      await write(defectiveCap(CAP, `${token}/skills`).files, home);
      return { files: {}, second: () => join(home, token, 'skills') };
    },
  },
  {
    name: 'a folder elsewhere on the disk',
    put: async (token) => {
      const other = await write(defectiveCap(CAP, `${token}/skills`).files);
      return { files: {}, second: () => join(other, token, 'skills') };
    },
  },
];

const TOKENS = ['cobaltkit', 'tundrakit', 'saffronkit'];

async function setupOf(source: Source, token: string) {
  const put = await source.put(token);
  const root = await write({ ...place({ caps: [] }).files, ...put.files });
  return observe(root, new Map(), put.second ? { userSkills: put.second(root) } : {});
}

describe('a capability is checked the same wherever it is loaded from', () => {
  for (const source of SOURCES) {
    for (const token of TOKENS) {
      it(`finds one orphan, one unresolved link and one unreachable capability: ${source.name} (${token})`, async () => {
        const obs = await setupOf(source, token);
        expect(obs.count('orphan')).toBe(1);
        expect(obs.count('unresolved-link')).toBe(1);
        expect(obs.count('unreachable')).toBe(1);
      });

      it(`names the capability by the source it was read in: ${source.name} (${token})`, async () => {
        const obs = await setupOf(source, token);
        const identity = capAtomFile(obs.map.atoms, CAP);
        expect(identity).toBeDefined();
        if (source.name !== 'the project') expect(identity).toContain(token);
      });
    }
  }

  it('gives two sources two names: the same capability in two folders is not named by one string', async () => {
    const source = SOURCES[3];
    if (!source) throw new Error('no source');
    const [a, b] = await Promise.all(TOKENS.slice(0, 2).map((token) => setupOf(source, token)));
    expect(capAtomFile(a?.map.atoms ?? [], CAP)).not.toBe(capAtomFile(b?.map.atoms ?? [], CAP));
  });

  it('metamorphic: the same defects in the project or in a second source give the same findings', async () => {
    const found: Array<Record<string, number>> = [];
    for (const source of SOURCES) found.push((await setupOf(source, 'cobaltkit')).counts);
    for (const counts of found) expect(counts).toEqual(found[0]);
  });
});
