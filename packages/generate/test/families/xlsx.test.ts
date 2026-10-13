import { readWorkbook } from '@agent-nexus/driftbench-artifacts';
import { describe, expect, it } from 'vitest';
import { writeXlsx } from '../../src/families/xlsx';

const SHEETS = [
  {
    name: 'Mobile',
    rows: [
      ['Plan', 'Allowance', 'Monthly price (USD)'],
      ['Acme Mobile 1', '5 GB', 12],
      ['Acme Mobile 2', '', 30.5],
    ],
  },
  { name: 'Home & Office', rows: [['Plan'], ['A <b> "quoted" plan']] },
];

describe('the seed workbook writer', () => {
  it('writes the same bytes for the same sheets, so a generated suite is reproducible', () => {
    expect(Buffer.from(writeXlsx(SHEETS)).equals(Buffer.from(writeXlsx(SHEETS)))).toBe(true);
  });

  it('writes a workbook the xlsx reader reads back: sheet names, text, numbers, and an empty cell left empty', async () => {
    const sheets = await readWorkbook(writeXlsx(SHEETS));
    expect(sheets.map((sheet) => sheet.label)).toEqual(['Mobile', 'Home & Office']);
    const [mobile, home] = sheets;
    expect(mobile?.cell(1, 3)?.value).toBe('Monthly price (USD)');
    expect(mobile?.cell(2, 1)?.value).toBe('Acme Mobile 1');
    expect(mobile?.cell(2, 3)?.value).toBe(12);
    expect(mobile?.cell(3, 2)).toBeUndefined();
    expect(mobile?.cell(3, 3)?.value).toBe(30.5);
    expect(home?.cell(2, 1)?.value).toBe('A <b> "quoted" plan');
    expect(mobile?.rowCount).toBe(3);
  });

  it('refuses a sheet name a workbook cannot hold', () => {
    expect(() => writeXlsx([{ name: 'a/b', rows: [] }])).toThrow(/sheet name/);
    expect(() => writeXlsx([])).toThrow(/at least one sheet/);
  });
});
