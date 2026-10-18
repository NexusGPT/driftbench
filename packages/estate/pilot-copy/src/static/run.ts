import type { StaticTest } from '@agent-nexus/driftbench-generate';
import { scanEstate } from '../map/build';
import type { EstateReader } from '../scan/reader';

/**
 * The static runner: reads an estate again, with code only (no model), and checks each static test of a
 * generated suite against the files as they are now. Run on the original estate it shows the invariants
 * that do not hold; run on a mutant copy it shows which static tests the mutation turns red.
 *
 * - invariant: the scan measures the invariant of that check again; the test passes when it holds. An
 *   invariant the scan no longer measures (its file is gone) fails.
 * - setting: the settings still declare the key, with the same value when the test names one.
 */

export type StaticResult = { id: string; atom: string; pass: boolean; detail: string };

export type StaticInput = { root: string; reader: EstateReader; ceiling?: number };

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
