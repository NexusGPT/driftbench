import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { ESTATE_NAMES, estateFolder, type GoldUnit, loadGold } from './gold';
import { loadTruth } from './truth';

/**
 * The refers_to and limits_table sections of the truth files (examples/estates/gold5/TRUTH-SCHEMA.md, sections 5
 * and 6): the committed files load clean, and each check of the loader names a bad entry.
 */

let gold: GoldUnit[] = [];
let work = '';
beforeAll(async () => {
  gold = await loadGold();
  work = await mkdtemp(join(tmpdir(), 'truth-refers-'));
});
afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

/** Estate A's committed truth with its two new sections replaced, loaded from a scratch file. */
async function problemsWith(sections: {
  refers_to?: unknown;
  limits_table?: unknown;
}): Promise<string[]> {
  const text = await readFile(join(estateFolder('A'), 'truth.yaml'), 'utf8');
  const truth = parse(text) as Record<string, unknown>;
  const path = join(work, `truth-${Math.random().toString(36).slice(2)}.yaml`);
  const file = { ...truth, refers_to: [], limits_table: [], ...sections };
  await writeFile(path, stringify(file));
  return (await loadTruth('A', gold, path)).problems;
}

describe('refers_to and limits_table in the truth files', () => {
  it.each(ESTATE_NAMES)('the committed truth of estate %s loads with both sections', async (estate) => {
    const { truth, problems } = await loadTruth(estate, gold);
    expect(problems).toEqual([]);
    expect(Array.isArray(truth.refers_to)).toBe(true);
    expect(truth.limits_table.length).toBeGreaterThan(0);
  });

  it('names an id that is no unit of the estate', async () => {
    const problems = await problemsWith({ refers_to: [{ unit: 'zzzzzzzzzz', to: 'hykpyrtlha' }] });
    expect(problems).toContain('refers_to.0.unit: zzzzzzzzzz is no unit of estate A');
  });

  it('refuses a range whose ends are out of file order', async () => {
    const problems = await problemsWith({
      refers_to: [{ unit: '2nfri23ink', to: { from: 'fs6zqfdxp7', to: 'q6hrdkjhga' } }],
    });
    expect(problems).toContain('refers_to.0.to: fs6zqfdxp7 to q6hrdkjhga is no run of one file in order');
  });

  it('refuses a unit that refers to itself, alone or inside a range', async () => {
    const problems = await problemsWith({
      refers_to: [
        { unit: 'fko2ua5tpt', to: 'fko2ua5tpt' },
        { unit: 'tqcnb4gt46', to: { from: 'q6hrdkjhga', to: 'fs6zqfdxp7' } },
      ],
    });
    expect(problems).toContain('refers_to.0: fko2ua5tpt refers to itself');
    expect(problems).toContain('refers_to.1: tqcnb4gt46 refers to itself');
  });

  it('refuses a limits_table range that holds a unit other than a table cell', async () => {
    // From the heading of the section to the sentence that points at the table: a heading and sentences.
    const problems = await problemsWith({ limits_table: [{ from: 'hmsstexity', to: '2nfri23ink' }] });
    expect(problems).toContain('limits_table.0: hmsstexity is a heading, not a table cell');
  });
});
