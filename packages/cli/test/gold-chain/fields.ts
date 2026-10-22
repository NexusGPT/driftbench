/**
 * The two field formats of the truth files that name where a number stands, read by one strict reader.
 * `refers_to`: `{unit, to: id}`, `{unit, to: {from, to}}` (the gold5 files) or `{unit, target}`, `{unit, targets: [id]}`
 * (the units-table files). `number_table` (gold5: `{from, to}` ranges of cells) and `limits_table` (units-table:
 * `{header, rows}`) both name a standalone table; the producer gets the tables only, with no word on which ones
 * hold a limit. A problem is named by list and position, never dropped.
 */
export type Ref = { id: string } | { from: string; to: string };
export type RefersEntry = { unit: string; to: Ref[] };
export type TableRange = { from: string; to: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function readRefersEntries(raw: unknown, problems: string[], key = 'refers_to'): RefersEntry[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push(`${key}: not a list`);
    return [];
  }
  const out: RefersEntry[] = [];
  raw.forEach((entry: unknown, at: number) => {
    const where = `${key}[${at}]`;
    if (!isRecord(entry)) {
      problems.push(`${where}: not a mapping`);
      return;
    }
    const unit = text(entry.unit);
    if (unit === '') problems.push(`${where}: no unit`);
    const to: Ref[] = [];
    const add = (value: unknown, label: string): void => {
      if (typeof value === 'string' && value !== '') to.push({ id: value });
      else if (isRecord(value) && text(value.from) !== '' && text(value.to) !== '')
        to.push({ from: text(value.from), to: text(value.to) });
      else problems.push(`${where}: ${label} is neither an id nor a {from, to} range`);
    };
    const named = ['to', 'target', 'targets'].filter((name) => entry[name] !== undefined);
    if (named.length !== 1) problems.push(`${where}: name the place with exactly one of to, target, targets`);
    else if (named[0] === 'targets') {
      if (!Array.isArray(entry.targets) || entry.targets.length === 0) problems.push(`${where}: targets is empty`);
      else entry.targets.forEach((value: unknown, index: number) => add(value, `targets[${index}]`));
    } else add(entry[named[0] as string], named[0] as string);
    if (unit !== '' && to.length > 0) out.push({ unit, to });
  });
  return out;
}

export function readTableRanges(raw: unknown, problems: string[], key: string): TableRange[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push(`${key}: not a list`);
    return [];
  }
  const out: TableRange[] = [];
  raw.forEach((entry: unknown, at: number) => {
    const where = `${key}[${at}]`;
    if (!isRecord(entry)) {
      problems.push(`${where}: not a mapping`);
      return;
    }
    // gold5: a range of cells; units-table: a header unit and its data rows.
    if (text(entry.from) !== '' && text(entry.to) !== '') {
      out.push({ from: text(entry.from), to: text(entry.to) });
    } else if (text(entry.header) !== '' && Array.isArray(entry.rows) && entry.rows.length > 0) {
      out.push({ from: text(entry.header), to: String(entry.rows[entry.rows.length - 1]) });
    } else problems.push(`${where}: neither a {from, to} range nor a {header, rows} table`);
  });
  return out;
}

/** The units of a range, in the order given, from `from` to `to` both included, in one file. */
export function unitsInRange<T extends { id: string; file: string }>(
  ordered: readonly T[],
  range: { from: string; to: string },
): T[] {
  const first = ordered.findIndex((unit) => unit.id === range.from);
  const last = ordered.findIndex((unit) => unit.id === range.to);
  if (first < 0 || last < 0 || first > last || ordered[first]?.file !== ordered[last]?.file) return [];
  return ordered.slice(first, last + 1).filter((unit) => unit.file === ordered[first]?.file);
}
