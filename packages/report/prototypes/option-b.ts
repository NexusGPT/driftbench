/**
 * Option B, "The board": a dashboard. A silk band with a glass panel holds the verdict and the four numbers
 * that decide it; a section map stays at the left; the rest is a grid of panels: the rate tiles, the
 * golden matrix (one square per golden, by spec and mode), the criteria ladder, the structure, the drift
 * mix and recovery, and a run ledger where every run is one row with its block strip, failing rows open.
 */

import type { Estimate } from '../src/estimate';
import type { RunDetail } from '../src/scorecard';
import {
  blockId,
  blockStrip,
  checksOf,
  DRIFT_NAMES,
  esc,
  fixed,
  intervalBar,
  intervalText,
  MODE_NAMES,
  methodWord,
  ms,
  type Prepared,
  page,
  pct,
  pointsText,
  reasonGroups,
  runId,
  runName,
  stageText,
  structureDiagram,
  toolChips,
  usd,
  VERDICT_WORD,
  verdictSentence,
} from './shared';

const CSS = `
body{font-size:15px}
.band{background:var(--nx-silk-card);padding:40px 24px 32px}
.band .in{max-width:1240px;margin:0 auto}
.glass{position:relative;border-radius:20px;background:var(--nx-glass-bg);border:1px solid var(--nx-glass-line);box-shadow:var(--nx-shadow-glass);-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);padding:28px 32px;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:24px 40px}
.glass::after{content:"";position:absolute;left:14px;right:14px;top:1px;height:1px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.95),rgba(255,255,255,0))}
.glass h1{font-size:clamp(30px,3.6vw,44px);line-height:1.06;margin:10px 0 12px}
.glass .meta{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13.5px;color:var(--nx-ink-2)}
.glass .meta b{font-weight:500;color:var(--nx-ink)}
.keys{display:grid;grid-template-columns:repeat(2,1fr);gap:16px 24px;align-content:start}
.key .n{font-family:var(--nx-serif-text);font-size:34px;line-height:1;white-space:nowrap}
.key .l{font-size:13.5px;margin-top:6px}
.key .ci{font-size:12.5px;color:var(--nx-ink-2);font-variant-numeric:tabular-nums}
.key .ibar{margin-top:5px}
.wrap{max-width:1240px;margin:0 auto;padding:24px 24px 96px;display:grid;grid-template-columns:200px minmax(0,1fr);gap:32px}
.nav{position:sticky;top:24px;align-self:start}
.nav ol{list-style:none;margin:0;padding:0;position:relative}
.nav ol::before{content:"";position:absolute;left:5px;top:6px;bottom:6px;width:2px;background:var(--nx-ill-edge)}
.nav li{position:relative;display:grid;grid-template-columns:12px 1fr;column-gap:12px;align-items:start;padding:4px 0;font-size:14px;color:var(--nx-ink-2)}
.nav li::before{content:"";position:relative;z-index:1;width:12px;height:12px;margin-top:4px;border-radius:50%;border:1px solid var(--nx-line-2);background:var(--nx-page)}
.nav li.red::before{border-color:var(--nx-fail);background:var(--nx-fail)}
.nav a{color:inherit}
.nav .count{display:block;font:400 12px/1.3 var(--nx-mono);color:var(--nx-ink-3)}
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px}
.panel{grid-column:span 12;background:var(--nx-card);border:1px solid var(--nx-line);border-radius:20px;padding:20px 24px;min-width:0}
.panel.w6{grid-column:span 6}.panel.w4{grid-column:span 4}.panel.w8{grid-column:span 8}.panel.w5{grid-column:span 5}.panel.w7{grid-column:span 7}
.panel h2{font-family:var(--nx-serif);font-weight:400;letter-spacing:-.012em;font-size:24px;line-height:1.1;margin:0 0 4px}
.panel .lead{font-size:13.5px;color:var(--nx-ink-2);margin-bottom:14px}
.why{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.why li{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;font-size:14px}
.why li .tag{margin-top:1px}
.why .links a{margin-right:10px;font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.tile{border:1px solid var(--nx-line);border-radius:12px;padding:10px 12px;background:var(--nx-card)}
.tile .l{font-size:12.5px;color:var(--nx-ink-2);line-height:1.3}
.tile .n{font-family:var(--nx-serif-text);font-size:26px;line-height:1.1;margin:4px 0 2px;white-space:nowrap}
.tile .ci{font-size:12px;color:var(--nx-ink-2);font-variant-numeric:tabular-nums}
.tile .s{font:400 10.5px/1.3 var(--nx-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--nx-ink-3);margin-top:4px}
.mx{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:4px;font-size:13px}
.mx col.spec{width:40%}.mx col.p{width:auto}
.mx th{font:500 11.5px/1.2 var(--nx-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--nx-ink-2);text-align:left;padding:0 4px 4px;font-weight:500}
.mx td{padding:0;vertical-align:top}
.mx td.name{padding:6px 8px 0 0;font-size:13px;line-height:1.3;overflow:hidden;text-overflow:ellipsis}
.mx .g{display:flex;flex-wrap:wrap;gap:4px}
.mx .g a{display:flex;align-items:center;min-width:28px;height:28px;padding:0 7px;border-radius:7px;background:var(--nx-ok-soft);font:500 10.5px/1 var(--nx-mono);color:var(--nx-ink-2);white-space:nowrap}
.mx .g a.reg{background:var(--nx-fail)}
.mx .g a.imp{background:var(--nx-ok)}
.mx .g a.bf{background:var(--nx-fail-soft);outline:1.5px solid var(--nx-fail);outline-offset:-1.5px}
.mx .g a.reg{color:#fff}.mx .g a.imp{color:#fff}.mx .g a.bf{color:var(--nx-fail-ink)}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--nx-ink-2);margin-top:10px}
.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:6px}
.matrix2{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}
.matrix2 div{border-radius:10px;padding:10px 12px;background:var(--nx-card-2)}
.matrix2 .n{font-family:var(--nx-serif-text);font-size:26px;line-height:1}
.matrix2 .l{font-size:12.5px;color:var(--nx-ink-2);margin-top:2px}
.matrix2 .fail{background:var(--nx-fail-soft)} .matrix2 .fail .n{color:var(--nx-fail-ink)}
.matrix2 .ok{background:var(--nx-ok-soft)} .matrix2 .ok .n{color:var(--nx-ok-ink)}
.ladder{display:grid;gap:6px}
.ladder .row{display:grid;grid-template-columns:minmax(80px,120px) minmax(0,1fr) 48px 96px;gap:10px;align-items:center;font-size:13px}
.ladder .row.head{font:500 11.5px/1.2 var(--nx-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--nx-ink-2)}
.ladder .row.bad .name{color:var(--nx-fail-ink);font-weight:500}
.ladder .name{font-family:var(--nx-mono);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ladder .cnt{text-align:right;font-variant-numeric:tabular-nums}
.ledger{width:100%;border-collapse:collapse;font-size:13.5px}
.ledger th{font:500 11.5px/1.2 var(--nx-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--nx-ink-2);text-align:left;padding:8px 10px;border-bottom:1px solid var(--nx-ink);white-space:nowrap}
.ledger td{padding:8px 10px;border-bottom:1px solid var(--nx-line);vertical-align:middle}
.ledger tr.bad td:first-child{box-shadow:inset 3px 0 0 var(--nx-fail)}
.ledger .r{text-align:right;font-variant-numeric:tabular-nums}
.run{border:1px solid var(--nx-line);border-radius:12px;margin:10px 0;background:var(--nx-card)}
.run>summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:8px 14px;align-items:center;padding:10px 14px;font-size:13.5px}
.run>summary>span{min-width:0}
.run>summary .sub{display:block;color:var(--nx-ink-2);font-family:var(--nx-mono);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.run .facts{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12.5px;color:var(--nx-ink-2);padding:8px 14px;border-top:1px solid var(--nx-line)}
.blk{display:grid;grid-template-columns:150px minmax(0,1fr) minmax(0,1fr);gap:8px 16px;padding:12px 14px;border-top:1px solid var(--nx-line);font-size:14px}
.blk.fail{background:color-mix(in srgb,var(--nx-fail) 6%,var(--nx-card))}
.blk .rail{font-size:12.5px;color:var(--nx-ink-2)}
.blk .rail b{display:block;font:500 11.5px/1.2 var(--nx-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--nx-ink);margin-bottom:4px}
.blk .rail .bad{color:var(--nx-fail-ink)}
.blk .who{font:500 11px/1.2 var(--nx-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--nx-ink-3);margin:0 0 4px}
.blk .msg{font-size:14px}
.blk .checks{grid-column:2 / span 2}
.blk .tools{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.bars .row{display:grid;grid-template-columns:150px 1fr 50px;gap:10px;align-items:center;font-size:13px;margin:6px 0}
.bars .bar{height:10px;border-radius:3px;background:var(--nx-blue)}
.bars .cnt{text-align:right;font-variant-numeric:tabular-nums}
@media (max-width:980px){.wrap{grid-template-columns:1fr}.nav{position:static}.panel.w6,.panel.w4,.panel.w8,.panel.w5,.panel.w7{grid-column:span 12}.glass{grid-template-columns:1fr}.blk{grid-template-columns:1fr}.blk .checks{grid-column:auto}}
@media (max-width:640px){.band{padding:24px 16px}.glass{padding:20px}.wrap{padding:16px 16px 64px}.keys{grid-template-columns:1fr 1fr}.matrix2{grid-template-columns:1fr 1fr}.ladder .row{grid-template-columns:100px 1fr 44px 70px}}
`;

export function renderOptionB(p: Prepared): string {
  const c = p.card;
  const cp = p.compare;
  const g = reasonGroups(p);
  const t = cp.allPass.table;
  const keys = [
    key(
      'Goldens passing, candidate',
      cp.allPass.candidate,
      pct,
      `${cp.allPass.candidate.k} of ${cp.allPass.candidate.n}`,
    ),
    key(
      'Goldens passing, baseline',
      cp.allPass.baseline,
      pct,
      `${cp.allPass.baseline.k} of ${cp.allPass.baseline.n}`,
    ),
    key(
      'Regression effect',
      cp.allPass.effect,
      (v) => `${pointsText(v)} pts`,
      `margin ${fixed(cp.margin * 100, 1)} pts`,
      { lo: -1, hi: 1, margin: cp.margin },
    ),
    `<div class="key"><div class="n num">${t.regressed} <span class="soft" style="font-size:20px">of ${cp.pairs.length}</span></div><div class="l">goldens regressed, ${t.improved} improved</div><div class="ci">McNemar exact p = ${cp.allPass.mcnemar.pValue < 0.0001 ? '< 0.0001' : fixed(cp.allPass.mcnemar.pValue, 4)}</div></div>`,
  ];
  const why: string[] = [];
  if (g.drop)
    why.push(
      `<li><span class="chip chip--fail tag">drop</span><div>${esc(g.drop)} <span class="links"><a href="#goldens">matrix</a></span></div></li>`,
    );
  for (const line of g.criteria) {
    const family = line.split(':')[0] as string;
    const fam = p.families.find((f) => f.family === family);
    why.push(
      `<li><span class="chip chip--fail tag">criterion</span><div>${esc(line)} <span class="links"><a href="#criteria">ladder</a>${fam ? `<a href="#${`block-${(fam.blocks[0] as { runId: string }).runId}-${(fam.blocks[0] as { index: number }).index}`}">${fam.blocks.length} blocks</a>` : ''}</span></div></li>`,
    );
  }
  for (const flag of g.flags) {
    const fam = p.families.find((f) => f.family === flag.family);
    why.push(
      `<li><span class="chip chip--fail tag">new flag</span><div><b>${esc(flag.family)}</b> fires in ${flag.units.length} goldens for the candidate and none for the baseline. <span class="links"><a href="#goldens">matrix</a>${fam ? `<a href="#${`block-${(fam.blocks[0] as { runId: string }).runId}-${(fam.blocks[0] as { index: number }).index}`}">first block</a>` : ''}</span></div></li>`,
    );
  }
  for (const line of g.wide)
    why.push(`<li><span class="chip chip--wait tag">margin</span><div>${esc(line)}</div></li>`);
  if (g.thin.length > 0)
    why.push(
      `<li><span class="chip chip--neutral chip--plain tag">underpowered</span><div>${esc(g.thin.join(', '))}: fewer than ${cp.minGoldens} goldens, left out of the parity test.</div></li>`,
    );
  if (g.parity) why.push(`<li><span class="chip chip--ok tag">parity</span><div>${esc(g.parity)}</div></li>`);

  const tiles: string[] = [];
  for (const m of c.modes)
    if (m.runPass) tiles.push(tile(`Runs passing, ${m.mode}`, m.runPass, pct, `${m.runs} runs`));
  for (const m of c.modes)
    if (m.blockAccuracy)
      tiles.push(tile(`Block accuracy, ${m.mode}`, m.blockAccuracy, pct, `${m.blockAccuracy.n} blocks`));
  if (c.endState) tiles.push(tile('End state match', c.endState, pct, `${c.endState.n} runs`));
  if (c.tools.f1)
    tiles.push(tile('Tool F1', c.tools.f1, pct, `${c.tools.matched} of ${c.tools.expected} calls`));
  if (c.tools.precision)
    tiles.push(tile('Tool precision', c.tools.precision, pct, `${c.tools.observed} calls made`));
  if (c.tools.recall) tiles.push(tile('Tool recall', c.tools.recall, pct, `${c.tools.expected} expected`));
  if (c.recovery?.immediate)
    tiles.push(tile('Immediate recovery', c.recovery.immediate, pct, `${c.recovery.measured} injections`));
  if (c.recovery?.clarified)
    tiles.push(
      tile('Asked before acting', c.recovery.clarified, pct, `${c.recovery.clarified.n} injections`),
    );
  const ov = c.compounding.overall;
  if (ov?.interval)
    tiles.push(
      tile(
        'Compounding index',
        { ...ov.interval, estimate: ov.index, method: 'cluster bootstrap', n: ov.blocks },
        (v) => `${pointsText(v)} pts`,
        'T minus F',
        { lo: -0.5, hi: 0.5 },
      ),
    );
  if (c.cost.perBlockUsd)
    tiles.push(
      tile('Cost per block', c.cost.perBlockUsd, usd, `total ${usd(c.cost.totalUsd)}`, {
        lo: 0,
        hi: Math.max(0.01, c.cost.perBlockUsd.upper * 1.5),
      }),
    );
  if (c.cost.latencyMsPerBlock)
    tiles.push(
      tile('Latency per block', c.cost.latencyMsPerBlock, ms, `${c.cost.latencyMsPerBlock.n} blocks`, {
        lo: 0,
        hi: c.cost.latencyMsPerBlock.upper * 1.5,
      }),
    );

  // the golden matrix: rows are specs, columns are modes; each cell holds one square per golden (perturbations fan out in P)
  const specs = [...new Set(p.pairs.map((x) => x.pair.specId))];
  const modes = c.campaign.modes;
  const matrixRows = specs
    .map((spec) => {
      const cells = modes
        .map((mode) => {
          const items = p.pairs.filter((x) => x.pair.specId === spec && x.pair.mode === mode);
          return `<td><div class="g">${items
            .map((x) => {
              const run = x.runs.find((r) => !r.pass) ?? x.runs[0];
              const cls =
                x.state === 'regressed'
                  ? 'reg'
                  : x.state === 'improved'
                    ? 'imp'
                    : x.state === 'both fail'
                      ? 'bf'
                      : '';
              const title = `${x.pair.unit}: ${x.state}${x.lost.length > 0 ? `; lost ${x.lost.join(', ')}` : ''}`;
              return `<a class="${cls}" href="#${run ? runId(run) : ''}" title="${esc(title)}">${x.pair.perturbationId ? esc(x.pair.perturbationId) : ''}</a>`;
            })
            .join('')}</div></td>`;
        })
        .join('');
      return `<tr><td class="name">${esc(p.titles.get(spec) ?? spec)}<br><span class="mono soft" style="font-size:11.5px">${esc(spec)}</span></td>${cells}</tr>`;
    })
    .join('');

  const ladder = cp.criteria
    .map((r) => {
      const fam = p.families.find((f) => f.family === r.criterion);
      const state = r.significantRegression
        ? '<span class="chip chip--fail">regressed</span>'
        : r.gating
          ? r.nonInferior
            ? '<span class="chip chip--ok">in margin</span>'
            : r.underpowered
              ? '<span class="chip chip--neutral chip--plain">thin</span>'
              : '<span class="chip chip--wait">wide</span>'
          : '<span class="chip chip--neutral chip--plain">no gate</span>';
      return `<div class="row ${r.significantRegression ? 'bad' : ''}"><span class="name" title="${esc(r.criterion)}">${fam && r.significantRegression ? `<a href="#${`block-${(fam.blocks[0] as { runId: string }).runId}-${(fam.blocks[0] as { index: number }).index}`}">${esc(r.criterion)}</a>` : esc(r.criterion)}</span><span title="effect ${pointsText(r.effect.estimate)}, interval ${pointsText(r.effect.lower)} to ${pointsText(r.effect.upper)} points, ${r.units} goldens">${intervalBar(r.effect, { lo: -1, hi: 1, margin: cp.margin })}</span><span class="cnt">${r.regressed}/${r.improved}</span><span>${state}</span></div>`;
    })
    .join('');

  const driftTotal = Object.values(c.drift).reduce((a, b) => a + (b ?? 0), 0);
  const driftRows = (Object.keys(DRIFT_NAMES) as (keyof typeof DRIFT_NAMES)[])
    .map((k) => {
      const n = c.drift[k] ?? 0;
      return `<div class="row"><span>${esc(DRIFT_NAMES[k])}</span><span><span class="bar" style="width:${driftTotal === 0 ? 0 : fixed((n / driftTotal) * 100, 1)}%"></span></span><span class="cnt">${n}</span></div>`;
    })
    .join('');

  const recoveryRows = c.recoveryByClass
    .map(
      (e) =>
        `<tr><td class="mono">${esc(e.deviation)}</td><td class="r">${e.summary.measured}</td><td class="r">${e.summary.labels.immediate} / ${e.summary.labels.late} / ${e.summary.labels.never}</td><td>${e.summary.immediate ? `<span class="num">${pct(e.summary.immediate.estimate)}</span> <span class="soft small num">${intervalText(e.summary.immediate)}</span>` : ''}</td></tr>`,
    )
    .join('');

  const failing = c.drilldown.filter((r) => !r.pass);
  const passing = c.drilldown.filter((r) => r.pass);
  const ledgerRows = c.drilldown.map((run) => ledgerRow(run)).join('');

  const body = `<div class="band"><div class="in"><div class="glass">
<div>
<p class="kicker kicker--dot">driftbench scorecard · ${esc(cp.candidate.campaignId)} against ${esc(cp.baseline.campaignId)}</p>
<h1 class="serif">${esc(VERDICT_WORD[cp.verdict])}. <span class="soft">${esc(verdictSentence(p))}</span></h1>
<p class="meta"><span><b>${c.campaign.runs}</b> runs</span><span><b>${c.campaign.specs}</b> specs</span><span>modes <b>${c.campaign.modes.join(', ')}</b></span><span><b>${Math.max(...Object.values(c.campaign.repeats))}</b> repeats</span><span>margin <b>${fixed(cp.margin * 100, 1)} pts</b></span><span>spent <b>${usd(c.cost.totalUsd)}</b></span><span>created <b>${esc(c.campaign.createdAt.slice(0, 16).replace('T', ' '))}</b></span></p>
</div>
<div class="keys">${keys.join('')}</div>
</div></div></div>

<div class="wrap">
<nav class="nav"><ol>
<li class="red"><a href="#why">Why<span class="count">${why.length} reasons</span></a></li>
<li><a href="#rates">Rates<span class="count">${tiles.length} with intervals</span></a></li>
<li class="${t.regressed > 0 ? 'red' : ''}"><a href="#goldens">Golden matrix<span class="count">${cp.pairs.length} paired</span></a></li>
<li class="${cp.criteria.some((r) => r.significantRegression) ? 'red' : ''}"><a href="#criteria">Criteria<span class="count">${cp.criteria.length}</span></a></li>
<li><a href="#structure">Structure</a></li>
<li><a href="#drift">Drift and recovery</a></li>
<li class="${failing.length > 0 ? 'red' : ''}"><a href="#runs">Run ledger<span class="count">${failing.length} failing of ${c.drilldown.length}</span></a></li>
<li><a href="#method">Method</a></li>
</ol></nav>

<div class="grid">
<section class="panel w7" id="why"><h2>Why</h2><p class="lead">Each line is one test against the baseline, with its number and where to look.</p><ol class="why">${why.join('')}</ol></section>
<section class="panel w5" id="pairing"><h2>Paired goldens</h2><p class="lead">A golden passes when every repeat passes. ${cp.pairs.length} paired, ${cp.unpaired.length} left out.</p>
<div class="matrix2"><div class="${t.bothPass > 0 ? 'ok' : ''}"><div class="n">${t.bothPass}</div><div class="l">pass both</div></div><div class="${t.regressed > 0 ? 'fail' : ''}"><div class="n">${t.regressed}</div><div class="l">regressed</div></div><div class="${t.improved > 0 ? 'ok' : ''}"><div class="n">${t.improved}</div><div class="l">improved</div></div><div class="${t.bothFail > 0 ? 'fail' : ''}"><div class="n">${t.bothFail}</div><div class="l">fail both</div></div></div>
<p class="note" style="margin-top:12px">Drift per golden: baseline ${fixed(cp.drift.baselineMean, 2)}, candidate ${fixed(cp.drift.candidateMean, 2)} drifting blocks per run; Wilcoxon p = ${cp.drift.wilcoxon.pValue < 0.0001 ? '< 0.0001' : fixed(cp.drift.wilcoxon.pValue, 4)} over ${cp.drift.wilcoxon.n} goldens that differ.</p></section>

<section class="panel" id="rates"><h2>Every rate, with its interval</h2><p class="lead">Two-sided 95% intervals; the band is the interval, the tick the estimate, the method under each.</p><div class="tiles">${tiles.join('')}</div></section>

<section class="panel w7" id="goldens"><h2>Golden matrix</h2><p class="lead">One square per golden: a spec in a mode, with one square per perturbation in P. Red: the baseline passes and the candidate fails. Each square opens its failing run.</p>
<table class="mx"><colgroup><col class="spec">${modes.map((m) => (m === 'P' ? '<col style="width:34%">' : '<col style="width:13%">')).join('')}</colgroup><thead><tr><th>spec</th>${modes.map((m) => `<th title="${MODE_NAMES[m]}">${m}</th>`).join('')}</tr></thead><tbody>${matrixRows}</tbody></table>
<div class="legend"><span><i style="background:var(--nx-ok-soft)"></i>pass both</span><span><i style="background:var(--nx-fail)"></i>regressed</span><span><i style="background:var(--nx-ok)"></i>improved</span><span><i style="background:var(--nx-fail-soft);outline:1.5px solid var(--nx-fail);outline-offset:-1.5px"></i>fail both</span></div></section>

<section class="panel w5" id="criteria"><h2>Criteria</h2><p class="lead">Effect in points, baseline minus candidate; the dashed line is the margin (${fixed(cp.margin * 100, 1)}). Counts: regressed/improved goldens. Benjamini-Hochberg at q ${cp.q}.</p><div class="ladder"><div class="row head"><span>criterion</span><span>effect and interval</span><span class="cnt">reg/imp</span><span>verdict</span></div>${ladder}</div></section>

<section class="panel" id="structure"><h2>How this run is put together</h2><p class="lead">Specs become goldens (one per mode and perturbation), each run ${p.totals.repeats} times; a run is one conversation of blocks; every block is read by its checks. Baseline and candidate pair on the same goldens.</p>${structureDiagram(p)}</section>

<section class="panel w5" id="drift"><h2>Drift class mix</h2><p class="lead">Blocks carrying each class, over every run of the candidate (${driftTotal} in all).</p><div class="bars">${driftRows}</div></section>
<section class="panel w7" id="recovery"><h2>Recovery after a deviation</h2><p class="lead">Per class of injected deviation: how many came back at their stage within the blocks allowed.</p><div style="overflow-x:auto"><table class="ledger"><thead><tr><th>class</th><th class="r">injections</th><th class="r">immediate / late / never</th><th>immediate</th></tr></thead><tbody>${recoveryRows}${c.recovery ? `<tr><td><b>every injection</b></td><td class="r">${c.recovery.measured}</td><td class="r">${c.recovery.labels.immediate} / ${c.recovery.labels.late} / ${c.recovery.labels.never}</td><td>${c.recovery.immediate ? `<span class="num">${pct(c.recovery.immediate.estimate)}</span> <span class="soft small num">${intervalText(c.recovery.immediate)}</span>` : ''}</td></tr>` : ''}</tbody></table></div></section>

<section class="panel" id="runs"><h2>Run ledger</h2><p class="lead">One row per run, failing first. The strip has one square per block, the ringed square the first drifting block; click a square to open the block.</p>
<div style="overflow-x:auto"><table class="ledger"><thead><tr><th>state</th><th>golden</th><th>mode</th><th class="r">repeat</th><th>blocks</th><th>first drift</th><th>drift</th><th class="r">latency</th><th class="r">cost</th></tr></thead><tbody>${ledgerRows}</tbody></table></div>
<h3 class="kicker" style="margin:24px 0 8px">${failing.length} failing runs, open</h3>
${failing.map((run) => runCard(run, true)).join('')}
<h3 class="kicker" style="margin:24px 0 8px">${passing.length} passing runs</h3>
${passing.map((run) => runCard(run, false)).join('')}
</section>

<section class="panel" id="method"><h2>How the numbers are made</h2><ul class="note" style="margin:8px 0 0;padding-left:18px"><li>Every interval is two-sided at 95%.</li><li>Wilson: the score interval on k of n. Wilson, design effect: a pass rate over the repeats of several goldens, on the effective number of runs, with the Student t quantile.</li><li>Cluster bootstrap: 2000 percentile resamples of whole conversations, seed 1.</li><li>Newcombe: the paired difference of two rates, baseline against candidate; McNemar exact on the goldens that disagree.</li><li>A run passes when it completes, every block passes and the end state matches. A golden passes when every repeat passes.</li></ul></section>
</div>
</div>`;
  return page(`Scorecard ${c.campaign.campaignId}`, CSS, body, 'driftbench scorecard, option B: the board');
}

function key(
  label: string,
  e: Estimate,
  show: (v: number) => string,
  note: string,
  scale: { lo?: number; hi?: number; margin?: number } = {},
): string {
  return `<div class="key"><div class="n num">${esc(show(e.estimate))}</div>${intervalBar(e, scale)}<div class="ci">${esc(intervalText(e, show))} · ${esc(methodWord(e))}</div><div class="l">${esc(label)}, ${esc(note)}</div></div>`;
}

function tile(
  label: string,
  e: Estimate,
  show: (v: number) => string,
  note: string,
  scale: { lo?: number; hi?: number } = {},
): string {
  return `<div class="tile"><div class="l">${esc(label)}</div><div class="n num">${esc(show(e.estimate))}</div>${intervalBar(e, { ...scale, height: 8 })}<div class="ci">${esc(intervalText(e, show))}</div><div class="s">${esc(note)} · ${esc(methodWord(e))}</div></div>`;
}

function ledgerRow(run: RunDetail): string {
  const s = run.succession;
  return `<tr class="${run.pass ? '' : 'bad'}"><td><span class="chip ${run.pass ? 'chip--ok' : 'chip--fail'}">${run.pass ? 'pass' : 'fail'}</span></td><td><a href="#${runId(run)}">${esc(run.specId)}</a>${run.perturbationId ? `<br><span class="mono soft" style="font-size:12px">${esc(run.perturbationId)}</span>` : ''}</td><td>${run.mode}</td><td class="r">${run.repeat + 1}</td><td>${blockStrip(run)}</td><td>${s.firstDriftBlock === undefined ? '<span class="soft">none</span>' : `block ${s.firstDriftBlock + 1}`}</td><td class="small">${
    run.blocks
      .flatMap((b) => b.drift)
      .filter((d, i, a) => a.indexOf(d) === i)
      .join(', ') || '<span class="soft">none</span>'
  }</td><td class="r">${ms(run.latencyMs)}</td><td class="r">${usd(run.cost)}</td></tr>`;
}

function runCard(run: RunDetail, open: boolean): string {
  const s = run.succession;
  const facts = [
    `first drift ${s.firstDriftBlock === undefined ? 'none' : `block ${s.firstDriftBlock + 1}`}`,
    `${s.driftCount} drifting`,
    ...(run.deviation ? [`deviation ${run.deviation}`] : []),
    ...(run.recovery ? [`recovery ${run.recovery.label}, collateral ${run.recovery.collateral}`] : []),
    ...(run.endState ? [`end state ${run.endState.match ? 'matches' : 'differs'}`] : []),
    `latency ${ms(run.latencyMs)}`,
    `cost ${usd(run.cost)}`,
  ];
  return `<details class="run" id="${runId(run)}"${open ? ' open' : ''}>
<summary><span class="chip ${run.pass ? 'chip--ok' : 'chip--fail'}">${run.pass ? 'pass' : 'fail'}</span><span><b>${esc(run.title ?? run.specId)}</b><br><span class="sub">${esc(runName(run))} · ${esc(run.target)}</span></span>${blockStrip(run)}<span class="small soft">${run.blocks.length} blocks</span></summary>
<p class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>
${run.blocks.map((b) => block(run, b)).join('')}
</details>`;
}

function block(run: RunDetail, b: (typeof run.blocks)[number]): string {
  const stageBad =
    b.expectedStage !== undefined && b.observedStage !== undefined && b.expectedStage !== b.observedStage;
  return `<div class="blk ${b.pass ? '' : 'fail'}" id="${blockId(run, b)}">
<div class="rail"><b>Block ${b.index + 1} · ${b.pass ? 'pass' : 'fail'}</b>${b.injected ? 'injected block' : `spec block ${(b.specBlock ?? 0) + 1}`}<div class="${stageBad ? 'bad' : ''}">stage: ${esc(stageText(b))}</div>${b.drift.length > 0 ? `<div class="bad">${esc(b.drift.map((d) => DRIFT_NAMES[d]).join(', '))}</div>` : ''}<div class="num">${ms(b.latencyMs)}${b.costUsd !== undefined ? ` · ${usd(b.costUsd)}` : ''}</div></div>
<div>${b.stimulus === undefined ? '<div class="who">User</div><p class="small soft">no stimulus</p>' : `<div class="who">User</div><p class="msg msg--user">${esc(b.stimulus)}</p>`}<div class="tools">${toolChips(b)}${(b.runtimeEvents ?? []).map((e) => `<span class="tool">${esc(e.kind)} ${esc(e.name)}${e.verdict ? ` · ${esc(e.verdict)}` : ''}</span>`).join('')}</div></div>
<div><div class="who">Agent</div><p class="msg msg--agent">${esc(b.text || '(no text)')}</p></div>
<div class="checks"><div class="who">Checks, ${b.verdicts.filter((v) => v.outcome === 'pass').length} of ${b.verdicts.length} pass</div>${checksOf(b)}</div>
</div>`;
}
