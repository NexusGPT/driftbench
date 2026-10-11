import { type LadderReport, type LevelRow, seedLabel } from './ladder';

/** A number as the table shows it: whole numbers plain, others to six significant digits; NaN is "error". */
export function showNumber(value: number): string {
  if (Number.isNaN(value)) return 'error';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(6)));
}

function cell(row: LevelRow): string {
  if (row.pass === null || row.observed === null) return 'not run';
  const items = row.itemCount ? ` (${row.itemCount})` : '';
  return `${showNumber(row.observed)} ${row.pass ? 'pass' : 'FAIL'}${items}`;
}

function threshold(row: LevelRow): string {
  return `${row.direction === 'atLeast' ? '>=' : '<='} ${showNumber(row.threshold)}`;
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (row: string[]) =>
    row
      .map((text, column) => text.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd();
  return `${[line(header), ...rows.map(line)].join('\n')}\n`;
}

export type FormatOptions = {
  /** The floor of the component, when known; the output then says whether the run holds it. */
  floor?: number;
};

/**
 * The ladder table of a report: one row per level, one column per seed, then the level per seed, the level of
 * the run (the minimum over seeds), the floor comparison and the items of each seed's first failing level.
 */
export function formatLadder(report: LadderReport, options: FormatOptions = {}): string {
  const first = report.seeds[0];
  if (!first) return `Validator ${report.component}: no seed was run.\n`;
  const header = [
    'Level',
    'Name',
    'Metric',
    'Threshold',
    ...report.seeds.map((run) => `seed ${seedLabel(run)}`),
  ];
  const rows = first.rows.map((row, index) => [
    String(row.level),
    row.name,
    row.metric,
    threshold(row),
    ...report.seeds.map((run) => {
      const own = run.rows[index];
      return own ? cell(own) : 'not run';
    }),
  ]);
  const hidden = report.seeds.find((run) => run.hidden);
  let text = `Validator ${report.component}${hidden ? ` (hidden seed ${hidden.seed})` : ''}\n`;
  text += table(header, rows);
  text += `Level per seed: ${report.seeds.map((run) => `${seedLabel(run)} = ${run.level}`).join(', ')}\n`;
  text += `Level of the run: ${report.level} of ${report.top}, the minimum over ${report.seeds.length} seed${
    report.seeds.length === 1 ? '' : 's'
  }.\n`;
  if (options.floor !== undefined) {
    text += `Floor: ${options.floor}. ${report.level >= options.floor ? 'At or above the floor.' : 'BELOW THE FLOOR.'}\n`;
  }
  const failed = report.seeds.filter((run) => run.failing);
  if (failed.length === 0) {
    text += 'No level failed.\n';
    return text;
  }
  text += 'Items of the first failing level:\n';
  for (const run of failed) {
    const failing = run.failing;
    if (!failing) continue;
    const count = failing.items.length;
    text += `  Seed ${seedLabel(run)}, level ${failing.level} ${failing.id} (${failing.name}), ${count} item${
      count === 1 ? '' : 's'
    }:\n`;
    if (count === 0) text += '    (the level named no item)\n';
    for (const item of failing.items) {
      text += `    ${item.id}  [${item.component}]  ${item.detail}\n`;
    }
  }
  return text;
}
