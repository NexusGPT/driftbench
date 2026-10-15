import type { CheckVocabulary, ExpectedBlock, ExpectedCell, ExpectedFile, ExpectedSheet } from './schema';

/**
 * Turns the oracle's expected outcome into the checks of the artifact reader vocabulary. The family names
 * which checks it uses per file kind; a check outside that list is never emitted. The expected values come
 * from the oracle only, computed before any agent runs.
 */

type Check = Record<string, unknown>;
type Artifact = { path: string; kind: ExpectedFile['kind']; checks: Check[] };

/** The column letter of a 1-based column number: 1 gives A, 27 gives AA. */
export function columnLetterOf(index: number): string {
  let out = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}

/** An empty expected cell is written '' in a check: the reader reads '' as an empty cell. */
function cell(value: ExpectedCell | undefined): ExpectedCell {
  return value === null || value === undefined ? '' : value;
}

/** An operand that may be swapped: a cell reference (C2) or a number (12, 1.5), nothing else. */
const OPERAND = '([A-Z]+[0-9]+|[0-9]+(?:\\.[0-9]+)?)';
/** Exactly two such operands around one multiplication or one addition. */
const SWAPPABLE = new RegExp(`^=${OPERAND}\\s*([*+])\\s*${OPERAND}$`);

/**
 * A pattern that matches the formula as written, with any spaces around its operators. A formula that is
 * one multiplication or one addition of two operands, each a cell reference or a number, also matches with
 * its operands swapped: =12*C2 computes what =C2*12 computes, and an instruction that states the behaviour
 * does not fix the order. Any other formula (a comparison, a power, a function, a second operation) keeps
 * the order as written.
 */
export function formulaPattern(formula: string): string {
  const body = (text: string) =>
    text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s*(\\\*|\\\+|-|\/)\s*/g, '\\s*$1\\s*');
  const one = SWAPPABLE.exec(formula);
  if (one) {
    const [, left = '', operator = '', right = ''] = one;
    const swapped = `${right.trim()}${operator}${left.trim()}`;
    return `^=(?:${body(`${left}${operator}${right}`)}|${body(swapped)})$`;
  }
  return `^${body(formula)}$`;
}

function gridChecks(
  vocabulary: readonly string[],
  sheet: string | undefined,
  header: readonly ExpectedCell[],
  rows: readonly (readonly ExpectedCell[])[],
  formulas: Readonly<Record<string, string>> = {},
): Check[] {
  const uses = (name: string) => vocabulary.includes(name);
  const at = sheet === undefined ? {} : { sheet };
  const out: Check[] = [];
  if (uses('header')) out.push({ header: { ...at, row: 1, values: header.map(cell) } });
  if (uses('rows')) out.push({ rows: { ...at, count: rows.length } });
  if (uses('cells') && rows.length > 0) {
    header.forEach((_, index) => {
      const letter = columnLetterOf(index + 1);
      // A formula column is checked by its formula: a library that never calculates leaves no cached value.
      if (Object.hasOwn(formulas, letter)) return;
      out.push({
        cells: { ...at, column: letter, from_row: 2, values: rows.map((row) => cell(row[index])) },
      });
    });
  }
  if (uses('formula')) {
    for (const [letter, template] of Object.entries(formulas)) {
      rows.forEach((_, offset) => {
        const row = offset + 2;
        out.push({
          formula: {
            ...at,
            cell: `${letter}${row}`,
            regex: formulaPattern(template.replaceAll('{row}', String(row))),
          },
        });
      });
    }
  }
  return out;
}

function sheetChecks(vocabulary: readonly string[], sheet: ExpectedSheet): Check[] {
  return gridChecks(vocabulary, sheet.name, sheet.header, sheet.rows, sheet.formulas);
}

/** The artifact expectation of one expected file, in the family's vocabulary. */
export function compileFile(file: ExpectedFile, vocabulary: CheckVocabulary): Artifact {
  const names = vocabulary[file.kind] ?? [];
  const checks: Check[] = [];
  if (file.kind === 'xlsx') {
    if (names.includes('sheets')) checks.push({ sheets: file.sheets.map((sheet) => sheet.name) });
    for (const sheet of file.sheets) checks.push(...sheetChecks(names, sheet));
    if (names.includes('no_error_cells')) checks.push({ no_error_cells: true });
  } else if (file.kind === 'csv') {
    checks.push(...gridChecks(names, undefined, file.header, file.rows));
  } else if (file.kind === 'json') {
    if (
      names.includes('subset') &&
      file.value !== null &&
      typeof file.value === 'object' &&
      !Array.isArray(file.value)
    ) {
      checks.push({ subset: file.value });
    }
  } else if (names.includes('contains')) {
    checks.push({ contains: file.contains });
  }
  return { path: file.path, kind: file.kind, checks };
}

/** The part of a block's expectations the oracle decides: produced files, the workspace diff, must. */
export function compileBlock(
  expected: ExpectedBlock,
  vocabulary: CheckVocabulary,
  othersUntouched: boolean,
): Record<string, unknown> {
  return {
    ...(expected.files.length > 0
      ? { artifacts: expected.files.map((file) => compileFile(file, vocabulary)) }
      : {}),
    workspace: {
      created: [...expected.workspace.created],
      changed: [...expected.workspace.changed],
      deleted: [...expected.workspace.deleted],
      ...(othersUntouched ? { others_untouched: true } : {}),
    },
    ...(expected.must && expected.must.length > 0 ? { must: [...expected.must] } : {}),
  };
}
