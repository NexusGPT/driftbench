#!/usr/bin/env node
/**
 * Draws the README charts from the result files of this repository.
 *
 * Usage:  node tools/readme-charts.mjs [--check]
 *   no flag   write docs/assets/<name>-light.svg and <name>-dark.svg, and docs/assets/data/chart-facts.csv
 *   --check   draw in memory and exit 1 when a committed file differs
 *
 * Every number comes from a file named in SOURCES below. Nothing is typed in by hand: a missing file,
 * a table that no longer parses, or an interval that disagrees with its source stops the script.
 * Plain Node, no dependency.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'assets');
const CHECK = process.argv.includes('--check');

const SOURCES = {
  promptfoo: 'comparisons/promptfoo/hard/recorded/summary.json',
  deepeval: 'comparisons/deepeval/hard/baseline-heldout-scores.json',
  deepevalReceipts: 'comparisons/deepeval/hard/baseline-task-receipts-heldout-scores.json',
  langfuseOurs: 'comparisons/langfuse/hard/pr115-scores.json',
  langfuseTheirs: 'comparisons/langfuse/hard/heldout-scores.json',
  inspect: 'comparisons/inspect/hard/summary.json',
  mmEval: 'docs/assets/data/mm-eval-sealed-test.json',
  budget: 'comparisons/budget/full-study.md',
  floors: 'validators/floors.json',
  matrix: 'docs/comparison.md',
};
const BANKS = [
  { id: 'system', file: 'validators/system/HANDOVER.md', pattern: /Bank version \d+ \((\d+) items\)/ },
  { id: 'generator', file: 'validators/generator/GATE.md', pattern: /\| Bank \| (\d+) items/ },
  { id: 'estate', file: 'validators/estate/GATE.md', pattern: /\| Bank \| (\d+) items/ },
  { id: 'stats', file: 'validators/stats/GATE.md', pattern: /\| Bank \| (\d+) items/ },
  {
    id: 'judges',
    file: 'validators/judges/GATE.md',
    pattern: /\| Bank \(deterministic, kept\) \| (\d+) items/,
  },
  { id: 'map', file: 'validators/map/GATE.md', pattern: /Measured on that bank \((\d+) items/ },
];

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const facts = [];
const fact = (chart, what, value, source) => facts.push({ chart, what, value, source });

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

/** Wilson 95 percent interval of right out of n, in percent. */
function wilson(right, n) {
  const z = 1.959963984540054;
  const p = right / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, (centre - half) * 100), Math.min(100, (centre + half) * 100)];
}

/** Stops when the interval this script computes is not the one the source file holds. */
function sameInterval(computed, stored, where) {
  const scale = stored[1] <= 1 ? 100 : 1;
  for (const side of [0, 1]) {
    if (Math.abs(computed[side] - stored[side] * scale) > 0.011) {
      throw new Error(`${where}: interval ${computed} differs from the source ${stored}`);
    }
  }
}

function judgeRows() {
  const groups = [];
  const row = (label, n, ours, theirs, source, stored) => {
    const oursCi = wilson(ours, n);
    const theirsCi = wilson(theirs, n);
    if (stored?.ours) sameInterval(oursCi, stored.ours, `${source} ${label} ours`);
    if (stored?.theirs) sameInterval(theirsCi, stored.theirs, `${source} ${label} theirs`);
    const standing = oursCi[0] > theirsCi[1] ? 'lead' : oursCi[1] < theirsCi[0] ? 'deficit' : 'close';
    fact(
      'judge-heldout',
      `${label}: driftbench ${ours} of ${n}, other ${theirs} of ${n}, ${standing}`,
      [ours, theirs, n],
      source,
    );
    return { label, n, ours, theirs, oursCi, theirsCi, standing };
  };

  const deepeval = json(SOURCES.deepeval);
  const receipts = json(SOURCES.deepevalReceipts);
  const names = {
    'turn relevancy': 'Turn relevancy',
    'G-Eval strict': 'G-Eval, strict',
    DAG: 'DAG, one node',
    'role adherence': 'Role adherence',
    'conversation completeness': 'Completeness',
    'task completion': 'Task completion',
    hallucination: 'Hallucination',
    faithfulness: 'Faithfulness',
    'knowledge retention': 'Knowledge retention',
  };
  groups.push({
    header: 'DeepEval 4.2.8, default metrics, 72 cases each',
    rows: deepeval.map((entry) => {
      const used = entry.row === 'task completion' ? receipts.find((r) => r.row === entry.row) : entry;
      const source = entry.row === 'task completion' ? SOURCES.deepevalReceipts : SOURCES.deepeval;
      return row(names[entry.row], used.n, used.ours, used.theirs, source, {
        ours: used.ours_ci,
        theirs: used.theirs_ci,
      });
    }),
  });

  const promptfoo = json(SOURCES.promptfoo);
  const pick = (list, name) =>
    list.find((r) => r.set === 'heldout' && r.side === 'shipped' && r.row === name);
  groups.push({
    header: 'promptfoo, default graders, 72 cases each',
    rows: [
      ['LLM rubric', pick(promptfoo.rows, 'rubric')],
      ['Factuality', pick(promptfoo.rows, 'factuality')],
      ['Personal data', pick(promptfoo.rows, 'pii')],
      ['Goal success', pick(promptfoo.ablations, 'goal-equal-evidence')],
    ].map(([label, r]) =>
      row(label, r.n, r.ours, r.theirs, SOURCES.promptfoo, { ours: r.ours_ci, theirs: r.theirs_ci }),
    ),
  });

  const ours = json(SOURCES.langfuseOurs).summary['heldout-cases.json'];
  const theirs = json(SOURCES.langfuseTheirs).variants.theirs;
  groups.push({
    header: 'Langfuse, Correctness template, 120 cases',
    rows: [
      row(
        'Reference correctness',
        ours.total,
        ours.correct,
        theirs.at_half_correct,
        `${SOURCES.langfuseOurs} and ${SOURCES.langfuseTheirs}`,
        { ours: ours.ci95 },
      ),
    ],
  });

  const inspect = json(SOURCES.inspect);
  const inspectNames = {
    qa: 'Model-graded QA',
    fact: 'Model-graded fact',
    panel: 'Grader panel',
    borderline: 'Panel, borderline',
  };
  groups.push({
    header: 'Inspect 0.3.278, default graders, 60 cases each',
    rows: inspect.rows
      .filter((r) => inspectNames[r.row])
      .map((r) => {
        const held = r.records.heldout;
        return row(
          inspectNames[r.row],
          held.ours.items,
          held.ours.right,
          held.theirs.right,
          SOURCES.inspect,
          {
            ours: [held.ours.ci95.lower, held.ours.ci95.upper],
            theirs: [held.theirs.ci95.lower, held.theirs.ci95.upper],
          },
        );
      }),
  });

  for (const group of groups)
    group.rows.sort((a, b) => b.ours / b.n - b.theirs / b.n - (a.ours / a.n - a.theirs / a.n));
  return groups;
}

function costRows() {
  const rows = [];
  const inspect = json(SOURCES.inspect);
  const labels = {
    qa: 'Inspect, model-graded QA',
    fact: 'Inspect, model-graded fact',
    panel: 'Inspect, grader panel',
    borderline: 'Inspect, panel on borderline cases',
  };
  for (const r of inspect.rows) {
    if (!labels[r.row]) continue;
    const held = r.records.heldout;
    rows.push({
      label: labels[r.row],
      ours: (held.ours.costUsd / held.ours.items) * 100,
      theirs: (held.theirs.costUsd / held.theirs.items) * 100,
      source: SOURCES.inspect,
    });
  }
  const ours = json(SOURCES.langfuseOurs).summary['heldout-cases.json'];
  const theirs = json(SOURCES.langfuseTheirs).variants.theirs;
  rows.push({
    label: 'Langfuse, Correctness template',
    ours: ours.usd_per_100,
    theirs: (theirs.evaluation_cost_usd / theirs.total) * 100,
    source: `${SOURCES.langfuseOurs} and ${SOURCES.langfuseTheirs}`,
  });
  rows.sort((a, b) => a.ours / a.theirs - b.ours / b.theirs);
  for (const r of rows)
    fact('judge-cost', `${r.label}: USD per 100 cases, driftbench then other`, [r.ours, r.theirs], r.source);
  return rows;
}

function mmEval() {
  const cohort = json(SOURCES.mmEval).completeCascadeCohort;
  fact(
    'mm-eval',
    'sealed test, single judge, with panel, difference, 95 percent interval, items',
    [cohort.base, cohort.cascade, cohort.difference, cohort.paired95, cohort.n],
    SOURCES.mmEval,
  );
  const subsets = Object.entries(cohort.subsets)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.difference - a.difference);
  for (const s of subsets)
    fact('mm-eval', `${s.name}: single judge, with panel, items`, [s.base, s.cascade, s.n], SOURCES.mmEval);
  return { cohort, subsets };
}

function budgetRows() {
  const text = read(SOURCES.budget);
  const table = text.slice(text.indexOf('## Selected rows'), text.indexOf('### Balance'));
  const rows = [];
  const pattern =
    /^\| (\d+) \| (hybrid|pairwise|random) \| ([\d.]+); SD [\d.]+; range [\d.]+ to [\d.]+; 95% CI ([\d.]+) to ([\d.]+) \|/gm;
  for (const match of table.matchAll(pattern)) {
    rows.push({
      budget: Number(match[1]),
      method: match[2],
      mean: Number(match[3]),
      meanText: match[3],
      lo: Number(match[4]),
      hi: Number(match[5]),
    });
  }
  if (rows.length !== 12)
    throw new Error(`${SOURCES.budget}: expected 12 selected rows, read ${rows.length}`);
  for (const r of rows)
    fact(
      'testgen-budget',
      `budget ${r.budget}, ${r.method}: mean faults of 13 over 30 seeds, 95 percent interval`,
      [r.mean, r.lo, r.hi],
      SOURCES.budget,
    );
  return rows;
}

function banks() {
  const floors = json(SOURCES.floors);
  const list = BANKS.map((bank) => {
    const match = read(bank.file).match(bank.pattern);
    if (!match) throw new Error(`${bank.file}: no bank size found`);
    const floor = floors.floors[bank.id];
    const row = {
      id: bank.id,
      items: Number(match[1]),
      floor,
      ladderVersion: floors.ladderVersion[bank.id],
      source: bank.file,
    };
    fact(
      'self-tests',
      `${bank.id}: planted-truth items${floor ? `, CI floor level ${floor}` : ', no floor yet'}`,
      [row.items, floor ?? null],
      `${bank.file}, ${SOURCES.floors}`,
    );
    return row;
  });
  return list.sort((a, b) => b.items - a.items);
}

function matrix() {
  const lines = read(SOURCES.matrix).split('\n');
  const header = lines.find((line) => line.startsWith('| # | Capability |'));
  const tools = header
    .split('|')
    .slice(3, -2)
    .map((cell) => cell.trim());
  const counts = Object.fromEntries(tools.map((tool) => [tool, { yes: 0, partial: 0, none: 0 }]));
  let capabilities = 0;
  for (const line of lines) {
    if (!/^\| \d+ \|/.test(line)) continue;
    capabilities += 1;
    const cells = line
      .split('|')
      .slice(3, 3 + tools.length)
      .map((cell) => cell.trim());
    cells.forEach((cell, index) => {
      const kind = cell.startsWith('yes')
        ? 'yes'
        : cell.startsWith('partial')
          ? 'partial'
          : /^not (found|documented)/.test(cell)
            ? 'none'
            : null;
      if (!kind) throw new Error(`${SOURCES.matrix}: unread cell "${cell.slice(0, 40)}"`);
      counts[tools[index]][kind] += 1;
    });
  }
  const rows = tools
    .map((tool) => ({ tool, ...counts[tool] }))
    .sort((a, b) => b.yes - a.yes || b.partial - a.partial);
  for (const r of rows)
    fact(
      'capability-matrix',
      `${r.tool}: documented in full, in part, not found, of ${capabilities}`,
      [r.yes, r.partial, r.none],
      SOURCES.matrix,
    );
  return { rows, capabilities };
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

const THEMES = {
  light: {
    page: '#F6F8FB',
    card: '#FFFFFF',
    ink: '#0E1116',
    ink2: '#3F4651',
    ink3: '#6B7280',
    line: '#DCE1E8',
    ours: '#2F5FD0',
    oursSoft: '#9DBDF2',
    other: '#AEB6C2',
    otherSoft: '#D9DEE6',
    whisker: '#0E1116',
    spark: '#FF6600',
  },
  dark: {
    page: '#0E1218',
    card: '#161B23',
    ink: '#F5F3F0',
    ink2: '#C5CBD3',
    ink3: '#8D96A3',
    line: '#2A313C',
    ours: '#6E9BF0',
    oursSoft: '#3C5FA8',
    other: '#6B7482',
    otherSoft: '#3A424E',
    whisker: '#F5F3F0',
    spark: '#FF7A1F',
  },
};
const SERIF = "'Libre Caslon Text', 'Libre Caslon Display', Georgia, 'Times New Roman', serif";
const SANS = "Geist, Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const W = 520;
const PAD = 22;

const esc = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (value) => Number(value.toFixed(2));

function wrap(text, size, width, factor = 0.53) {
  const limit = Math.floor(width / (size * factor));
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && `${line} ${word}`.length > limit) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** One chart canvas: a title sentence, a key, a body drawn by the caller, and a source caption. */
function canvas(theme, { title, key = [], caption, describe }, body) {
  const t = THEMES[theme];
  const parts = [];
  let y = PAD + 8;
  const titleLines = wrap(title, 19, W - PAD * 2, 0.485);
  for (const line of titleLines) {
    y += 19;
    parts.push(
      `<text x="${PAD}" y="${y}" font-family="${SERIF}" font-size="19" fill="${t.ink}" letter-spacing="-0.2">${esc(line)}</text>`,
    );
    y += 6;
  }
  y += 12;
  if (key.length) {
    y += 8;
    let x = PAD;
    for (const item of key) {
      parts.push(`<rect x="${x}" y="${y - 9}" width="11" height="11" rx="2" fill="${t[item.color]}"/>`);
      parts.push(
        `<text x="${x + 16}" y="${y + 1}" font-family="${SANS}" font-size="13" font-weight="500" fill="${t.ink2}">${esc(item.label)}</text>`,
      );
      x += 16 + item.label.length * 6.9 + 18;
    }
    y += 20;
  }
  const drawn = body(t, y);
  parts.push(drawn.svg);
  y = drawn.y + 14;
  parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${t.line}" stroke-width="1"/>`);
  y += 6;
  for (const line of caption.flatMap((entry) => wrap(entry, 11, W - PAD * 2, 0.61))) {
    y += 15;
    parts.push(
      `<text x="${PAD}" y="${y}" font-family="${MONO}" font-size="11" fill="${t.ink3}">${esc(line)}</text>`,
    );
  }
  const height = y + PAD;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<desc>${esc(describe)}</desc>`,
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="14" fill="${t.page}" stroke="${t.line}"/>`,
    ...parts,
    '</svg>',
    '',
  ].join('\n');
}

/** An axis under a plot: ticks from zero, labelled with what they measure. */
function axis(t, x0, width, y, max, ticks, label, format = (v) => v) {
  const out = [
    `<line x1="${x0}" y1="${y}" x2="${x0 + width}" y2="${y}" stroke="${t.ink3}" stroke-width="1"/>`,
  ];
  for (const tick of ticks) {
    const x = num(x0 + (tick / max) * width);
    out.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 4}" stroke="${t.ink3}" stroke-width="1"/>`);
    out.push(
      `<text x="${x}" y="${y + 16}" text-anchor="middle" font-family="${SANS}" font-size="11.5" font-weight="600" fill="${t.ink3}">${esc(format(tick))}</text>`,
    );
  }
  out.push(
    `<text x="${x0 + width / 2}" y="${y + 33}" text-anchor="middle" font-family="${SANS}" font-size="12" fill="${t.ink3}">${esc(label)}</text>`,
  );
  return { svg: out.join('\n'), y: y + 36 };
}

function grid(t, x0, width, top, bottom, max, ticks) {
  return ticks
    .filter((tick) => tick > 0)
    .map((tick) => {
      const x = num(x0 + (tick / max) * width);
      return `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="${t.line}" stroke-width="1" stroke-dasharray="2 4"/>`;
    })
    .join('\n');
}

function bar(x0, y, length, height, color) {
  const w = Math.max(length, 1.5);
  return `<path d="M${x0} ${y}h${num(w - 2)}a2 2 0 0 1 2 2v${height - 4}a2 2 0 0 1 -2 2h-${num(w - 2)}z" fill="${color}"/>`;
}

function whisker(t, x0, width, max, y, lo, hi) {
  const a = num(x0 + (lo / max) * width);
  const b = num(x0 + (hi / max) * width);
  return `<path d="M${a} ${y - 3}v6M${a} ${y}H${b}M${b} ${y - 3}v6" stroke="${t.whisker}" stroke-width="1.2" fill="none" opacity="0.85"/>`;
}

// ---------------------------------------------------------------------------------------------
// The charts
// ---------------------------------------------------------------------------------------------

function judgeChart(theme) {
  const groups = judgeRows();
  const all = groups.flatMap((g) => g.rows);
  const count = (standing) => all.filter((r) => r.standing === standing).length;
  const title = `On ${all.length} held-out tests against four frameworks' default judges, the shipped judge is clearly ahead on ${count('lead')}, clearly behind on ${count('deficit')}, and within error on ${count('close')}.`;
  const labelWidth = 150;
  const x0 = PAD + labelWidth;
  const width = 200;
  const mark = { lead: 'ahead', deficit: 'behind', close: '' };
  return {
    title,
    svg: canvas(
      theme,
      {
        title,
        key: [
          { color: 'ours', label: 'driftbench, shipped judge' },
          { color: 'other', label: "the other tool's default" },
        ],
        caption: [
          'Correct verdicts on held-out cases with fixed labels, one judge model for both sides (Claude Haiku 5.5). Whiskers: 95% Wilson interval. Ahead or behind means the two intervals do not overlap.',
          'Goal success and task completion give both judges the same evidence; with default inputs the other tools score 36 and 44 of 72.',
          'Sources: comparisons/{deepeval,promptfoo,langfuse,inspect}/hard. Redraw: node tools/readme-charts.mjs',
        ],
        describe: all
          .map((r) => `${r.label}: driftbench ${r.ours} of ${r.n}, other ${r.theirs} of ${r.n}.`)
          .join(' '),
      },
      (t, top) => {
        const out = [];
        let y = top;
        const plotTop = y;
        const body = [];
        for (const group of groups) {
          y += 22;
          body.push(
            `<text x="${PAD}" y="${y}" font-family="${MONO}" font-size="11" font-weight="500" letter-spacing="0.6" fill="${t.ink3}">${esc(group.header.toUpperCase())}</text>`,
          );
          y += 8;
          for (const r of group.rows) {
            body.push(
              `<text x="${PAD}" y="${y + 15}" font-family="${SANS}" font-size="13.5" fill="${t.ink}">${esc(r.label)}</text>`,
            );
            body.push(bar(x0, y + 2, (r.ours / r.n) * width, 9, t.ours));
            body.push(whisker(t, x0, width, 100, y + 6.5, r.oursCi[0], r.oursCi[1]));
            body.push(bar(x0, y + 13, (r.theirs / r.n) * width, 9, t.other));
            body.push(whisker(t, x0, width, 100, y + 17.5, r.theirsCi[0], r.theirsCi[1]));
            const tx = x0 + width + 10;
            body.push(
              `<text x="${tx}" y="${y + 15}" font-family="${SANS}" font-size="13" font-weight="600" fill="${t.ink}">${r.ours} <tspan fill="${t.ink3}" font-weight="500">v</tspan> ${r.theirs}</text>`,
            );
            if (mark[r.standing]) {
              const color = r.standing === 'lead' ? t.ours : t.ink;
              body.push(
                `<text x="${W - PAD}" y="${y + 15}" text-anchor="end" font-family="${SANS}" font-size="12" font-weight="600" fill="${color}">${mark[r.standing]}</text>`,
              );
            }
            y += 30;
          }
        }
        out.push(grid(t, x0, width, plotTop + 8, y, 100, [50, 100]));
        out.push(body.join('\n'));
        const a = axis(
          t,
          x0,
          width,
          y + 4,
          100,
          [0, 50, 100],
          'correct verdicts, % of cases',
          (v) => `${v}%`,
        );
        out.push(a.svg);
        return { svg: out.join('\n'), y: a.y };
      },
    ),
  };
}

function costChart(theme) {
  const rows = costRows();
  const cheaper = rows.filter((r) => r.ours < r.theirs).length;
  const title = `The shipped judge costs less per 100 cases on ${cheaper} of ${rows.length} measured rows.`;
  const max = 0.15;
  const x0 = PAD;
  const width = W - PAD * 2 - 70;
  const money = (v) => `$${v.toFixed(3)}`;
  return {
    title,
    svg: canvas(
      theme,
      {
        title,
        key: [
          { color: 'ours', label: 'driftbench, shipped judge' },
          { color: 'other', label: "the other tool's default" },
        ],
        caption: [
          'Recorded model spend per 100 held-out cases, Claude Haiku 5.5 on both sides, one run. Cost is not accuracy: on three Inspect rows the cheaper judge is also the less accurate one (chart above).',
          'Sources: comparisons/inspect/hard/summary.json, comparisons/langfuse/hard/pr115-scores.json, heldout-scores.json.',
        ],
        describe: rows
          .map((r) => `${r.label}: driftbench ${money(r.ours)}, other ${money(r.theirs)}.`)
          .join(' '),
      },
      (t, top) => {
        const body = [];
        let y = top + 4;
        const plotTop = y;
        for (const r of rows) {
          y += 18;
          body.push(
            `<text x="${PAD}" y="${y}" font-family="${SANS}" font-size="13.5" fill="${t.ink}">${esc(r.label)}</text>`,
          );
          y += 7;
          for (const [value, color, weight] of [
            [r.ours, t.ours, 600],
            [r.theirs, t.other, 500],
          ]) {
            const length = (value / max) * width;
            body.push(bar(x0, y, length, 11, color));
            body.push(
              `<text x="${num(x0 + length + 7)}" y="${y + 10}" font-family="${SANS}" font-size="12.5" font-weight="${weight}" fill="${t.ink}">${money(value)}</text>`,
            );
            y += 14;
          }
          y += 6;
        }
        const ticks = [0, 0.05, 0.1, 0.15];
        const a = axis(
          t,
          x0,
          width,
          y + 2,
          max,
          ticks,
          'US dollars per 100 judged cases',
          (v) => `$${v.toFixed(2)}`,
        );
        return {
          svg: [grid(t, x0, width, plotTop, y, max, ticks), body.join('\n'), a.svg].join('\n'),
          y: a.y,
        };
      },
    ),
  };
}

function mmEvalChart(theme) {
  const { cohort, subsets } = mmEval();
  const two = (v) => v.toFixed(2);
  const title = `On MM-Eval's sealed test set, asking a panel only when the first judge is unsure lifts accuracy from ${two(cohort.base)} to ${two(cohort.cascade)}.`;
  const labelWidth = 150;
  const x0 = PAD + labelWidth;
  const width = 215;
  const rows = [
    { name: 'All five subsets, mean', n: cohort.n, base: cohort.base, cascade: cohort.cascade, strong: true },
    ...subsets,
  ];
  const pretty = (name) => name.charAt(0).toUpperCase() + name.slice(1);
  return {
    title,
    svg: canvas(
      theme,
      {
        title,
        key: [
          { color: 'ours', label: 'first judge, then a panel if unsure' },
          { color: 'other', label: 'first judge alone' },
        ],
        caption: [
          `Paired gain ${two(cohort.difference)} points, 95% interval ${two(cohort.paired95[0])} to ${two(cohort.paired95[1])} (paired bootstrap). ${cohort.n.toLocaleString('en-US')} items sealed before the first call, scored once. ${cohort.wins} items won, ${cohort.losses} lost. Both bars are driftbench; no other tool is run here.`,
          'First judge Claude Haiku 5.5; panel of three other model families. Source: docs/assets/data/mm-eval-sealed-test.json, a copy of the research result (provenance in docs/assets/data/README.md).',
        ],
        describe: rows
          .map((r) => `${r.name}: alone ${two(r.base)}, with panel ${two(r.cascade)}, ${r.n} items.`)
          .join(' '),
      },
      (t, top) => {
        const body = [];
        let y = top + 6;
        const plotTop = y;
        for (const r of rows) {
          body.push(
            `<text x="${PAD}" y="${y + 11}" font-family="${SANS}" font-size="13.5" font-weight="${r.strong ? 600 : 400}" fill="${t.ink}">${esc(pretty(r.name))}</text>`,
          );
          body.push(
            `<text x="${PAD}" y="${y + 25}" font-family="${SANS}" font-size="11.5" fill="${t.ink3}">${r.n.toLocaleString('en-US')} items</text>`,
          );
          body.push(bar(x0, y, (r.cascade / 100) * width, 12, t.ours));
          body.push(
            `<text x="${num(x0 + (r.cascade / 100) * width + 7)}" y="${y + 10.5}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="${t.ink}">${two(r.cascade)}</text>`,
          );
          body.push(bar(x0, y + 15, (r.base / 100) * width, 12, t.other));
          body.push(
            `<text x="${num(x0 + (r.base / 100) * width + 7)}" y="${y + 25.5}" font-family="${SANS}" font-size="12.5" fill="${t.ink2}">${two(r.base)}</text>`,
          );
          y += r.strong ? 46 : 38;
        }
        const ticks = [0, 25, 50, 75, 100];
        const a = axis(t, x0, width, y, 100, ticks, 'accuracy, the benchmark’s own score', (v) => v);
        return {
          svg: [grid(t, x0, width, plotTop, y, 100, ticks), body.join('\n'), a.svg].join('\n'),
          y: a.y,
        };
      },
    ),
  };
}

function budgetChart(theme) {
  const rows = budgetRows();
  const at = (budget, method) => rows.find((r) => r.budget === budget && r.method === method);
  const trim = (r) => (Number.isInteger(r.mean) ? String(r.mean) : r.meanText);
  const title = `With a budget of 20 tests, driftbench's selector catches ${trim(at(20, 'hybrid'))} of 13 planted faults; pairwise covering catches ${trim(at(20, 'pairwise'))} and random sampling ${trim(at(20, 'random'))}.`;
  const names = { hybrid: 'driftbench selector', pairwise: 'pairwise covering', random: 'random sampling' };
  const colors = { hybrid: 'ours', pairwise: 'other', random: 'otherSoft' };
  const x0 = PAD + 96;
  const width = 250;
  const max = 13;
  return {
    title,
    svg: canvas(
      theme,
      {
        title,
        key: [],
        caption: [
          'Mean over 30 seeds on the fictional Acme agent with 13 scripted faults; whiskers: 95% interval of the seed mean. From 50 tests up the three methods tie. The 4 faults no method reaches here need task specs, which the full generator adds.',
          'No model call. Source: comparisons/budget/full-study.md. Rerun: pnpm exec tsx comparisons/budget/full-control.ts',
        ],
        describe: rows.map((r) => `Budget ${r.budget}, ${names[r.method]}: ${r.meanText} of 13.`).join(' '),
      },
      (t, top) => {
        const body = [];
        let y = top;
        const plotTop = y;
        for (const budget of [20, 50, 100, 200]) {
          const group = ['hybrid', 'pairwise', 'random']
            .map((method) => at(budget, method))
            .sort((a, b) => b.mean - a.mean || (a.method === 'hybrid' ? -1 : 1));
          body.push(
            `<text x="${PAD}" y="${y + 24}" font-family="${SANS}" font-size="13.5" font-weight="600" fill="${t.ink}">${budget} tests</text>`,
          );
          for (const r of group) {
            const length = (r.mean / max) * width;
            body.push(bar(x0, y + 4, length, 12, t[colors[r.method]]));
            if (r.hi > r.lo) body.push(whisker(t, x0, width, max, y + 10, r.lo, r.hi));
            const label = budget === 20 ? `${trim(r)}  ${names[r.method]}` : trim(r);
            const tx = num(x0 + (Math.max(r.mean, r.hi) / max) * width + 8);
            body.push(
              `<text x="${tx}" y="${y + 14.5}" font-family="${SANS}" font-size="12.5" font-weight="${r.method === 'hybrid' ? 600 : 400}" fill="${t.ink}">${esc(label)}</text>`,
            );
            y += 15;
          }
          y += 14;
        }
        const ticks = [0, 4, 8, 13];
        const a = axis(t, x0, width, y, max, ticks, 'planted faults caught, of 13', (v) => v);
        return {
          svg: [grid(t, x0, width, plotTop, y, max, ticks), body.join('\n'), a.svg].join('\n'),
          y: a.y,
        };
      },
    ),
  };
}

function banksChart(theme) {
  const rows = banks();
  const total = rows.reduce((sum, r) => sum + r.items, 0);
  const held = rows.filter((r) => r.floor).length;
  const title = `driftbench tests itself on ${total.toLocaleString('en-US')} planted-truth items in ${rows.length} suites; ${held} suites have a floor that CI refuses to go below.`;
  const names = {
    system: 'Whole pipeline',
    generator: 'Test generator',
    estate: 'Code-agent estates',
    stats: 'Statistics',
    judges: 'Judges',
    map: 'Map extraction',
  };
  const x0 = PAD + 138;
  const width = 150;
  const max = 2500;
  return {
    title,
    svg: canvas(
      theme,
      {
        title,
        key: [],
        caption: [
          'A planted-truth item is a case built by code with a known answer: a fault, a recovery or an effect put in at a known place. Bars: items in each suite. A suite runs as a ladder of levels, cheapest check first; a floor is the level every seed must reach in CI, for the ladder version named. No pass rate is quoted until a suite passes its independent audit; the open gaps are listed in each GATE.md.',
          'Sources: validators/*/GATE.md, validators/system/HANDOVER.md, validators/floors.json.',
        ],
        describe: rows
          .map(
            (r) =>
              `${names[r.id]}: ${r.items} items${r.floor ? `, floor level ${r.floor}` : ', no floor yet'}.`,
          )
          .join(' '),
      },
      (t, top) => {
        const body = [];
        let y = top + 4;
        const plotTop = y;
        for (const r of rows) {
          const length = (r.items / max) * width;
          body.push(
            `<text x="${PAD}" y="${y + 13}" font-family="${SANS}" font-size="13.5" fill="${t.ink}">${esc(names[r.id])}</text>`,
          );
          body.push(bar(x0, y + 1, length, 15, r.floor ? t.ours : t.other));
          body.push(
            `<text x="${num(x0 + length + 7)}" y="${y + 13}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="${t.ink}">${r.items.toLocaleString('en-US')}<tspan font-weight="400" fill="${t.ink2}">${r.floor ? `  floor: level ${r.floor}, ladder v${r.ladderVersion}` : '  no floor yet'}</tspan></text>`,
          );
          y += 28;
        }
        const ticks = [0, 1000, 2000];
        const a = axis(t, x0, width, y, max, ticks, 'planted-truth items in the suite', (v) =>
          v.toLocaleString('en-US'),
        );
        return {
          svg: [grid(t, x0, width, plotTop, y, max, ticks), body.join('\n'), a.svg].join('\n'),
          y: a.y,
        };
      },
    ),
  };
}

function matrixChart(theme) {
  const { rows, capabilities } = matrix();
  const best = rows[0];
  const title = `Of ${capabilities} evaluation capabilities, the most any of seven other tools documents in full is ${best.yes}. driftbench ships all ${capabilities}, each with a test.`;
  const x0 = PAD + 92;
  const width = W - PAD - x0 - 6;
  const unit = width / capabilities;
  return {
    title,
    svg: canvas(
      theme,
      {
        title,
        key: [
          { color: 'ink2', label: 'in full' },
          { color: 'other', label: 'in part' },
          { color: 'otherSoft', label: 'not found' },
        ],
        caption: [
          `What each tool's public docs or source show, read on 2026-10-11, one cited page per cell. "Not found" means the page where it would be documented does not show it; it is not proof the tool lacks it.`,
          'Source: docs/comparison.md, 30 rows by 8 tools, every driftbench cell with the test that proves it.',
        ],
        describe: rows
          .map((r) => `${r.tool}: ${r.yes} in full, ${r.partial} in part, ${r.none} not found.`)
          .join(' '),
      },
      (t, top) => {
        const body = [];
        let y = top + 4;
        const line = (name, segments, strong) => {
          body.push(
            `<text x="${PAD}" y="${y + 14}" font-family="${SANS}" font-size="13.5" font-weight="${strong ? 600 : 400}" fill="${t.ink}">${esc(name)}</text>`,
          );
          let x = x0;
          for (const [value, fill, ink] of segments) {
            if (!value) continue;
            const w = value * unit;
            body.push(
              `<rect x="${num(x)}" y="${y}" width="${num(w - 1.5)}" height="19" rx="2" fill="${fill}"/>`,
            );
            if (w > 16)
              body.push(
                `<text x="${num(x + (w - 1.5) / 2)}" y="${y + 13.5}" text-anchor="middle" font-family="${SANS}" font-size="12" font-weight="600" fill="${ink}">${value}</text>`,
              );
            x += w;
          }
          y += 29;
        };
        const onDark = theme === 'dark' ? '#0E1218' : '#FFFFFF';
        line('driftbench', [[capabilities, t.ours, '#FFFFFF']], true);
        for (const r of rows)
          line(
            r.tool,
            [
              [r.yes, t.ink2, onDark],
              [r.partial, t.other, t.ink],
              [r.none, t.otherSoft, t.ink2],
            ],
            false,
          );
        const a = axis(t, x0, width, y, capabilities, [0, 10, 20, 30], 'capabilities, of 30', (v) => v);
        return { svg: [body.join('\n'), a.svg].join('\n'), y: a.y };
      },
    ),
  };
}

/** The flow, as boxes: from a map and a spec to a verdict. Not a chart: it holds no measured number. */
function flowDiagram(theme) {
  const t = THEMES[theme];
  const steps = [
    ['1', 'Map', 'What the agent can face:', 'stages, values, tools, rules.', 'A person approves it.'],
    ['2', 'Tests', 'Code writes blocks from', 'the map. A gate rejects', 'tests that cannot fail.'],
    ['3', 'Run', 'One adapter reaches your', 'agent. Three run modes,', 'repeats, record and replay.'],
    ['4', 'Checks', '29 machine checks read', 'the reply, the tool calls,', 'the files. A fail is final.'],
    ['5', 'Judges', 'A model judges the rest,', 'quoting its evidence. A', 'panel votes when unsure.'],
    ['6', 'Statistics', 'An interval on every rate,', 'the noise floor, paired', 'tests between two runs.'],
    ['7', 'Verdict', 'A scorecard, and an exit', 'code CI can gate on:', 'parity or regression.'],
  ];
  const columns = 2;
  const boxW = (W - PAD * 2 - 16) / columns;
  const boxH = 96;
  const lastH = 62;
  const out = [];
  let y0 = PAD + 4;
  const title = 'From a map of situations to a verdict a pull request can gate on';
  out.push(
    `<text x="${PAD}" y="${y0 + 19}" font-family="${SERIF}" font-size="19" fill="${t.ink}" letter-spacing="-0.2">From a map to a verdict.</text>`,
  );
  y0 += 38;
  steps.forEach((step, index) => {
    const column = index % columns;
    const rowIndex = Math.floor(index / columns);
    const last = index === steps.length - 1;
    const x = last ? PAD : PAD + column * (boxW + 16);
    const w = last ? W - PAD * 2 : boxW;
    const y = y0 + rowIndex * (boxH + 14);
    const strong = last;
    out.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${last ? lastH : boxH}" rx="10" fill="${t.card}" stroke="${strong ? t.ours : t.line}" stroke-width="${strong ? 1.5 : 1}"/>`,
    );
    out.push(
      `<text x="${x + 14}" y="${y + 24}" font-family="${MONO}" font-size="11" font-weight="500" fill="${t.ink3}">${step[0]}</text>`,
    );
    out.push(
      `<text x="${x + 30}" y="${y + 25}" font-family="${SANS}" font-size="15" font-weight="600" fill="${t.ink}">${esc(step[1])}</text>`,
    );
    const lines = last ? [step.slice(2).join(' ')] : step.slice(2);
    lines.forEach((text, lineIndex) => {
      out.push(
        `<text x="${x + 14}" y="${y + 46 + lineIndex * 16.5}" font-family="${SANS}" font-size="12.5" fill="${t.ink2}">${esc(text)}</text>`,
      );
    });
    if (!last && column === 1) {
      const ax = x + w / 2 - boxW / 2 - 8;
      const ay = y + boxH + 2;
      out.push(
        `<path d="M${ax} ${ay}v9M${ax - 3.5} ${ay + 6}l3.5 4l3.5 -4" stroke="${t.ink3}" stroke-width="1.3" fill="none"/>`,
      );
    }
    if (!last && column === 0) {
      const ax = x + w + 2;
      const ay = y + boxH / 2;
      out.push(
        `<path d="M${ax} ${ay}h9M${ax + 6} ${ay - 3.5}l4 3.5l-4 3.5" stroke="${t.ink3}" stroke-width="1.3" fill="none"/>`,
      );
    }
  });
  const rowsCount = Math.ceil(steps.length / columns);
  const height = y0 + (rowsCount - 1) * (boxH + 14) + lastH + PAD;
  return {
    title,
    svg: [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-label="${esc(title)}">`,
      `<title>${esc(title)}</title>`,
      `<desc>${esc(steps.map((s) => `${s[0]}. ${s[1]}: ${s.slice(2).join(' ')}`).join(' '))}</desc>`,
      `<rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="14" fill="${t.page}" stroke="${t.line}"/>`,
      ...out,
      '</svg>',
      '',
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------------------------

const CHARTS = {
  'judge-heldout': judgeChart,
  'judge-cost': costChart,
  'mm-eval-sealed-test': mmEvalChart,
  'testgen-budget': budgetChart,
  'self-tests': banksChart,
  'capability-matrix': matrixChart,
  'how-it-works': flowDiagram,
};

const files = new Map();
const titles = {};
for (const [name, draw] of Object.entries(CHARTS)) {
  const light = draw('light');
  const kept = facts.length;
  const dark = draw('dark');
  facts.length = kept; // the dark pass reads the same numbers again
  files.set(`${name}-light.svg`, light.svg);
  files.set(`${name}-dark.svg`, dark.svg);
  titles[name] = light.title;
}
const cell = (value) => `"${String(typeof value === 'string' ? value : JSON.stringify(value)).replace(/"/g, '""')}"`;
const table = [['chart', 'what', 'value', 'source']];
for (const [name, title] of Object.entries(titles)) table.push([name, 'title', title, 'tools/readme-charts.mjs']);
for (const f of facts) table.push([f.chart, f.what, f.value, f.source]);
files.set(join('data', 'chart-facts.csv'), `${table.map((row) => row.map(cell).join(',')).join('\n')}\n`);

let stale = 0;
for (const [name, content] of files) {
  const path = join(OUT, name);
  if (CHECK) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      console.error(`stale: docs/assets/${name}`);
      stale += 1;
    }
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote docs/assets/${name}`);
}
if (CHECK) {
  console.log(
    stale
      ? `${stale} file(s) differ: run node tools/readme-charts.mjs`
      : `${files.size} files match their sources.`,
  );
  process.exit(stale ? 1 : 0);
}
