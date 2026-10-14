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
    ['bench-judgebench', 30, 40, '10 pairs'],
    ['bench-mm-eval', 45, 35, '20 pairs'],
    ['bench-rubricbench', 50, 60, '30 pairs'],
    ['bench-verify', 80, 70, '10 items'],
    ['bench-writing', 75, 65, '40 pairs'],
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
    const c = chart('bench-judgebench', { judgebench: fixture }, defaultFixtures());
    const haiku = scores(panelOf(c, 'Claude Haiku 5.5'));
    expect(haiku.driftbench).toBe(30);
    expect(haiku.promptfoo).toBe(40);
    expect(haiku.DeepEval).toBe(60);
    expect(haiku['fixture-tool']).toBe(71);
  });

  it.each(Object.keys(defaultFixtures()))('rejects a partial default result set missing %s', (missing) => {
    const files = defaultFixtures();
    delete files[missing];
    const run = chartRun('bench-judgebench', undefined, files);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(`incomplete default result set: missing ${missing}`);
  });

  it.each(['policy', 'model'])('rejects an unexpected frozen %s', (field) => {
    const files = defaultFixtures();
    files['verify.json'].metadata = { ...files['verify.json'].metadata, [field]: 'unexpected' };
    const run = chartRun('bench-judgebench', undefined, files);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('expected default-on-v6 on claude-haiku-5-5');
  });
});
