import type ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { compileFile } from '../../generate/src/families/compile';
import { defaultReaders } from '../src/index';
import { workbook } from './fixtures';

/**
 * The formula checks a task family compiles from its oracle, run by the xlsx reader on real workbooks: a
 * commuted multiplication passes, and a formula that only rearranges a longer expression fails.
 */

/** One sheet whose D2 holds the given formula, with C2 13 and a cached result. */
function book(formula: string, result: number): Promise<Uint8Array> {
  return workbook((target: ExcelJS.Workbook) => {
    const sheet = target.addWorksheet('Mobile');
    sheet.addRow(['Plan', 'Allowance', 'Monthly', 'Yearly']);
    sheet.addRow(['A', '5 GB', 13, { formula, result }]);
  });
}

/** The verdict of the formula check compiled for D2 from the oracle's template. */
async function verdict(template: string, written: string, result: number) {
  const artifact = compileFile(
    {
      path: 'out/book.xlsx',
      kind: 'xlsx',
      sheets: [
        {
          name: 'Mobile',
          header: ['Plan', 'Allowance', 'Monthly', 'Yearly'],
          rows: [['A', '5 GB', 13, result]],
          formulas: { D: template },
        },
      ],
    },
    { xlsx: ['formula'] },
  );
  const reader = defaultReaders().get('xlsx');
  if (!reader) throw new Error('no xlsx reader');
  const document = await reader.open(await book(written, result), artifact.path);
  return artifact.checks.map((check) => document.check(check).ok);
}

describe('a family formula check on a real workbook', () => {
  it('passes the commuted multiplication', async () => {
    expect(await verdict('=C{row}*12', '12*C2', 156)).toEqual([true]);
  });

  it('fails a workbook whose formula rearranges a comparison or a power', async () => {
    // =C2=12+1 is TRUE at C2=13; =1+C2=12 is FALSE. =C2^2+1 and =1+C2^2 agree, but the check is for the formula written.
    expect(await verdict('=C{row}=12+1', '1+C2=12', 0)).toEqual([false]);
    expect(await verdict('=C{row}^2+1', '1+C2^2', 170)).toEqual([false]);
    expect(await verdict('=C{row}*12', '12*C3', 0)).toEqual([false]);
  });
});
