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
    const c = chart('bench-judgebench');
    for (const panel of c.panels)
      expect(Object.keys(scores(panel)).sort()).toEqual(['driftbench', 'promptfoo']);
    expect(c.note).toContain('recorded result on this benchmark in this repository: promptfoo.');
  });

  it('draws every contestant of a competitor file, with names for the known tools', () => {
    const c = chart('bench-judgebench', { judgebench: fixture });
    const haiku = scores(panelOf(c, 'Claude Haiku 5.5'));
    expect(haiku['fixture-tool']).toBe(71);
    expect(haiku.DeepEval).toBe(60);
    expect(c.note).toContain('promptfoo, fixture-tool, DeepEval, LangWatch');
  });

  it('keeps the recorded driftbench and promptfoo cells, not the file copies', () => {
    const c = chart('bench-judgebench', { judgebench: fixture });
    const haiku = scores(panelOf(c, 'Claude Haiku 5.5'));
    expect(haiku.driftbench).toBe(88.89);
    expect(haiku.promptfoo).toBe(82.96);
  });

  it('draws a contestant that refused some items with its score and the refusal count', () => {
    const c = chart('bench-judgebench', { judgebench: fixture });
    const bar = panelOf(c, 'Claude Haiku 5.5').bars.find((b) => b.name === 'LangWatch');
    expect(bar.score).toBe(20);
    expect(bar.refused).toBe(12);
    expect(panelOf(c, 'Claude Haiku 5.5').bars.find((b) => b.name === 'DeepEval').refused).toBeUndefined();
  });

  it('draws a contestant with no result, and a contestant on another model, as not run', () => {
    const c = chart('bench-judgebench', { judgebench: fixture });
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
    const c = chart('bench-mm-eval', { mmeval: file });
    expect(scores(panelOf(c, 'Claude Haiku 5.5'))['fixture-tool']).toBe(50);
  });
});

describe('readme charts, median and margin', () => {
  const runsFixture = {
    bench: 'judgebench',
    model: 'claude-haiku-5-5',
    contestants: [
      {
        contestant: 'multi-run',
        transportMissing: 0,
        all: { score: 0.5, runs: [0.5, 0.9, 0.7], wilson95: [0.1, 0.2] },
      },
      { contestant: 'even-runs', transportMissing: 0, all: { runs: [0.4, 0.6] } },
      { contestant: 'one-run', transportMissing: 0, all: { score: 0.6, wilson95: [0.55, 0.66] } },
      { contestant: 'bare', transportMissing: 0, all: { score: 0.3 } },
    ],
  };
  const haiku = (name) =>
    panelOf(chart('bench-judgebench', { judgebench: runsFixture }), 'Claude Haiku 5.5').bars.find(
      (b) => b.name === name,
    );

  it('draws the median of several runs, with min to max as the margin and the run count', () => {
    const b = haiku('multi-run');
    expect(b.score).toBe(70);
    expect(b.margin).toEqual([50, 90]);
    expect(b.marginKind).toBe('range');
    expect(b.runs).toBe(3);
  });

  it('takes the mean of the two middle runs for an even count', () => {
    expect(haiku('even-runs').score).toBe(50);
  });

  it('draws a single run with its stored interval and "1 run"', () => {
    const b = haiku('one-run');
    expect(b.runs).toBe(1);
    expect(b.margin).toEqual([55, 66]);
    expect(b.marginKind).toBe('interval');
  });

  it('draws a single run with no stored interval as a bar without a margin', () => {
    const b = haiku('bare');
    expect(b.runs).toBe(1);
    expect(b.margin).toBeUndefined();
  });

  it('gives driftbench and promptfoo the stored interval of their one recorded run', () => {
    const b = haiku('driftbench');
    expect(b.runs).toBe(1);
    expect(b.margin[0]).toBeLessThan(b.score);
    expect(b.margin[1]).toBeGreaterThan(b.score);
  });
});

describe('readme charts, committed files', () => {
  it('match the result files they are read from', () => {
    const run = spawnSync('node', [script, '--check'], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
  });
});
