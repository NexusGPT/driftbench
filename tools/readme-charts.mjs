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
// One chart per benchmark: driftbench beside each competitor, one group per model, percent correct
// ---------------------------------------------------------------------------------------------

const SEALED = 'docs/assets/data/sealed';
const MODEL = {
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  haiku: 'Claude Haiku 5.5',
  'gpt-6-luna': 'GPT-6 Luna',
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
};
const p1 = (v) => v.toFixed(1);
const columnGroup = (label, sub, ours, theirs, source, chart) => {
  fact(chart, `${label}: driftbench then competitor, percent`, [round(ours), round(theirs)], source);
  return {
    label,
    sub,
    bars: [
      { series: 0, value: round(ours), text: p1(ours) },
      { series: 1, value: round(theirs), text: p1(theirs) },
    ],
  };
};
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
const versus = (groups) => {
  const pairs = groups.filter((g) => g.bars.length > 1);
  const n = (test) => pairs.filter((g) => test(g.bars[0].value, g.bars[1].value)).length;
  const parts = [
    [n((a, b) => a > b), 'higher'],
    [n((a, b) => a < b), 'lower'],
    [n((a, b) => a === b), 'equal'],
  ].filter(([count]) => count);
  return `${parts.map(([count, word]) => `${word} with ${count}`).join(', ')} of ${pairs.length} ${pairs.length === 1 ? 'model' : 'models'}`;
};

function sealedJudgeBench() {
  const file = `${SEALED}/judgebench.json`;
  const groups = json(file)
    .cells.filter((c) => c.status === 'MEASURED')
    .map((c) =>
      columnGroup(
        MODEL[c.model],
        `${c.n} pairs`,
        pct(c.ledger.correct, c.n),
        pct(c.promptfoo.correct, c.n),
        file,
        'bench-judgebench',
      ),
    );
  return columns('bench-judgebench', {
    kicker: 'JudgeBench · sealed test · same items, same model per pair of bars',
    title: `JudgeBench: driftbench scores ${versus(groups)}.`,
    key: ['driftbench pair ledger', 'promptfoo select-best'],
    groups,
  });
}

function sealedMmEval() {
  const file = `${SEALED}/mm-eval.json`;
  const data = json(file);
  const groups = [];
  for (const [model, cell] of Object.entries(data.models)) {
    const c = cell.primary;
    if (!c || c.matched < data.planned * 0.98) continue;
    groups.push(
      columnGroup(
        MODEL[model],
        `${c.matched} pairs`,
        c.scores.ledger * 100,
        c.scores.promptfoo * 100,
        file,
        'bench-mm-eval',
      ),
    );
  }
  return columns('bench-mm-eval', {
    kicker: "MM-Eval · sealed test · the benchmark's own score",
    title: `MM-Eval: driftbench scores ${versus(groups)}.`,
    key: ['driftbench pair ledger', 'promptfoo select-best'],
    groups,
  });
}

function sealedRubricBench() {
  const luna = json(`${SEALED}/rubricbench-luna.json`);
  const lite = json(`${SEALED}/rubricbench-flash-lite.json`).cells.find(
    (c) => c.model === 'gemini-3.5-flash-lite',
  );
  const groups = [
    columnGroup(
      MODEL[luna.model],
      `${luna.stats.pairs} pairs`,
      luna.stats.ours.estimate * 100,
      luna.stats.peer.estimate * 100,
      `${SEALED}/rubricbench-luna.json`,
      'bench-rubricbench',
    ),
    columnGroup(
      MODEL[lite.model],
      `${lite.stats.pairs} pairs`,
      lite.stats.ours.estimate * 100,
      lite.stats.peer.estimate * 100,
      `${SEALED}/rubricbench-flash-lite.json`,
      'bench-rubricbench',
    ),
  ];
  return columns('bench-rubricbench', {
    kicker: 'RubricBench · test split · both orders of every pair',
    title: `RubricBench: driftbench scores ${versus(groups)}.`,
    key: ['driftbench pair ledger', 'promptfoo select-best'],
    groups,
    note: 'Claude Haiku 5.5 still running: left out',
  });
}

function sealedVerify() {
  const file = `${SEALED}/verify.json`;
  const data = json(file);
  const c = data.cells.find((x) => x.model === 'gpt-6-luna');
  const [ours, theirs] = c.official.correct;
  const n = c.official.matchedItems;
  const groups = [
    columnGroup(MODEL[c.model], `${n} items`, pct(ours, n), pct(theirs, n), file, 'bench-verify'),
  ];
  const fail = data.cheaters.alwaysFailOfficial * 100;
  fact('bench-verify', 'a judge that always says fail, percent', round(fail), file);
  groups.push({
    label: 'No model',
    sub: 'always says fail',
    bars: [{ series: 2, value: round(fail), text: p1(fail) }],
  });
  return columns('bench-verify', {
    kicker: 'LongJudgeBench verify · test split · is the final answer correct',
    title: 'Verify: above promptfoo, below a judge that always says fail.',
    key: ['driftbench verify cascade', 'promptfoo llm-rubric', 'no model'],
    groups,
    note: 'Claude Haiku 5.5 pending: left out',
  });
}

function sealedWriting() {
  const file = `${SEALED}/writing.json`;
  const cells = json(file).cells;
  const groups = [];
  for (const model of ['haiku', 'gpt-6-luna', 'gemini-3.5-flash-lite']) {
    const ours = cells.find((c) => c.model === model && c.contestant === 'pair-ledger');
    const peer = cells.find((c) => c.model === model && c.contestant === 'promptfoo');
    if (ours?.status !== 'complete' || peer?.status !== 'complete') continue;
    groups.push(
      columnGroup(MODEL[model], `${ours.pairs} pairs`, ours.accuracy, peer.accuracy, file, 'bench-writing'),
    );
  }
  const longer = cells.find((c) => c.contestant === 'longer-wins');
  fact('bench-writing', 'a rule that picks the longer reply, percent', round(longer.accuracy), file);
  groups.push({
    label: 'No model',
    sub: 'picks the longer reply',
    bars: [{ series: 2, value: round(longer.accuracy), text: p1(longer.accuracy) }],
  });
  return columns('bench-writing', {
    kicker: 'LongJudgeBench writing preference · test split · both orders',
    title: `Writing: driftbench scores ${versus(groups)}; picking the longer reply beats both.`,
    key: ['driftbench pair ledger', 'promptfoo select-best', 'no model'],
    groups,
  });
}

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

const data = {};
for (const [name, build] of Object.entries(CHARTS)) {
  data[name] = build();
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
