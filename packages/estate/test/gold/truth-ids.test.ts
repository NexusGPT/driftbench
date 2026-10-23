import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GoldUnit } from './gold';
import { loadTruth } from './truth';

/**
 * An id such as 13438124e4 is a number in the default YAML schema (it reads as 134381240000). The truth loader reads
 * the file with that schema and checks every id against `z.string()`, so an unquoted id of that shape is refused by the
 * path of its field instead of being matched against a wrong value. These tests pin that.
 */

const planted = Array.from(
  { length: 8 },
  (_, i) => `  - { unit: "abcdefgh0${i}", ask: "ask ${i}", reply_act: answer }`,
).join('\n');

const truthWith = (limitUnit: string, governs: string, cover: string): string =>
  [
    'version: 1',
    'estate: A',
    `gold5Sha256: ${'a'.repeat(64)}`,
    'limits:',
    `  - { unit: ${limitUnit}, limit: 5, comparison: le, role: constraint, governs: ${governs} }`,
    'scopes: []',
    'planted_rules:',
    planted,
    'plan:',
    `  cover: [${cover}]`,
    '  exclude: []',
    '  same_row: []',
    '',
  ].join('\n');

const unit = (id: string): GoldUnit => ({
  file: 'A-skill.md',
  n: 0,
  id,
  container: '',
  text: id,
  section: '',
  estate: 'A',
  labelAuthor: 'rule',
  labelOpus: 'rule',
  agreed: true,
  label: 'rule',
});

/** Gold units for every planted rule and for the ids the tests use, each a rule outside the standing file. */
const GOLD = [...Array.from({ length: 8 }, (_, i) => `abcdefgh0${i}`), '13438124e4'].map(unit);

async function loadWith(text: string, gold: readonly GoldUnit[] = []) {
  const dir = await mkdtemp(join(tmpdir(), 'truth-ids-'));
  const path = join(dir, 'truth.yaml');
  await writeFile(path, text);
  try {
    return { error: undefined, ...(await loadTruth('A', gold, path)) };
  } catch (error) {
    return { error: error as Error, truth: undefined, problems: [] as string[] };
  }
}
const load = async (text: string): Promise<Error | undefined> => (await loadWith(text)).error;

describe('an id that the default YAML schema reads as a number', () => {
  it.each(['13438124e4', '774723e072', '9651728e48', '1234567890'])(
    'is refused by its field path in a limit unit when %s is not quoted',
    async (id) => {
      const error = await load(truthWith(id, '"abcdefghij"', '"abcdefghij"'));
      expect(error?.message).toMatch(/limits\.0\.unit/);
      expect(error?.message).not.toMatch(/limits\.0\.governs/);
    },
  );

  it('is refused by its field path in governs and in a plan list', async () => {
    const error = await load(truthWith('"abcdefghij"', '13438124e4', '13438124e4'));
    expect(error?.message).toMatch(/limits\.0\.governs/);
    expect(error?.message).toMatch(/plan\.cover\.0/);
  });

  it('is accepted when quoted: a known quoted id gives no problem, an unknown one is reported by its path', async () => {
    const known = await loadWith(truthWith('"13438124e4"', '"13438124e4"', '"13438124e4"'), GOLD);
    expect(known.error).toBeUndefined();
    expect(known.problems).toEqual([]);
    expect(known.truth?.limits[0]?.unit).toBe('13438124e4');
    const unknown = await loadWith(truthWith('"13438124e4"', '"13438124e5"', '"13438124e4"'), GOLD);
    expect(unknown.error).toBeUndefined();
    expect(unknown.problems).toHaveLength(1);
    expect(unknown.problems[0]).toMatch(/^limits\.0\.governs: 13438124e5 is no unit of estate A/);
  });
});
