import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readTables } from '../src/index';

const IMPORT = fileURLToPath(new URL('../../../examples/acme/import/', import.meta.url));

async function tables(name: string) {
  return readTables(new Uint8Array(await readFile(`${IMPORT}${name}`)), name);
}

describe('readTables', () => {
  it('reads a CSV file as one table of texts, quoted fields included', async () => {
    const [table, ...rest] = await tables('cases.csv');
    expect(rest).toEqual([]);
    expect(table?.label).toBe('cases.csv');
    expect(table?.rows).toHaveLength(4);
    expect(table?.rows[1]).toEqual([
      'upgrade',
      'A customer upgrades home internet',
      "Hello, I'm looking for faster home internet.",
      'address',
      'Acme Telecom|street address',
      null,
      '0',
    ]);
  });

  it('reads every sheet of a workbook, numbers kept as numbers and empty cells as null', async () => {
    const read = await tables('cases.xlsx');
    expect(read.map((table) => table.label)).toEqual(['Notes', 'Cases']);
    expect(read[1]?.rows[2]).toEqual([
      'upgrade',
      null,
      '88 Summit Avenue, Acmeville',
      'offer',
      'Fiber is not available|Acme Air 5G',
      'Fiber (300|1000)',
      1,
    ]);
  });

  it('refuses a file it cannot read as a table, naming it', async () => {
    await expect(readTables(new TextEncoder().encode('not a workbook'), 'cases.xlsx')).rejects.toThrow(
      /cases\.xlsx could not be read as xlsx/,
    );
    await expect(readTables(new Uint8Array(), 'cases.docx')).rejects.toThrow(
      'cases.docx: import reads .csv, .tsv and .xlsx files',
    );
  });
});
