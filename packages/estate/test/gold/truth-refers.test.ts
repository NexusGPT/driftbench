import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { ESTATE_NAMES, estateFolder, type GoldUnit, loadGold } from './gold';
import { loadTruth } from './truth';

/**
 * The refers_to and number_table sections of the truth files (examples/estates/gold5/TRUTH-SCHEMA.md, sections 5
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
async function problemsWith(sections: { refers_to?: unknown; number_table?: unknown }): Promise<string[]> {
  const text = await readFile(join(estateFolder('A'), 'truth.yaml'), 'utf8');
  const truth = parse(text) as Record<string, unknown>;
  const path = join(work, `truth-${Math.random().toString(36).slice(2)}.yaml`);
  const file = { ...truth, refers_to: [], number_table: [], ...sections };
  await writeFile(path, stringify(file));
  return (await loadTruth('A', gold, path)).problems;
}

describe('refers_to and number_table in the truth files', () => {
  it.each(ESTATE_NAMES)('the committed truth of estate %s loads with both sections', async (estate) => {
    const { truth, problems } = await loadTruth(estate, gold);
    expect(problems).toEqual([]);
    // Read through a plain shape, so the file also typechecks against a loader that lacks both fields (red first).
    const read = truth as { refers_to?: unknown[]; number_table?: unknown[] };
    expect(Array.isArray(read.refers_to)).toBe(true);
    expect(read.number_table?.length).toBeGreaterThan(0);
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

  it('refuses a number_table range that holds a unit other than a table cell', async () => {
    // From the heading of the section to the sentence that points at the table: a heading and sentences.
    const problems = await problemsWith({ number_table: [{ from: 'hmsstexity', to: '2nfri23ink' }] });
    expect(problems).toContain('number_table.0: hmsstexity is a heading, not a table cell');
  });

  it('refuses a refers_to entry given twice', async () => {
    const entry = { unit: 'fko2ua5tpt', to: 'hykpyrtlha' };
    const problems = await problemsWith({ refers_to: [entry, { ...entry }] });
    expect(problems).toContain('refers_to.1: the same entry as refers_to.0');
  });

  it('refuses two number tables that share a cell', async () => {
    const problems = await problemsWith({
      number_table: [
        { from: 'ls4xe277ue', to: 'v6tqzxlzqq' },
        { from: 'kmxy45ryyx', to: 'v6tqzxlzqq' },
      ],
    });
    expect(problems).toContain('number_table.1: overlaps number_table.0');
  });
});
