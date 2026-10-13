/**
 * An inventory kept as markdown tables or as one CSV with a section column. The tables are read into the
 * mapping an inventory file holds (written as YAML), the pre-pass runs on that, and each quote it gives is
 * mapped back to the row of the original file it comes from, so every quote stays a passage of the source.
 */

type Row = { cells: Record<string, string>; line: string };
type Parsed = {
  channels?: { values: string[]; line: string };
  behaviours: Row[];
  flows: Row[];
};

export type TableInventory = {
  /** The inventory as a YAML mapping. */
  yaml: string;
  /** Maps a quote of the YAML text to the line of the original file it stands for. */
  requote: (quote: string) => string;
};

const split = (value: string | undefined, separator: RegExp) =>
  (value ?? '')
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part !== '');

function markdown(text: string): Parsed {
  const parsed: Parsed = { behaviours: [], flows: [] };
  let section: 'behaviours' | 'flows' | undefined;
  let header: string[] | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const channels = /^channels:\s*(.+)$/i.exec(line);
    if (channels) parsed.channels = { values: split(channels[1], /,/), line };
    const heading = /^#{1,6}\s*(behaviours|flows)\b/i.exec(line);
    if (heading) {
      section = heading[1]?.toLowerCase() as 'behaviours' | 'flows';
      header = undefined;
      continue;
    }
    if (!section || !line.startsWith('|')) continue;
    const cells = line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    if (!header) {
      header = cells.map((cell) => cell.toLowerCase());
      continue;
    }
    const row = Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']));
    parsed[section].push({ cells: row, line });
  }
  return parsed;
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function csv(text: string): Parsed {
  const parsed: Parsed = { behaviours: [], flows: [] };
  const lines = text.split('\n');
  const rows = csvRows(text);
  const header = rows[0]?.map((name) => name.trim().toLowerCase()) ?? [];
  rows.slice(1).forEach((cells, index) => {
    const row = Object.fromEntries(header.map((name, at) => [name, (cells[at] ?? '').trim()]));
    const line = lines[index + 1] ?? '';
    if (row.section === 'channels') parsed.channels = { values: split(row.channels, /\s+/), line };
    else if (row.section === 'behaviour') parsed.behaviours.push({ cells: row, line });
    else if (row.section === 'flow') parsed.flows.push({ cells: row, line });
  });
  return parsed;
}

/** Reads an inventory kept as markdown tables or CSV; undefined when it holds no behaviour and no flow. */
export function tableInventory(text: string, format: 'markdown' | 'csv'): TableInventory | undefined {
  const parsed = format === 'csv' ? csv(text) : markdown(text);
  if (parsed.behaviours.length === 0 && parsed.flows.length === 0) return undefined;
  const separator = format === 'csv' ? /\s+/ : /,/;
  const list = (items: string[]) => `[${items.map((item) => JSON.stringify(item)).join(', ')}]`;
  const lines: string[] = [];
  const spans: Array<{ start: number; end: number; line: string }> = [];
  let offset = 0;
  const emit = (line: string, source?: string) => {
    if (source !== undefined) spans.push({ start: offset, end: offset + line.length + 1, line: source });
    lines.push(line);
    offset += line.length + 1;
  };
  if (parsed.channels) emit(`channels: ${list(parsed.channels.values)}`, parsed.channels.line);
  const first = (row: Row) => row.line;
  emit('behaviours:');
  for (const row of parsed.behaviours) {
    emit(`  - id: ${JSON.stringify(row.cells.id)}`, first(row));
    emit(`    title: ${JSON.stringify(row.cells.title)}`, first(row));
    const channels = split(row.cells.channels, separator);
    if (channels.length > 0) emit(`    channels: ${list(channels)}`, first(row));
  }
  emit('flows:');
  for (const row of parsed.flows) {
    emit(`  - id: ${JSON.stringify(row.cells.id)}`, first(row));
    emit(`    title: ${JSON.stringify(row.cells.title)}`, first(row));
    emit(`    behaviours: ${list(split(row.cells.behaviours, separator))}`, first(row));
    const deviations = split(row.cells.deviations, separator);
    if (deviations.length > 0) emit(`    deviations: ${list(deviations)}`, first(row));
  }
  const yaml = `${lines.join('\n')}\n`;
  return {
    yaml,
    requote: (quote) => {
      const at = yaml.indexOf(quote.split('\n')[0] ?? quote);
      return spans.find((span) => at >= span.start && at < span.end)?.line ?? quote;
    },
  };
}

/** Maps every quote of a pre-pass back to the original file. */
export function requoted<T extends { ok: boolean }>(prepass: T, requote: (quote: string) => string): T {
  if (!prepass.ok) return prepass;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) =>
        key === 'evidence' && value && typeof (value as { quote?: unknown }).quote === 'string'
          ? [key, { ...(value as object), quote: requote((value as { quote: string }).quote) }]
          : [key, walk(value)],
      ),
    );
  };
  return walk(prepass) as T;
}
