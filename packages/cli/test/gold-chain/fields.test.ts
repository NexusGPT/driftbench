import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { ESTATES_DIR } from '../../../estate/test/gold/gold';
import { readRefersEntries, readTableRanges, unitsInRange } from './fields';

const truthOf = (estate: 'a' | 'b' | 'c'): Record<string, unknown> =>
  parseYaml(readFileSync(join(ESTATES_DIR, `gold-${estate}`, 'truth.yaml'), 'utf8'), { schema: 'failsafe' }) as Record<
    string,
    unknown
  >;

describe('the readers of the two field formats', () => {
  it('read the gold5 files of A, B and C as they are: `to: id`, `to: {from, to}` and number_table ranges', () => {
    const problems: string[] = [];
    const counts = (['a', 'b', 'c'] as const).map((estate) => {
      const raw = truthOf(estate);
      const refers = readRefersEntries(raw.refers_to, problems);
      const tables = readTableRanges(raw.number_table, problems, 'number_table');
      return { estate, refers: refers.length, ranges: refers.filter((entry) => entry.to.some((ref) => 'from' in ref)).length, tables: tables.length };
    });
    expect(problems).toEqual([]);
    expect(counts).toEqual([
      { estate: 'a', refers: 3, ranges: 2, tables: 2 },
      { estate: 'b', refers: 0, ranges: 0, tables: 2 },
      { estate: 'c', refers: 9, ranges: 5, tables: 1 },
    ]);
    const a = readRefersEntries(truthOf('a').refers_to, []);
    expect(a[0]).toEqual({ unit: '2nfri23ink', to: [{ from: 'q6hrdkjhga', to: 'fs6zqfdxp7' }] });
    expect(a[2]).toEqual({ unit: 'fko2ua5tpt', to: [{ id: 'hykpyrtlha' }] });
  });

  it('read the units-table format: `target`, `targets` and a {header, rows} table as one range', () => {
    const problems: string[] = [];
    expect(readRefersEntries([{ unit: 'u1', target: 'u2' }, { unit: 'u3', targets: ['u4', { from: 'u5', to: 'u6' }] }], problems)).toEqual([
      { unit: 'u1', to: [{ id: 'u2' }] },
      { unit: 'u3', to: [{ id: 'u4' }, { from: 'u5', to: 'u6' }] },
    ]);
    expect(readTableRanges([{ header: 'h', rows: ['r1', 'r2'] }, { from: 'a', to: 'b' }], problems, 'limits_table')).toEqual([
      { from: 'h', to: 'r2' },
      { from: 'a', to: 'b' },
    ]);
    expect(problems).toEqual([]);
  });

  it('name every bad entry by list and position, and drop none silently', () => {
    const problems: string[] = [];
    readRefersEntries(['x', { unit: 'u1' }, { unit: 'u2', to: 'a', target: 'b' }, { unit: 'u3', targets: [] }, { to: 'a' }, { unit: 'u4', to: { from: 'a' } }], problems);
    readTableRanges([{ header: 'h' }, 7], problems, 'number_table');
    expect(problems).toEqual([
      'refers_to[0]: not a mapping',
      'refers_to[1]: name the place with exactly one of to, target, targets',
      'refers_to[2]: name the place with exactly one of to, target, targets',
      'refers_to[3]: targets is empty',
      'refers_to[4]: no unit',
      'refers_to[5]: to is neither an id nor a {from, to} range',
      'number_table[0]: neither a {from, to} range nor a {header, rows} table',
      'number_table[1]: not a mapping',
    ]);
  });

  it('resolve a range over the units of one file in order, and nothing when it runs across files or backwards', () => {
    const units = [
      { id: 'a', file: 'f1' },
      { id: 'b', file: 'f1' },
      { id: 'c', file: 'f1' },
      { id: 'd', file: 'f2' },
    ];
    expect(unitsInRange(units, { from: 'a', to: 'c' }).map((unit) => unit.id)).toEqual(['a', 'b', 'c']);
    expect(unitsInRange(units, { from: 'c', to: 'a' })).toEqual([]);
    expect(unitsInRange(units, { from: 'c', to: 'd' })).toEqual([]);
  });
});
