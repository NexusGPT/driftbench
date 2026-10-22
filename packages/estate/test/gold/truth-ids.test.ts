import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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

async function load(text: string): Promise<Error | undefined> {
  const dir = await mkdtemp(join(tmpdir(), 'truth-ids-'));
  const path = join(dir, 'truth.yaml');
  await writeFile(path, text);
  try {
    await loadTruth('A', [], path);
    return undefined;
  } catch (error) {
    return error as Error;
  }
}

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

  it('is accepted when quoted: the schema reaches the units, where an unknown id is reported by its path', async () => {
    const error = await load(truthWith('"13438124e4"', '"13438124e4"', '"13438124e4"'));
    // The file fits the schema; with no gold units the loader returns problems instead of throwing.
    expect(error).toBeUndefined();
  });
});
