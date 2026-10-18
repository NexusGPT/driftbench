import { xlsxReader } from '@agent-nexus/driftbench-artifacts';
import type { ArtifactDocument } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { bytesOf, runCases, workbook } from './fixtures';

/** Two regional sheets with a total row each. South's revenue total is wrong on purpose (190, not 180). */
function regional(): Promise<Uint8Array> {
  return workbook((book) => {
    const north = book.addWorksheet('North');
    north.addRow(['Month', 'Units', 'Revenue (USD)', 'Unit price (USD)']);
    north.addRow(['Jan', 10, 150, { formula: 'C2/B2', result: 15, shareType: 'shared', ref: 'D2:D4' }]);
    north.addRow(['Feb', 12, 180, { sharedFormula: 'D2', result: 15 }]);
    north.addRow(['Mar', 8, 120, { sharedFormula: 'D2', result: 15 }]);
    north.addRow(['Total', { formula: 'SUM(B2:B4)', result: 30 }, { formula: 'SUM(C2:C4)', result: 450 }]);
    const south = book.addWorksheet('South');
    south.addRow(['Month', 'Units', 'Revenue (USD)']);
    south.addRow(['Jan', 5, 75]);
    south.addRow(['Feb', 7, 105]);
    south.addRow(['Total', 12, 190]);
  });
}

/** A sheet with every kind of broken cell: a formula nobody calculated, an error result, an error value. */
function broken(): Promise<Uint8Array> {
  return workbook((book) => {
    const prices = book.addWorksheet('Prices');
    prices.addRow(['Plan', 'Monthly', 'Yearly']);
    prices.addRow(['S', 15, { formula: 'B2*12' }]);
    prices.addRow(['M', 0, { formula: '1/B3', result: { error: '#DIV/0!' } }]);
    prices.getCell('E4').value = { error: '#REF!' };
    const notes = book.addWorksheet('Notes', { state: 'hidden' });
    notes.getCell('A1').value = 'Fictional data';
  });
}

const open = async (): Promise<ArtifactDocument> => xlsxReader.open(await regional(), 'out/regional.xlsx');
const openBroken = async (): Promise<ArtifactDocument> => xlsxReader.open(await broken(), 'out/broken.xlsx');

runCases(xlsxReader, open, {
  sheets: {
    pass: [
      { check: { sheets: ['North', 'South'] }, evidence: 'sheets "North", "South"' },
      { check: { sheets: { values: ['South'], order: 'any_order' } } },
      { check: { sheets: { values: [{ regex: '^N' }, 'South'], order: 'in_order' } } },
    ],
    fail: [
      { check: { sheets: ['North'] }, evidence: '1 more than expected: "South"' },
      { check: { sheets: ['South', 'North'] }, evidence: 'item 1 is "North", expected "South"' },
      { check: { sheets: ['North', 'South', 'Summary'] }, evidence: 'missing "Summary"' },
    ],
  },
  header: {
    pass: [
      {
        check: {
          header: { sheet: 'North', row: 1, values: ['Month', 'Units', 'Revenue (USD)', 'Unit price (USD)'] },
        },
        evidence: 'North row 1: "Month", "Units", "Revenue (USD)", "Unit price (USD)"',
      },
      { check: { header: ['Month', 'Units', 'Revenue (USD)', { contains: 'Unit price' }] } },
    ],
    fail: [
      {
        check: { header: { sheet: 'South', values: ['Month', 'Units'] } },
        evidence: 'South!C1 holds "Revenue (USD)" past the expected header',
      },
      {
        check: {
          header: { sheet: 'North', values: ['Month', 'Quantity', 'Revenue (USD)', 'Unit price (USD)'] },
        },
        evidence: 'North!B1 is "Units", expected "Quantity"',
      },
    ],
  },
  rows: {
    pass: [
      {
        check: { rows: { sheet: 'North', count: 4 } },
        evidence: 'North: 4 rows with values from row 2 (rows 2 to 5)',
      },
      { check: { rows: { sheet: 'South', count: { min: 2, max: 3 } } } },
      { check: { rows: { sheet: 'North', count: 5, from_row: 1 } } },
    ],
    fail: [{ check: { rows: { sheet: 'North', count: 3 } }, evidence: 'expected 3' }],
  },
  cells: {
    pass: [
      {
        check: { cells: { sheet: 'North', column: 'B', values: [10, 12, 8] } },
        evidence: 'North!B2:B4 (Units) = 10, 12, 8',
      },
      {
        check: {
          cells: { sheet: 'North', column: 'Revenue (USD)', from_row: 3, values: [180, { regex: '^12' }] },
        },
      },
      { check: { cells: { sheet: 'North', column: 4, from_row: 2, to_row: 4, values: [15, 15, 15] } } },
    ],
    fail: [
      {
        check: { cells: { sheet: 'North', column: 'B', values: [10, 13, 8] } },
        evidence: 'B3 is 12, expected 13',
      },
      {
        check: { cells: { sheet: 'North', column: 'A', values: ['Jan', 'Feb', 'April'] } },
        evidence: 'A4 is "Mar"',
      },
      { check: { cells: { sheet: 'North', column: 'Profit', values: [1] } }, evidence: 'no column "Profit"' },
    ],
  },
  formula: {
    pass: [
      {
        check: { formula: { sheet: 'North', cell: 'B5', regex: '^=SUM\\(B2:B4\\)$' } },
        evidence: 'North!B5 holds =SUM(B2:B4) (cached result 30)',
      },
      {
        check: { formula: { sheet: 'North', cell: 'D3', regex: '^=C3/B3$' } },
        evidence: 'North!D3 holds =C3/B3',
      },
      { check: { formula: { sheet: 'North', cell: 'C5' } } },
    ],
    fail: [
      { check: { formula: { sheet: 'South', cell: 'C4' } }, evidence: 'South!C4 holds 190 and no formula' },
      {
        check: { formula: { sheet: 'North', cell: 'C5', regex: 'AVERAGE' } },
        evidence: 'which does not match /AVERAGE/',
      },
    ],
  },
  value: {
    pass: [
      {
        check: { value: { sheet: 'North', cell: 'C5', equals: 450 } },
        evidence: 'North!C5 (Revenue (USD)) = 450',
      },
      { check: { value: { sheet: 'North', column: 'Month', row: 2, equals: 'Jan' } } },
      { check: { value: { sheet: 'South', cell: 'D2', equals: { absent: true } } } },
    ],
    fail: [
      {
        check: { value: { sheet: 'North', cell: 'C5', equals: 451 } },
        evidence: 'North!C5 (Revenue (USD)) = 450, expected 451',
      },
      {
        check: { value: { sheet: 'North', cell: 'A2', equals: { one_of: ['Feb', 'Mar'] } } },
        evidence: 'expected one of "Feb", "Mar"',
      },
    ],
  },
  total: {
    pass: [
      {
        check: { total: { sheet: 'North', column: 'C', cell: 'C5' } },
        evidence: 'North!C2:C4 (Revenue (USD)) sums to 450 (3 numbers); North!C5 = 450',
      },
      { check: { total: { sheet: 'South', column: 'Units', to_row: 3, equals: 12 } } },
      { check: { total: { sheet: 'North', column: 'B', to_row: 4, equals: 30, cell: 'B5' } } },
    ],
    fail: [
      {
        check: { total: { sheet: 'South', column: 'C', cell: 'C4' } },
        evidence: 'sums to 180 (2 numbers); South!C4 = 190; C4 is not the sum',
      },
      {
        check: { total: { sheet: 'North', column: 'B', to_row: 4, equals: 31 } },
        evidence: 'sums to 30 (3 numbers); expected 31',
      },
      {
        check: { total: { sheet: 'North', column: 'A', to_row: 4, equals: 0 } },
        evidence: 'A2 holds "Jan", not a number',
      },
    ],
  },
  no_error_cells: {
    pass: [
      { check: { no_error_cells: true }, evidence: 'no error cell in 2 sheets (31 cells hold something)' },
      {
        check: { no_error_cells: { sheet: 'Notes' } },
        in: openBroken,
        evidence: 'no error cell in sheet Notes (1 cell holds something)',
      },
    ],
    fail: [
      {
        check: { no_error_cells: true },
        in: openBroken,
        evidence: '2 error cells in 2 sheets: Prices!C3 = #DIV/0!, Prices!E4 = #REF!',
      },
      { check: { no_error_cells: { sheet: 'Prices' } }, in: openBroken, evidence: 'in sheet Prices' },
    ],
  },
  contains: {
    pass: [
      { check: { contains: ['Revenue (USD)', 'Sheet 2 of 2:   South'] }, evidence: 'found "Revenue (USD)"' },
    ],
    fail: [{ check: { contains: 'Profit' }, evidence: 'missing "Profit" (0 of 1 found)' }],
  },
  not_contains: {
    pass: [{ check: { not_contains: ['Profit', '#REF!'] } }],
    fail: [{ check: { not_contains: 'Mar' }, evidence: 'found "Mar" in' }],
  },
  regex: {
    pass: [{ check: { regex: '^Sheet 1 of 2: North$' }, evidence: 'matched "Sheet 1 of 2: North"' }],
    fail: [{ check: { regex: '^Sheet 3' }, evidence: 'no match for /^Sheet 3/' }],
  },
});

describe('xlsx reader', () => {
  it('renders every sheet as a table a judge can read, formulas beside their results', async () => {
    const text = (await open()).text();
    expect(text).toContain(
      'Sheet 1 of 2: North\n| row | A | B | C | D |\n| 1 | Month | Units | Revenue (USD) | Unit price (USD) |',
    );
    expect(text).toContain('| 3 | Feb | 12 | 180 | 15 (=C3/B3) |');
    expect(text).toContain('| 5 | Total | 30 (=SUM(B2:B4)) | 450 (=SUM(C2:C4)) |  |');
    expect(text).toContain('Sheet 2 of 2: South');
  });

  it('marks formulas without a cached result, error cells and hidden sheets', async () => {
    const document = await openBroken();
    expect(document.text()).toContain('| 2 | S | 15 | (=B2*12, not calculated) |');
    expect(document.text()).toContain('#DIV/0! (=1/B3)');
    expect(document.text()).toContain('Sheet 2 of 2: Notes (hidden)');
    expect(document.check({ formula: { sheet: 'Prices', cell: 'C2', regex: '^=B2\\*12$' } })).toMatchObject({
      ok: true,
      evidence: 'Prices!C2 holds =B2*12 (not calculated)',
    });
    expect(document.check({ value: { sheet: 'Prices', cell: 'C2', equals: 180 } })).toMatchObject({
      ok: false,
      evidence: 'Prices!C2 (Yearly) = (=B2*12, not calculated), expected 180',
    });
    expect(
      document.check({ total: { sheet: 'Prices', column: 'C', to_row: 3, equals: 0 } }).evidence,
    ).toContain('C2 holds =B2*12 with no calculated value');
    expect(document.check({ sheets: ['Prices', 'Notes'] })).toMatchObject({
      ok: true,
      evidence: 'sheets "Prices", "Notes" (hidden)',
    });
  });

  it('keeps a formula result of 0, compares numbers with a small tolerance and a number stored as text apart', async () => {
    const document = await xlsxReader.open(
      await workbook((book) => {
        const sheet = book.addWorksheet('Calc');
        sheet.addRow(['zero', { formula: '1-1', result: 0 }]);
        sheet.addRow(['float', { formula: '0.1+0.2', result: 0.1 + 0.2 }]);
        sheet.addRow(['text', '15']);
        sheet.addRow(['date', new Date(Date.UTC(2026, 9, 1))]);
      }),
      'calc.xlsx',
    );
    expect(document.check({ value: { cell: 'B1', equals: 0 } }).ok).toBe(true);
    expect(document.check({ value: { cell: 'B2', equals: 0.3 } }).ok).toBe(true);
    expect(document.check({ value: { cell: 'B3', equals: 15 } })).toMatchObject({
      ok: false,
      evidence: 'Calc!B3 = "15", expected 15',
    });
    expect(document.check({ value: { cell: 'B4', equals: '2026-10-01' } }).ok).toBe(true);
  });

  it('quotes a sheet name that needs it in addresses', async () => {
    const document = await xlsxReader.open(
      await workbook((book) => {
        book.addWorksheet('Price list').addRow(['Plan']);
      }),
      'list.xlsx',
    );
    expect(document.check({ value: { sheet: 'Price list', cell: 'A1', equals: 'Plan' } }).evidence).toBe(
      '\'Price list\'!A1 = "Plan"',
    );
  });

  it('fails a check on a missing sheet with the sheets it found, without a usage hint', async () => {
    const result = (await open()).check({ rows: { sheet: 'East', count: 1 } });
    expect(result).toMatchObject({
      ok: false,
      evidence: 'no sheet named "East"; the sheets are "North", "South"',
    });
  });

  it('names an unknown check, a check with two names, an empty check and a malformed argument', async () => {
    const document = await open();
    expect(document.check({ sheet: ['North'] })).toMatchObject({
      ok: false,
      evidence:
        'unknown check "sheet" for xlsx; the xlsx checks are sheets, header, rows, cells, formula, value, total, no_error_cells, contains, not_contains, regex',
    });
    expect(document.check({ sheets: ['North'], rows: 1 }).evidence).toBe(
      'a check names one check; this one names sheets, rows',
    );
    expect(document.check({}).evidence).toContain('the check is empty');
    expect(document.check({ rows: { sheet: 'North', cout: 3 } }).evidence).toBe(
      'rows does not take "cout"; it takes sheet, count, from_row; write rows: { sheet, count: 3, from_row: 2 }; count may be { min, max }',
    );
    expect(document.check({ cells: { sheet: 'North', column: 'B' } }).evidence).toContain(
      'cells needs values as a list',
    );
    expect(document.check({ no_error_cells: false }).evidence).toContain(
      'no_error_cells takes true or { sheet }',
    );
    expect(document.check({ formula: { cell: 'D2', regex: '(' } }).evidence).toContain(
      'formula has an invalid regex',
    );
  });

  it('opens a file that is not a workbook as a document whose every check fails and says why', async () => {
    const document = await xlsxReader.open(bytesOf('not a zip'), 'out/fake.xlsx');
    expect(document.kind).toBe('xlsx');
    expect(document.path).toBe('out/fake.xlsx');
    expect(document.text()).toMatch(/^\[out\/fake\.xlsx could not be read as xlsx: /);
    for (const check of [{ sheets: ['North'] }, { contains: 'x' }, { nothing: true }]) {
      const result = document.check(check);
      expect(result.ok).toBe(false);
    }
    expect(document.check({ contains: 'x' }).evidence).toMatch(
      /^out\/fake\.xlsx could not be read as xlsx: /,
    );
    expect(document.check({ nothing: true }).evidence).toContain('unknown check "nothing"');
  });

  it('never throws from check(), whatever the spec hands it', async () => {
    const document = await open();
    expect(document.check(null as never).ok).toBe(false);
    expect(document.check('sheets' as never).ok).toBe(false);
  });
});
