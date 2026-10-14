import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./readme-charts.mjs', import.meta.url));
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The chart as the script builds it, with the all-competitors files of `peers` (or none). */
function chart(name, peers) {
  const dir = mkdtempSync(join(tmpdir(), 'readme-charts-'));
  roots.push(dir);
  mkdirSync(dir, { recursive: true });
  for (const [bench, file] of Object.entries(peers ?? {})) {
    writeFileSync(join(dir, `${bench}-all-peers.json`), JSON.stringify(file));
  }
  const run = spawnSync('node', [script, '--print', name], {
    encoding: 'utf8',
    env: { ...process.env, DRIFTBENCH_PEERS_DIR: dir },
  });
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

  it('says in the title when a competitor is ahead, and labels refusals', () => {
    const c = chart('bench-verify', { verify: best });
    expect(c.title).toContain('behind DeepEval');
    expect(c.panels[0].bars[0].refused).toBe(3);
  });

  it('says ahead when driftbench leads', () => {
    const file = { ...best, contestants: best.contestants.filter((x) => x.contestant !== 'deepeval') };
    const c = chart('bench-verify', { verify: file });
    expect(c.title).toContain('ahead of promptfoo at 60.0');
  });

  it('draws the reader-first setting as plain "driftbench" with a footnote', () => {
    const c = chart('bench-writing', { writing });
    const bars = scores(c.panels[0]);
    expect(bars.driftbench).toBeCloseTo(67.63, 2);
    expect(Object.keys(bars)).not.toContain('driftbench-reader-first');
    expect(c.title).toContain('reader-first');
    expect(c.note).toContain('default 61.3');
  });
});

describe('readme charts, committed files', () => {
  it('match the result files they are read from', () => {
    const run = spawnSync('node', [script, '--check'], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
  });
});
