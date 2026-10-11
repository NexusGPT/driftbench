import {
  countHolds,
  describeCount,
  invalid,
  isCountBounds,
  mapping,
  missing,
  optionalInteger,
  parseCount,
  requiredList,
} from './args';
import {
  clip,
  describeAssertion,
  type Equality,
  type Found,
  holds,
  listed,
  nearlyEqual,
  parseAssertion,
  parseAssertions,
} from './assertion';
import { type Outcome, outcome } from './document';

/**
 * The checks a sheet and a CSV file share: a header row, a row count, cells by column and row range,
 * one value by address, and a total. An xlsx sheet and a CSV file are both a grid of cells addressed
 * the spreadsheet way: columns by letter from A, rows by number from 1.
 */

export type CellValue = string | number | boolean | null;

export type GridCell = {
  /** The value checks compare: a number, a text, a boolean; null for an empty cell. */
  readonly value: CellValue;
  /** The formula with its leading =, for a formula cell. Its value is the cached result, null when none. */
  readonly formula?: string;
  /** The error code, such as #DIV/0!, when the cell or its cached result is an error. */
  readonly error?: string;
};

export interface Grid {
  /** What evidence calls the grid: a sheet name, or the CSV path. */
  readonly label: string;
  /** What precedes an address in evidence: `Mobile!` for a sheet, nothing for a CSV file. */
  readonly prefix: string;
  /** The last row and the last column that hold something; 0 when the grid is empty. */
  readonly rowCount: number;
  readonly columnCount: number;
  cell(row: number, column: number): GridCell | undefined;
  /** What equal means for this grid's values. */
  readonly equal: Equality;
  /** The number a cell holds, for totals; undefined when it holds no number. */
  numberOf(value: CellValue): number | undefined;
}

export const MAX_COLUMN = 16384;

export function columnLetter(index: number): string {
  let out = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}

export function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index;
}

export type Address = { row: number; column: number; text: string };

/** Reads a cell address such as D2 (or $D$2, or d2). */
export function parseAddress(raw: unknown, key: string): Address {
  const match = typeof raw === 'string' ? /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]*)$/.exec(raw.trim()) : null;
  const letters = match?.[1];
  const digits = match?.[2];
  if (!letters || !digits || columnIndex(letters) > MAX_COLUMN)
    invalid(`needs ${key} as a cell address such as D2`);
  const column = columnIndex(letters);
  const row = Number(digits);
  return { row, column, text: `${columnLetter(column)}${row}` };
}

/** True when a cell holds something: a value, an error, or a formula. */
export function filled(cell: GridCell | undefined): cell is GridCell {
  return (
    cell !== undefined && (cell.value !== null || cell.formula !== undefined || cell.error !== undefined)
  );
}

/** The cell as an assertion sees it. A formula nobody calculated has no value to compare. */
export function foundCell(cell: GridCell | undefined): Found {
  if (!filled(cell)) return { present: false, value: null };
  if (cell.value === null && cell.error === undefined) return { present: true, value: undefined };
  return { present: true, value: cell.value };
}

/** How evidence shows a cell: texts quoted, so a number stored as text reads apart from a number. */
export function showCell(cell: GridCell | undefined): string {
  if (!filled(cell)) return '(empty)';
  if (cell.error !== undefined) return cell.error;
  if (cell.value === null) return `(${cell.formula}, not calculated)`;
  return typeof cell.value === 'string' ? JSON.stringify(clip(cell.value, 80)) : String(cell.value);
}

export function formatNumber(n: number): string {
  return String(Number(n.toPrecision(12)));
}

/** Rows as runs for evidence: 2 to 4, 6. */
export function describeRows(rows: readonly number[]): string {
  const runs: string[] = [];
  let start = rows[0];
  let previous = start;
  for (const row of [...rows.slice(1), undefined]) {
    if (row !== undefined && previous !== undefined && row === previous + 1) {
      previous = row;
      continue;
    }
    if (start !== undefined && previous !== undefined)
      runs.push(start === previous ? `${start}` : `${start} to ${previous}`);
    start = row;
    previous = row;
  }
  return listed(runs, 8);
}

/** A column named by letter (C), by number from 1 (3), or by a header text in row 1 (Monthly price). */
export type Column = { index: number; letter: string };

export function resolveColumn(raw: unknown, grid: Grid): Column {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_COLUMN) {
    return { index: raw, letter: columnLetter(raw) };
  }
  if (typeof raw === 'string' && raw.length > 0) {
    for (let column = 1; column <= grid.columnCount; column++) {
      if (grid.cell(1, column)?.value === raw) return { index: column, letter: columnLetter(column) };
    }
    if (/^[A-Z]{1,3}$/.test(raw) && columnIndex(raw) <= MAX_COLUMN) {
      return { index: columnIndex(raw), letter: raw };
    }
    const headers: string[] = [];
    for (let column = 1; column <= grid.columnCount; column++) {
      const value = grid.cell(1, column)?.value;
      if (typeof value === 'string') headers.push(JSON.stringify(value));
    }
    missing(
      `no column ${JSON.stringify(raw)}: it is not a column letter, and row 1 of ${grid.label} holds ${headers.length > 0 ? listed(headers) : 'no header text'}`,
    );
  }
  return invalid('needs column as a letter such as C, a number from 1, or a header text from row 1');
}

/** The header text of a column, for evidence: ` (Monthly price (USD))`, or nothing. */
function headerNote(grid: Grid, column: Column, fromRow: number): string {
  const value = fromRow > 1 ? grid.cell(1, column.index)?.value : undefined;
  return typeof value === 'string' && value !== column.letter ? ` (${clip(value, 40)})` : '';
}

function rangeText(grid: Grid, column: Column, from: number, to: number): string {
  const start = `${column.letter}${from}`;
  return `${grid.prefix}${from === to ? start : `${start}:${column.letter}${to}`}`;
}

function rowHasValue(grid: Grid, row: number): boolean {
  for (let column = 1; column <= grid.columnCount; column++) {
    if (filled(grid.cell(row, column))) return true;
  }
  return false;
}

function lastColumnIn(grid: Grid, row: number): number {
  for (let column = grid.columnCount; column >= 1; column--) {
    if (filled(grid.cell(row, column))) return column;
  }
  return 0;
}

function lastRowIn(grid: Grid, column: number): number {
  for (let row = grid.rowCount; row >= 1; row--) {
    if (filled(grid.cell(row, column))) return row;
  }
  return 0;
}

export const GRID_KEYS = {
  header: ['row', 'values'],
  rows: ['count', 'from_row'],
  cells: ['column', 'from_row', 'to_row', 'values'],
  value: ['cell', 'column', 'row', 'equals'],
  total: ['column', 'from_row', 'to_row', 'cell', 'equals'],
} as const;

export type GridCheckName = keyof typeof GRID_KEYS;

/** Reads the argument of a grid check, shorthand included, with the extra keys a kind adds (sheet). */
export function gridArgs(
  name: GridCheckName,
  arg: unknown,
  extra: readonly string[],
): Record<string, unknown> {
  if (name === 'header' && Array.isArray(arg)) return { values: arg };
  if (name === 'rows' && (typeof arg === 'number' || isCountBounds(arg))) return { count: arg };
  return mapping(arg, [...extra, ...GRID_KEYS[name]]);
}

/** The header row holds these values from column A, and nothing after them. */
export function checkHeader(map: Record<string, unknown>, grid: Grid): Outcome {
  const row = optionalInteger(map, 'row', 1) ?? 1;
  const values = parseAssertions(requiredList(map, 'values'), 'value');
  const width = Math.max(values.length, lastColumnIn(grid, row));
  const cells = Array.from({ length: width }, (_, index) => grid.cell(row, index + 1));
  const problems: string[] = [];
  values.forEach((want, index) => {
    const cell = cells[index];
    if (!holds(want, foundCell(cell), grid.equal)) {
      problems.push(
        `${grid.prefix}${columnLetter(index + 1)}${row} is ${showCell(cell)}, expected ${describeAssertion(want)}`,
      );
    }
  });
  cells.slice(values.length).forEach((cell, offset) => {
    if (filled(cell)) {
      problems.push(
        `${grid.prefix}${columnLetter(values.length + offset + 1)}${row} holds ${showCell(cell)} past the expected header`,
      );
    }
  });
  const shown = cells.length === 0 ? '(empty)' : listed(cells.map(showCell), 30);
  return outcome(`${grid.label} row ${row}: ${shown}`, problems);
}

/** The number of rows that hold a value, from `from_row` (2 by default, the row under a header). */
export function checkRows(map: Record<string, unknown>, grid: Grid): Outcome {
  if (map.count === undefined) invalid('needs count');
  const count = parseCount(map.count, 'count');
  const from = optionalInteger(map, 'from_row', 1) ?? 2;
  const rows: number[] = [];
  for (let row = from; row <= grid.rowCount; row++) if (rowHasValue(grid, row)) rows.push(row);
  const ok = countHolds(count, rows.length);
  const where = rows.length > 0 ? ` (${rows.length === 1 ? 'row' : 'rows'} ${describeRows(rows)})` : '';
  return {
    ok,
    evidence: `${grid.label}: ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} with values from row ${from}${where}${ok ? '' : `, expected ${describeCount(count)}`}`,
  };
}

/** The cells of one column from `from_row` (2 by default) hold these values, in order. */
export function checkCells(map: Record<string, unknown>, grid: Grid): Outcome {
  const column = resolveColumn(map.column, grid);
  const values = parseAssertions(requiredList(map, 'values'), 'value');
  const from = optionalInteger(map, 'from_row', 1) ?? 2;
  const to = optionalInteger(map, 'to_row', from) ?? from + values.length - 1;
  if (to - from + 1 !== values.length) {
    invalid(`lists ${values.length} values for the ${to - from + 1} rows ${from} to ${to}`);
  }
  const cells = values.map((_, offset) => grid.cell(from + offset, column.index));
  const problems: string[] = [];
  values.forEach((want, offset) => {
    const cell = cells[offset];
    if (!holds(want, foundCell(cell), grid.equal)) {
      problems.push(
        `${column.letter}${from + offset} is ${showCell(cell)}, expected ${describeAssertion(want)}`,
      );
    }
  });
  const shown = listed(cells.map(showCell), 30);
  return outcome(
    `${rangeText(grid, column, from, to)}${headerNote(grid, column, from)} = ${shown}`,
    problems,
  );
}

/** One cell, by address (`cell: D2`) or by `column` and `row`, holds a value. */
export function checkValue(map: Record<string, unknown>, grid: Grid): Outcome {
  if (!Object.hasOwn(map, 'equals')) invalid('needs equals');
  const want = parseAssertion(map.equals, 'equals');
  let row: number;
  let column: Column;
  if (map.cell !== undefined) {
    if (map.column !== undefined || map.row !== undefined) invalid('takes cell, or column and row, not both');
    const address = parseAddress(map.cell, 'cell');
    row = address.row;
    column = { index: address.column, letter: columnLetter(address.column) };
  } else {
    column = resolveColumn(map.column, grid);
    const at = optionalInteger(map, 'row', 1);
    if (at === undefined) invalid('needs cell, or column and row');
    row = at;
  }
  const cell = grid.cell(row, column.index);
  const ok = holds(want, foundCell(cell), grid.equal);
  return {
    ok,
    evidence: `${rangeText(grid, column, row, row)}${headerNote(grid, column, row)} = ${showCell(cell)}${ok ? '' : `, expected ${describeAssertion(want)}`}`,
  };
}

const numberEqual: Equality = (expected, found) =>
  typeof expected === 'number' && typeof found === 'number' && nearlyEqual(expected, found);

/**
 * The numbers of a column range add up: to `equals`, to the value of the total `cell`, or both. The
 * range runs from `from_row` (2 by default) to `to_row`, or to the row above a total cell in the same
 * column, or to the last row of the column that holds something.
 */
export function checkTotal(map: Record<string, unknown>, grid: Grid): Outcome {
  const column = resolveColumn(map.column, grid);
  const target = map.cell === undefined ? undefined : parseAddress(map.cell, 'cell');
  const hasEquals = Object.hasOwn(map, 'equals');
  if (!target && !hasEquals) invalid('needs equals, cell, or both');
  const want = hasEquals ? parseAssertion(map.equals, 'equals') : undefined;
  const from = optionalInteger(map, 'from_row', 1) ?? 2;
  const sameColumn = target !== undefined && target.column === column.index;
  const to =
    optionalInteger(map, 'to_row', from) ??
    (sameColumn && target.row > from ? target.row - 1 : Math.max(lastRowIn(grid, column.index), from));
  if (sameColumn && target.row >= from && target.row <= to) {
    invalid(`has the total cell ${target.text} inside the summed rows ${from} to ${to}`);
  }

  let sum = 0;
  let numbers = 0;
  const problems: string[] = [];
  for (let row = from; row <= to; row++) {
    const cell = grid.cell(row, column.index);
    if (!filled(cell)) continue;
    const address = `${column.letter}${row}`;
    if (cell.error !== undefined) {
      problems.push(`${address} is ${cell.error}`);
      continue;
    }
    if (cell.value === null) {
      problems.push(`${address} holds ${cell.formula} with no calculated value`);
      continue;
    }
    const n = grid.numberOf(cell.value);
    if (n === undefined) {
      problems.push(`${address} holds ${showCell(cell)}, not a number`);
      continue;
    }
    sum += n;
    numbers++;
  }

  let evidence = `${rangeText(grid, column, from, to)}${headerNote(grid, column, from)} sums to ${formatNumber(sum)} (${numbers} ${numbers === 1 ? 'number' : 'numbers'})`;
  if (want !== undefined && !holds(want, { present: true, value: sum }, numberEqual)) {
    problems.unshift(`expected ${describeAssertion(want)}`);
  }
  if (target) {
    const cell = grid.cell(target.row, target.column);
    const n = filled(cell) && cell.value !== null ? grid.numberOf(cell.value) : undefined;
    evidence += `; ${grid.prefix}${target.text} = ${showCell(cell)}`;
    if (n === undefined) problems.unshift(`${target.text} holds no number`);
    else if (!nearlyEqual(n, sum)) problems.unshift(`${target.text} is not the sum`);
  }
  return outcome(evidence, problems);
}

/**
 * Equality for sheet cells: numbers within the relative tolerance of `nearlyEqual`; texts, booleans
 * and empty cells strictly. An expected empty text is an empty cell.
 */
export const cellEqual: Equality = (expected, found) => {
  const want = expected === '' ? null : expected;
  const got = found === '' ? null : found;
  if (typeof want === 'number' && typeof got === 'number') return nearlyEqual(want, got);
  return want === got;
};
