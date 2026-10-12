import type { RunReport } from './run';

/**
 * One ranked bar chart per benchmark: the score of each contestant on the test split with its 95% interval
 * as a whisker, and its measured cost per 100 items in the label. A static SVG that follows the reader's
 * light or dark theme. driftbench's bar carries the accent colour; every other bar is neutral, so identity
 * never rests on colour alone: each bar is named in its label.
 */

const W = 760;
const LEFT = 250;
const RIGHT = 70;
const ROW = 34;
const BAR = 18;
const TOP = 92;
const BOTTOM = 44;

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Breaks a line at spaces so no line passes `width` characters; at most two lines. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length > 2 ? [lines[0] as string, lines.slice(1).join(' ')] : lines;
}

export type ChartRow = {
  readonly name: string;
  readonly estimate: number;
  readonly lower: number;
  readonly upper: number;
  /** USD per 100 items. */
  readonly costPer100: number;
  readonly ours: boolean;
};

export function chartRows(report: RunReport, labels: Readonly<Record<string, string>> = {}): ChartRow[] {
  return report.contestants
    .map((c) => ({
      name: labels[c.contestant] ?? c.contestant,
      estimate: c.summary.value.estimate,
      lower: c.summary.value.lower,
      upper: c.summary.value.upper,
      costPer100: report.items === 0 ? 0 : (100 * c.costUsd) / report.items,
      ours: c.contestant.startsWith('driftbench'),
    }))
    .sort((a, b) => b.estimate - a.estimate || a.name.localeCompare(b.name));
}

export function renderChart(title: string, subtitle: string, rows: readonly ChartRow[]): string {
  const height = TOP + rows.length * ROW + BOTTOM;
  const plot = W - LEFT - RIGHT;
  const x = (v: number) => LEFT + v * plot;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (t) =>
        `<line class="grid" x1="${x(t)}" y1="${TOP - 6}" x2="${x(t)}" y2="${TOP + rows.length * ROW}"/>` +
        `<text class="tick" x="${x(t)}" y="${TOP + rows.length * ROW + 18}" text-anchor="middle">${Math.round(t * 100)}</text>`,
    )
    .join('');
  const bars = rows
    .map((r, i) => {
      const cy = TOP + i * ROW + ROW / 2;
      const y = cy - BAR / 2;
      const w = Math.max(0, x(r.estimate) - LEFT);
      // A bar with a 4px rounded end, square at the baseline.
      const radius = Math.min(4, w / 2);
      const path = `M${LEFT},${y} H${LEFT + w - radius} Q${LEFT + w},${y} ${LEFT + w},${y + radius} V${y + BAR - radius} Q${LEFT + w},${y + BAR} ${LEFT + w - radius},${y + BAR} H${LEFT} Z`;
      const label = `${(100 * r.estimate).toFixed(1)}`;
      const tip = `${r.name}: ${label} (95% interval ${(100 * r.lower).toFixed(1)} to ${(100 * r.upper).toFixed(1)}), ${r.costPer100.toFixed(2)} USD per 100 items`;
      return (
        `<g><title>${esc(tip)}</title>` +
        `<text class="${r.ours ? 'name ours' : 'name'}" x="${LEFT - 12}" y="${cy - 2}" text-anchor="end">${esc(r.name)}</text>` +
        `<text class="cost" x="${LEFT - 12}" y="${cy + 12}" text-anchor="end">${r.costPer100.toFixed(2)} USD / 100 items</text>` +
        `<path class="${r.ours ? 'bar ours' : 'bar'}" d="${path}"/>` +
        `<line class="whisker" x1="${x(r.lower)}" y1="${cy}" x2="${x(r.upper)}" y2="${cy}"/>` +
        `<line class="whisker" x1="${x(r.lower)}" y1="${cy - 5}" x2="${x(r.lower)}" y2="${cy + 5}"/>` +
        `<line class="whisker" x1="${x(r.upper)}" y1="${cy - 5}" x2="${x(r.upper)}" y2="${cy + 5}"/>` +
        `<text class="value" x="${x(r.upper) + 8}" y="${cy + 4}">${label}</text></g>`
      );
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-label="${esc(title)}">
<style>
  .bg { fill: #fcfcfb; }
  text { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; fill: #52514e; }
  .title { font-size: 16px; font-weight: 600; fill: #0b0b0b; }
  .subtitle { font-size: 12px; }
  .name { font-size: 13px; fill: #0b0b0b; }
  .name.ours { font-weight: 600; }
  .cost, .tick { font-size: 11px; fill: #75746f; }
  .value { font-size: 12px; fill: #0b0b0b; }
  .grid { stroke: #e4e3df; stroke-width: 1; }
  .bar { fill: #8a8984; }
  .bar.ours { fill: #2a78d6; }
  .whisker { stroke: #52514e; stroke-width: 1.5; }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #1a1a19; }
    text { fill: #c3c2b7; }
    .title, .name, .value { fill: #f0efec; }
    .cost, .tick { fill: #8f8e88; }
    .grid { stroke: #33332f; }
    .bar { fill: #6b6a65; }
    .bar.ours { fill: #3987e5; }
    .whisker { stroke: #c3c2b7; }
  }
</style>
<rect class="bg" width="${W}" height="${height}" rx="8"/>
<text class="title" x="20" y="30">${esc(title)}</text>
${wrap(subtitle, 110)
  .map((line, i) => `<text class="subtitle" x="20" y="${50 + i * 16}">${esc(line)}</text>`)
  .join('')}
${grid}${bars}
</svg>
`;
}

/** One results table in Markdown, rows ranked as in the chart, for the docs page. */
export function renderTable(report: RunReport, labels: Readonly<Record<string, string>> = {}): string {
  const rows = [...report.contestants]
    .map((c) => ({ c, name: labels[c.contestant] ?? c.contestant }))
    .sort((a, b) => b.c.summary.value.estimate - a.c.summary.value.estimate || a.name.localeCompare(b.name));
  const pct = (v: number) => (100 * v).toFixed(1);
  const head =
    '| Rank | Contestant | Score (95% interval) | Position consistency | USD per 100 items | Missing answers |\n' +
    '|---|---|---|---|---|---|';
  const body = rows.map(({ c, name }, i) => {
    const s = c.summary;
    const pc = s.positionConsistency === undefined ? 'n/a' : pct(s.positionConsistency);
    const cost = report.items === 0 ? 0 : (100 * c.costUsd) / report.items;
    return `| ${i + 1} | ${name} | ${pct(s.value.estimate)} [${pct(s.value.lower)}, ${pct(s.value.upper)}] | ${pc} | ${cost.toFixed(2)} | ${s.missing} |`;
  });
  return [head, ...body].join('\n');
}
