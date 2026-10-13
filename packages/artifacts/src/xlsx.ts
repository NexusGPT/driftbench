import type ExcelJS from 'exceljs';
import { invalid, isRecord, mapping, missing, optionalString, parseOrder, requiredList } from './args';
import { holds, jsonEqual, listed, parseAssertions } from './assertion';
import {
  type CheckTable,
  type KindReader,
  type Outcome,
  outcome,
  ownBuffer,
  ReaderDocument,
  type StructureCheck,
  unreadable,
} from './document';
import {
  type CellValue,
  cellEqual,
  checkCells,
  checkHeader,
  checkRows,
  checkTotal,
  checkValue,
  columnLetter,
  filled,
  type Grid,
  type GridCell,
  type GridCheckName,
  gridArgs,
  parseAddress,
  showCell,
} from './grid';
import { matchList } from './match';
import { loadReaderLibrary } from './optional';
import { TEXT_CHECKS } from './text';

/**
 * The xlsx reader, on exceljs. It reads every cell of every sheet once, at open: values, formulas with
 * their cached results, and error values. A formula's value is the result the producing application
 * cached; a file written by a library that never calculates (openpyxl, exceljs) has none unless it was
 * recalculated, and the evidence says "not calculated".
 */

/** exceljs `ValueType`, by number: the enum is declared ambient, so it is not imported. */
const TYPE = {
  null: 0,
  merge: 1,
  number: 2,
  string: 3,
  date: 4,
  hyperlink: 5,
  formula: 6,
  sharedString: 7,
  richText: 8,
  boolean: 9,
  error: 10,
} as const;

export class Sheet implements Grid {
  readonly equal = cellEqual;
  readonly prefix: string;

  constructor(
    readonly label: string,
    readonly hidden: boolean,
    private readonly rows: ReadonlyMap<number, ReadonlyMap<number, GridCell>>,
    readonly rowCount: number,
    readonly columnCount: number,
  ) {
    this.prefix = `${/^[A-Za-z_][A-Za-z0-9_.]*$/.test(label) ? label : `'${label.replace(/'/g, "''")}'`}!`;
  }

  cell(row: number, column: number): GridCell | undefined {
    return this.rows.get(row)?.get(column);
  }

  numberOf(value: CellValue): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }

  /** Every cell that holds something, by row then column. */
  *filledCells(): Generator<{ row: number; column: number; cell: GridCell }> {
    for (const [row, cells] of this.rows) {
      for (const [column, cell] of cells) yield { row, column, cell };
    }
  }
}

export type Workbook = { readonly sheets: readonly Sheet[] };

function isoDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return String(date);
  const iso = date.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

/** A formula's cached result as a cell value; an error result is kept as its code. */
function formulaCell(formula: string, result: unknown): GridCell {
  if (result === undefined || result === null) return { value: null, formula };
  if (typeof result === 'number' || typeof result === 'string' || typeof result === 'boolean') {
    return { value: result, formula };
  }
  if (result instanceof Date) return { value: isoDate(result), formula };
  if (isRecord(result) && typeof result.error === 'string')
    return { value: result.error, formula, error: result.error };
  if (isRecord(result) && Array.isArray(result.richText)) {
    return {
      value: result.richText.map((run) => (isRecord(run) ? String(run.text ?? '') : '')).join(''),
      formula,
    };
  }
  return { value: String(result), formula };
}

function readCell(cell: ExcelJS.Cell): GridCell | undefined {
  const value: unknown = cell.value;
  switch (cell.type as number) {
    case TYPE.number:
      return typeof value === 'number' ? { value } : undefined;
    case TYPE.string:
    case TYPE.sharedString:
    case TYPE.hyperlink:
    case TYPE.richText: {
      const text = typeof value === 'string' ? value : cell.text;
      return text === '' ? undefined : { value: text };
    }
    case TYPE.date:
      return value instanceof Date ? { value: isoDate(value) } : undefined;
    case TYPE.boolean:
      return typeof value === 'boolean' ? { value } : undefined;
    case TYPE.error: {
      const code = isRecord(value) && typeof value.error === 'string' ? value.error : String(value);
      return { value: code, error: code };
    }
    case TYPE.formula:
      return formulaCell(`=${cell.formula ?? ''}`, cell.result);
    default:
      return undefined;
  }
}

function readSheet(worksheet: ExcelJS.Worksheet): Sheet {
  const rows = new Map<number, Map<number, GridCell>>();
  let rowCount = 0;
  let columnCount = 0;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const read = readCell(cell);
      if (!filled(read)) return;
      let cells = rows.get(rowNumber);
      if (!cells) {
        cells = new Map();
        rows.set(rowNumber, cells);
      }
      cells.set(columnNumber, read);
      rowCount = Math.max(rowCount, rowNumber);
      columnCount = Math.max(columnCount, columnNumber);
    });
  });
  return new Sheet(worksheet.name, worksheet.state !== 'visible', rows, rowCount, columnCount);
}

function renderCell(cell: GridCell | undefined): string {
  if (!filled(cell)) return '';
  let text: string;
  if (cell.formula === undefined) text = cell.error ?? String(cell.value);
  else if (cell.error !== undefined) text = `${cell.error} (${cell.formula})`;
  else if (cell.value === null) text = `(${cell.formula}, not calculated)`;
  else text = `${String(cell.value)} (${cell.formula})`;
  return text.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ');
}

/** The text a judge reads: each sheet as a table with its column letters and row numbers. */
export function renderWorkbook(sheets: readonly Sheet[]): string {
  return sheets
    .map((sheet, index) => {
      const head = `Sheet ${index + 1} of ${sheets.length}: ${sheet.label}${sheet.hidden ? ' (hidden)' : ''}`;
      if (sheet.rowCount === 0) return `${head}\n(empty)`;
      const letters = Array.from({ length: sheet.columnCount }, (_, column) => columnLetter(column + 1));
      const lines = [head, `| row | ${letters.join(' | ')} |`];
      let previous = 0;
      for (const { row } of sheet.filledCells()) {
        if (row === previous) continue;
        previous = row;
        const cells = letters.map((_, column) => renderCell(sheet.cell(row, column + 1)));
        lines.push(`| ${row} | ${cells.join(' | ')} |`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/** The sheet a check names, or the first sheet when it names none. */
function pickSheet(book: Workbook, raw: unknown): Sheet {
  const name = raw === undefined ? undefined : optionalString({ sheet: raw }, 'sheet');
  const sheet =
    name === undefined ? book.sheets[0] : book.sheets.find((candidate) => candidate.label === name);
  if (sheet) return sheet;
  return missing(
    `no sheet named ${JSON.stringify(name)}; the sheets are ${listed(book.sheets.map((s) => JSON.stringify(s.label)))}`,
  );
}

function sheetCheck(
  name: GridCheckName,
  usage: string,
  run: (map: Record<string, unknown>, grid: Grid) => Outcome,
): StructureCheck<Workbook> {
  return {
    reads: 'structure',
    usage,
    run(arg, book) {
      const map = gridArgs(name, arg, ['sheet']);
      return run(map, pickSheet(book, map.sheet));
    },
  };
}

const sheets: StructureCheck<Workbook> = {
  reads: 'structure',
  usage: 'sheets: [North, South] or sheets: { values: [...], order: exact | in_order | any_order }',
  run(arg, book) {
    const map = Array.isArray(arg) ? { values: arg } : mapping(arg, ['values', 'order']);
    const values = parseAssertions(requiredList(map, 'values'), 'sheet');
    const order = parseOrder(map.order, 'exact');
    const names = book.sheets.map((sheet) => sheet.label);
    const problems = matchList(
      values,
      names,
      order,
      (want, name) => holds(want, { present: true, value: name }, jsonEqual),
      (name) => JSON.stringify(name),
    );
    const shown = book.sheets.map(
      (sheet) => `${JSON.stringify(sheet.label)}${sheet.hidden ? ' (hidden)' : ''}`,
    );
    return outcome(`sheets ${listed(shown, 30)}`, problems);
  },
};

const formula: StructureCheck<Workbook> = {
  reads: 'structure',
  usage: 'formula: { sheet: Mobile, cell: D2, regex: "^=C2\\\\*12$" }; without regex, any formula passes',
  run(arg, book) {
    const map = mapping(arg, ['sheet', 'cell', 'regex']);
    const sheet = pickSheet(book, map.sheet);
    const address = parseAddress(map.cell, 'cell');
    const source = optionalString(map, 'regex');
    let pattern: RegExp | undefined;
    try {
      pattern = source === undefined ? undefined : new RegExp(source, 'm');
    } catch (cause) {
      invalid(`has an invalid regex: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    const cell = sheet.cell(address.row, address.column);
    const where = `${sheet.prefix}${address.text}`;
    if (cell?.formula === undefined)
      return { ok: false, evidence: `${where} holds ${showCell(cell)} and no formula` };
    const result = cell.error ?? (cell.value === null ? 'not calculated' : `cached result ${showCell(cell)}`);
    const evidence = `${where} holds ${cell.formula} (${result})`;
    if (!pattern || pattern.test(cell.formula)) return { ok: true, evidence };
    return { ok: false, evidence: `${evidence}, which does not match /${pattern.source}/` };
  },
};

const noErrorCells: StructureCheck<Workbook> = {
  reads: 'structure',
  usage: 'no_error_cells: true, or no_error_cells: { sheet: Mobile } for one sheet',
  run(arg, book) {
    let scope: readonly Sheet[] = book.sheets;
    if (arg !== true) {
      if (!isRecord(arg)) invalid('takes true or { sheet }');
      scope = [pickSheet(book, mapping(arg, ['sheet']).sheet)];
    }
    const errors: string[] = [];
    let count = 0;
    for (const sheet of scope) {
      for (const { row, column, cell } of sheet.filledCells()) {
        count++;
        if (cell.error !== undefined)
          errors.push(`${sheet.prefix}${columnLetter(column)}${row} = ${cell.error}`);
      }
    }
    const where = scope.length === 1 ? `sheet ${scope[0]?.label}` : `${scope.length} sheets`;
    if (errors.length === 0)
      return {
        ok: true,
        evidence: `no error cell in ${where} (${count} ${count === 1 ? 'cell holds' : 'cells hold'} something)`,
      };
    return {
      ok: false,
      evidence: `${errors.length} error ${errors.length === 1 ? 'cell' : 'cells'} in ${where}: ${listed(errors, 10)}`,
    };
  },
};

export const XLSX_CHECKS: CheckTable<Workbook> = {
  sheets,
  header: sheetCheck(
    'header',
    'header: { sheet, row: 1, values: [...] } or header: [...] for the first sheet',
    checkHeader,
  ),
  rows: sheetCheck('rows', 'rows: { sheet, count: 3, from_row: 2 }; count may be { min, max }', checkRows),
  cells: sheetCheck('cells', 'cells: { sheet, column: C, from_row: 2, to_row, values: [...] }', checkCells),
  formula,
  value: sheetCheck(
    'value',
    'value: { sheet, cell: D2, equals: 180 } or value: { sheet, column, row, equals }',
    checkValue,
  ),
  total: sheetCheck(
    'total',
    'total: { sheet, column: C, from_row: 2, to_row, equals: 75, cell: C5 }',
    checkTotal,
  ),
  no_error_cells: noErrorCells,
  ...TEXT_CHECKS,
};

/**
 * exceljs, several hundred modules: it loads when the first workbook opens, not when this package does. A
 * missing package fails here, outside the catch that reports an unreadable file.
 */
function loadExcelJS(): Promise<typeof ExcelJS> {
  return loadReaderLibrary('exceljs', 'xlsx', async () => (await import('exceljs')).default);
}

/** Every sheet of a workbook, read once. Throws when the bytes are not a workbook. */
export async function readWorkbook(bytes: Uint8Array): Promise<Sheet[]> {
  const workbook = new (await loadExcelJS()).Workbook();
  await workbook.xlsx.load(ownBuffer(bytes));
  const read = workbook.worksheets.map(readSheet);
  if (read.length === 0) throw new Error('the file holds no worksheet');
  return read;
}

export const xlsxReader: KindReader = {
  kind: 'xlsx',
  checkNames: Object.keys(XLSX_CHECKS),
  async open(bytes, path) {
    await loadExcelJS();
    try {
      const read = await readWorkbook(bytes);
      return new ReaderDocument<Workbook>('xlsx', path, renderWorkbook(read), XLSX_CHECKS, { sheets: read });
    } catch (cause) {
      return unreadable('xlsx', path, XLSX_CHECKS, cause);
    }
  },
};
