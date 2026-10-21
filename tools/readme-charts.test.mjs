import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { summarySvg } from './readme-summary.mjs';

const script = fileURLToPath(new URL('./readme-charts.mjs', import.meta.url));
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The chart as the script builds it, with the all-competitors files of `peers` (or none). */
function chartRun(name, peers, defaults) {
  const dir = mkdtempSync(join(tmpdir(), 'readme-charts-'));
  roots.push(dir);
  mkdirSync(dir, { recursive: true });
  for (const [bench, file] of Object.entries(peers ?? {})) {
    writeFileSync(join(dir, `${bench}-all-peers.json`), JSON.stringify(file));
  }
  if (defaults) {
    mkdirSync(join(dir, 'default-results'));
    for (const [name, data] of Object.entries(defaults)) {
      writeFileSync(join(dir, 'default-results', name), JSON.stringify(data));
    }
  }
  return spawnSync('node', [script, '--print', name], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DRIFTBENCH_PEERS_DIR: dir,
      DRIFTBENCH_DEFAULT_RESULTS_DIR: join(dir, 'default-results'),
    },
  });
}

function chart(name, peers, defaults) {
  const run = chartRun(name, peers, defaults);
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout);
}
const scores = (panel) => Object.fromEntries(panel.bars.map((b) => [b.name, b.score]));
const panelOf = (c, model) => c.panels.find((p) => p.name === model);

const fixture = {
  bench: 'judgebench',
  model: 'claude-haiku-5-5',
  contestants: [
    { contestant: 'driftbench', transportMissing: 0, all: { score: 0.9 } },
    { contestant: 'promptfoo', transportMissing: 0, all: { score: 0.5 } },
    { contestant: 'fixture-tool', transportMissing: 0, all: { score: 0.71 } },
    { contestant: 'deepeval', transportMissing: 0, all: { score: 0.6 } },
    { contestant: 'langwatch', transportMissing: 12, present: 258, all: { score: 0.2 } },
    { contestant: 'inspect', transportMissing: 270, present: 0 },
  ],
};

describe('readme charts, competitors', () => {
  it('draws only driftbench and promptfoo when no competitor file exists', () => {
    const c = chart('bench-judgebench-models');
    for (const panel of c.panels)
      expect(Object.keys(scores(panel)).sort()).toEqual(['driftbench', 'promptfoo']);
    expect(c.note).toContain('recorded result on this benchmark in this repository: promptfoo.');
  });

  it('draws every contestant of a competitor file, with names for the known tools', () => {
    const c = chart('bench-judgebench-models', { judgebench: fixture });
    const haiku = scores(panelOf(c, 'Claude Haiku 5.5'));
    expect(haiku['fixture-tool']).toBe(71);
    expect(haiku.DeepEval).toBe(60);
    expect(c.note).toContain('promptfoo, fixture-tool, DeepEval, LangWatch');
  });

  it('keeps the recorded driftbench and promptfoo cells, not the file copies', () => {
    const c = chart('bench-judgebench-models', { judgebench: fixture });
    const haiku = scores(panelOf(c, 'Claude Haiku 5.5'));
    expect(haiku.driftbench).toBeCloseTo(88.889, 2);
    expect(haiku.promptfoo).toBeCloseTo(82.963, 2);
  });

  it('draws a contestant that refused some items with its score and the refusal count', () => {
    const c = chart('bench-judgebench-models', { judgebench: fixture });
    const bar = panelOf(c, 'Claude Haiku 5.5').bars.find((b) => b.name === 'LangWatch');
    expect(bar.score).toBe(20);
    expect(bar.refused).toBe(12);
    expect(panelOf(c, 'Claude Haiku 5.5').bars.find((b) => b.name === 'DeepEval').refused).toBeUndefined();
  });

  it('draws a contestant with no result, and a contestant on another model, as not run', () => {
    const c = chart('bench-judgebench-models', { judgebench: fixture });
    expect(scores(panelOf(c, 'Claude Haiku 5.5')).Inspect).toBeNull();
    expect(scores(panelOf(c, 'GPT-6 Luna'))['fixture-tool']).toBeNull();
    expect(scores(panelOf(c, 'Gemini 3.5 Flash-Lite')).DeepEval).toBeNull();
    expect(scores(panelOf(c, 'GPT-6 Luna')).LangWatch).toBeNull();
  });

  it('reads the primary cohort for MM-Eval', () => {
    const file = {
      bench: 'mmeval',
      model: 'claude-haiku-5-5',
      contestants: [
        { contestant: 'fixture-tool', transportMissing: 0, primary: { score: 0.5 }, all: { score: 0.9 } },
      ],
    };
    const c = chart('bench-mm-eval-models', { mmeval: file });
    expect(scores(panelOf(c, 'Claude Haiku 5.5'))['fixture-tool']).toBe(50);
  });
});

describe('readme charts, best case per benchmark', () => {
  const cell = (score, n = 100) => ({ score, n });
  const best = {
    bench: 'verify',
    model: 'claude-haiku-5-5',
    unit: 'item',
    contestants: [
      { contestant: 'driftbench', transportMissing: 0, all: cell(0.7) },
      { contestant: 'promptfoo', transportMissing: 0, all: cell(0.6) },
      { contestant: 'deepeval', transportMissing: 3, all: cell(0.8) },
      { contestant: 'inspect', transportMissing: 0, all: cell(0.5) },
    ],
  };
  const writing = {
    bench: 'writing',
    model: 'claude-haiku-5-5',
    unit: 'game',
    contestants: [
      { contestant: 'driftbench', transportMissing: 0, all: cell(0.6127, 346) },
      { contestant: 'driftbench-reader-first', transportMissing: 0, all: cell(0.6763, 346) },
      { contestant: 'promptfoo', transportMissing: 0, all: cell(0.5694, 346) },
    ],
  };

  it('is one panel on one model, sorted high to low, with no baseline bar', () => {
    const c = chart('bench-verify', { verify: best });
    expect(c.panels).toHaveLength(1);
    expect(c.panels[0].name).toBe('Claude Haiku 5.5');
    expect(c.panels[0].bars.map((b) => b.name)).toEqual(['DeepEval', 'driftbench', 'promptfoo', 'Inspect']);
    expect(c.panels[0].bars.some((b) => b.baseline)).toBe(false);
  });

  it("labels refusals, and keeps the title to driftbench's own score", () => {
    const c = chart('bench-verify', { verify: best });
    expect(c.title).toBe('Verify: driftbench scores 70.0.');
    expect(c.panels[0].bars[0].refused).toBe(3);
  });

  it('draws the reader-first setting as plain "driftbench" with a footnote', () => {
    const c = chart('bench-writing', { writing });
    const bars = scores(c.panels[0]);
    expect(bars.driftbench).toBeCloseTo(67.63, 2);
    expect(Object.keys(bars)).not.toContain('driftbench-reader-first');
    expect(c.title).not.toContain('reader-first');
    expect(c.key.map((k) => k.label)).toContain('driftbench');
    expect(c.key.some((k) => k.label.includes('reader-first'))).toBe(false);
    expect(c.note).toContain('default 61.3');
  });
});

describe('readme summary chart', () => {
  const row = (score) => ({
    id: 'x',
    name: 'X',
    unit: 'items',
    n: 10,
    definition: 'd',
    cells: ['driftbench', 'promptfoo', 'DeepEval', 'Inspect', 'Langfuse', 'LangWatch'].map((name, i) => ({
      name,
      score: i === 0 ? score : 60 + i,
    })),
  });
  const args = (rows) => ({ rows, title: 'T', model: 'M', sources: 'S', notes: ['a'] });

  it('draws every score as a label, ranked, with no tally words', () => {
    const svg = summarySvg(false, args([row(90)]));
    expect((svg.match(/class="score"/g) ?? []).length).toBe(6);
    expect(svg).not.toMatch(/wins|losses|ties|Holm/);
  });

  it('refuses a score that falls inside the axis break', () => {
    expect(() => summarySvg(false, args([row(40)]))).toThrow(/axis break/);
  });

  it('takes its numbers from the benchmark charts, in the committed alt text', () => {
    const run = spawnSync('node', [script, '--print', 'summary'], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const c = JSON.parse(run.stdout);
    // The committed JudgeBench chart supplies the number, whichever result set is committed.
    const bench = spawnSync('node', [script, '--print', 'bench-judgebench'], { encoding: 'utf8' });
    expect(bench.status, bench.stderr).toBe(0);
    const ours = JSON.parse(bench.stdout)
      .panels[0].bars.find((b) => b.ours)
      .score.toFixed(1);
    const judgebench = c.alt.split('JudgeBench, 270 pairs: ')[1].split(' MM-Eval')[0];
    expect(judgebench).toContain(`driftbench ${ours}`);
    expect(c.svg.light).toContain(ours);
  });
});

describe('readme charts, declared v8 strict-relevance annotation', () => {
  it('labels retention by the paired test and shows its exact p value', () => {
    const c = chart('hard-deepeval');
    const source = JSON.parse(
      readFileSync(new URL('../comparisons/default-on/readme-v7/ANALYSIS.json', import.meta.url), 'utf8'),
    );
    const retention = source.rows.find((r) => r.row === 'Knowledge retention');
    const group = c.groups.find((r) => r.label.replaceAll('|', '') === 'Knowledge retention');
    const verdict =
      retention.pairedHolmP > 0.05 || retention.v7 === retention.peer
        ? 'level'
        : retention.v7 > retention.peer
          ? 'ahead'
          : 'behind';
    expect(group.sub).toBe(`of ${retention.n}; ${verdict}`);
    expect(c.note).toContain(`Retention exact p = ${retention.pairedP.toPrecision(3)}`);
    if (retention.n - retention.pairedN) {
      expect(c.note).toContain(
        `Knowledge retention: ${retention.n - retention.pairedN} incomplete pairs excluded`,
      );
    }
    expect(c.note).toContain('Holm p <= 0.05');
  });

  it('draws the bar as plain driftbench, with the v8 metric declaration in its footnote', () => {
    const c = chart('hard-deepeval');
    const marked = c.groups.filter((g) => g.label.endsWith(' *'));
    expect(marked.length).toBeGreaterThan(0);
    expect(c.key[0]).toBe('driftbench');
    expect(c.note).toContain('* G-Eval strict: v8 default, metric declares request-fulfillment');
    expect(c.note).not.toContain('* opt-in setting response-relevance');
  });

  it('leaves the existing leads figure unchanged', () => {
    const c = chart('judge-leads');
    const labels = c.groups.flatMap((g) => g.rows.map((r) => r.label));
    expect(labels).not.toContain('G-Eval, strict');
  });
});

describe('readme charts, committed files', () => {
  it('match the result files they are read from', () => {
    const run = spawnSync('node', [script, '--check'], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
  });
});

// Synthetic values deliberately differ from the historical scores and rankings.
function defaultFixtures() {
  const metadata = { policy: 'default-on-v6', model: 'claude-haiku-5-5' };
  return {
    'judgebench.json': {
      metadata,
      cells: [
        {
          model: 'claude-haiku-5-5',
          status: 'MEASURED',
          n: 10,
          ledger: { correct: 3 },
          promptfoo: { correct: 4 },
        },
        { model: 'gpt-6-luna', status: 'MEASURED', n: 10, ledger: { correct: 9 }, promptfoo: { correct: 8 } },
      ],
    },
    'mm-eval.json': {
      metadata,
      planned: 20,
      models: { haiku: { primary: { matched: 20, scores: { ledger: 0.45, promptfoo: 0.35 } } } },
    },
    'rubricbench-haiku.json': {
      metadata,
      cells: [
        {
          model: 'claude-haiku-5-5',
          coverage: { complete: true },
          stats: { pairs: 30, ours: { estimate: 0.5 }, peer: { estimate: 0.6 } },
        },
      ],
    },
    'verify.json': {
      metadata,
      cheaters: { alwaysFailOfficial: 0.6 },
      cells: [{ model: 'haiku', official: { correct: [8, 7], matchedItems: 10 } }],
    },
    'writing.json': {
      metadata,
      cells: [
        { model: 'haiku', contestant: 'pair-ledger', status: 'complete', pairs: 40, accuracy: 75 },
        { model: 'haiku', contestant: 'promptfoo', status: 'complete', pairs: 40, accuracy: 65 },
        { contestant: 'longer-wins', accuracy: 55 },
      ],
    },
  };
}

describe('readme charts, frozen default results', () => {
  it.each([
    ['bench-judgebench-models', 30, 40, '10 pairs'],
    ['bench-mm-eval-models', 45, 35, '20 pairs'],
    ['bench-rubricbench-models', 50, 60, '30 pairs'],
    ['bench-verify-models', 80, 70, '10 items'],
    ['bench-writing-models', 75, 65, '40 pairs'],
  ])('reads %s from the frozen Haiku default, without mixing older defaults', (name, ours, peer, size) => {
    const c = chart(name, undefined, defaultFixtures());
    const haiku = panelOf(c, 'Claude Haiku 5.5');
    expect(scores(haiku).driftbench).toBe(ours);
    expect(scores(haiku).promptfoo).toBe(peer);
    expect(haiku.model).toBe(size);
    expect(c.note).toContain(size);
    for (const model of ['GPT-6 Luna', 'Gemini 3.5 Flash-Lite']) {
      expect(scores(panelOf(c, model)).driftbench).toBeNull();
      expect(panelOf(c, model).model).toBe('not run');
    }
    expect(c.note).toContain('default-on-v6');
    expect(c.note).toContain('Claude Haiku 5.5');
    expect(c.note).toContain('unverified historical (lane report)');
    expect(c.key[0].label).toBe('driftbench default-on-v6');
    expect(c.title).not.toMatch(/above promptfoo, below|longer reply beats both/);
    expect(c.note).not.toMatch(
      /nine safety|GPT-6 Luna only|270 pairs per model|790 pairs per model|173 pairs per model/,
    );
  });

  it('keeps recorded competitor scores separate from the new default score', () => {
    const c = chart('bench-judgebench-models', { judgebench: fixture }, defaultFixtures());
    const haiku = scores(panelOf(c, 'Claude Haiku 5.5'));
    expect(haiku.driftbench).toBe(30);
    expect(haiku.promptfoo).toBe(40);
    expect(haiku.DeepEval).toBe(60);
    expect(haiku['fixture-tool']).toBe(71);
  });

  it.each(Object.keys(defaultFixtures()))('rejects a partial default result set missing %s', (missing) => {
    const files = defaultFixtures();
    delete files[missing];
    const run = chartRun('bench-judgebench-models', undefined, files);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(`incomplete default result set: missing ${missing}`);
  });

  it.each(['policy', 'model'])('rejects an unexpected frozen %s', (field) => {
    const files = defaultFixtures();
    files['verify.json'].metadata = { ...files['verify.json'].metadata, [field]: 'unexpected' };
    const run = chartRun('bench-judgebench-models', undefined, files);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('expected default-on-v6 on claude-haiku-5-5');
  });
});

// One all-competitors file per benchmark on Claude Haiku 5.5. The promptfoo cell matches the default
// fixtures, as the real report requires; the recorded driftbench rows are older defaults.
function peersOnHaiku() {
  const cell = (score, n) => ({ score, n });
  const file = (bench, cohort, promptfoo, n, extra = []) => ({
    bench,
    model: 'claude-haiku-5-5',
    contestants: [
      { contestant: 'driftbench', transportMissing: 0, [cohort]: cell(0.99, n) },
      ...extra,
      { contestant: 'promptfoo', transportMissing: 0, [cohort]: cell(promptfoo, n) },
      { contestant: 'deepeval', transportMissing: 0, [cohort]: cell(0.21, n) },
      { contestant: 'inspect', transportMissing: 0, [cohort]: cell(0.22, n) },
      { contestant: 'langfuse', transportMissing: 0, [cohort]: cell(0.23, n) },
      { contestant: 'langwatch', transportMissing: 0, [cohort]: cell(0.24, n) },
    ],
  });
  return {
    judgebench: file('judgebench', 'all', 0.4, 10),
    mmeval: file('mmeval', 'primary', 0.35, 20),
    rubricbench: file('rubricbench', 'all', 0.6, 60),
    verify: file('verify', 'all', 0.7, 10),
    writing: file('writing', 'all', 0.65, 80, [
      { contestant: 'driftbench-reader-first', transportMissing: 0, all: cell(0.98, 80) },
    ]),
  };
}

describe('readme charts, best case on the frozen default', () => {
  it.each([
    ['bench-judgebench', 30],
    ['bench-mm-eval', 45],
    ['bench-rubricbench', 50],
    ['bench-verify', 80],
    ['bench-writing', 75],
  ])('draws %s with the frozen default score, never the recorded driftbench row', (name, ours) => {
    const c = chart(name, peersOnHaiku(), defaultFixtures());
    const s = scores(c.panels[0]);
    expect(s.driftbench).toBeCloseTo(ours, 6);
    expect(s.DeepEval).toBeCloseTo(21, 6);
    expect(c.note).toContain('default-on-v6');
    expect(c.note).toContain('unverified historical (lane report)');
    expect(c.note).not.toContain('reader-first');
  });

  it('refuses a default result whose promptfoo score differs from the competitor file', () => {
    const peers = peersOnHaiku();
    peers.verify.contestants.find((x) => x.contestant === 'promptfoo').all.score = 0.5;
    const run = chartRun('bench-verify', peers, defaultFixtures());
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('populations differ');
  });

  it('refuses a competitor file run on another model', () => {
    const peers = peersOnHaiku();
    peers.verify.model = 'gpt-6-luna';
    const run = chartRun('bench-verify', peers, defaultFixtures());
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('the frozen default ran on claude-haiku-5-5');
  });

  it('names the frozen default in the summary, without the reader-first footnote', () => {
    // The summary chart breaks its axis from 30 to 50, so every fixture score sits outside it.
    const files = defaultFixtures();
    files['judgebench.json'].cells[0].ledger.correct = 6;
    files['judgebench.json'].cells[0].promptfoo.correct = 7;
    files['mm-eval.json'].models.haiku.primary.scores = { ledger: 0.55, promptfoo: 0.65 };
    files['rubricbench-haiku.json'].cells[0].stats.ours.estimate = 0.56;
    const peers = peersOnHaiku();
    const promptfoo = (bench) => peers[bench].contestants.find((x) => x.contestant === 'promptfoo');
    promptfoo('judgebench').all.score = 0.7;
    promptfoo('mmeval').primary.score = 0.65;
    const run = chartRun('summary', peers, files);
    expect(run.status, run.stderr).toBe(0);
    const c = JSON.parse(run.stdout);
    expect(c.alt).toContain('default-on-v6');
    expect(c.alt).not.toContain('Reader-first');
    expect(c.alt).toContain('driftbench 75.0');
  });
});

describe('readme charts, v7 held-out results', () => {
  const analysis = JSON.parse(
    readFileSync(new URL('../comparisons/default-on/readme-v7/ANALYSIS.json', import.meta.url), 'utf8'),
  );
  it('preserves every v7 hard-row score except the measured v8 strict-relevance row, including the panel decline', () => {
    const rows = ['deepeval', 'promptfoo', 'langfuse', 'inspect'].flatMap((tool) => {
      const c = chart(`hard-${tool}`);
      if (c.rows) return [{ label: 'Reference correctness', ours: c.rows[0].sub, peer: c.rows[1].sub }];
      return c.groups.map((g) => ({
        label: g.label.replaceAll('|', '').replace(' *', '').replace('G-Eval, strict', 'G-Eval strict'),
        ours: g.bars[0].text,
        peer: g.bars[1].text,
      }));
    });
    expect(rows).toHaveLength(18);
    for (const row of analysis.rows) {
      const plotted = rows.find((r) => r.label === row.row);
      expect(Number.parseInt(plotted.ours, 10)).toBe(
        row.row === 'G-Eval strict'
          ? JSON.parse(
              readFileSync(
                new URL('../comparisons/default-on/strict-v8/RESULT.json', import.meta.url),
                'utf8',
              ),
            ).correct
          : row.v7,
      );
      expect(Number.parseInt(plotted.peer, 10)).toBe(row.peer);
    }
  });
  it('uses the v7 cost rather than earlier driftbench spend', () => {
    const c = chart('judge-cost');
    const qa = c.groups[0].rows.find((r) => r.label === 'Inspect, model-graded QA');
    expect(qa.a).toBe(analysis.rows.find((r) => r.row === 'Model-graded QA').v7UsdPer100);
    expect(c.note).toContain('Messages API');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const panel = c.groups[0].rows.find((r) => r.label === 'Inspect, grader panel');
    const score = analysis.rows.find((r) => r.row === 'Grader panel');
    expect(readme).toContain(
      `default-on-v7 spends $${panel.a.toFixed(3)} per 100 cases against $${panel.b.toFixed(3)}, and scores ${score.v7} of ${score.n} against ${score.peer}`,
    );
    expect(readme).not.toContain('at the same score, 59 of 60');
  });
});
