import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { validateSpec } from '../spec/load';

/**
 * Turns the rows of a table (a CSV file, a spreadsheet sheet) into specs, through a mapping file.
 *
 * The mapping holds a `spec` template and a `block` template. A string in a template may name
 * columns in braces, such as `"{question}"`; `{row}` is the source row number. A string that is one
 * placeholder takes the cell as it is (a spreadsheet number stays a number); an empty cell leaves the
 * field out. A directive object reads one column with options:
 *
 *   { $column: must, $split: "|" }   a list, the cell split on the separator, parts trimmed
 *   { $column: must_not, $list: true } a list of the whole cell
 *   { $column: max_calls, $as: number } the cell converted: text, number, boolean or json
 *
 * With `group_by`, the rows sharing a value of that column become the blocks of one spec, in row order,
 * and the spec template reads the first of them. Without it, every row is a spec of one block. Rows
 * with every cell empty are skipped.
 */

export type TableCell = string | number | boolean | null;

/** One table: a CSV file, or one sheet of a workbook. `rows[0]` is row 1. */
export type TableInput = { label: string; rows: readonly (readonly TableCell[])[] };

export type TableMapping = {
  sheet?: string;
  headerRow: number;
  groupBy?: string;
  spec: Record<string, unknown>;
  block: Record<string, unknown>;
};

export type ImportedSpec = {
  id: string;
  /** The source row numbers the spec was made from. */
  rows: number[];
  /** The spec as authored: shorthand kept, ready to write. */
  spec: Record<string, unknown>;
  /** The spec as YAML, with a comment naming the source rows. */
  yaml: string;
  /** The spec's content hash, as the loader computes it. */
  hash: string;
};

export type ImportError = { rows: number[]; message: string };

export type ImportResult = { specs: ImportedSpec[]; errors: ImportError[] };

const MAPPING_KEYS = new Set(['sheet', 'header_row', 'group_by', 'spec', 'block']);
const DIRECTIVE_KEYS = new Set(['$column', '$split', '$list', '$as']);
const CONVERSIONS = new Set(['text', 'number', 'boolean', 'json']);
/** `{{` (two opening braces in a row, written as one) or `{column}`. */
const PLACEHOLDER = /\{\{|\{([^{}]+)\}/g;
const ROW = 'row';

/** Parses and checks a mapping file. Never throws on bad input. */
export function parseTableMapping(
  text: string,
): { ok: true; mapping: TableMapping } | { ok: false; errors: string[] } {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    return {
      ok: false,
      errors: [`the mapping is not YAML: ${cause instanceof Error ? cause.message : cause}`],
    };
  }
  if (!isObject(raw)) return { ok: false, errors: ['the mapping must be a YAML mapping'] };
  const errors: string[] = [];
  for (const key of Object.keys(raw)) if (!MAPPING_KEYS.has(key)) errors.push(`unknown key: ${key}`);
  const { sheet, header_row: headerRow = 1, group_by: groupBy, spec, block } = raw;
  if (sheet !== undefined && typeof sheet !== 'string') errors.push('sheet: expected a sheet name');
  if (!Number.isInteger(headerRow) || (headerRow as number) < 1)
    errors.push('header_row: expected a row number');
  if (groupBy !== undefined && typeof groupBy !== 'string') errors.push('group_by: expected a column name');
  if (!isObject(spec) || !('id' in spec)) errors.push('spec: needs an id, such as id: "my-spec-{row}"');
  if (!isObject(block) || !['user', 'burst', 'when'].some((key) => key in block)) {
    errors.push('block: needs user, burst or when');
  }
  if (isObject(spec)) checkDirectives(spec, 'spec', errors);
  if (isObject(block)) checkDirectives(block, 'block', errors);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    mapping: {
      ...(typeof sheet === 'string' ? { sheet } : {}),
      headerRow: headerRow as number,
      ...(typeof groupBy === 'string' ? { groupBy } : {}),
      spec: spec as Record<string, unknown>,
      block: block as Record<string, unknown>,
    },
  };
}

/** Maps the table the mapping names to specs. Each spec is validated with the spec loader. */
export function importTable(
  tables: readonly TableInput[],
  mapping: TableMapping,
  source: string,
): ImportResult {
  const fail = (message: string): ImportResult => ({ specs: [], errors: [{ rows: [], message }] });
  const table = mapping.sheet === undefined ? tables[0] : tables.find((each) => each.label === mapping.sheet);
  if (table === undefined) {
    return fail(
      mapping.sheet === undefined
        ? `${source} holds no table`
        : `${source} has no sheet "${mapping.sheet}"; its sheets are ${tables.map((each) => each.label).join(', ')}`,
    );
  }
  const header = (table.rows[mapping.headerRow - 1] ?? []).map((cell) =>
    cell === null ? '' : String(cell).trim(),
  );
  const columns = new Map<string, number>();
  header.forEach((name, index) => {
    if (name !== '' && !columns.has(name)) columns.set(name, index);
  });
  const named = [...columnsOf(mapping.spec), ...columnsOf(mapping.block)];
  if (mapping.groupBy !== undefined) named.push(mapping.groupBy);
  for (const name of named) {
    if (name !== ROW && !columns.has(name)) {
      return fail(
        `the mapping names column "${name}", which ${table.label} does not have; its columns are ${[...columns.keys()].join(', ')}`,
      );
    }
  }

  type Row = { number: number; cells: readonly TableCell[] };
  const groups = new Map<string, Row[]>();
  table.rows.forEach((cells, index) => {
    const number = index + 1;
    if (number <= mapping.headerRow || cells.every((cell) => cell === null || cell === '')) return;
    const key =
      mapping.groupBy === undefined
        ? `#${number}`
        : cellText(cells[columns.get(mapping.groupBy) ?? -1] ?? null);
    const group = groups.get(key) ?? [];
    group.push({ number, cells });
    groups.set(key, group);
  });

  const specs: ImportedSpec[] = [];
  const errors: ImportError[] = [];
  const madeFrom = new Map<string, number[]>();
  for (const rows of groups.values()) {
    const numbers = rows.map((row) => row.number);
    try {
      const [first] = rows;
      if (first === undefined) continue;
      const reader = (row: Row) => (name: string) =>
        name === ROW ? row.number : (row.cells[columns.get(name) ?? -1] ?? null);
      const spec = fill(mapping.spec, reader(first));
      const blocks = rows.map((row) => fill(mapping.block, reader(row)));
      const built: Record<string, unknown> = { ...(isObject(spec) ? spec : {}), blocks };
      const id = typeof built.id === 'string' ? built.id : String(built.id ?? '');
      const earlier = madeFrom.get(id);
      if (earlier !== undefined) {
        errors.push({
          rows: numbers,
          message: `spec id ${id} is already made from rows ${earlier.join(', ')}`,
        });
        continue;
      }
      const loaded = validateSpec(built, `${source} rows ${numbers.join(', ')}`);
      if (!loaded.ok) {
        const issues = loaded.errors.map((issue) => `${issue.path} ${issue.code} ${issue.message}`);
        errors.push({ rows: numbers, message: `spec ${id}: ${issues.join('; ')}` });
        continue;
      }
      madeFrom.set(id, numbers);
      const where = numbers.length === 1 ? `row ${numbers[0]}` : `rows ${numbers.join(', ')}`;
      const yaml = `# Imported from ${source}, ${where}.\n${stringifyYaml(built, { lineWidth: 0 })}`;
      specs.push({ id, rows: numbers, spec: built, yaml, hash: loaded.hash });
    } catch (cause) {
      errors.push({ rows: numbers, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { specs, errors };
}

const OMIT = Symbol('omit');

/** Applies a template to one row. Throws a plain Error naming the column when a value does not convert. */
function fill(template: unknown, read: (name: string) => TableCell | number): unknown {
  const out = apply(template, read);
  return out === OMIT ? {} : out;
}

function apply(template: unknown, read: (name: string) => TableCell | number): unknown {
  if (typeof template === 'string') return interpolate(template, read);
  if (Array.isArray(template)) {
    const items: unknown[] = [];
    for (const item of template) {
      const value = apply(item, read);
      if (value === OMIT) continue;
      if (isDirective(item) && Array.isArray(value)) items.push(...value);
      else items.push(value);
    }
    return items;
  }
  if (isDirective(template)) return directive(template, read);
  if (isObject(template)) {
    const entries = Object.entries(template);
    const out: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      const filled = apply(value, read);
      if (filled !== OMIT) out[key] = filled;
    }
    return entries.length > 0 && Object.keys(out).length === 0 ? OMIT : out;
  }
  return template;
}

function interpolate(template: string, read: (name: string) => TableCell | number): unknown {
  const whole = /^\{([^{}]+)\}$/.exec(template);
  if (whole?.[1] !== undefined) {
    const value = read(whole[1].trim());
    return value === null || value === '' ? OMIT : value;
  }
  let empty = false;
  const text = template.replace(PLACEHOLDER, (match: string, name: string | undefined) => {
    if (match === '{{' || name === undefined) return '{';
    const value = read(name.trim());
    if (value === null || value === '') empty = true;
    return cellText(value);
  });
  return empty ? OMIT : text;
}

function directive(spec: Record<string, unknown>, read: (name: string) => TableCell | number): unknown {
  const column = String(spec.$column);
  const value = read(column);
  if (value === null || value === '') return OMIT;
  if (typeof spec.$split === 'string') {
    const parts = cellText(value)
      .split(spec.$split)
      .map((part) => part.trim())
      .filter((part) => part !== '');
    return parts.length === 0 ? OMIT : parts.map((part) => convert(part, spec.$as, column));
  }
  const converted = convert(value, spec.$as, column);
  return spec.$list === true ? [converted] : converted;
}

function convert(value: TableCell | number, as: unknown, column: string): unknown {
  if (as === undefined) return value;
  const text = cellText(value).trim();
  if (as === 'text') return cellText(value);
  if (as === 'number') {
    const n = typeof value === 'number' ? value : text === '' ? Number.NaN : Number(text);
    if (!Number.isFinite(n)) throw new Error(`column ${column}: "${text}" is not a number`);
    return n;
  }
  if (as === 'boolean') {
    if (typeof value === 'boolean') return value;
    const lower = text.toLowerCase();
    if (['true', 'yes', '1'].includes(lower)) return true;
    if (['false', 'no', '0'].includes(lower)) return false;
    throw new Error(`column ${column}: "${text}" is not true or false`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`column ${column}: "${text}" is not JSON`);
  }
}

function checkDirectives(template: unknown, path: string, errors: string[]): void {
  if (Array.isArray(template)) {
    template.forEach((item, index) => {
      checkDirectives(item, `${path}.${index}`, errors);
    });
    return;
  }
  if (!isObject(template)) return;
  const keys = Object.keys(template);
  if (keys.some((key) => key.startsWith('$'))) {
    const unknown = keys.filter((key) => !DIRECTIVE_KEYS.has(key));
    if (unknown.length > 0) {
      errors.push(
        `${path}: unknown directive key ${unknown.join(', ')}; a directive takes $column, $split, $list, $as`,
      );
    } else if (typeof template.$column !== 'string' || template.$column === '') {
      errors.push(`${path}: a directive needs $column, the column name`);
    } else if (template.$as !== undefined && !CONVERSIONS.has(String(template.$as))) {
      errors.push(`${path}: $as takes text, number, boolean or json`);
    }
    return;
  }
  for (const [key, value] of Object.entries(template)) checkDirectives(value, `${path}.${key}`, errors);
}

/** Every column a template reads. */
function columnsOf(template: unknown): string[] {
  if (typeof template === 'string') {
    return [...template.matchAll(PLACEHOLDER)]
      .filter((match) => match[1] !== undefined)
      .map((match) => (match[1] ?? '').trim());
  }
  if (Array.isArray(template)) return template.flatMap(columnsOf);
  if (isDirective(template)) return [String(template.$column)];
  if (isObject(template)) return Object.values(template).flatMap(columnsOf);
  return [];
}

function isDirective(value: unknown): value is Record<string, unknown> {
  return isObject(value) && '$column' in value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cellText(value: TableCell | number): string {
  return value === null ? '' : String(value);
}
