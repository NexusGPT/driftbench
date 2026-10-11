import type { Equality } from './assertion';
import { nearlyEqual } from './assertion';
import {
  type CheckTable,
  describeFailure,
  type KindReader,
  type Outcome,
  ReaderDocument,
  type StructureCheck,
} from './document';
import {
  type CellValue,
  cellEqual,
  checkCells,
  checkHeader,
  checkRows,
  checkTotal,
  checkValue,
  type Grid,
  type GridCell,
  type GridCheckName,
  gridArgs,
} from './grid';
import { decodeText, TEXT_CHECKS } from './text';

/**
 * The csv reader. A CSV file is a grid of texts, addressed like a sheet: row 1 is the first line,
 * column A the first field. Quoted fields, doubled quotes, line breaks inside quotes and CRLF follow
 * RFC 4180. The delimiter is a tab for `.tsv`, otherwise the most frequent of comma, semicolon and tab
 * on the first line, outside quotes.
 */

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** The number a CSV text reads as, or undefined. Thousands separators are not read. */
export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim();
  return NUMBER.test(trimmed) ? Number(trimmed) : undefined;
}

/**
 * Equality for CSV fields, which are all texts: a spec number equals a field that reads as that
 * number, a spec boolean a field reading true or false, a spec text the same text, a spec null or
 * empty text an empty field.
 */
export const csvEqual: Equality = (expected, found) => {
  const want = expected === '' ? null : expected;
  if (typeof found !== 'string') return cellEqual(want, found);
  if (typeof want === 'number') {
    const n = parseNumber(found);
    return n !== undefined && nearlyEqual(want, n);
  }
  if (typeof want === 'boolean') return found.trim().toLowerCase() === String(want);
  return want === found;
};

export class CsvError extends Error {}

/** Parses CSV text into records of fields. A blank line is a record with one empty field. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let quoteLine = 0;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === '\n') line++;
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
      quoteLine = line;
    } else if (char === delimiter) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      line++;
    } else {
      field += char;
    }
  }
  if (quoted) throw new CsvError(`the quoted field opened on line ${quoteLine} is never closed`);
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/** The delimiter: tab for .tsv, else the most frequent of , ; and tab on the first line, outside quotes. */
export function detectDelimiter(text: string, path: string): string {
  if (path.toLowerCase().endsWith('.tsv')) return '\t';
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char in counts) counts[char] = (counts[char] ?? 0) + 1;
  }
  let best = ',';
  for (const candidate of [';', '\t']) {
    if ((counts[candidate] ?? 0) > (counts[best] ?? 0)) best = candidate;
  }
  return best;
}

export class CsvGrid implements Grid {
  readonly prefix = '';
  readonly equal = csvEqual;
  readonly rowCount: number;
  readonly columnCount: number;

  constructor(
    readonly label: string,
    private readonly records: readonly (readonly string[])[],
  ) {
    let rowCount = 0;
    let columnCount = 0;
    records.forEach((fields, index) => {
      const last = fields.findLastIndex((field) => field !== '');
      if (last === -1) return;
      rowCount = index + 1;
      columnCount = Math.max(columnCount, last + 1);
    });
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  cell(row: number, column: number): GridCell | undefined {
    const text = this.records[row - 1]?.[column - 1];
    return text === undefined || text === '' ? undefined : { value: text };
  }

  numberOf(value: CellValue): number | undefined {
    if (typeof value === 'number') return value;
    return typeof value === 'string' ? parseNumber(value) : undefined;
  }
}

function gridCheck(
  name: GridCheckName,
  usage: string,
  run: (map: Record<string, unknown>, grid: Grid) => Outcome,
): StructureCheck<CsvGrid> {
  return {
    reads: 'structure',
    usage,
    run: (arg, grid) => run(gridArgs(name, arg, []), grid),
  };
}

export const CSV_CHECKS: CheckTable<CsvGrid> = {
  header: gridCheck(
    'header',
    'header: [plan_id, name, ...] or header: { row: 1, values: [...] }',
    checkHeader,
  ),
  rows: gridCheck('rows', 'rows: 6, rows: { min: 1 }, or rows: { count: 6, from_row: 2 }', checkRows),
  cells: gridCheck(
    'cells',
    'cells: { column: monthly_usd, from_row: 2, to_row, values: [...] }; column is a header, a letter or a number',
    checkCells,
  ),
  value: gridCheck(
    'value',
    'value: { cell: E2, equals: 15 } or value: { column: monthly_usd, row: 2, equals: 15 }',
    checkValue,
  ),
  total: gridCheck(
    'total',
    'total: { column: monthly_usd, from_row: 2, to_row, equals: 210, cell }',
    checkTotal,
  ),
  ...TEXT_CHECKS,
};

export const csvReader: KindReader = {
  kind: 'csv',
  checkNames: Object.keys(CSV_CHECKS),
  async open(bytes, path) {
    const text = decodeText(bytes);
    try {
      const grid = new CsvGrid(path, parseCsv(text, detectDelimiter(text, path)));
      return new ReaderDocument<CsvGrid>('csv', path, text, CSV_CHECKS, grid);
    } catch (cause) {
      const why = `${path} could not be read as csv: ${describeFailure(cause)}`;
      return new ReaderDocument<CsvGrid>('csv', path, text, CSV_CHECKS, undefined, { structure: why });
    }
  },
};
