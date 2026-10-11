import { pick, rngFor, shuffle } from '../seed/random';
import { FamilyError, type Knobs } from './knobs';
import type { CornerKind, Count, FamilyFile, Generator, Table } from './schema';

/** A cell of a generated table: text, or a whole number. */
export type TableCell = string | number;
export type TableRow = Record<string, TableCell>;

/** A generated table: its rows, and how far a corner case rotated its columns in every file that renders it. */
export type GeneratedTable = { readonly rows: readonly TableRow[]; readonly columnShift: number };
export type Tables = Readonly<Record<string, GeneratedTable>>;

export function countOf(count: Count, knobs: Knobs): number {
  if (typeof count === 'number') return count;
  const value = knobs[count.knob];
  if (typeof value !== 'number') throw new FamilyError(`the knob ${count.knob} holds no whole number`);
  return value;
}

/** Text with {column}, {column|title}, {seq} and {row} filled in from one row. */
function fill(template: string, row: TableRow, seq: number, index: number): string {
  return template.replace(
    /\{([A-Za-z_][A-Za-z0-9_]*)(\|title)?\}/g,
    (whole, name: string, title?: string) => {
      let text: string;
      if (name === 'seq') text = String(seq);
      else if (name === 'row') text = String(index + 1);
      else if (Object.hasOwn(row, name)) text = String(row[name]);
      else throw new FamilyError(`the template ${template} names ${whole}, which no earlier column holds`);
      return title ? text.charAt(0).toUpperCase() + text.slice(1) : text;
    },
  );
}

function column(
  name: string,
  gen: Generator,
  rows: TableRow[],
  seed: number,
  label: string,
  knobs: Knobs,
): void {
  const rng = rngFor(seed, `${label}:${name}`);
  if ('groups' in gen) {
    const count = countOf(gen.groups.count, knobs);
    if (count > gen.groups.values.length) {
      throw new FamilyError(
        `${label}.${name} needs ${count} distinct values; the list holds ${gen.groups.values.length}`,
      );
    }
    if (count > rows.length) {
      throw new FamilyError(`${label}.${name} needs ${count} distinct values on ${rows.length} rows`);
    }
    if (count === 0 && rows.length > 0)
      throw new FamilyError(`${label}.${name} picks no value for ${rows.length} rows`);
    const picked = shuffle(rng, gen.groups.values).slice(0, count);
    const assigned = [...picked, ...rows.slice(count).map(() => pick(rng, picked) as string)];
    shuffle(rng, assigned).forEach((value, index) => {
      (rows[index] as TableRow)[name] = value;
    });
    return;
  }
  const seqs = new Map<string, number>();
  rows.forEach((row, index) => {
    if ('choice' in gen) row[name] = pick(rng, gen.choice) as string;
    else if ('choice_by' in gen) {
      const key = String(row[gen.choice_by.column]);
      const options = Object.hasOwn(gen.choice_by.values, key) ? gen.choice_by.values[key] : undefined;
      if (!options)
        throw new FamilyError(`${label}.${name} has no values for ${gen.choice_by.column} = ${key}`);
      row[name] = pick(rng, options) as string;
    } else if ('int' in gen) {
      row[name] = gen.int.min + Math.floor(rng() * (gen.int.max - gen.int.min + 1));
    } else {
      const key = gen.seq_by === undefined ? '' : String(row[gen.seq_by]);
      const seq = (seqs.get(key) ?? 0) + 1;
      seqs.set(key, seq);
      row[name] = fill(gen.template, row, seq, index);
    }
  });
}

/** One table, from its grammar and the instance seed. Each column draws from a stream of its own. */
export function generateTable(name: string, table: Table, seed: number, knobs: Knobs): GeneratedTable {
  const count = countOf(table.rows, knobs);
  const rows: TableRow[] = Array.from({ length: count }, () => ({}));
  for (const entry of table.columns) column(entry.name, entry.gen, rows, seed, `tables.${name}`, knobs);
  return { rows, columnShift: 0 };
}

export function generateTables(family: FamilyFile, seed: number, knobs: Knobs): Tables {
  const out: Record<string, GeneratedTable> = {};
  for (const name of Object.keys(family.tables).sort()) {
    out[name] = generateTable(name, family.tables[name] as Table, seed, knobs);
  }
  return out;
}

function tableOf(kind: CornerKind): string {
  if ('empty_cell' in kind) return kind.empty_cell.table;
  if ('duplicate_row' in kind) return kind.duplicate_row.table;
  if ('column_order' in kind) return kind.column_order.table;
  return kind.unit_change.table;
}

/** The number with the converted unit: 10 GB at factor 1024 gives 10240 MB. */
function converted(
  value: string,
  rules: Extract<CornerKind, { unit_change: unknown }>['unit_change']['rules'],
): string | undefined {
  for (const rule of rules) {
    const match = new RegExp(rule.match).exec(value);
    const number = match?.[1];
    if (number === undefined) continue;
    const result = Number((Number(number) * rule.factor).toPrecision(12));
    return `${result} ${rule.unit}`;
  }
  return undefined;
}

/**
 * The tables with one corner case applied, or undefined when the case does not apply to them (no value
 * to empty, no row to repeat, no value in a unit a rule converts). A corner case keeps the workspace inside
 * the task contract: the instruction applies to it as written.
 */
export function applyCorner(tables: Tables, kind: CornerKind, seed: number): Tables | undefined {
  const name = tableOf(kind);
  const table = tables[name];
  if (!table)
    throw new FamilyError(`the corner ${kind.id} names the table ${name}, which the instance does not hold`);
  const rng = rngFor(seed, `corner:${kind.id}`);
  const rows = table.rows.map((row) => ({ ...row }));
  let columnShift = table.columnShift;
  if ('empty_cell' in kind) {
    const { column: target } = kind.empty_cell;
    const filled = rows.flatMap((row, index) => (String(row[target] ?? '') === '' ? [] : [index]));
    const at = pick(rng, filled);
    if (at === undefined) return undefined;
    (rows[at] as TableRow)[target] = '';
  } else if ('duplicate_row' in kind) {
    const at = Math.floor(rng() * rows.length);
    const row = rows[at];
    if (row === undefined) return undefined;
    rows.splice(at + 1, 0, { ...row });
  } else if ('column_order' in kind) {
    columnShift += 1;
  } else {
    let changed = 0;
    for (const row of rows) {
      const value = converted(String(row[kind.unit_change.column] ?? ''), kind.unit_change.rules);
      if (value === undefined) continue;
      row[kind.unit_change.column] = value;
      changed += 1;
    }
    if (changed === 0) return undefined;
  }
  return { ...tables, [name]: { rows, columnShift } };
}

/** The corner cases of one instance: up to per_instance kinds that apply, chosen by the instance seed. */
export function chooseCorners(family: FamilyFile, tables: Tables, seed: number): CornerKind[] {
  const rng = rngFor(seed, 'corners');
  const applicable = family.corners.kinds.filter((kind) => applyCorner(tables, kind, seed) !== undefined);
  return shuffle(rng, applicable)
    .slice(0, family.corners.per_instance)
    .sort((a, b) => family.corners.kinds.indexOf(a) - family.corners.kinds.indexOf(b));
}
