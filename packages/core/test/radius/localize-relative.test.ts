import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Localization, localizeRows, ochiaiLocalize, relativeLocalize } from '../../src/radius/localize';
import { h7Record, h7Specs, keyOf, registry } from './mutation-h7';

/**
 * Relative counting: each block read against its own baseline verdict (H5). On the stored H7 runs the
 * baseline has one failing block, `p1` (porting-ok), which fails in all 6 baseline runs.
 */

const h5: { variants: { variant: string; sections: string[]; failing: string[][] }[] } = JSON.parse(
  readFileSync(new URL('../fixtures/sections/h5-localize.json', import.meta.url), 'utf8'),
);
const rows = localizeRows(h7Specs, registry, 'F');
const local = registry.sections.filter((s) => s.scope === 'local').map((s) => s.id);
const global = new Set(registry.sections.filter((s) => s.scope === 'global').map((s) => s.id));
const all = [...keyOf.values()];
const baseline = h7Record().baseline.map((run) => new Map(Object.entries(run)));
const p1 = 'porting-ok#p1';

/** EXAM of the best ranked planted section, ties averaged, as H5 registered it. */
const exam = (result: Localization, planted: string[]) =>
  Math.min(
    ...planted.map((section) => {
      const at = result.sections.find((each) => each.section === section);
      if (!at) return Number.POSITIVE_INFINITY;
      return ((at.best - 1 + at.worst - 1) / 2 + 1) / local.length;
    }),
  );

const faults = h5.variants
  .filter((variant) => !variant.sections.some((section) => global.has(section)))
  .map((variant) => ({
    sections: variant.sections,
    runs: variant.failing.map((failing) => {
      const failed = new Set(failing.map((id) => keyOf.get(id)));
      return new Map(all.map((key) => [key, failed.has(key)]));
    }),
  }));

describe('relative counting', () => {
  it('reads the baseline: p1 fails there, so it is no row and its failures blame nothing', () => {
    // Three runs where only p1 fails, as it does in the baseline.
    const runs = [0, 1, 2].map(() => new Map(all.map((key) => [key, key === p1])));
    const always = ochiaiLocalize(rows, runs, { local }, 'flat');
    expect(always.failureWeight).toBe(1);
    expect(always.sections[0]?.score).toBeGreaterThan(0);
    const relative = relativeLocalize(rows, baseline, runs, { local });
    expect(relative.baseline).toEqual({ failing: [p1], unstable: [] });
    expect(relative.failureWeight).toBe(0);
    expect(relative.sections.every((section) => section.score === 0)).toBe(true);
  });

  it('blames no section of a suite that holds its baseline under a mutant', () => {
    const passing = new Map(all.map((key) => [key, false]));
    const unchanged = relativeLocalize(rows, [passing, passing], [passing, passing, passing], { local });
    expect(unchanged.failureWeight).toBe(0);
    expect(unchanged.sections.filter((section) => section.score > 0)).toEqual([]);
  });

  it('is worse than flat counting over the same rows on 2 of 84 faults (2.4%), as H5 measured', () => {
    let worse = 0;
    let better = 0;
    let evaluable = 0;
    for (const fault of faults) {
      const relative = relativeLocalize(rows, baseline, fault.runs, { local });
      const keep = (key: string) => !relative.baseline?.failing.includes(key);
      const flat = ochiaiLocalize(
        rows.filter((row) => keep(row.key)),
        fault.runs.map((run) => new Map([...run].filter(([key]) => keep(key)))),
        { local },
        'flat',
      );
      if (flat.failureWeight === 0) continue;
      evaluable++;
      if (exam(relative, fault.sections) > exam(flat, fault.sections)) worse++;
      if (exam(relative, fault.sections) < exam(flat, fault.sections)) better++;
    }
    expect([evaluable, worse, better]).toEqual([84, 2, 3]);
    expect(worse / evaluable).toBeLessThanOrEqual(0.05);
  });

  it('against flat counting over every block, p1 included, is worse on 14 of 98', () => {
    // Flat counting credits the sections p1 links to with p1's baseline failure, mutant or not: 9 of the
    // 14 are faults whose mutant kills no block. Reported, not a bar: grouped counting holds 3 of 98.
    let worse = 0;
    let evaluable = 0;
    for (const fault of faults) {
      const flat = ochiaiLocalize(rows, fault.runs, { local }, 'flat');
      if (flat.failureWeight === 0) continue;
      evaluable++;
      if (
        exam(relativeLocalize(rows, baseline, fault.runs, { local }), fault.sections) >
        exam(flat, fault.sections)
      )
        worse++;
    }
    expect([evaluable, worse]).toEqual([98, 14]);
  });

  it('leaves out a block the caller marks flaky, and a block whose baseline runs tie', () => {
    const tie = [new Map([[p1, true]]), new Map([[p1, false]])];
    expect(relativeLocalize(rows, tie, tie, { local }).baseline?.unstable).toEqual([p1]);
    const flaky = relativeLocalize(rows, baseline, baseline, { local }, { exclude: ['upgrade-happy#u1'] });
    expect(flaky.baseline?.unstable).toEqual(['upgrade-happy#u1']);
  });
});
