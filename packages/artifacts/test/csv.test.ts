import { fileURLToPath } from 'node:url';
import { csvReader } from '@agent-nexus/driftbench-artifacts';
import { type ArtifactDocument, loadSpecFile } from '@agent-nexus/driftbench-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from '../src/csv';
import { bytesOf, runCases } from './fixtures';

const SPEC = fileURLToPath(new URL('../../../examples/acme/specs/tasks/price-sheet.yaml', import.meta.url));

/** The catalog the Acme price-sheet task seeds its workspace with, read from the spec itself. */
let catalog = '';
beforeAll(async () => {
  const loaded = await loadSpecFile(SPEC);
  if (!loaded.ok) throw new Error(`the Acme spec does not load: ${JSON.stringify(loaded.errors)}`);
  catalog = loaded.spec.given?.world?.workspace?.files?.['catalog.csv'] ?? '';
});

const open = async (): Promise<ArtifactDocument> => csvReader.open(bytesOf(catalog), 'catalog.csv');

runCases(csvReader, open, {
  header: {
    pass: [
      {
        check: { header: ['plan_id', 'name', 'category', 'allowance', 'monthly_usd'] },
        evidence: 'catalog.csv row 1: "plan_id"',
      },
      {
        check: {
          header: { row: 1, values: ['plan_id', { regex: '^na' }, 'category', 'allowance', 'monthly_usd'] },
        },
      },
    ],
    fail: [
      { check: { header: ['plan_id', 'name'] }, evidence: 'C1 holds "category" past the expected header' },
      {
        check: { header: ['id', 'name', 'category', 'allowance', 'monthly_usd'] },
        evidence: 'A1 is "plan_id", expected "id"',
      },
    ],
  },
  rows: {
    pass: [
      { check: { rows: 6 }, evidence: 'catalog.csv: 6 rows with values from row 2 (rows 2 to 7)' },
      { check: { rows: { count: 7, from_row: 1 } } },
      { check: { rows: { min: 1 } } },
    ],
    fail: [{ check: { rows: 5 }, evidence: '6 rows with values from row 2 (rows 2 to 7), expected 5' }],
  },
  cells: {
    pass: [
      {
        check: { cells: { column: 'monthly_usd', values: [15, 25, 35, 40, 60, 35] } },
        evidence: 'E2:E7 (monthly_usd) = "15", "25", "35", "40", "60", "35"',
      },
      {
        check: { cells: { column: 'B', from_row: 2, to_row: 3, values: ['Acme Mobile S', 'Acme Mobile M'] } },
      },
      { check: { cells: { column: 3, from_row: 5, values: ['home', 'home', 'home'] } } },
    ],
    fail: [
      {
        check: { cells: { column: 'monthly_usd', values: [15, 25, 30, 40, 60, 35] } },
        evidence: 'E4 is "35", expected 30',
      },
      { check: { cells: { column: 'price', values: [15] } }, evidence: 'no column "price"' },
    ],
  },
  value: {
    pass: [
      { check: { value: { cell: 'C5', equals: 'home' } }, evidence: 'C5 (category) = "home"' },
      { check: { value: { column: 'allowance', row: 4, equals: 'unlimited' } } },
      { check: { value: { cell: 'F2', equals: null } } },
    ],
    fail: [
      { check: { value: { cell: 'E7', equals: 40 } }, evidence: 'E7 (monthly_usd) = "35", expected 40' },
    ],
  },
  total: {
    pass: [
      {
        check: { total: { column: 'monthly_usd', equals: 210 } },
        evidence: 'E2:E7 (monthly_usd) sums to 210 (6 numbers)',
      },
      { check: { total: { column: 'E', from_row: 2, to_row: 4, equals: 75 } } },
    ],
    fail: [
      {
        check: { total: { column: 'monthly_usd', equals: 200 } },
        evidence: 'sums to 210 (6 numbers); expected 200',
      },
      {
        check: { total: { column: 'allowance', to_row: 2, equals: 0 } },
        evidence: 'D2 holds "10 GB", not a number',
      },
    ],
  },
  contains: {
    pass: [{ check: { contains: 'air-5g,Acme Air 5G,home,200 Mbps,35' } }],
    fail: [{ check: { contains: 'Acme Fiber 2000' }, evidence: 'missing "Acme Fiber 2000"' }],
  },
  not_contains: {
    pass: [{ check: { not_contains: ';' } }],
    fail: [{ check: { not_contains: 'unlimited' }, evidence: 'found "unlimited"' }],
  },
  regex: {
    pass: [{ check: { regex: '^fiber-\\d+,' }, evidence: 'matched "fiber-300,"' }],
    fail: [{ check: { regex: '^dsl-' }, evidence: 'no match for /^dsl-/' }],
  },
});

describe('csv reader', () => {
  it('parses quoted fields, doubled quotes, line breaks inside quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",\r\n', ',')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', ''],
    ]);
    expect(parseCsv('', ',')).toEqual([]);
    expect(parseCsv('a\n\nb', ',')).toEqual([['a'], [''], ['b']]);
  });

  it('picks the delimiter from the first line, outside quotes, and a tab for .tsv', () => {
    expect(detectDelimiter('"a,b";c;d\n1;2;3', 'x.csv')).toBe(';');
    expect(detectDelimiter('a\tb\n', 'x.csv')).toBe('\t');
    expect(detectDelimiter('a,b\n', 'x.csv')).toBe(',');
    expect(detectDelimiter('a,b\n', 'x.TSV')).toBe('\t');
  });

  it('reads a semicolon file with a byte order mark, and its numbers and booleans as the spec writes them', async () => {
    const document = await csvReader.open(
      bytesOf('﻿plan;price;active\nS;15.50;TRUE\n\nM;1e2;false\n'),
      'prices.csv',
    );
    expect(document.check({ header: ['plan', 'price', 'active'] }).ok).toBe(true);
    expect(document.check({ rows: 2 }).evidence).toBe(
      'prices.csv: 2 rows with values from row 2 (rows 2, 4)',
    );
    expect(document.check({ cells: { column: 'price', from_row: 2, to_row: 2, values: [15.5] } }).ok).toBe(
      true,
    );
    expect(document.check({ value: { column: 'active', row: 2, equals: true } }).ok).toBe(true);
    expect(document.check({ value: { column: 'active', row: 4, equals: false } }).ok).toBe(true);
    expect(document.check({ total: { column: 'price', to_row: 4, equals: 115.5 } }).ok).toBe(true);
  });

  it('fails the grid checks of a malformed file with the reason, and still searches its text', async () => {
    const document = await csvReader.open(bytesOf('plan,price\n"S,15\n'), 'broken.csv');
    expect(document.check({ rows: 1 })).toMatchObject({
      ok: false,
      evidence: 'broken.csv could not be read as csv: the quoted field opened on line 2 is never closed',
    });
    expect(document.check({ contains: 'plan,price' }).ok).toBe(true);
    expect(document.text()).toBe('plan,price\n"S,15\n');
  });
});
