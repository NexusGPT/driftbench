import type { TableCell, TableInput } from '@agent-nexus/driftbench-core';
import { detectDelimiter, parseCsv } from './csv';
import { describeFailure } from './document';
import type { Grid } from './grid';
import { decodeText } from './text';
import { readWorkbook } from './xlsx';

/**
 * Reads a CSV, TSV or xlsx file as tables of cell values, for `driftbench import`: one table for a
 * CSV file, one per sheet for a workbook. `rows[0]` is row 1; an empty cell is null. CSV fields stay
 * texts; workbook cells keep their numbers and booleans, and a formula its cached result.
 */
export async function readTables(bytes: Uint8Array, path: string): Promise<TableInput[]> {
  const lower = path.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    const text = decodeText(bytes);
    try {
      return [{ label: baseName(path), rows: parseCsv(text, detectDelimiter(text, path)).map(csvRow) }];
    } catch (cause) {
      throw new Error(`${path} could not be read as csv: ${describeFailure(cause)}`);
    }
  }
  if (lower.endsWith('.xlsx')) {
    try {
      return (await readWorkbook(bytes)).map((sheet) => ({ label: sheet.label, rows: gridRows(sheet) }));
    } catch (cause) {
      throw new Error(`${path} could not be read as xlsx: ${describeFailure(cause)}`);
    }
  }
  throw new Error(`${path}: import reads .csv, .tsv and .xlsx files`);
}

function csvRow(fields: readonly string[]): TableCell[] {
  return fields.map((field) => (field === '' ? null : field));
}

function gridRows(grid: Grid): TableCell[][] {
  const rows: TableCell[][] = [];
  for (let row = 1; row <= grid.rowCount; row += 1) {
    const cells: TableCell[] = [];
    for (let column = 1; column <= grid.columnCount; column += 1) {
      cells.push(grid.cell(row, column)?.value ?? null);
    }
    rows.push(cells);
  }
  return rows;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
