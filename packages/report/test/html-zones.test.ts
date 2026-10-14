import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { beforeAll, describe, expect, it } from 'vitest';
import { type CampaignData, loadCampaign } from '../src/data';
import { renderHtml } from '../src/html';
import { pageModel } from '../src/html-zones';
import { buildScorecard, type Scorecard } from '../src/scorecard';
import { dataOf, run, storeAcmeCampaign } from './support';

let card: Scorecard;
let html: string;
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
  const acme = await loadCampaign(store, 'c-acme');
  fault = await loadCampaign(store, 'c-acme-x3');
  await store.close();
  card = buildScorecard(fault, { baseline: acme, margin: 0.15 });
  html = renderHtml(card);
}, 120_000);

/** The part of the page between an opening tag and the next zone. */
function zone(id: string): string {
  const start = html.indexOf(`id="${id}"`);
  expect(start, id).toBeGreaterThan(0);
  const next = html.indexOf('<section', start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}

describe('the three zones of the scorecard page', () => {
  it('opens on the numbers: cases, runs and regressions, each counted from the scorecard', () => {
    const m = pageModel(card);
    const passing = m.cases.filter((c) => c.pass).length;
    expect(html).toContain(`<p class="n">${passing}<small>of ${card.lines.length}</small></p>`);
    expect(html).toContain(
      `<p class="n">${card.campaign.passing}<small>of ${card.campaign.runs}</small></p>`,
    );
    const compare = card.compare;
    expect(compare).toBeDefined();
    expect(html).toContain(
      `<p class="n">${compare?.allPass.table.regressed}<small>of ${compare?.pairs.length}</small></p>`,
    );
  });

  it('draws three charts with a title, a unit and a caption that names both axes', () => {
    const charts = zone('charts');
    expect(charts.match(/<figure class="card chart">/g)).toHaveLength(3);
    for (const title of ['Cases passing by test', 'Runs passing by mode', 'Failed checks by type'])
      expect(charts).toContain(`<h3>${title} <span>`);
    expect(charts.match(/<figcaption>x: [^<]+ · y: /g)).toHaveLength(3);
    expect(charts).toContain('<g class="ser-b">');
    expect(charts).toContain('<g class="ser-c">');
  });

  it('lists the baseline and the candidate, each with a switch that draws it in the charts', () => {
    const versions = zone('versions');
    expect(versions).toContain('id="vis-b" checked');
    expect(versions).toContain('id="vis-c" checked');
    expect(versions).toContain('>c-acme</span><span class="vtag">Baseline</span>');
    expect(versions).toContain('>c-acme-x3</span><span class="vtag">Candidate</span>');
  });

  it('lists one row per test with its status, its score and one pill per failing check family', () => {
    const m = pageModel(card);
    const tests = zone('tests');
    expect(tests.match(/<details class="test /g)).toHaveLength(m.tests.length);
    for (const t of m.tests) {
      const pass = t.casesPassing === t.cases.length;
      expect(tests).toContain(`${t.casesPassing} of ${t.cases.length} cases<small>`);
      expect(tests).toMatch(new RegExp(`<details class="test ${pass ? 't-pass' : 't-fail'}`));
    }
    const failing = m.tests.filter((t) => t.casesPassing < t.cases.length).length;
    expect(tests).toContain(`<label for="tf-fail">Failing<span class="c">${failing}</span></label>`);
    expect(m.checkColumns.length).toBeGreaterThan(0);
    expect(tests).toContain(`<span class="cph">${m.checkColumns[0]?.replace(/_/g, '_<wbr>')}</span>`);
    expect(tests).toMatch(/<span class="cp fail" title="[^"]+: \d+ failed checks">Fail \d+<\/span>/);
  });

  it('opens a test into its cases, each with its runs, its change against the baseline and a link to its runs', () => {
    const m = pageModel(card);
    const regressed = m.cases.find((c) => c.baseline === true && !c.pass);
    expect(regressed).toBeDefined();
    const tests = zone('tests');
    expect(tests).toContain('<span class="move down">pass → fail</span>');
    expect(tests).toContain(`<a class="link" href="#case-${regressed?.index}">Runs</a>`);
    expect(html).toContain(`<span class="anchor" id="case-${regressed?.index}"></span>`);
  });

  it('lists every run in a table whose row opens the run panel', () => {
    const runs = html.slice(html.indexOf('<section id="drilldown">'), html.indexOf('<a class="scrim"'));
    expect(runs.match(/<tr class="run-row /g)).toHaveLength(card.drilldown.length);
    for (const entry of card.drilldown) {
      expect(runs).toContain(`<a class="rowlink" href="#run-${entry.runId}">`);
      expect(html).toContain(`<section class="drawer" id="run-${entry.runId}"`);
    }
    const failed = card.drilldown.filter((entry) => !entry.pass).length;
    expect(runs).toContain(`<label for="rf-fail">Failed<span class="c">${failed}</span></label>`);
  });

  it('shows in a run panel the conversation, the checks with their evidence and the run data', () => {
    const failing = card.drilldown.find((entry) => !entry.pass);
    expect(failing).toBeDefined();
    if (!failing) return;
    const start = html.indexOf(`<section class="drawer" id="run-${failing.runId}"`);
    const panel = html.slice(start, html.indexOf('</section>', start));
    for (const tab of ['Conversation', 'Checks', 'Run data']) expect(panel).toContain(`">${tab}`);
    const block = failing.blocks.find((b) => !b.pass);
    const verdict = block?.verdicts.find((v) => v.outcome === 'fail');
    expect(verdict).toBeDefined();
    expect(panel).toContain(`<span class="cid">${verdict?.id}</span>`);
    expect(panel).toContain(
      '<caption>Verdicts with evidence: every one that did not pass, every judged one</caption>',
    );
    if (block?.stimulus) expect(panel).toContain('<p class="who">User</p>');
    expect(panel).toContain(`<dt>Target</dt><dd>${failing.target}</dd>`);
  });

  it('is dark by default with a light theme one click away, and keeps every detailed table folded below', () => {
    expect(html).toContain(':root:has(#theme-light:checked){');
    expect(html).toContain('<label class="theme-btn" for="theme-light">');
    expect(html.indexOf('<section id="drilldown">')).toBeLessThan(html.indexOf('id="details"'));
    for (const id of ['summary', 'compare', 'reliability', 'succession'])
      expect(html).toMatch(
        new RegExp(`<details class="more"><summary>[^<]+</summary>\\n<section id="${id}">`),
      );
  });

  it('leaves out the versions and every baseline column when the scorecard has no baseline', () => {
    const alone = renderHtml(buildScorecard(fault));
    expect(alone).not.toContain('id="versions"');
    expect(alone).not.toContain('Vs baseline');
    expect(alone).not.toContain('<g class="ser-b">');
  });

  it('marks a check pill "not shown" when the run limit left out the runs it would read', () => {
    const limited = buildScorecard(fault, { maxRuns: 2 });
    const page = renderHtml(limited);
    expect(page).toContain('<span class="cp none"');
    expect(page).toContain('left out by the run limit');
  });

  it('reads the baseline of each target when one spec runs on two targets', () => {
    const targets = [
      { adapter: 'function', agent: 'alpha' },
      { adapter: 'function', agent: 'beta' },
    ];
    const baseline = dataOf(
      targets.map((target) => run({ target })),
      {},
      'c-base',
    );
    const candidate = dataOf(
      targets.map((target, i) =>
        run({
          target,
          blocks: [{ pass: i === 1, verdicts: [{ id: 'must.0', outcome: i === 1 ? 'pass' : 'fail' }] }],
        }),
      ),
      {},
      'c-cand',
    );
    const two = buildScorecard(candidate, { baseline, margin: 0.15 });
    expect(two.compare?.allPass.table.regressed).toBe(1);
    const m = pageModel(two);
    expect(m.tests).toHaveLength(2);
    expect(m.tests.map((t) => t.casesBaseline)).toEqual([1, 1]);
    expect(m.tests.map((t) => t.regressed).sort()).toEqual([0, 1]);
    const page = renderHtml(two);
    expect(page).toContain('<label for="tf-reg">Regressed<span class="c">1</span></label>');
    expect(page).toContain('<span class="move down">1 regressed</span>');
    expect(page).toContain('<span class="move down">pass → fail</span>');
    expect(page).not.toContain('no baseline');
  });

  it('filters by target for every target, however many', () => {
    const nine = dataOf(
      Array.from({ length: 9 }, (_, i) => run({ target: { adapter: 'function', agent: `t-${i}` } })),
    );
    const page = renderHtml(buildScorecard(nine));
    for (let i = 0; i < 9; i++) {
      expect(page).toContain(`<input type="radio" name="tt" id="tt-${i}">`);
      expect(page).toContain(`:root:has(#tt-${i}:checked) .test:not(.tt-${i}){display:none}`);
    }
  });

  it('escapes what the agent wrote in the panel', () => {
    const tricky = dataOf([
      run({ blocks: [{ pass: false, verdicts: [{ id: 'must.0', outcome: 'fail', evidence: '<i>x</i>' }] }] }),
    ]);
    const page = renderHtml(buildScorecard(tricky));
    expect(page).toContain('&lt;i&gt;x&lt;/i&gt;');
    expect(page).not.toContain('<i>x</i>');
  });
});
