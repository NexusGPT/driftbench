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
    { contestant: 'langwatch', transportMissing: 12, all: { score: 0.2 } },
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

  it('draws an incomplete contestant, and a contestant on another model, as not run', () => {
    const c = chart('bench-judgebench', { judgebench: fixture });
    expect(scores(panelOf(c, 'Claude Haiku 5.5')).LangWatch).toBeNull();
    expect(scores(panelOf(c, 'GPT-6 Luna'))['fixture-tool']).toBeNull();
    expect(scores(panelOf(c, 'Gemini 3.5 Flash-Lite')).DeepEval).toBeNull();
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

describe('readme charts, committed files', () => {
  it('match the result files they are read from', () => {
    const run = spawnSync('node', [script, '--check'], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
  });
});
