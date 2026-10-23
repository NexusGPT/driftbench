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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarySvg } from './readme-summary.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'assets');
const CHECK = process.argv.includes('--check');
const PRINT = process.argv.includes('--print')
  ? process.argv[process.argv.indexOf('--print') + 1]
  : undefined;

const SOURCES = {
  readmeV7: 'comparisons/default-on/readme-v7/ANALYSIS.json',
  strictV8: 'comparisons/default-on/strict-v8/RESULT.json',
  promptfoo: 'comparisons/promptfoo/hard/recorded/summary.json',
  deepeval: 'comparisons/deepeval/hard/baseline-heldout-scores.json',
  deepevalReceipts: 'comparisons/deepeval/hard/baseline-task-receipts-heldout-scores.json',
  // Fresh held-out rows that replace the 72-case rows of the same name; a row may name an opt-in setting.
  deepevalFresh: 'comparisons/deepeval/lead/fresh-scores.json',
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
  const row = (label, n, ours, theirs, source, stored, setting, paired, record = true) => {
    const oursCi = wilson(ours, n);
    const theirsCi = wilson(theirs, n);
    if (stored?.ours) sameInterval(oursCi, stored.ours, `${source} ${label} ours`);
    if (stored?.theirs) sameInterval(theirsCi, stored.theirs, `${source} ${label} theirs`);
    const standing = paired
      ? paired.adjusted <= 0.05 && ours !== theirs
        ? ours > theirs
          ? 'lead'
          : 'deficit'
        : 'close'
      : oursCi[0] > theirsCi[1]
        ? 'lead'
        : oursCi[1] < theirsCi[0]
          ? 'deficit'
          : 'close';
    if (chart && record)
      fact(
        chart,
        `${label}: driftbench ${ours} of ${n}, other ${theirs} of ${n}, ${standing}`,
        [ours, theirs, n],
        source,
      );
    return {
      label,
      n,
      ours,
      theirs,
      oursCi,
      theirsCi,
      standing,
      ...(setting ? { setting } : {}),
      ...(paired ? { paired } : {}),
    };
  };

  const analysis = json(SOURCES.readmeV7);
  const preregistration = json('comparisons/default-on/readme-v7/PREREGISTRATION.json');
  const current = json(SOURCES.strictV8);
  const receiptsFile = 'comparisons/default-on/strict-v8/receipts.json';
  const receipts = json(receiptsFile);
  const population = json('comparisons/default-on/readme-v7/manifest.json');
  const definition = population.rows.find((r) => r.row === current.row);
  const ids = definition && Object.keys(definition.peerCorrect).sort();
  if (
    current.policy !== 'default-on-v8' ||
    current.model !== 'claude-haiku-5-5' ||
    !definition ||
    definition.dataset !== current.dataset ||
    JSON.stringify(ids) !== JSON.stringify(receipts.map((r) => r.id).sort()) ||
    receipts.some(
      (r) =>
        r.failure !== null || r.settings !== current.settings || !['pass', 'fail'].includes(r.prediction),
    ) ||
    receipts.some((r) => r.correct !== (r.prediction === r.gold)) ||
    receipts.length !== current.n ||
    receipts.filter((r) => r.correct).length !== current.correct ||
    Object.values(definition.peerCorrect).filter(Boolean).length !== current.peer ||
    createHash('sha256').update(read(receiptsFile)).digest('hex') !== current.receiptsSha256
  )
    throw new Error(`${SOURCES.strictV8}: frozen population or complete receipts differ`);
  const wins = receipts.filter((r) => r.correct && !definition.peerCorrect[r.id]).length;
  const losses = receipts.filter((r) => !r.correct && definition.peerCorrect[r.id]).length;
  if (wins !== current.pairedWins || losses !== current.pairedLosses || current.pairedN !== current.n)
    throw new Error(`${SOURCES.strictV8}: paired counts differ from receipts`);
  const freeze = preregistration.amendments.at(-1).runFreeze;
  if (analysis.frozen !== freeze || analysis.rows.length !== preregistration.rows.length)
    throw new Error(`${SOURCES.readmeV7}: run freeze or row population differs from preregistration`);
  const definitions = [
    ['DeepEval 4.2.8, default metrics', 'deepeval'],
    ['promptfoo, default graders, 72 cases each', 'promptfoo-langfuse'],
    ['Langfuse, Correctness template, 120 cases', 'langfuse'],
    ['Inspect 0.3.278, default graders, 60 cases each', 'inspect'],
  ];
  for (const [header, lane] of definitions) {
    groups.push({
      header,
      rows: analysis.rows
        .filter((r) =>
          lane === 'langfuse'
            ? r.row === 'Reference correctness'
            : r.lane === lane && r.row !== 'Reference correctness',
        )
        .map((r) => {
          const registered = preregistration.rows.find((p) => p.row === r.row);
          if (!registered || r.n !== registered.n || r.peer !== registered.recordedPeer)
            throw new Error(`${SOURCES.readmeV7}: ${r.row} differs from preregistered population`);
          const isCurrent = r.row === current.row && r.dataset === current.dataset;
          const built = row(
            r.row === 'G-Eval strict' ? 'G-Eval, strict' : r.row,
            r.n,
            r.v7,
            r.peer,
            SOURCES.readmeV7,
            { ours: r.v7Ci, theirs: r.peerCi },
            r.setting,
            r.pairedHolmP === undefined
              ? undefined
              : { raw: r.pairedP, adjusted: r.pairedHolmP, missing: r.n - r.pairedN },
            !isCurrent,
          );
          if (built.standing !== r.standing)
            throw new Error(`${SOURCES.readmeV7}: ${r.row} standing differs from the README rule`);
          return isCurrent
            ? row(
                built.label,
                current.n,
                current.correct,
                current.peer,
                SOURCES.strictV8,
                { ours: current.oursCi, theirs: current.peerCi },
                'v8 declared request-fulfillment',
                { raw: current.pairedP, adjusted: current.pairedHolmP, missing: 0 },
              )
            : built;
        }),
    });
  }

  for (const group of groups)
    group.rows.sort((a, b) => b.ours / b.n - b.theirs / b.n - (a.ours / a.n - a.theirs / a.n));
  return groups;
}

function costRows(record = true) {
  const rows = [];
  const v7 = json(SOURCES.readmeV7).rows;
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
      ours: v7.find(
        (entry) =>
          entry.row ===
          {
            qa: 'Model-graded QA',
            fact: 'Model-graded fact',
            panel: 'Grader panel',
            borderline: 'Panel, borderline',
          }[r.row],
      ).v7UsdPer100,
      theirs: (held.theirs.costUsd / held.theirs.items) * 100,
      source: `${SOURCES.readmeV7} and ${SOURCES.inspect}`,
    });
  }
  const theirs = json(SOURCES.langfuseTheirs).variants.theirs;
  rows.push({
    label: 'Langfuse, Correctness template',
    ours: v7.find((r) => r.row === 'Reference correctness').v7UsdPer100,
    theirs: (theirs.evaluation_cost_usd / theirs.total) * 100,
    source: `${SOURCES.readmeV7} and ${SOURCES.langfuseTheirs}`,
  });
  rows.sort((a, b) => a.ours / a.theirs - b.ours / b.theirs);
  for (const r of rows)
    if (record)
      fact(
        'judge-cost',
        `${r.label}: USD per 100 cases, driftbench then other`,
        [r.ours, r.theirs],
        r.source,
      );
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
        .map((g) => ({ ...g, rows: g.rows.filter((r) => r.standing === 'lead' && !r.setting) }))
        .filter((g) => g.rows.length)
    : every;
  const all = groups.flatMap((g) => g.rows);
  return {
    kind: 'pairs',
    kicker: 'Judge accuracy · held-out cases · Claude Haiku 5.5 on both sides',
    title: leadsOnly
      ? `Cases correct of ${all[0].n}, driftbench against DeepEval's default.`
      : `${total} judge tests, cases correct.`,
    key: ['driftbench default-on-v7', "the other tool's default"],
    min: 0,
    max: 100,
    ticks: [0, 25, 50, 75, 100],
    tick: '',
    axis: 'score out of 100: correct verdicts, % of cases',
    groups: groups.map((g) => ({ header: g.header, rows: g.rows.map(pair) })),
    note: leadsOnly
      ? `${[...new Set(all.map((r) => r.n))].sort((a, b) => a - b).join(' or ')} cases per row · lines: 95% interval${all.some((r) => r.paired) ? ' · fresh rows: paired Holm test' : ''}`
      : `${Math.min(...all.map((r) => r.n))} to ${Math.max(...all.map((r) => r.n))} cases per row · lines: 95% interval · fresh rows: paired Holm test`,
  };
}

function costData() {
  const rows = costRows();
  return {
    kind: 'pairs',
    kicker: 'Judge cost · US dollars per 100 cases · Claude Haiku 5.5',
    title: 'Cost per 100 judged cases.',
    key: ['driftbench default-on-v7', "the other tool's default"],
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
    note: '60 to 120 cases per row · v7: Messages API; peers: recorded spend',
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
// Competitors are grey, each with its own fill pattern; driftbench is the only coloured bar.
const PATTERNS = {
  promptfoo: 'hatch',
  DeepEval: 'dots',
  Inspect: 'cross',
  Langfuse: 'lines',
  LangWatch: 'light',
};
// three decimals: a score read to one decimal later must not be rounded twice
const bar = (name, score, extra = {}) => ({
  name,
  score: score === null ? null : Number(score.toFixed(3)),
  ...(PATTERNS[name] && !extra.ours ? { pattern: PATTERNS[name] } : {}),
  ...extra,
});

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
function addPeers(chart, bench, panels, labels = {}) {
  const path = join(PEERS_DIR, `${bench}-all-peers.json`);
  if (!existsSync(path)) return [];
  const file = JSON.parse(readFileSync(path, 'utf8'));
  const model = MODEL_IN_PEERS_FILE[file.model] ?? file.model;
  const cohort = bench === 'mmeval' ? 'primary' : 'all';
  const shown = path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path;
  const names = [];
  // The file holds driftbench and promptfoo cells too: they fill a panel where the sealed files have none.
  for (const id of ['driftbench', PROMPTFOO]) {
    const row = file.contestants.find((c) => c.contestant === id);
    const panel = panels.find((p) => p.name === model);
    const mine = panel?.bars.find((b) => b.name === (id === 'driftbench' ? 'driftbench' : PROMPTFOO));
    if (row?.[cohort] && mine && mine.score === null) {
      mine.score = Number((row[cohort].score * 100).toFixed(3));
      panel.model = `${row[cohort].n.toLocaleString('en-US')} ${file.unit.startsWith('item') ? 'items' : file.unit.startsWith('pair') ? 'pairs' : 'games'}`;
      fact(chart, `${panel.name}: ${mine.name}, percent`, mine.score, shown);
    }
  }
  for (const row of file.contestants.filter((c) => !OWN.has(c.contestant))) {
    const name = PEER_NAME[row.contestant] ?? row.contestant;
    // A peer that refused some items is drawn with its score, which counts each refusal as wrong, and the
    // refusal count. Only a peer with no result at all is "not run".
    const refused = row.transportMissing ?? 0;
    const hasResult = row[cohort] !== undefined && (row.present === undefined || row.present > 0);
    names.push(name);
    labels[name] = row.grader ?? name;
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
  const labels = {};
  const peers = addPeers(chart, bench, panels, labels);
  const drawn = [PROMPTFOO, ...peers].join(', ');
  const defaultSize = panels.find((panel) => panel.name === 'Claude Haiku 5.5')?.model;
  // which models have no driftbench result, read from the panels as drawn
  const unrun = panels.filter((p) => p.bars.find((b) => b.ours)?.score === null).map((p) => p.name);
  const missing = unrun.length
    ? `${note ? ' ' : ''}Not run for driftbench and promptfoo: ${unrun.join(', ')}.`
    : '';
  return {
    kind: 'ranked',
    kicker,
    title,
    key: [
      ...key.filter((k) => k.style !== 'other'),
      ...key.filter((k) => k.style === 'other').map((k) => ({ ...k, pattern: PATTERNS[PROMPTFOO] })),
      ...peers.map((n) => ({ label: labels[n], style: 'other', pattern: PATTERNS[n] })),
    ].map((entry) =>
      HAS_DEFAULT && entry.style === 'ours' ? { ...entry, label: 'driftbench default-on-v6' } : entry,
    ),
    axis: 'score out of 100: correct, % of items',
    panels: orderPanels(panels),
    note: HAS_DEFAULT
      ? `Frozen default-on-v6 on Claude Haiku 5.5: ${defaultSize}. Other default models: not run. Recorded peers (${drawn}): unverified historical (lane report).`
      : `Competitors with a recorded result on this benchmark in this repository: ${drawn}. ${note}${missing}`.trim(),
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
          'bench-judgebench-models',
          model,
          `${c.n} pairs`,
          [
            bar('driftbench', pct(c.ledger.correct, c.n), { ours: true }),
            bar(PROMPTFOO, pct(c.promptfoo.correct, c.n)),
          ],
          file,
        )
      : modelPanel('bench-judgebench-models', model, null, notRun('driftbench', PROMPTFOO), file);
  });
  return ranked({
    chart: 'bench-judgebench-models',
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
      return modelPanel('bench-mm-eval-models', model, null, notRun('driftbench', PROMPTFOO), file);
    return modelPanel(
      'bench-mm-eval-models',
      model,
      `${c.matched} pairs`,
      [bar('driftbench', c.scores.ledger * 100, { ours: true }), bar(PROMPTFOO, c.scores.promptfoo * 100)],
      file,
    );
  });
  return ranked({
    chart: 'bench-mm-eval-models',
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
      return modelPanel('bench-rubricbench-models', model, null, notRun('driftbench', PROMPTFOO), file);
    return modelPanel(
      'bench-rubricbench-models',
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
    chart: 'bench-rubricbench-models',
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
      return modelPanel(
        'bench-verify-models',
        model,
        null,
        [...notRun('driftbench', PROMPTFOO), baseline],
        file,
      );
    const [ours, theirs] = c.official.correct;
    const n = c.official.matchedItems;
    return modelPanel(
      'bench-verify-models',
      model,
      `${n} items`,
      [bar('driftbench', pct(ours, n), { ours: true }), bar(PROMPTFOO, pct(theirs, n)), baseline],
      file,
    );
  });
  return ranked({
    chart: 'bench-verify-models',
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
    note: '',
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
      return modelPanel(
        'bench-writing-models',
        model,
        null,
        [...notRun('driftbench', PROMPTFOO), baseline],
        file,
      );
    }
    return modelPanel(
      'bench-writing-models',
      model,
      `${ours.pairs} pairs`,
      [bar('driftbench', ours.accuracy, { ours: true }), bar(PROMPTFOO, peer.accuracy), baseline],
      file,
    );
  });
  return ranked({
    chart: 'bench-writing-models',
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
    label: `${breaks[r.label] ?? r.label}${r.setting ? ' *' : ''}`,
    sub: `of ${r.n}${r.paired ? `; ${r.standing === 'lead' ? 'ahead' : r.standing === 'deficit' ? 'behind' : 'level'}` : ''}`,
    bars: [
      { series: 0, value: round(pct(r.ours, r.n)), text: String(r.ours) },
      { series: 1, value: round(pct(r.theirs, r.n)), text: String(r.theirs) },
    ],
  }));
  const name = { deepeval: 'DeepEval', promptfoo: 'promptfoo', langfuse: 'Langfuse', inspect: 'Inspect' }[
    tool
  ];
  const kicker = `${name} hard cases · held-out · Claude Haiku 5.5 on both sides`;
  if (group.rows.length === 1) {
    const [r] = group.rows;
    return {
      kind: 'hbars',
      kicker,
      title: `${name}: ${r.ours} of ${r.n} correct, against ${r.theirs}.`,
      key: ['driftbench default-on-v7', `${name} default`],
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
  // Owner rule: no win, tie or loss tally in a chart title.
  const title = `${name}: cases correct of ${[...new Set(group.rows.map((r) => r.n))]
    .sort((a, b) => a - b)
    .join(' or ')}.`;
  const settings = [...new Set(group.rows.filter((r) => r.setting).map((r) => r.setting))];
  const sizes = [...new Set(group.rows.map((r) => r.n))];
  return columns(`hard-${tool}`, {
    kicker: `${kicker} · bars labelled with cases correct`,
    title,
    key: [settings.length ? 'driftbench' : 'driftbench default-on-v7', `${name} default`],
    groups,
    note: [
      group.rows.some((r) => r.paired)
        ? 'Fresh rows: exact paired test, Holm p <= 0.05; other rows: separate 95% intervals'
        : 'Ahead or behind: the 95% intervals do not overlap',
      group.rows.find((r) => r.label === 'Knowledge retention' && r.paired) &&
        `Retention exact p = ${group.rows.find((r) => r.label === 'Knowledge retention').paired.raw.toPrecision(3)}`,
      group.rows.some((r) => r.paired?.missing) &&
        group.rows
          .filter((r) => r.paired?.missing)
          .map((r) => `${r.label}: ${r.paired.missing} incomplete pairs excluded`)
          .join('; '),
      sizes.length > 1 && `cases per test: ${sizes.sort((a, b) => a - b).join(' or ')}`,
      settings.length &&
        (settings.includes('v8 declared request-fulfillment')
          ? '* G-Eval strict: v8 default, metric declares request-fulfillment; other rows unchanged'
          : `* opt-in setting ${settings.join(', ')}; every other bar is the shipped judge`),
    ]
      .filter(Boolean)
      .join(' · '),
  });
}

// ---------------------------------------------------------------------------------------------
// The README charts: one per benchmark, driftbench beside every competitor on one model, best case
// ---------------------------------------------------------------------------------------------

let readerFirstDefault = 0;
let longerReply = 0;
const BEST = [
  {
    chart: 'bench-judgebench',
    bench: 'judgebench',
    name: 'JudgeBench',
    unit: 'pairs',
    kicker: 'JudgeBench · sealed test · official pair score',
  },
  {
    chart: 'bench-mm-eval',
    bench: 'mmeval',
    name: 'MM-Eval',
    unit: 'items',
    kicker: "MM-Eval · sealed test · the benchmark's own score",
  },
  {
    chart: 'bench-rubricbench',
    bench: 'rubricbench',
    name: 'RubricBench',
    unit: 'games',
    kicker: 'RubricBench · test split · both orders of every pair',
  },
  {
    chart: 'bench-verify',
    bench: 'verify',
    name: 'Verify',
    unit: 'items',
    kicker: 'LongJudgeBench verify · test split · is the final answer correct',
  },
  {
    chart: 'bench-writing',
    bench: 'writing',
    name: 'Writing',
    unit: 'games',
    kicker: 'LongJudgeBench writing preference · test split · both orders',
  },
];
const TOOL_NAME = { promptfoo: 'promptfoo', ...PEER_NAME };

const DEFAULT_FILE = {
  judgebench: 'judgebench.json',
  mmeval: 'mm-eval.json',
  rubricbench: 'rubricbench-haiku.json',
  verify: 'verify.json',
  writing: 'writing.json',
};
/** The frozen default's Claude Haiku 5.5 score for one benchmark, out of 100. The default report scores the
 *  recorded promptfoo answers again on the same population; a promptfoo score that differs from the
 *  all-competitors file means the two populations differ, so the chart refuses to set them side by side. */
function defaultHaiku(bench, chart, peerModel, recordedPromptfoo) {
  if (peerModel !== 'claude-haiku-5-5') {
    throw new Error(
      `${chart}: the competitor file is on ${peerModel}; the frozen default ran on claude-haiku-5-5`,
    );
  }
  const source = join(DEFAULT_RESULTS, DEFAULT_FILE[bench]);
  const d = json(source);
  let ours;
  let peer;
  if (bench === 'judgebench') {
    const c = d.cells.find((x) => x.model === 'claude-haiku-5-5' && x.status === 'MEASURED');
    ours = (c.ledger.correct / c.n) * 100;
    peer = (c.promptfoo.correct / c.n) * 100;
  } else if (bench === 'mmeval') {
    const s = d.models.haiku.primary.scores;
    ours = s.ledger * 100;
    peer = s.promptfoo * 100;
  } else if (bench === 'rubricbench') {
    const c = d.cells.find((x) => x.model === 'claude-haiku-5-5');
    ours = c.stats.ours.estimate * 100;
    peer = c.stats.peer.estimate * 100;
  } else if (bench === 'verify') {
    const c = d.cells.find((x) => x.model === 'haiku' && x.official);
    ours = (c.official.correct[0] / c.official.matchedItems) * 100;
    peer = (c.official.correct[1] / c.official.matchedItems) * 100;
  } else {
    const c = (k) => d.cells.find((x) => x.model === 'haiku' && x.contestant === k);
    ours = c('pair-ledger').accuracy;
    peer = c('promptfoo').accuracy;
  }
  if (Math.abs(peer - recordedPromptfoo) > 1e-6) {
    throw new Error(
      `${chart}: promptfoo scores ${peer} in the default result and ${recordedPromptfoo} in the competitor file; the populations differ`,
    );
  }
  return { ours, source };
}

/** One chart per benchmark from the all-competitors file: driftbench and every competitor on the model that
 *  file was run on, highest to lowest, scores out of 100, no baseline bars. Every competitor was run on that
 *  one model only, so it is the only model where driftbench can be set against all of them. */
function bestCase({ chart, bench, name, unit, kicker }) {
  const path = `docs/comparison/benchmarks/${bench}-all-peers.json`;
  const file = JSON.parse(readFileSync(join(PEERS_DIR, `${bench}-all-peers.json`), 'utf8'));
  const cohort = bench === 'mmeval' ? 'primary' : 'all';
  const model = MODEL[file.model] ?? file.model;
  const row = (id) => file.contestants.find((c) => c.contestant === id);
  // With a frozen default result set, the driftbench bar is that default; the recorded rows are older settings.
  const frozen = HAS_DEFAULT
    ? defaultHaiku(bench, chart, file.model, row(PROMPTFOO)[cohort].score * 100)
    : null;
  // A footnote where driftbench used an opt-in setting: the writing bar is the reader-first setting.
  const optIn = frozen ? undefined : row('driftbench-reader-first');
  const ours = optIn ?? row('driftbench');
  const bars = [{ id: 'driftbench', row: ours, ours: true }];
  for (const c of file.contestants) {
    if (['driftbench', 'driftbench-reader-first'].includes(c.contestant)) continue;
    bars.push({ id: c.contestant, row: c });
  }
  const labelOf = { [PROMPTFOO]: bench === 'verify' ? 'promptfoo llm-rubric' : 'promptfoo select-best' };
  for (const b of bars) if (!b.ours && b.row.grader) labelOf[TOOL_NAME[b.id]] = b.row.grader;
  const drawn = bars.map((b) => {
    const cell = b.row[cohort];
    const refused = b.ours && frozen ? 0 : (b.row.transportMissing ?? 0);
    const label = b.ours ? 'driftbench' : (TOOL_NAME[b.id] ?? b.id);
    const score = b.ours && frozen ? frozen.ours : cell ? cell.score * 100 : null;
    const out = bar(label, score, {
      ...(b.ours ? { ours: true } : {}),
      ...(refused > 0 ? { refused } : {}),
    });
    if (chart)
      fact(
        chart,
        `${label}, percent${refused > 0 ? ', refused items counted wrong' : ''}`,
        out.score === null ? 'not run' : refused > 0 ? [out.score, refused] : out.score,
        b.ours && frozen ? frozen.source : path,
      );
    return out;
  });
  const n = row(PROMPTFOO)[cohort].n;
  const mine = drawn[0].score;
  const title = `${name}: driftbench scores ${p1(mine)}.`;
  let note = frozen
    ? `${model}, ${n.toLocaleString('en-US')} ${unit}. driftbench: the frozen default-on-v6 product default. Competitors: recorded runs on this model only, unverified historical (lane report). A refused item counts as wrong.`
    : `${model}, ${n.toLocaleString('en-US')} ${unit}. Every competitor ran on this model only. A refused item counts as wrong.`;
  if (optIn) {
    const plain = row('driftbench')[cohort];
    readerFirstDefault = plain.score * 100;
    const longer = json(`${SEALED}/writing.json`).cells.find((c) => c.contestant === 'longer-wins');
    longerReply = longer.accuracy;
    if (chart)
      fact(
        chart,
        'driftbench default, reader-first setting, rule that picks the longer reply, percent',
        [round(plain.score * 100), round(ours[cohort].score * 100), round(longer.accuracy)],
        `${path}, ${SEALED}/writing.json`,
      );
    const same = Math.abs(ours[cohort].score * 100 - longer.accuracy) < 0.005;
    note += ` The driftbench bar uses its opt-in reader-first setting (default ${p1(plain.score * 100)}).${same ? ` It scores the same as a rule that always picks the longer reply, ${p1(longer.accuracy)}.` : ''}`;
  }
  return {
    kind: 'ranked',
    kicker,
    title,
    key: [
      { label: 'driftbench', style: 'ours' },
      ...drawn
        .filter((b) => !b.ours)
        .map((b) => ({ label: labelOf[b.name], style: 'other', pattern: PATTERNS[b.name] })),
    ],
    axis: 'score out of 100: correct, % of items',
    panels: [
      {
        name: model,
        model: `${n.toLocaleString('en-US')} ${unit}`,
        bars: drawn.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
      },
    ],
    note,
  };
}

// ---------------------------------------------------------------------------------------------
// The summary chart above the quickstart: the five benchmark charts side by side, drawn from their bars
// ---------------------------------------------------------------------------------------------

const DEFINITIONS = {
  'bench-judgebench': 'Correct choices between a right answer and a wrong answer.',
  'bench-mm-eval': 'Judgement across chat, reasoning, safety and language tasks.',
  'bench-rubricbench': 'Choices between replies against the stated grading criteria.',
  'bench-verify': 'LongJudgeBench: checks whether the final answer is correct.',
  'bench-writing': 'LongJudgeBench: choice of the preferred written reply.',
};
const one = (v) => (Math.round(v * 10) / 10).toFixed(1);
const SUMMARY_ORDER = ['driftbench', PROMPTFOO, 'DeepEval', 'Inspect', 'Langfuse', 'LangWatch'];

function summaryData() {
  const rows = BEST.map(({ chart, name }) => {
    const panel = data[chart].panels[0];
    const cells = SUMMARY_ORDER.map((n) => {
      const b = panel.bars.find((x) => x.name === n);
      if (!b || b.score === null) throw new Error(`${chart}: no score for ${n} in the summary chart`);
      return { name: n, score: b.score };
    });
    const label = name === 'Verify' ? 'verify' : name === 'Writing' ? 'writing' : name;
    return {
      id: chart,
      name: label,
      unit: panel.model.split(' ')[1],
      n: Number(panel.model.split(' ')[0].replaceAll(',', '')),
      definition: DEFINITIONS[chart],
      cells,
    };
  });
  const writing = data['bench-writing'];
  const notes = HAS_DEFAULT
    ? [
        'driftbench: frozen default-on-v6.',
        'Competitors: recorded runs, unverified historical (lane report).',
      ]
    : [
        `Reader-first setting: ${one(rows.at(-1).cells[0].score)} shown; default ${one(readerFirstDefault)}.`,
        `Same score as a rule that always picks the longer reply (${one(longerReply)}).`,
      ];
  void writing;
  const model = data['bench-judgebench'].panels[0].name;
  const sources = HAS_DEFAULT
    ? `${DEFAULT_RESULTS}/*.json and docs/comparison/benchmarks/*-all-peers.json`
    : 'docs/comparison/benchmarks/*-all-peers.json';
  const SUMMARY_TITLE = 'Judge accuracy on public benchmarks';
  const args = { rows, title: SUMMARY_TITLE, model, sources, notes };
  const alt = `${SUMMARY_TITLE}, ${model}, scores out of 100, bars ranked within each benchmark, driftbench the only coloured bar and each competitor grey with its own pattern, with an axis break from 30 to 50. ${rows
    .map(
      (r) =>
        `${r.name}, ${r.n.toLocaleString('en-US')} ${r.unit}: ${[...r.cells]
          .sort((a, b) => b.score - a.score)
          .map((c) => `${c.name} ${one(c.score)}`)
          .join(', ')}.`,
    )
    .join(' ')} ${notes.join(' ')}`;
  return { title: args.title, svg: { light: summarySvg(false, args), dark: summarySvg(true, args) }, alt };
}

function readmeSummary() {
  return `<p align="center">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/summary-dark.png">\n    <img alt="${data.summary.alt}" src="docs/assets/summary-light.png" width="100%" />\n  </picture>\n</p>`;
}

const CHARTS = {
  'judge-leads': () => judgeData(true),
  'judge-cost': costData,
  'mm-eval-sealed-test': mmData,
  'testgen-budget': budgetData,
  'self-tests': banksData,
  'capability-matrix': matrixData,
  ...Object.fromEntries(BEST.map((b) => [b.chart, () => bestCase(b)])),
  'bench-judgebench-models': sealedJudgeBench,
  'bench-mm-eval-models': sealedMmEval,
  'bench-rubricbench-models': sealedRubricBench,
  'bench-verify-models': sealedVerify,
  'bench-writing-models': sealedWriting,
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
  // what a run sends: the recap change in mode F, and one independent block change in mode T
  const e2e = text.match(
    /sends (\d+) of (\d+) blocks and carries (\d+) cells\. A full campaign of the same faulty agent fails on (\d+) cells/,
  );
  if (!e2e) throw new Error(`${RADIUS_DOC}: the end to end sentence no longer parses`);
  const [sent, all, carried, failing] = e2e.slice(1).map(Number);
  fact(
    'impact-radius',
    'recap change, mode F: blocks sent, blocks in the full run, percent saved, cells carried, failing cells of the full run',
    [sent, all, Number((((all - sent) / all) * 100).toFixed(1)), carried, failing],
    RADIUS_DOC,
  );
  const modeT = text.match(
    /sends (\d+) of (\d+) blocks\. The same campaign without end-state snapshots sends (\d+) of (\d+)/,
  );
  if (!modeT) throw new Error(`${RADIUS_DOC}: the mode T sentence no longer parses`);
  const [modeTSent, modeTAll, modeTWithout] = [modeT[1], modeT[2], modeT[3]].map(Number);
  fact(
    'impact-radius',
    'coverage check input change, mode T: blocks sent, blocks in the full run, percent saved, blocks sent without snapshots',
    [modeTSent, modeTAll, Number((((modeTAll - modeTSent) / modeTAll) * 100).toFixed(1)), modeTWithout],
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
  const forSummary = PRINT === 'summary' && BEST.some((b) => b.chart === name);
  if (PRINT && name !== PRINT && !forSummary) continue;
  data[name] = build();
}
if (!PRINT || PRINT === 'summary') data.summary = summaryData();
if (PRINT) {
  if (!data[PRINT]) throw new Error(`no chart named ${PRINT}`);
  console.log(JSON.stringify(data[PRINT]));
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// The detail page of the public benchmarks: the per-model charts and their tables, written from the data
// ---------------------------------------------------------------------------------------------

const DETAIL = 'docs/comparison/benchmarks/index.md';

function detailTable(chartName) {
  const panels = data[chartName].panels;
  const order = ['driftbench', PROMPTFOO, ...Object.values(PEER_NAME), 'always fail', 'longer reply'];
  const names = order.filter((n) => panels.some((p) => p.bars.some((b) => b.name === n)));
  const cell = (b) =>
    !b || b.score === null ? 'not run' : `${b.score.toFixed(1)}${b.refused ? ` (${b.refused} refused)` : ''}`;
  const rows = panels.map(
    (p) =>
      `| ${p.name} | ${p.model} | ${names.map((n) => cell(p.bars.find((b) => b.name === n))).join(' | ')} |`,
  );
  return [
    `| Model | Set | ${names.join(' | ')} |`,
    `|---|---|${names.map(() => '---:').join('|')}|`,
    ...rows,
  ].join('\n');
}

function detailPage() {
  const section = (title, status, charts, extra = '') =>
    [
      `## ${title}`,
      '',
      status,
      '',
      ...charts.flatMap(([name, label]) => [
        `![${label}: one panel per model, driftbench beside every recorded competitor, highest to lowest. The numbers are in the table below.](../../assets/${name}-light.png)`,
        '',
        detailTable(name),
        '',
      ]),
      extra,
    ]
      .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
      .join('\n');
  return `${[
    '# Public judge benchmarks',
    '',
    'The [benchmarks page](../../public-benchmarks.md) shows one chart per benchmark: driftbench beside every competitor on one model. This page holds the rest: one chart and one table per benchmark with every model that was run, and a "not run" where a contestant was not. Bars run from the highest score to the lowest, on one scale of 0 to 100. A refused item counts as wrong, and the table says how many. The sets, the rules and the limits of each result are in [how the README numbers were measured](../methods.md#public-benchmarks-against-promptfoo). A correction across the whole family of cells is pending, so no cell is called a win or a loss.',
    '',
    'DeepEval, Inspect, Langfuse and LangWatch were run on Claude Haiku 5.5 only. promptfoo and driftbench were also run on GPT-6 Luna and Gemini 3.5 Flash-Lite. Paired tests, wins, losses and spend per benchmark are in the [all-competitors tables](judgebench-all-peers.md).',
    '',
    section('JudgeBench', 'Three models, 270 sealed pairs each.', [
      ['bench-judgebench-models', 'JudgeBench'],
    ]),
    section(
      'LongJudgeBench',
      'Verify is run on GPT-6 Luna for promptfoo and driftbench, and on Claude Haiku 5.5 for all contestants. Writing preference has 173 pairs per model, and a rule that picks the longer reply is drawn as a baseline.',
      [
        ['bench-verify-models', 'LongJudgeBench verify'],
        ['bench-writing-models', 'LongJudgeBench writing preference'],
      ],
    ),
    section(
      'MM-Eval',
      'Up to 600 sealed pairs per model. Claude Haiku 5.5 scores 591 pairs; the nine missing are safety items.',
      [['bench-mm-eval-models', 'MM-Eval']],
    ),
    section('RubricBench', 'Three models, 790 pairs each.', [['bench-rubricbench-models', 'RubricBench']]),
    '## RubricEval',
    '',
    'Data not public. No chart is planned.',
  ].join('\n\n')}\n`.replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------------------------
// The README blocks that repeat the numbers of the charts: alt text, labels and the table are written
// from the same bars the charts draw, so a number cannot differ between them
// ---------------------------------------------------------------------------------------------

const README = 'README.md';
const BENCHMARKS = 'docs/public-benchmarks.md';

const TASK = {
  'bench-judgebench': 'picks the correct answer',
  'bench-mm-eval': 'picks the better answer',
  'bench-rubricbench': 'picks the reply that meets the grading criteria',
  'bench-verify': 'decides whether the final answer is correct',
  'bench-writing': 'picks the reply readers prefer',
};

/** One plain line that leads with driftbench's score and says what the reader gains, from the bars of the chart. */
function benefit(chart) {
  const bars = data[chart].panels[0].bars;
  const ours = bars.find((b) => b.ours);
  const rest = bars.filter((b) => !b.ours && b.score !== null).sort((a, b) => b.score - a.score);
  const names = rest.map((b) => b.name);
  const next = rest[0];
  const tenth = (v) => Math.round(v * 10);
  if (tenth(ours.score) > tenth(next.score)) {
    return `driftbench ${TASK[chart]} more often than ${names.slice(0, -1).join(', ')} and ${names.at(-1)} on the same model: ${one(ours.score)}, against ${one(next.score)} for the next best, ${next.name}.`;
  }
  const below = rest.filter((b) => tenth(b.score) < tenth(ours.score));
  const list = below.map((b) => `${b.name} (${one(b.score)})`);
  const gap = one(next.score - ours.score);
  // "A", "A and B", "A, B and C": a one-name list must not print an empty name before "and".
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : (list[0] ?? '');
  const above = joined ? ` and above ${joined}` : '';
  return `driftbench ${TASK[chart]} ${one(ours.score)} times in 100, within ${gap} points of the top score (${next.name}, ${one(next.score)})${above}.`;
}

const IDENTITY_NOTE =
  'Unchanged by the v8 default: no metric in this set declares request-fulfillment; the request sequence is byte-identical to the previous default (proof: [39585594216](https://github.com/NexusGPT/driftbench/actions/runs/39585594216)).';

/** A repository path as the page at `base` links it: the README at the root, a docs page under docs/. */
function linkTo(path, base) {
  if (base !== 'docs') return path;
  return path.startsWith('docs/') ? path.slice(5) : `../${path}`;
}

function readmeCharts(base = 'root') {
  const parts = [
    ['bench-judgebench', 'judgebench', 'JudgeBench', 'pair ledger'],
    ['bench-mm-eval', 'mm-eval', 'MM-Eval', 'pair ledger'],
    ['bench-rubricbench', 'rubricbench', 'RubricBench', 'pair ledger'],
    ['bench-verify', 'verify', 'Verify', 'frozen verify cascade'],
    ['bench-writing', 'writing', 'Writing', 'pair ledger'],
  ];
  return parts
    .map(([chart, file, label, mode]) => {
      const c = data[chart];
      const panel = c.panels[0];
      const alt = `${c.title} ${panel.name}, ${panel.model}, percent correct, highest to lowest: ${panel.bars.map((b) => `${b.name} ${one(b.score)}`).join(', ')}.`;
      const writing =
        chart === 'bench-writing' && !HAS_DEFAULT
          ? ` The driftbench bar uses its opt-in reader-first setting (long-structured), which scores the same as a rule that always picks the longer reply, ${one(panel.bars.find((b) => b.ours).score)}; the default setting scores ${one(readerFirstDefault)}.`
          : '';
      const refused = panel.bars.filter((b) => b.refused).map((b) => `${b.name} ${b.refused}`);
      const setting = HAS_DEFAULT
        ? 'driftbench runs its frozen default-on-v6 product default; competitor results are recorded, unverified historical (lane report)'
        : `driftbench runs its opt-in ${mode}`;
      const foot = `${panel.name}, ${panel.model}. Each judge runs its default settings; ${setting}. A refused item counts as wrong${refused.length ? ` (refused: ${refused.join(', ')})` : ''}.${writing}`;
      return `**${label}.** ${benefit(chart)}\n\n<a href="${linkTo(`docs/assets/bench-${file}-light.png`, base)}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${linkTo(`docs/assets/bench-${file}-dark.png`, base)}">\n    <img alt="${alt}" src="${linkTo(`docs/assets/bench-${file}-light.png`, base)}" width="100%">\n  </picture>\n</a>\n<p align="center"><sub>${foot}</sub></p>\n\n${IDENTITY_NOTE}\n`;
    })
    .join('\n');
}

function readmeTable() {
  const names = ['driftbench', PROMPTFOO, 'DeepEval', 'Inspect', 'Langfuse', 'LangWatch'];
  const rows = [
    ['bench-judgebench', 'JudgeBench'],
    ['bench-mm-eval', 'MM-Eval'],
    ['bench-rubricbench', 'RubricBench'],
    ['bench-verify', 'LongJudgeBench verify'],
    ['bench-writing', 'LongJudgeBench writing'],
  ].map(([chart, label]) => {
    const panel = data[chart].panels[0];
    const reader = chart === 'bench-writing' && !HAS_DEFAULT ? ' (footnote)' : '';
    const cells = names.map((n) => {
      const b = panel.bars.find((x) => x.name === n);
      return b && b.score !== null ? one(b.score) : 'not run';
    });
    return `| ${label}, ${panel.model}${reader} | ${cells.join(' | ')} |`;
  });
  const footnote = HAS_DEFAULT
    ? 'Footnote: driftbench figures are the frozen default-on-v6 product default on Claude Haiku 5.5; competitor figures are recorded, unverified historical (lane report).'
    : `Footnote: the driftbench figure for writing uses its opt-in reader-first setting (long-structured); the default setting scores ${one(readerFirstDefault)}.`;
  return `| Benchmark | ${names.join(' | ')} |\n|---|${names.map(() => '---:').join('|')}|\n${rows.join('\n')}\n\n${footnote}`;
}

function readmeV7(base = 'root') {
  const H = base === 'docs' ? '##' : '###';
  const analysis = json(SOURCES.readmeV7);
  const returned = [...new Map(analysis.rows.map((r) => [r.dataset, r.returned])).values()].reduce(
    (sum, n) => sum + n,
    0,
  );
  const panel = analysis.rows.find((r) => r.row === 'Grader panel');
  const missing = analysis.rows
    .filter((r) => r.n !== r.verdicts)
    .map((r) => `${r.row}: ${r.n - r.verdicts}`)
    .join('; ');
  const image = (name, alt) => `<a href="${linkTo(`.github/readme/${name}-light.png`, base)}">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="${linkTo(`.github/readme/${name}-dark.png`, base)}">
    <img alt="${alt}" src="${linkTo(`.github/readme/${name}-light.png`, base)}" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="${linkTo('docs/comparison/methods.md', base)}#the-judge-on-hard-cases">How we measured</a></sub></p>`;
  const groups = judgeRows(null);
  const alt = (rows) =>
    rows.map((r) => `${r.label}: ${r.ours} against ${r.theirs} of ${r.n}, ${r.standing}.`).join(' ');
  const leads = groups.flatMap((g) => g.rows).filter((r) => r.standing === 'lead' && !r.setting);
  const current = json(SOURCES.strictV8);
  const rows = analysis.rows.map(
    (r) =>
      `| ${r.row}${r.setting ? ' *' : ''} | ${r.n.toLocaleString('en-US')} | ${(r.row === current.row ? current.correct : r.v7).toLocaleString('en-US')} | ${r.peer.toLocaleString('en-US')} | ${r.standing} |`,
  );
  return [
    `${H} The shipped judge against DeepEval`,
    image('judge-leads', `default-on-v7 against the recorded DeepEval default. ${alt(leads)}`),
    'On hallucination, faithfulness, turn relevancy, completeness and role adherence, default-on-v7 scores above DeepEval beyond the separate 95% intervals.',
    `${H} Hard cases, framework by framework`,
    `The v7 run returns ${returned.toLocaleString('en-US')} items across ${analysis.rows.length} rows on Claude Haiku 5.5. Peers keep their recorded answers. Earlier driftbench rows used \`claude -p\` with old prompts (knowledge retention mostly used the Messages API); v7 uses \`createDefaultJudge\` over the Anthropic Messages API. The transport difference is part of this comparison.`,
    ...['deepeval', 'promptfoo', 'langfuse'].map((tool) =>
      image(
        `hard-${tool}`,
        `${tool === 'deepeval' ? 'Previous default with the v8 declared-fulfillment strict row' : 'default-on-v7'} against the recorded ${tool} default. ${alt(groups.find((g) => g.header.toLowerCase().startsWith(tool)).rows)}`,
      ),
    ),
    [
      '| Judge row | Cases | driftbench correct | Recorded peer correct | Standing |',
      '|---|---:|---:|---:|---|',
      ...rows,
    ].join('\n'),
    '* G-Eval strict is the v8 default on a metric declaring request-fulfillment: 480/480, against the same recorded peer’s 451/480. This replaces the historical v7 result of 479/480. G-Eval strict and knowledge retention retain exact paired tests, Holm over those two rows. Other standings retain separate Wilson 95% intervals. Close means no separation under that rule.',
    `For the fourteen other README datasets: ${IDENTITY_NOTE}`,
    `Inconclusive answers count wrong (${missing}). They stay in the score denominator and leave the peer paired tests. Grader panel falls from ${panel.earlierJudge} to ${panel.v7} correct against the earlier driftbench answers; this is included in the secondary analysis.`,
    `[Results, analysis and reproduction](${linkTo('comparisons/default-on/readme-v7/RESULT.md', base)}). Historical public benchmark rows below retain their recorded judge versions and settings.`,
  ].join('\n\n');
}

/** Replaces what lies between the markers `<!-- tag:start -->` and `<!-- tag:end -->` of a page. */
function swapBlock(text, file, tag, body) {
  const start = `<!-- ${tag}:start -->`;
  const end = `<!-- ${tag}:end -->`;
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < 0) throw new Error(`${file}: the markers ${start} and ${end} are missing`);
  return `${text.slice(0, a + start.length)}\n${body}\n${text.slice(b)}`;
}

// The README keeps the summary chart and the table. The page of the public benchmarks keeps the five charts,
// the table, the held-out judge rows and the cost chart.
function readmeText() {
  const withTable = swapBlock(read(README), README, 'readme-table', readmeTable());
  return swapBlock(withTable, README, 'readme-summary', readmeSummary());
}

function benchmarksText() {
  let text = read(BENCHMARKS);
  text = swapBlock(text, BENCHMARKS, 'readme-charts', readmeCharts('docs'));
  text = swapBlock(text, BENCHMARKS, 'readme-table', readmeTable());
  text = swapBlock(text, BENCHMARKS, 'readme-v7', readmeV7('docs'));
  const costs = costRows(false);
  const panelCost = costs.find((r) => r.label === 'Inspect, grader panel');
  const panelScore = json(SOURCES.readmeV7).rows.find((r) => r.row === 'Grader panel');
  text = text.replace(
    /^On Inspect's grader panel,.*$/m,
    `On Inspect's grader panel, default-on-v7 spends $${panelCost.ours.toFixed(3)} per 100 cases against $${panelCost.theirs.toFixed(3)}, and scores ${panelScore.v7} of ${panelScore.n} against ${panelScore.peer}. Lower cost does not establish equal accuracy.`,
  );
  return text.replace(
    /alt="[^"]*"(?= src="\.\.\/\.github\/readme\/judge-cost-light\.png")/,
    `alt="Recorded USD per 100 cases, default-on-v7 over the Messages API against the recorded peer. ${costRows(
      false,
    )
      .map((r) => `${r.label}: ${r.ours.toFixed(3)} against ${r.theirs.toFixed(3)}.`)
      .join(' ')}"`,
  );
}

const files = new Map();
files.set(join(ROOT, DETAIL), detailPage());
files.set(join(ROOT, README), readmeText());
files.set(join(ROOT, BENCHMARKS), benchmarksText());
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
