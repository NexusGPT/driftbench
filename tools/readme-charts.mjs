#!/usr/bin/env node
/**
 * Reads the README chart numbers from the result files of this repository.
 *
 * Usage:  node tools/readme-charts.mjs [--check]
 *   no flag   write .github/readme/src/chart-data.js (read by .github/readme/src/chart.html, which
 *             .github/readme/render.mjs renders in light and dark) and docs/assets/data/chart-facts.csv
 *   --check   compute in memory and exit 1 when a committed file differs
 *
 * Every number comes from a file named in SOURCES below. Nothing is typed in by hand: a missing file,
 * a table that no longer parses, or an interval that disagrees with its source stops the script.
 * Plain Node, no dependency.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'assets');
const CHECK = process.argv.includes('--check');
const PRINT = process.argv.includes('--print')
  ? process.argv[process.argv.indexOf('--print') + 1]
  : undefined;

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

const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
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

function judgeRows(chart = 'judge-heldout') {
  const groups = [];
  const row = (label, n, ours, theirs, source, stored) => {
    const oursCi = wilson(ours, n);
    const theirsCi = wilson(theirs, n);
    if (stored?.ours) sameInterval(oursCi, stored.ours, `${source} ${label} ours`);
    if (stored?.theirs) sameInterval(theirsCi, stored.theirs, `${source} ${label} theirs`);
    const standing = oursCi[0] > theirsCi[1] ? 'lead' : oursCi[1] < theirsCi[0] ? 'deficit' : 'close';
    fact(
      chart,
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
// The chart data the figure pages draw
// ---------------------------------------------------------------------------------------------

const pct = (right, n) => (right / n) * 100;
const round = (v) => Number(v.toFixed(2));
const pair = (r) => ({
  label: r.label,
  a: round(pct(r.ours, r.n)),
  b: round(pct(r.theirs, r.n)),
  aText: String(r.ours),
  bText: String(r.theirs),
  aCi: r.oursCi.map(round),
  bCi: r.theirsCi.map(round),
  tag: r.standing === 'lead' ? 'ahead' : r.standing === 'deficit' ? 'behind' : '',
});

function judgeData(leadsOnly) {
  const every = judgeRows(leadsOnly ? 'judge-leads' : 'judge-heldout');
  const total = every.flatMap((g) => g.rows).length;
  const groups = leadsOnly
    ? every
        .map((g) => ({ ...g, rows: g.rows.filter((r) => r.standing === 'lead') }))
        .filter((g) => g.rows.length)
    : every;
  const all = groups.flatMap((g) => g.rows);
  const count = (standing) => all.filter((r) => r.standing === standing).length;
  return {
    kind: 'pairs',
    kicker: 'Judge accuracy · held-out cases · Claude Haiku 5.5 on both sides',
    title: leadsOnly
      ? `${all.length} clear wins over the default judges.`
      : `${total} judge tests: ${count('lead')} ahead, ${count('deficit')} behind, ${count('close')} level.`,
    key: ['driftbench, shipped judge', "the other tool's default"],
    min: 0,
    max: 100,
    ticks: [0, 25, 50, 75, 100],
    tick: '',
    axis: 'score out of 100: correct verdicts, % of cases',
    groups: groups.map((g) => ({ header: g.header, rows: g.rows.map(pair) })),
    note: leadsOnly
      ? '72 cases per row · lines: 95% interval'
      : '60 to 120 cases per row · lines: 95% interval',
  };
}

function costData() {
  const rows = costRows();
  return {
    kind: 'pairs',
    kicker: 'Judge cost · US dollars per 100 cases · Claude Haiku 5.5',
    title: `Cheaper on ${rows.filter((r) => r.ours < r.theirs).length} of ${rows.length} rows.`,
    key: ['driftbench, shipped judge', "the other tool's default"],
    min: 0,
    max: 0.15,
    ticks: [0, 0.05, 0.1, 0.15],
    tick: '$',
    axis: 'US dollars per 100 judged cases',
    groups: [
      {
        header: '',
        rows: rows.map((r) => ({
          label: r.label,
          a: r.ours,
          b: r.theirs,
          aText: `$${r.ours.toFixed(3)}`,
          bText: `$${r.theirs.toFixed(3)}`,
        })),
      },
    ],
    note: '60 to 120 cases per row · recorded spend',
  };
}

function mmData() {
  const { cohort, subsets } = mmEval();
  const pretty = (name) => name.charAt(0).toUpperCase() + name.slice(1);
  const rows = [
    { name: 'All five subsets', n: cohort.n, base: cohort.base, cascade: cohort.cascade },
    ...subsets,
  ].map((r) => ({
    label: pretty(r.name),
    sub: `${r.n.toLocaleString('en-US')} items`,
    a: round(r.cascade),
    b: round(r.base),
    aText: r.cascade.toFixed(2),
    bText: r.base.toFixed(2),
    tag: `+${(r.cascade - r.base).toFixed(2)}`,
  }));
  return {
    kind: 'pairs',
    kicker: `MM-Eval · sealed test set · ${cohort.n.toLocaleString('en-US')} items, scored once`,
    title: `A panel when unsure: ${cohort.base.toFixed(2)} to ${cohort.cascade.toFixed(2)}.`,
    key: ['first judge, then a panel if unsure', 'first judge alone'],
    min: 70,
    max: 100,
    ticks: [70, 80, 90, 100],
    tick: '',
    axis: "accuracy, the benchmark's own score (axis starts at 70)",
    groups: [{ header: '', rows }],
    note: `${cohort.n.toLocaleString('en-US')} items · gain ${cohort.difference.toFixed(2)} points, 95% interval ${cohort.paired95[0].toFixed(2)} to ${cohort.paired95[1].toFixed(2)}`,
  };
}

function budgetData() {
  const rows = budgetRows();
  const at = (budget, method) => rows.find((r) => r.budget === budget && r.method === method);
  const text = (r) => (Number.isInteger(r.mean) ? String(r.mean) : r.meanText);
  return {
    kind: 'triples',
    kicker: 'Test generation · fictional Acme agent · 13 planted faults · 30 seeds',
    title: `20 tests find ${text(at(20, 'hybrid'))} of 13 planted faults.`,
    key: ['driftbench selector', 'pairwise covering', 'random sampling'],
    min: 7,
    max: 10,
    ticks: [7, 8, 9, 10],
    tick: '',
    axis: 'planted faults caught, of 13 (axis starts at 7)',
    groups: [20, 50, 100, 200].map((budget) => ({
      label: `${budget} tests`,
      bars: ['hybrid', 'pairwise', 'random'].map((method) => {
        const r = at(budget, method);
        return {
          series: method === 'hybrid' ? 0 : method === 'pairwise' ? 1 : 2,
          value: r.mean,
          text: text(r),
          ci: r.hi > r.lo ? [r.lo, r.hi] : null,
        };
      }),
    })),
    note: 'Mean over 30 seeds · lines: 95% interval · no model call',
  };
}

function banksData() {
  const rows = banks();
  const names = {
    system: 'Whole pipeline',
    generator: 'Test generator',
    estate: 'Code-agent estates',
    stats: 'Statistics',
    judges: 'Judges',
    map: 'Map extraction',
  };
  const total = rows.reduce((sum, r) => sum + r.items, 0);
  return {
    kind: 'single',
    kicker: 'Self-tests · cases built by code with a known answer',
    title: `${total.toLocaleString('en-US')} planted-truth cases test driftbench itself.`,
    key: ['holds a floor in CI', 'no floor yet'],
    min: 0,
    max: 2500,
    ticks: [0, 1000, 2000],
    tick: ',',
    axis: 'planted-truth cases in the suite',
    rows: rows.map((r) => ({
      label: names[r.id],
      value: r.items,
      text: r.items.toLocaleString('en-US'),
      series: r.floor ? 0 : 1,
      sub: r.floor ? `floor: level ${r.floor}` : 'no floor yet',
    })),
    note: 'Floor: the level CI refuses to go below',
  };
}

function matrixData() {
  const { rows, capabilities } = matrix();
  return {
    kind: 'stacked',
    kicker: `Capabilities · ${capabilities} rows · 8 tools`,
    title: `All ${capabilities}. The next best: ${rows[0].yes} in full.`,
    key: ['in full', 'in part', 'not found'],
    min: 0,
    max: capabilities,
    ticks: [0, 10, 20, 30],
    tick: '',
    axis: `capabilities, of ${capabilities}`,
    rows: [
      { label: 'driftbench', parts: [capabilities, 0, 0], ours: true },
      ...rows.map((r) => ({ label: r.tool, parts: [r.yes, r.partial, r.none] })),
    ],
    note: "Read from each tool's docs and source",
  };
}

// ---------------------------------------------------------------------------------------------
// One chart per public benchmark: one panel per model, in each panel driftbench beside every
// competitor with a recorded result, highest to lowest, score out of 100. A result that was not
// run is drawn as an empty bar labelled "not run"; nothing is estimated.
// ---------------------------------------------------------------------------------------------

const SEALED = 'docs/assets/data/sealed';
// A published frozen-default set replaces all five primary sources together. Tests can use
// an isolated directory, including a missing directory to exercise the historical branch.
const DEFAULT_RESULTS = process.env.DRIFTBENCH_DEFAULT_RESULTS_DIR ?? 'docs/assets/data/default-on-v6';
const DEFAULT_FILES = [
  'judgebench.json',
  'mm-eval.json',
  'rubricbench-haiku.json',
  'verify.json',
  'writing.json',
];
const HAS_DEFAULT = existsSync(resolve(ROOT, DEFAULT_RESULTS));
if (HAS_DEFAULT) {
  for (const name of DEFAULT_FILES) {
    const file = join(DEFAULT_RESULTS, name);
    if (!existsSync(resolve(ROOT, file))) {
      throw new Error(`incomplete default result set: missing ${name}`);
    }
    const { metadata } = json(file);
    if (metadata?.policy !== 'default-on-v6' || metadata?.model !== 'claude-haiku-5-5') {
      throw new Error(`${file}: expected default-on-v6 on claude-haiku-5-5`);
    }
  }
}
const primaryFile = (name) => join(HAS_DEFAULT ? DEFAULT_RESULTS : SEALED, name);
const measuredModel = (model) => !HAS_DEFAULT || model === 'claude-haiku-5-5';

// The models of the benchmark runs, in the order of the README. Gemini 3.8 Flash is not charted.
const MODELS = ['claude-haiku-5-5', 'gpt-6-luna', 'gemini-3.5-flash-lite'];
const MODEL = {
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  haiku: 'Claude Haiku 5.5',
  'gpt-6-luna': 'GPT-6 Luna',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
};
// Some result files name Claude Haiku 5.5 "haiku".
const FILE_MODEL = { 'claude-haiku-5-5': 'haiku' };
const inFile = (model) => FILE_MODEL[model] ?? model;
const PROMPTFOO = 'promptfoo';
const bar = (name, score, extra = {}) => ({ name, score: score === null ? null : round(score), ...extra });

/** One panel of a ranked chart: a model, the size of its set, and its bars. `sizes` is "n pairs" or null. */
function modelPanel(chart, model, size, bars, source) {
  for (const b of bars) {
    fact(chart, `${MODEL[model]}: ${b.name}, percent`, b.score === null ? 'not run' : b.score, source);
  }
  return { name: MODEL[model], model: size ?? 'not run', bars };
}

/** Panels from the best score down; a panel with nothing run goes last. */
const orderPanels = (panels) => [...panels].sort((a, b) => best(b) - best(a));
const best = (panel) => Math.max(-1, ...panel.bars.map((b) => b.score ?? -1));

/** "higher with 2, lower with 1 of 3 models": driftbench against the named competitor, panels where both ran. */
function versus(panels, competitor) {
  const pairs = panels
    .map((p) => [p.bars.find((b) => b.ours), p.bars.find((b) => b.name === competitor)])
    .filter(([a, b]) => a && b && a.score !== null && b.score !== null);
  // compared as drawn, to one decimal: two bars that read 80.8 and 80.8 are equal
  const tenth = (v) => Math.round(v * 10);
  const n = (test) => pairs.filter(([a, b]) => test(tenth(a.score), tenth(b.score))).length;
  const parts = [
    [n((a, b) => a > b), 'higher'],
    [n((a, b) => a < b), 'lower'],
    [n((a, b) => a === b), 'equal'],
  ].filter(([count]) => count);
  return `${parts.map(([count, word]) => `${word} with ${count}`).join(', ')} of ${pairs.length} ${pairs.length === 1 ? 'model' : 'models'}`;
}

// The all-competitors run writes docs/comparison/benchmarks/<bench>-all-peers.json for each benchmark it ran.
// Every contestant in such a file, other than driftbench and promptfoo, is drawn as a competitor. The
// folder can be moved with DRIFTBENCH_PEERS_DIR (the test of this script uses a fixture folder).
const PEERS_DIR = resolve(ROOT, process.env.DRIFTBENCH_PEERS_DIR ?? 'docs/comparison/benchmarks');
const OWN = new Set(['driftbench', PROMPTFOO, 'driftbench-reader-first']);
const PEER_NAME = { deepeval: 'DeepEval', inspect: 'Inspect', langfuse: 'Langfuse', langwatch: 'LangWatch' };
const MODEL_IN_PEERS_FILE = { 'claude-haiku-5-5': 'Claude Haiku 5.5' };

/** Adds one bar per recorded competitor to every panel; returns the names drawn. A contestant that is
 *  incomplete in the file, or run on another model, is drawn as "not run" in that panel. */
function addPeers(chart, bench, panels) {
  const path = join(PEERS_DIR, `${bench}-all-peers.json`);
  if (!existsSync(path)) return [];
  const file = JSON.parse(readFileSync(path, 'utf8'));
  const model = MODEL_IN_PEERS_FILE[file.model] ?? file.model;
  const cohort = bench === 'mmeval' ? 'primary' : 'all';
  const shown = path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path;
  const names = [];
  for (const row of file.contestants.filter((c) => !OWN.has(c.contestant))) {
    const name = PEER_NAME[row.contestant] ?? row.contestant;
    // A peer that refused some items is drawn with its score, which counts each refusal as wrong, and the
    // refusal count. Only a peer with no result at all is "not run".
    const refused = row.transportMissing ?? 0;
    const hasResult = row[cohort] !== undefined && (row.present === undefined || row.present > 0);
    names.push(name);
    for (const panel of panels) {
      const drawn = hasResult && panel.name === model;
      const score = drawn ? row[cohort].score * 100 : null;
      panel.bars.push(bar(name, score, drawn && refused > 0 ? { refused } : {}));
      fact(
        chart,
        `${panel.name}: ${name}, percent${drawn && refused > 0 ? ', refused items counted wrong' : ''}`,
        score === null ? 'not run' : drawn && refused > 0 ? [round(score), refused] : round(score),
        shown,
      );
    }
  }
  return names;
}

const ranked = ({ chart, bench, kicker, title, key, panels, note }) => {
  const peers = addPeers(chart, bench, panels);
  const drawn = [PROMPTFOO, ...peers].join(', ');
  const defaultSize = panels.find((panel) => panel.name === 'Claude Haiku 5.5')?.model;
  return {
    kind: 'ranked',
    kicker,
    title,
    key: HAS_DEFAULT
      ? key.map((entry) => (entry.style === 'ours' ? { ...entry, label: 'driftbench default-on-v6' } : entry))
      : key,
    axis: 'score out of 100: correct, % of items',
    panels: orderPanels(panels),
    note: HAS_DEFAULT
      ? `Frozen default-on-v6 on Claude Haiku 5.5: ${defaultSize}. Other default models: not run. Recorded peers (${drawn}): unverified historical (lane report).`
      : `Competitors with a recorded result on this benchmark in this repository: ${drawn}. ${note}`,
  };
};
const notRun = (ours, competitor) => [bar(ours, null, { ours: true }), bar(competitor, null)];

function sealedJudgeBench() {
  const file = primaryFile('judgebench.json');
  const cells = json(file).cells.filter((c) => c.status === 'MEASURED');
  const panels = MODELS.map((model) => {
    const c = measuredModel(model) && cells.find((x) => x.model === model);
    return c
      ? modelPanel(
          'bench-judgebench',
          model,
          `${c.n} pairs`,
          [
            bar('driftbench', pct(c.ledger.correct, c.n), { ours: true }),
            bar(PROMPTFOO, pct(c.promptfoo.correct, c.n)),
          ],
          file,
        )
      : modelPanel('bench-judgebench', model, null, notRun('driftbench', PROMPTFOO), file);
  });
  return ranked({
    chart: 'bench-judgebench',
    bench: 'judgebench',
    kicker: 'JudgeBench · sealed test · same items, same model in each panel',
    title: `JudgeBench: driftbench scores ${versus(panels, PROMPTFOO)}.`,
    key: [
      { label: 'driftbench pair ledger', style: 'ours' },
      { label: 'promptfoo select-best', style: 'other' },
    ],
    panels,
    note: `270 pairs per model.`,
  });
}

function sealedMmEval() {
  const file = primaryFile('mm-eval.json');
  const data = json(file);
  const panels = MODELS.map((model) => {
    const c = measuredModel(model) && data.models[inFile(model)]?.primary;
    // a model whose run covers under 98 percent of the planned items is not charted as a result
    if (!c || c.matched < data.planned * 0.98)
      return modelPanel('bench-mm-eval', model, null, notRun('driftbench', PROMPTFOO), file);
    return modelPanel(
      'bench-mm-eval',
      model,
      `${c.matched} pairs`,
      [bar('driftbench', c.scores.ledger * 100, { ours: true }), bar(PROMPTFOO, c.scores.promptfoo * 100)],
      file,
    );
  });
  return ranked({
    chart: 'bench-mm-eval',
    bench: 'mmeval',
    kicker: "MM-Eval · sealed test · the benchmark's own score",
    title: `MM-Eval: driftbench scores ${versus(panels, PROMPTFOO)}.`,
    key: [
      { label: 'driftbench pair ledger', style: 'ours' },
      { label: 'promptfoo select-best', style: 'other' },
    ],
    panels,
    note: `Up to 600 pairs per model; Claude Haiku 5.5 scores 591, nine safety items missing.`,
  });
}

function sealedRubricBench() {
  const haikuFile = primaryFile('rubricbench-haiku.json');
  const cells = HAS_DEFAULT
    ? {
        'claude-haiku-5-5': [json(haikuFile).cells.find((c) => c.model === 'claude-haiku-5-5'), haikuFile],
        'gpt-6-luna': [null, haikuFile],
        'gemini-3.5-flash-lite': [null, haikuFile],
      }
    : {
        'claude-haiku-5-5': [
          json(`${SEALED}/rubricbench-haiku.json`).cells.find((c) => c.model === 'claude-haiku-5-5'),
          `${SEALED}/rubricbench-haiku.json`,
        ],
        'gpt-6-luna': [
          { model: 'gpt-6-luna', ...json(`${SEALED}/rubricbench-luna.json`), coverage: { complete: true } },
          `${SEALED}/rubricbench-luna.json`,
        ],
        'gemini-3.5-flash-lite': [
          json(`${SEALED}/rubricbench-flash-lite.json`).cells.find(
            (c) => c.model === 'gemini-3.5-flash-lite',
          ),
          `${SEALED}/rubricbench-flash-lite.json`,
        ],
      };
  const panels = MODELS.map((model) => {
    const [c, file] = cells[model];
    if (!c?.coverage?.complete)
      return modelPanel('bench-rubricbench', model, null, notRun('driftbench', PROMPTFOO), file);
    return modelPanel(
      'bench-rubricbench',
      model,
      `${c.stats.pairs} pairs`,
      [
        bar('driftbench', c.stats.ours.estimate * 100, { ours: true }),
        bar(PROMPTFOO, c.stats.peer.estimate * 100),
      ],
      file,
    );
  });
  return ranked({
    chart: 'bench-rubricbench',
    bench: 'rubricbench',
    kicker: 'RubricBench · test split · both orders of every pair',
    title: `RubricBench: driftbench scores ${versus(panels, PROMPTFOO)}.`,
    key: [
      { label: 'driftbench pair ledger', style: 'ours' },
      { label: 'promptfoo select-best', style: 'other' },
    ],
    panels,
    note: `790 pairs per model.`,
  });
}

function sealedVerify() {
  const file = primaryFile('verify.json');
  const data = json(file);
  const fail = data.cheaters.alwaysFailOfficial * 100;
  const panels = MODELS.map((model) => {
    const c = measuredModel(model) && data.cells.find((x) => x.model === inFile(model) && x.official);
    const baseline = bar('always fail', fail, { baseline: true });
    if (!c)
      return modelPanel('bench-verify', model, null, [...notRun('driftbench', PROMPTFOO), baseline], file);
    const [ours, theirs] = c.official.correct;
    const n = c.official.matchedItems;
    return modelPanel(
      'bench-verify',
      model,
      `${n} items`,
      [bar('driftbench', pct(ours, n), { ours: true }), bar(PROMPTFOO, pct(theirs, n)), baseline],
      file,
    );
  });
  return ranked({
    chart: 'bench-verify',
    bench: 'verify',
    kicker: 'LongJudgeBench verify · test split · is the final answer correct',
    title: HAS_DEFAULT
      ? `Verify: driftbench scores ${versus(panels, PROMPTFOO)}.`
      : 'Verify: above promptfoo, below a judge that always says fail.',
    key: [
      { label: 'driftbench verify cascade', style: 'ours' },
      { label: 'promptfoo llm-rubric', style: 'other' },
      { label: 'no model', style: 'baseline' },
    ],
    panels,
    note: `Run with GPT-6 Luna only; the other two models are not run.`,
  });
}

function sealedWriting() {
  const file = primaryFile('writing.json');
  const cells = json(file).cells;
  const longer = cells.find((c) => c.contestant === 'longer-wins');
  const panels = MODELS.map((model) => {
    const key = inFile(model);
    const ours = measuredModel(model) && cells.find((c) => c.model === key && c.contestant === 'pair-ledger');
    const peer = cells.find((c) => c.model === key && c.contestant === 'promptfoo');
    const baseline = bar('longer reply', longer.accuracy, { baseline: true });
    if (ours?.status !== 'complete' || peer?.status !== 'complete') {
      return modelPanel('bench-writing', model, null, [...notRun('driftbench', PROMPTFOO), baseline], file);
    }
    return modelPanel(
      'bench-writing',
      model,
      `${ours.pairs} pairs`,
      [bar('driftbench', ours.accuracy, { ours: true }), bar(PROMPTFOO, peer.accuracy), baseline],
      file,
    );
  });
  return ranked({
    chart: 'bench-writing',
    bench: 'writing',
    kicker: 'LongJudgeBench writing preference · test split · both orders',
    title: HAS_DEFAULT
      ? `Writing: driftbench scores ${versus(panels, PROMPTFOO)}.`
      : `Writing: driftbench scores ${versus(panels, PROMPTFOO)}; picking the longer reply beats both.`,
    key: [
      { label: 'driftbench pair ledger', style: 'ours' },
      { label: 'promptfoo select-best', style: 'other' },
      { label: 'no model', style: 'baseline' },
    ],
    panels,
    note: `173 pairs per model.`,
  });
}

const p1 = (v) => v.toFixed(1);
const columns = (_chart, { kicker, title, key, groups, note, min = 0 }) => ({
  kind: 'columns',
  kicker,
  title,
  key,
  min,
  max: 100,
  ticks: min === 50 ? [50, 60, 70, 80, 90, 100] : [0, 25, 50, 75, 100],
  tick: '%',
  axis: min === 50 ? 'correct, % of items · the axis starts at 50%' : 'score out of 100: correct, % of items',
  groups,
  note,
});

function hardPerTool(tool) {
  const group = judgeRows(`hard-${tool}`).find((g) => g.header.toLowerCase().startsWith(tool));
  // a bar marks where a long label may break under a narrow column
  const breaks = {
    Hallucination: 'Hal|luci|nation',
    Faithfulness: 'Faith|ful|ness',
    'Turn relevancy': 'Turn rel|e|vancy',
    Completeness: 'Com|plete|ness',
    'Role adherence': 'Role ad|her|ence',
    'Task completion': 'Task com|ple|tion',
    'Knowledge retention': 'Knowl|edge re|ten|tion',
  };
  const groups = group.rows.map((r) => ({
    label: breaks[r.label] ?? r.label,
    sub: `of ${r.n}`,
    bars: [
      { series: 0, value: round(pct(r.ours, r.n)), text: String(r.ours) },
      { series: 1, value: round(pct(r.theirs, r.n)), text: String(r.theirs) },
    ],
  }));
  const name = { deepeval: 'DeepEval', promptfoo: 'promptfoo', langfuse: 'Langfuse', inspect: 'Inspect' }[
    tool
  ];
  const ahead = group.rows.filter((r) => r.standing === 'lead').length;
  const behind = group.rows.filter((r) => r.standing === 'deficit').length;
  const level = group.rows.length - ahead - behind;
  const parts = [
    ahead && `ahead on ${ahead}`,
    behind && `behind on ${behind}`,
    level && `level on ${level}`,
  ].filter(Boolean);
  const kicker = `${name} hard cases · held-out · Claude Haiku 5.5 on both sides`;
  if (group.rows.length === 1) {
    const [r] = group.rows;
    return {
      kind: 'hbars',
      kicker,
      title: `${name}: ${r.ours} of ${r.n} correct, against ${r.theirs}.`,
      key: ['driftbench, shipped judge', `${name} default`],
      min: 0,
      max: 100,
      ticks: [0, 25, 50, 75, 100],
      tick: '',
      axis: 'score out of 100: correct, % of cases',
      rows: [
        {
          label: 'driftbench',
          series: 0,
          value: round(pct(r.ours, r.n)),
          text: p1(pct(r.ours, r.n)),
          sub: `${r.ours} of ${r.n}`,
        },
        {
          label: name,
          series: 1,
          value: round(pct(r.theirs, r.n)),
          text: p1(pct(r.theirs, r.n)),
          sub: `${r.theirs} of ${r.n}`,
        },
      ],
      note: `${r.label} · ${r.n} cases`,
    };
  }
  const atLeast = group.rows.filter((r) => r.ours >= r.theirs).length;
  const title =
    ahead || behind
      ? `${name}: ${parts.join(', ')} of ${group.rows.length} tests.`
      : `${name}: equal or higher on ${atLeast} of ${group.rows.length} tests.`;
  return columns(`hard-${tool}`, {
    kicker: `${kicker} · bars labelled with cases correct`,
    title,
    key: ['driftbench, shipped judge', `${name} default`],
    groups,
    note: 'Ahead or behind: the 95% intervals do not overlap',
  });
}

const CHARTS = {
  'judge-leads': () => judgeData(true),
  'judge-cost': costData,
  'mm-eval-sealed-test': mmData,
  'testgen-budget': budgetData,
  'self-tests': banksData,
  'capability-matrix': matrixData,
  'bench-judgebench': sealedJudgeBench,
  'bench-mm-eval': sealedMmEval,
  'bench-rubricbench': sealedRubricBench,
  'bench-verify': sealedVerify,
  'bench-writing': sealedWriting,
  'hard-deepeval': () => hardPerTool('deepeval'),
  'hard-promptfoo': () => hardPerTool('promptfoo'),
  'hard-inspect': () => hardPerTool('inspect'),
  'hard-langfuse': () => hardPerTool('langfuse'),
};

// ---------------------------------------------------------------------------------------------
// Numbers the README quotes in prose, read from files of this repository and listed in chart-facts.csv
// ---------------------------------------------------------------------------------------------

const GATE_REPORT = 'examples/acme/gated/gate-report.json';
const RADIUS_DOC = 'docs/concepts/blast-radius.md';

/** Blocks: how much of a failing conversation a block verdict marks, for each planted fault of the sales assistant. */
function impactBlocks() {
  const report = json(GATE_REPORT);
  // the same set as examples/acme/test/radius/contained.test.ts: accepted blocks of the dev split
  const suite = report.blocks.filter((b) => b.status === 'accepted' && b.split === 'dev');
  const blocksOf = new Map();
  for (const b of suite) {
    const spec = b.key.split('#')[0];
    blocksOf.set(spec, (blocksOf.get(spec) ?? 0) + 1);
  }
  fact('impact-blocks', 'gated suite: conversations, blocks', [blocksOf.size, suite.length], GATE_REPORT);
  const shares = [];
  for (const f of report.mutation.by_fault) {
    if (f.kind === 'control' || f.equivalent || f.target !== 'function:acme-sales') continue;
    const red = suite.filter((b) => b.faults?.[f.id]?.outcome === 'fail');
    const specs = new Set(red.map((b) => b.key.split('#')[0]));
    const inFailing = [...specs].reduce((n, spec) => n + blocksOf.get(spec), 0);
    const share = round((red.length / inFailing) * 100);
    fact(
      'impact-blocks',
      `${f.id}: red blocks, failing conversations, blocks in them, red share percent`,
      [red.length, specs.size, inFailing, share],
      GATE_REPORT,
    );
    shares.push(share);
  }
  const partial = shares.filter((v) => v < 100);
  fact(
    'impact-blocks',
    'faults that leave some blocks green: count of faults, lowest and highest red share percent',
    [partial.length, Math.min(...partial), Math.max(...partial)],
    GATE_REPORT,
  );
}

/** Blast radius: the Acme table of blocks sent, and the containment table, read from the concept page. */
function impactRadius() {
  const text = read(RADIUS_DOC);
  const total = Number(text.match(/holds 195 specs and (\d+) scored blocks/)[1]);
  const measured = text.slice(text.indexOf('## Measured on Acme'), text.indexOf('**No false safe.**'));
  const rows = [
    ...measured.matchAll(
      /^\| ([^|]+) \| `([^`]+)` \| (\d+) \| (\d+) \| (\d+)(?: of (\d+))? \| (\d+) \| ([\d.]+)% \|$/gm,
    ),
  ];
  if (rows.length !== 11) throw new Error(`${RADIUS_DOC}: expected 11 measured rows, found ${rows.length}`);
  fact('impact-radius', 'Acme gated suite, scored blocks', total, RADIUS_DOC);
  for (const r of rows) {
    fact(
      'impact-radius',
      `${r[1]}: blocks sent of ${total}, percent saved`,
      [Number(r[7]), Number(r[8])],
      RADIUS_DOC,
    );
  }
  const contained = text.slice(text.indexOf('**No false safe.**'), text.indexOf('The test can fail.'));
  const faults = [...contained.matchAll(/^\| `([^`]+)` \| `[^`]+` \| (\d+) \| (\d+)\b/gm)];
  const clean = faults.filter((f) => Number(f[3]) === 0).length;
  fact(
    'impact-radius',
    'scored faults, faults with no red block outside the radius',
    [faults.length, clean],
    RADIUS_DOC,
  );
}

const MOJ_REPORT = 'research/moj/results/sealed/report.json';
const MOJ_RESULTS = 'research/moj/RESULTS.md';

/** Mixture of judges: the sealed MM-Eval panel, and the sealed MoJ run against promptfoo. */
function impactMoj() {
  const sent = json(SOURCES.mmEval).fullPanelEscalationsOnly;
  fact(
    'impact-moj',
    'sealed MM-Eval, items sent to the panel, score of the first judge, score after the panel, wins, losses',
    [sent.n, round(sent.base), round(sent.cascade), sent.wins, sent.losses],
    SOURCES.mmEval,
  );
  // The sealed run: JudgeBench is scored with the strict both-order rule, the other two as the benchmark does.
  const report = json(MOJ_REPORT);
  const results = read(MOJ_RESULTS);
  const sealed = results.slice(
    results.indexOf('## Sealed confirmation'),
    results.indexOf('## Pointwise final freeze'),
  );
  const rows = [
    ['judgebench', 'JudgeBench, strict both-order rule', 'moj_strict', 'pf_strict'],
    ['mmeval', 'MM-Eval', 'moj', 'pf'],
    ['writing', 'Writing', 'moj', 'pf'],
  ];
  for (const [key, label, ours, theirs] of rows) {
    const r = report[key];
    const [moj, promptfoo] = [r[ours].acc * 100, r[theirs].acc * 100].map((v) => Number(v.toFixed(1)));
    // the table of RESULTS.md must say what the report says
    const line = sealed.split('\n').find((l) => l.startsWith(`| ${label} (${r.pairs}) |`));
    const cells = line?.split('|').map((c) => c.trim());
    if (!cells || Number.parseFloat(cells[2]) !== moj || Number.parseFloat(cells[3]) !== promptfoo) {
      throw new Error(`${MOJ_RESULTS}: the ${label} row does not match ${MOJ_REPORT}`);
    }
    const calls = Number(r.cost_per_100.moj_s2_calls.toFixed(0));
    fact(
      'impact-moj',
      `sealed ${label}: pairs, MoJ percent, promptfoo percent, MoJ reasoning calls per 100 pairs, promptfoo calls, ratio`,
      [
        r.pairs,
        moj,
        promptfoo,
        calls,
        r.cost_per_100.pf_s2_calls,
        Number((r.cost_per_100.pf_s2_calls / r.cost_per_100.moj_s2_calls).toFixed(1)),
      ],
      MOJ_REPORT,
    );
  }
  fact(
    'impact-moj',
    'sealed writing: rule that picks the longer reply, percent',
    Number((report.writing.length.acc * 100).toFixed(1)),
    MOJ_REPORT,
  );
}

impactBlocks();
impactRadius();
impactMoj();

const data = {};
for (const [name, build] of Object.entries(CHARTS)) {
  data[name] = build();
}
if (PRINT) {
  if (!data[PRINT]) throw new Error(`no chart named ${PRINT}`);
  console.log(JSON.stringify(data[PRINT]));
  process.exit(0);
}
const files = new Map();
files.set(
  join(ROOT, '.github', 'readme', 'src', 'chart-data.js'),
  `// Written by tools/readme-charts.mjs from the result files it names. Do not edit by hand.\nwindow.CHART_DATA = ${JSON.stringify(data, null, 2)};\n`,
);
const cell = (value) =>
  `"${String(typeof value === 'string' ? value : JSON.stringify(value)).replace(/"/g, '""')}"`;
const table = [['chart', 'what', 'value', 'source']];
for (const [name, chart] of Object.entries(data))
  table.push([name, 'title', chart.title, 'tools/readme-charts.mjs']);
for (const f of facts) table.push([f.chart, f.what, f.value, f.source]);
files.set(
  join(OUT, 'data', 'chart-facts.csv'),
  `${table.map((row) => row.map(cell).join(',')).join('\n')}\n`,
);

let stale = 0;
for (const [path, content] of files) {
  const shown = path.slice(ROOT.length + 1);
  if (CHECK) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      console.error(`stale: ${shown}`);
      stale += 1;
    }
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote ${shown}`);
}
if (CHECK) {
  console.log(
    stale
      ? `${stale} file(s) differ: run node tools/readme-charts.mjs`
      : `${files.size} files match their sources.`,
  );
  process.exit(stale ? 1 : 0);
}
