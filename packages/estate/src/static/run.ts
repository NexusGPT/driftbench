import type { StaticTest } from '@agent-nexus/driftbench-generate';
import { orphansOf, scanEstate } from '../map/build';
import type { EstateReader } from '../scan/reader';
import type { EstateMap } from '../schema';

/**
 * The static runner: reads an estate again, with code only (no model), and checks each static test of a
 * generated suite against the files as they are now. Run on the original estate it shows the invariants
 * that do not hold; run on a mutant copy it shows which static tests the mutation turns red.
 *
 * - invariant: the scan measures the invariant of that check again; the test passes when it holds. An
 *   invariant the scan no longer measures (its file is gone) fails. `no_orphans` counts the files the atoms of the
 *   given map name, when one is given.
 * - setting: the settings still declare the key, with the same value when the test names one.
 */

export type StaticResult = { id: string; atom: string; pass: boolean; detail: string };

export type StaticInput = {
  root: string;
  reader: EstateReader;
  ceiling?: number;
  /**
   * The estate map the tests were generated from, or a mutant's own map. Code cannot read which files a prose
   * names, so without it a file only the prose names is an orphan; with it, the atoms the prose gave count.
   */
  map?: EstateMap;
};

export async function runStaticTests(
  tests: readonly StaticTest[],
  input: StaticInput,
): Promise<StaticResult[]> {
  const scanned = await scanEstate({
    root: input.root,
    reader: input.reader,
    ...(input.ceiling !== undefined ? { ceiling: input.ceiling } : {}),
  });
  const invariants = scanned.map.atoms.filter((atom) => atom.kind === 'invariant');
  const settings = scanned.raw.settings;
  return tests.map((test): StaticResult => {
    const base = { id: test.id, atom: test.atom };
    if (test.check.kind === 'invariant') {
      const name = test.check.check;
      const atom = invariants.find((candidate) => candidate.fields?.check === name);
      if (!atom) return { ...base, pass: false, detail: `the estate no longer measures ${name}` };
      if (name === 'no_orphans' && input.map) {
        const prose = input.map.atoms.filter((candidate) => candidate.producedBy === 'model');
        const code = scanned.map.atoms.filter((candidate) => candidate.producedBy === 'code');
        const orphans = orphansOf(scanned.raw, [...code, ...prose], scanned.map.edges);
        return {
          ...base,
          pass: orphans.length === 0,
          detail: `${name} ${orphans.length === 0 ? 'holds' : 'does not hold'}: ${JSON.stringify({ orphans })}`,
        };
      }
      const { check: _check, holds, ...measured } = atom.fields ?? {};
      return {
        ...base,
        pass: holds === true,
        detail: `${name} ${holds === true ? 'holds' : 'does not hold'}: ${JSON.stringify(measured)}`,
      };
    }
    const { key, value } = test.check;
    const declared = settings.find((setting) => setting.key === key);
    if (!declared) return { ...base, pass: false, detail: `the settings no longer declare ${key}` };
    if (value !== undefined && declared.value !== value) {
      return {
        ...base,
        pass: false,
        detail: `${key} is ${declared.value ?? 'not kept'}, the map says ${value}`,
      };
    }
    return { ...base, pass: true, detail: value === undefined ? `${key} is declared` : `${key} is ${value}` };
  });
}
