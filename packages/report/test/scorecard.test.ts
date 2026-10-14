import { fileURLToPath } from 'node:url';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { beforeAll, describe, expect, it } from 'vitest';
import { type CampaignData, loadCampaign, ReportInputError, runPassed } from '../src/data';
import type { Estimate } from '../src/estimate';
import { renderHtml, renderPage, renderRun } from '../src/html';
import { renderJunit } from '../src/junit';
import { readPilotReport } from '../src/pilot';
import { buildScorecard, runDetailOf, toolAccuracy } from '../src/scorecard';
import { dataOf, FIXED, run, storeAcmeCampaign } from './support';

const PILOT = fileURLToPath(new URL('../../../examples/acme/pilot/acme-random', import.meta.url));

let acme: CampaignData;
let fault: CampaignData;

beforeAll(async () => {
  const store = openMemoryStore();
  await storeAcmeCampaign(store, { campaignId: 'c-acme', modes: ['T', 'F', 'P'], repeats: 2 });
  await storeAcmeCampaign(store, {
    campaignId: 'c-acme-x3',
    modes: ['T', 'F', 'P'],
    repeats: 2,
    fault: 'x3-skips-recap',
  });
  acme = await loadCampaign(store, 'c-acme');
  fault = await loadCampaign(store, 'c-acme-x3');
  await store.close();
}, 120_000);

/** Every estimate in a value, with the path that leads to it. */
function estimates(
  value: unknown,
  path = '$',
  out: Array<[string, Estimate]> = [],
): Array<[string, Estimate]> {
  if (value === null || typeof value !== 'object') return out;
  if (value instanceof Map || value instanceof Set) return out;
  if ('estimate' in value && 'method' in value) out.push([path, value as Estimate]);
  for (const [key, child] of Object.entries(value)) estimates(child, `${path}.${key}`, out);
  return out;
}

describe('the scorecard of a stored Acme campaign', () => {
  it('is the same bytes every time: seeded bootstraps, the campaign clock', () => {
    const first = renderHtml(buildScorecard(fault, { baseline: acme, margin: 0.15 }));
    const second = renderHtml(buildScorecard(fault, { baseline: acme, margin: 0.15 }));
    expect(second).toBe(first);
    expect(first).toContain(FIXED);
  });

  it('matches the committed snapshot, with the compare diff and a pilot report', async () => {
    const card = buildScorecard(fault, {
      baseline: acme,
      margin: 0.15,
      maxRuns: 3,
      pilot: readPilotReport(PILOT),
    });
    await expect(renderHtml(card)).toMatchFileSnapshot('./__snapshots__/acme-x3-scorecard.html');
  });

  it('matches the committed JUnit snapshot', async () => {
    await expect(renderJunit(fault)).toMatchFileSnapshot('./__snapshots__/acme-x3-junit.xml');
  });

  it('carries an interval on every estimate, and a reason where there is none', () => {
    const card = buildScorecard(fault, { baseline: acme, margin: 0.15 });
    const all = estimates(card);
    expect(all.length).toBeGreaterThan(100);
    for (const [path, estimate] of all) {
      expect(Number.isFinite(estimate.lower), path).toBe(true);
      expect(Number.isFinite(estimate.upper), path).toBe(true);
      expect(estimate.lower, path).toBeLessThanOrEqual(estimate.estimate + 1e-12);
      expect(estimate.upper, path).toBeGreaterThanOrEqual(estimate.estimate - 1e-12);
      if (estimate.method === 'none') expect(estimate.lower, path).toBe(estimate.upper);
    }
  });

  it('is one file with no script and no external asset, and escapes what the agent wrote', () => {
    const html = renderHtml(buildScorecard(fault, { baseline: acme, margin: 0.15 }));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    // The one url() the page holds is an embedded font: data, never a request.
    expect(html).not.toMatch(
      /<script|<link|<img|src=|href=["']?https?:|@import|url\((?!data:font\/woff2;base64,)/i,
    );
    expect(html).toContain(
      '<input type="checkbox" id="theme-light" class="theme-input" aria-label="Light theme">',
    );
    const tricky = dataOf([
      run({
        blocks: [
          { pass: false, verdicts: [{ id: 'must.0', outcome: 'fail', evidence: '<b>bold</b> & "q"' }] },
        ],
      }),
    ]);
    const page = renderHtml(buildScorecard(tricky));
    expect(page).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;q&quot;');
    expect(page).not.toContain('<b>bold</b>');
  });

  it('shows the regressed verdict, the paired tests, the criteria and the goldens that changed', () => {
    const html = renderHtml(buildScorecard(fault, { baseline: acme, margin: 0.15 }));
    expect(html).toContain('verdict-regressed');
    expect(html).toContain('McNemar exact on the discordant goldens');
    expect(html).toContain('Wilcoxon signed-rank');
    expect(html).toContain('Criteria, Benjamini-Hochberg across them');
    expect(html).toContain('Goldens that changed');
    expect(html).toContain('acme-plan-upgrade · F');
  });

  it('gives every run its own panel, failing runs first, with the evidence of what failed', () => {
    const card = buildScorecard(fault, { baseline: acme, margin: 0.15 });
    const firstPass = card.drilldown.findIndex((entry) => entry.pass);
    expect(firstPass).toBeGreaterThan(0);
    expect(card.drilldown.slice(firstPass).every((entry) => entry.pass)).toBe(true);
    const html = renderHtml(card);
    expect(html).toMatch(
      /<section class="drawer" id="run-[^"]+" aria-label="Run [^"]+">\n<div class="dh">\n<p class="row">.*<\/p>\n<p class="dstatus"><span class="chip fail">Fail<\/span>/,
    );
    expect(html).toContain('Verdicts with evidence: every one that did not pass, every judged one');
    const limited = buildScorecard(fault, { maxRuns: 2 });
    expect(limited.drilldown).toHaveLength(2);
    expect(limited.omittedRuns).toBe(fault.runs.length - 2);
  });

  it('reports the compounding index, the recovery table and the spread view', () => {
    const card = buildScorecard(fault, { baseline: acme, margin: 0.15 });
    expect(card.compounding.specs.length).toBe(6);
    expect(card.recoveryByClass.length).toBeGreaterThan(0);
    expect(card.spread.mode).toBe('F');
    expect(card.spread.cells).toHaveLength(6);
    expect(card.spread.noise?.lines).toBe(6);
    const html = renderHtml(card);
    for (const id of [
      'summary',
      'compare',
      'reliability',
      'succession',
      'compounding',
      'recovery',
      'spread',
      'drilldown',
    ]) {
      expect(html).toContain(`<section id="${id}">`);
    }
  });

  it('runs on the deterministic agent with zero run-to-run noise', () => {
    const card = buildScorecard(acme);
    expect(card.campaign.failing).toBe(0);
    expect(card.spread.noise).toMatchObject({ variance: 0, perGolden: 0, repeatsFor5Points: 1 });
    expect(card.compounding.overall?.index).toBe(0);
    expect(card.compare).toBeUndefined();
  });
});

describe('JUnit XML', () => {
  it('makes one suite per golden, one case per run, a failure per failing run, an error per broken run', () => {
    const data = dataOf([
      run({ specId: 'a', repeat: 0 }),
      run({
        specId: 'a',
        repeat: 1,
        blocks: [
          { pass: false, verdicts: [{ id: 'tools.order', outcome: 'fail', evidence: 'called 0 times' }] },
        ],
      }),
      run({ specId: 'b', status: 'failed' }),
    ]);
    const xml = renderJunit(data);
    expect(xml).toContain('<testsuites name="c-test" tests="3" failures="1" errors="1"');
    expect(xml).toContain('<testsuite name="a" tests="2" failures="1" errors="0"');
    expect(xml).toContain(
      '<failure type="fail" message="1 failing: block 0 tools.order fail: called 0 times">',
    );
    expect(xml).toContain('<error type="failed"');
    expect(xml.match(/<testcase /g)).toHaveLength(3);
  });
});

describe('tool accuracy', () => {
  it('matches calls to the expected tools of each block, per label', () => {
    const spec = {
      blocks: [
        {
          when: { user: 'a' },
          expect: {
            tools: [
              { label: 'x', count: 1 },
              { label: 'y', count: 0 },
            ],
          },
        },
        { when: { user: 'b' }, expect: { tools: [{ label: 'z', count: { min: 2 } }] } },
        { when: { user: 'c' } },
      ],
    };
    const data = dataOf(
      [
        run({ blocks: [{ toolCalls: ['x', 'y'] }, { toolCalls: ['z'] }, { toolCalls: ['w'] }] }),
        run({ repeat: 1, blocks: [{ toolCalls: ['x'] }, { toolCalls: ['z', 'z', 'z'] }, {}] }),
      ],
      { 'spec-a': spec as never },
    );
    const acc = toolAccuracy(data);
    // Run 0: matched x 1, z 1 of 2 expected; 3 calls in blocks with expectations. Run 1: matched 3 of 3, 4 calls.
    expect(acc).toMatchObject({ matched: 5, expected: 6, observed: 7 });
    expect(acc.precision?.estimate).toBeCloseTo(5 / 7, 12);
    expect(acc.recall?.estimate).toBeCloseTo(5 / 6, 12);
    const p = 5 / 7;
    const r = 5 / 6;
    expect(acc.f1?.estimate).toBeCloseTo((2 * p * r) / (p + r), 12);
    expect(acc.recall?.clusters).toBe(2);
  });
});

describe('readPilotReport', () => {
  it('reads a pilot report from its folder', () => {
    const report = readPilotReport(PILOT);
    expect(report.target).toMatchObject({ adapter: 'function', agent: 'acme-random' });
    expect(report.analysis.cells.length).toBe(13);
    expect(report.design.cells).toBe(13);
    expect(report.analysis.observations).toBe(1620);
  });

  it('refuses a missing file or a file that is not a pilot report', () => {
    expect(() => readPilotReport('/nowhere/at/all')).toThrow(ReportInputError);
    const notPilot = fileURLToPath(new URL('../../../package.json', import.meta.url));
    expect(() => readPilotReport(notPilot)).toThrow('is not a pilot report');
  });
});

describe('rendering for the viewer', () => {
  it('links each run of the drilldown when given its address, and leaves the file alone without one', () => {
    const card = buildScorecard(fault, { maxRuns: 2 });
    const linked = renderHtml(card, { runHref: (runId) => `/run/${runId}`, nav: '<nav class="top">x</nav>' });
    // Each run links twice: from its panel and from the drilldown list.
    expect(linked.match(/<a class="open" href="\/run\/[^"]+">open the run<\/a>/g)).toHaveLength(4);
    expect(linked).toContain('<nav class="top">x</nav>');
    expect(renderHtml(card)).not.toContain('class="open"');
  });

  it('renders one run with every block in full and the extra after each block', () => {
    const passing = fault.runs.find(runPassed) as (typeof fault.runs)[number];
    const html = renderRun(
      runDetailOf(fault, passing),
      (block) => `<p class="extra">form ${block.index}</p>`,
    );
    for (const index of passing.blocks.map((block) => block.index)) {
      expect(html).toContain(`id="block-${index}"`);
      expect(html).toContain(`<p class="extra">form ${index}</p>`);
    }
    expect(html).toContain('Machine verdicts passed');
    expect(renderPage('T', [html])).toMatch(/^<!doctype html>[\s\S]*<title>T<\/title>/);
  });
});
