/**
 * Option A, "The brief": one column, read top to bottom like a memo. The verdict is a headline in plain
 * words; the reasons follow as a numbered list, each with its numbers and a link to the goldens behind it;
 * then the rates as number callouts, the structure, the pairing, the criteria and the conversations.
 */

import type { Estimate } from '../src/estimate';
import type { RunDetail } from '../src/scorecard';
import {
  blockId,
  blockStrip,
  checksOf,
  countFirst,
  DRIFT_NAMES,
  esc,
  fixed,
  glossary,
  intervalBar,
  intervalText,
  MODE_NAMES,
  methodWord,
  ms,
  PLAIN_CSS,
  type Prepared,
  page,
  pct,
  plainOpener,
  pointsText,
  reasonGroups,
  runId,
  runName,
  stageText,
  structureDiagram,
  terms,
  toolChips,
  usd,
  VERDICT_WORD,
  verdictSentence,
} from './shared';

const CSS = `
${PLAIN_CSS}
main{max-width:860px;margin:0 auto;padding:48px 24px 96px}
.mast{padding-bottom:32px;border-bottom:1px solid var(--nx-line);margin-bottom:40px}
.mast h1{font-size:clamp(34px,5vw,54px);line-height:1.04;margin:16px 0 20px}
.mast h1 .soft{display:block}
.mast .meta{display:flex;flex-wrap:wrap;gap:8px 24px;font-size:14px;color:var(--nx-ink-2)}
.mast .meta b{font-weight:500;color:var(--nx-ink)}
section{margin:0 0 48px}
h2{font-family:var(--nx-serif);font-weight:400;letter-spacing:-.012em;font-size:30px;line-height:1.1;margin:0 0 6px}
.lead{font-size:17px;color:var(--nx-ink-2);margin-bottom:20px;max-width:64ch}
.why{list-style:none;margin:0;padding:0;counter-reset:why}
.why li{position:relative;padding:14px 0 14px 44px;border-top:1px solid var(--nx-line);counter-increment:why}
.why li::before{content:counter(why);position:absolute;left:0;top:14px;width:28px;height:28px;border-radius:50%;background:var(--nx-ink);color:var(--nx-page);font:500 13px/28px var(--nx-mono);text-align:center}
.why li.weak::before{background:var(--nx-card-2);color:var(--nx-ink-2)}
.why .links{margin-top:6px;font-size:14px}
.why .links a{margin-right:12px}
.nums{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:24px 28px;margin:8px 0 16px}
.nx-num .n{display:block;font-family:var(--nx-serif-text);font-size:40px;line-height:1.05;letter-spacing:-.01em;white-space:nowrap}
.nx-num .l{display:block;margin-top:8px;padding-top:8px;border-top:1px solid var(--nx-line);font-size:14px}
.nx-num .ci{display:block;font:400 13px/1.4 var(--nx-sans);color:var(--nx-ink-2);font-variant-numeric:tabular-nums}
.nx-num .ibar{margin-top:6px}
.nx-num .s{display:block;margin-top:4px;font:400 11.5px/1.3 var(--nx-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--nx-ink-3)}
.card{background:var(--nx-card);border:1px solid var(--nx-line);border-radius:20px;padding:20px 24px}
.matrix{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:520px;margin:12px 0}
.matrix div{border-radius:12px;padding:14px 16px;background:var(--nx-card-2)}
.matrix .n{font-family:var(--nx-serif-text);font-size:34px;line-height:1}
.matrix .l{font-size:14px;color:var(--nx-ink-2);margin-top:4px}
.matrix .fail{background:var(--nx-fail-soft)} .matrix .fail .n{color:var(--nx-fail-ink)}
.matrix .ok{background:var(--nx-ok-soft)} .matrix .ok .n{color:var(--nx-ok-ink)}
.golden{display:grid;grid-template-columns:1fr auto;gap:4px 16px;padding:12px 0;border-top:1px solid var(--nx-line);align-items:start}
.golden .name{font-weight:500}
.golden .sub{font-size:14px;color:var(--nx-ink-2)}
.run{background:var(--nx-card);border:1px solid var(--nx-line);border-radius:20px;margin:16px 0;overflow:hidden}
.run>summary{display:grid;grid-template-columns:auto 1fr auto;gap:12px 16px;align-items:center;padding:16px 24px}
.run>summary .title{font-weight:500}
.run>summary .sub{font-size:14px;color:var(--nx-ink-2)}
.run .body{padding:0 24px 20px;border-top:1px solid var(--nx-line)}
.run .facts{display:flex;flex-wrap:wrap;gap:6px 20px;font-size:14px;color:var(--nx-ink-2);padding:12px 0}
.block{display:grid;grid-template-columns:120px 1fr;gap:12px 20px;padding:18px 0;border-top:1px solid var(--nx-line)}
.block.fail{box-shadow:inset 4px 0 0 var(--nx-fail);padding-left:16px;margin-left:-20px;padding-right:0}
.block .rail{font-size:13px;color:var(--nx-ink-2)}
.block .rail b{display:block;font:500 12.5px/1.2 var(--nx-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--nx-ink);margin-bottom:6px}
.block .rail .stage{margin-top:8px}
.block .rail .stage.bad{color:var(--nx-fail-ink)}
.block .turns{display:grid;gap:10px}
.block .who{font:500 12px/1.2 var(--nx-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--nx-ink-3);margin-bottom:4px}
.block .checks{margin-top:8px}
.block .tools{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start}
.method li{margin:4px 0}
.table--tight{font-size:13px}.table--tight th,.table--tight td{padding:8px 8px}.table--tight .chip{font-size:12px;padding:2px 8px}
@media (max-width:640px){main{padding:32px 16px 64px}.block{grid-template-columns:1fr}.block.fail{margin-left:0;padding-left:12px}.run>summary{grid-template-columns:1fr}}
`;

export function renderOptionA(p: Prepared): string {
  const { t } = terms();
  const c = p.card;
  const cp = p.compare;
  const g = reasonGroups(p);
  const regressed = p.pairs.filter((x) => x.state === 'regressed');
  const improved = p.pairs.filter((x) => x.state === 'improved');
  const bothFail = p.pairs.filter((x) => x.state === 'both fail');
  const reasons: string[] = [];
  if (g.drop) reasons.push(li(g.drop, `<a href="#pairing">the ${regressed.length} goldens</a>`));
  for (const line of g.criteria) {
    const family = line.split(':')[0] as string;
    const fam = p.families.find((f) => f.family === family);
    reasons.push(
      li(
        `<b>${esc(family)}</b> regressed. ${esc(line.slice(family.length + 2))}`,
        fam
          ? `<a href="#criteria">criterion row</a> ${fam.blocks
              .slice(0, 6)
              .map((b, i) => `<a href="#${`block-${b.runId}-${b.index}`}">block ${i + 1}</a>`)
              .join(
                ' ',
              )}${fam.blocks.length > 6 ? ` <span class="soft">and ${fam.blocks.length - 6} more</span>` : ''}`
          : '',
      ),
    );
  }
  for (const flag of g.flags) {
    const fam = p.families.find((f) => f.family === flag.family);
    reasons.push(
      li(
        `A new gating flag, <b>${esc(flag.family)}</b>, fires in ${flag.units.length} golden${flag.units.length === 1 ? '' : 's'} for the candidate and in none for the baseline.`,
        `${flag.units
          .slice(0, 4)
          .map((u) => `<a href="#golden-${slug(u)}">${esc(u)}</a>`)
          .join(
            ' ',
          )}${flag.units.length > 4 ? ` <span class="soft">and ${flag.units.length - 4} more</span>` : ''}${fam ? ` <a href="#${`block-${(fam.blocks[0] as { runId: string }).runId}-${(fam.blocks[0] as { index: number }).index}`}">first block</a>` : ''}`,
      ),
    );
  }
  for (const line of g.wide) reasons.push(li(`Not within the margin. ${esc(line)}`, '', true));
  if (g.thin.length > 0)
    reasons.push(
      li(
        `Underpowered, left out of the parity test (fewer than ${cp.minGoldens} goldens): ${esc(g.thin.join(', '))}. <span class="soft">--strict puts them back.</span>`,
        '',
        true,
      ),
    );
  if (g.parity) reasons.push(li(esc(g.parity)));

  const tiles: string[] = [];
  for (const m of c.modes) {
    if (m.runPass)
      tiles.push(
        num(`Runs passing, ${MODE_NAMES[m.mode]}`, m.runPass, pct, `${m.runs} runs, ${m.lines} goldens`),
      );
  }
  for (const m of c.modes) {
    if (m.blockAccuracy)
      tiles.push(
        num(`Block accuracy, ${MODE_NAMES[m.mode]}`, m.blockAccuracy, pct, `${m.blockAccuracy.n} blocks`),
      );
  }
  if (c.endState)
    tiles.push(num('End state match', c.endState, pct, `${c.endState.k} of ${c.endState.n} runs compared`));
  if (c.tools.f1)
    tiles.push(
      num('Tool F1', c.tools.f1, pct, `${c.tools.matched} of ${c.tools.expected} expected calls made`),
    );
  if (c.tools.precision)
    tiles.push(num('Tool precision', c.tools.precision, pct, `${c.tools.observed} calls made`));
  if (c.tools.recall)
    tiles.push(num('Tool recall', c.tools.recall, pct, `${c.tools.expected} calls expected`));
  if (c.recovery?.immediate)
    tiles.push(num('Immediate recovery', c.recovery.immediate, pct, `${c.recovery.measured} injections`));
  if (c.recovery?.recovered)
    tiles.push(num('Came back at all', c.recovery.recovered, pct, `${c.recovery.measured} injections`));
  const ov = c.compounding.overall;
  if (ov?.interval)
    tiles.push(
      num(
        'Compounding index',
        { ...ov.interval, estimate: ov.index, method: 'cluster bootstrap', n: ov.blocks },
        (v) => `${pointsText(v)} pts`,
        `T minus F over ${ov.blocks} shared blocks`,
        { lo: -0.5, hi: 0.5 },
      ),
    );
  if (c.cost.perBlockUsd)
    tiles.push(
      num('Cost per block', c.cost.perBlockUsd, usd, `total ${usd(c.cost.totalUsd)}`, {
        lo: 0,
        hi: Math.max(0.01, c.cost.perBlockUsd.upper * 1.5),
      }),
    );
  if (c.cost.latencyMsPerBlock)
    tiles.push(
      num('Latency per block', c.cost.latencyMsPerBlock, ms, `${c.cost.latencyMsPerBlock.n} blocks`, {
        lo: 0,
        hi: c.cost.latencyMsPerBlock.upper * 1.5,
      }),
    );

  const criteriaRows = cp.criteria
    .filter((r) => r.regressed + r.improved > 0 || r.gating)
    .map((r) => {
      const fam = p.families.find((f) => f.family === r.criterion);
      const verdict = r.significantRegression
        ? '<span class="chip chip--fail">regressed</span>'
        : r.gating
          ? r.nonInferior
            ? '<span class="chip chip--ok">within margin</span>'
            : r.underpowered
              ? '<span class="chip chip--wait">underpowered</span>'
              : '<span class="chip chip--wait">not within margin</span>'
          : '<span class="chip chip--neutral chip--plain">not gating</span>';
      return `<tr class="${r.significantRegression ? 'bad' : ''}"><td class="mono">${esc(r.criterion)}</td><td class="r">${r.units}</td><td class="r">${r.regressed}</td><td class="r">${r.improved}</td><td class="r">${pointsText(r.effect.estimate)}</td><td style="min-width:140px">${intervalBar(r.effect, { lo: -1, hi: 1, margin: cp.margin })}<span class="small soft num">${pointsText(r.effect.lower)} to ${pointsText(r.effect.upper)} pts</span></td><td class="r">${r.adjusted < 0.0001 ? '< 0.0001' : fixed(r.adjusted, 4)}</td><td>${verdict}${fam && r.significantRegression ? `<div class="small"><a href="#block-${(fam.blocks[0] as { runId: string }).runId}-${(fam.blocks[0] as { index: number }).index}">${fam.blocks.length} failing blocks</a></div>` : ''}</td></tr>`;
    });

  const failingRuns = c.drilldown.filter((r) => !r.pass);
  const passingRuns = c.drilldown.filter((r) => r.pass);

  const body = `<main>
<header class="mast">
<p class="kicker kicker--dot">driftbench scorecard · ${esc(cp.candidate.campaignId)} against ${esc(cp.baseline.campaignId)}</p>
<h1 class="serif">${esc(VERDICT_WORD[cp.verdict])}. <span class="soft">${esc(verdictSentence(p))}</span></h1>
<p class="meta"><span><b>${c.campaign.runs}</b> runs</span><span><b>${c.campaign.specs}</b> specs</span><span>modes <b>${c.campaign.modes.join(', ')}</b></span><span><b>${Math.max(...Object.values(c.campaign.repeats))}</b> repeats</span><span>margin <b>${fixed(cp.margin * 100, 1)} points</b></span><span>spent <b>${usd(c.cost.totalUsd)}</b></span><span>created <b>${esc(c.campaign.createdAt.slice(0, 16).replace('T', ' '))}</b></span><span>targets <b>${esc(c.campaign.targets.join(', '))}</b></span></p>
</header>

${plainOpener(p, t)}

<section id="why" style="margin-top:40px">
<h2>Why</h2>
<p class="lead">Each reason below is one test the ${t('candidate')} failed against the ${t('baseline')}, with its number and a link to the ${t('golden', 'goldens')} and ${t('block', 'blocks')} behind it. A golden counts as ${t('regressed')} when it passed before and fails now.</p>
<ol class="why">${reasons.join('')}</ol>
</section>

<section id="rates">
<h2>Every rate, with its interval</h2>
<p class="lead">Counts first, then the rate and its ${t('interval')}: the range the true rate is likely in. The band under each number draws that range; the dark tick is the measured rate. The method is named under each number.</p>
<div class="nums">${tiles.join('')}</div>
</section>

<section id="structure">
<h2>How this run is put together</h2>
<p class="lead">A spec is a succession of blocks. Each golden is one spec in one mode, run ${p.totals.repeats} times; each run is one conversation; each block is one stimulus and the agent's reply, read by its checks. Baseline and candidate pair on the same goldens.</p>
<div class="card">${structureDiagram(p)}</div>
</section>

<section id="pairing">
<h2>Golden by golden</h2>
<p class="lead">A golden passes when every repeat passes. ${cp.pairs.length} goldens are paired; ${cp.unpaired.length === 0 ? 'none is left out' : `${cp.unpaired.length} left out`}.</p>
<div class="matrix">
<div class="${cp.allPass.table.bothPass > 0 ? 'ok' : ''}"><span class="n">${cp.allPass.table.bothPass}</span><span class="l">pass both</span></div>
<div class="${cp.allPass.table.regressed > 0 ? 'fail' : ''}"><span class="n">${cp.allPass.table.regressed}</span><span class="l">regressed: baseline passes, candidate fails</span></div>
<div class="${cp.allPass.table.improved > 0 ? 'ok' : ''}"><span class="n">${cp.allPass.table.improved}</span><span class="l">improved: baseline fails, candidate passes</span></div>
<div class="${cp.allPass.table.bothFail > 0 ? 'fail' : ''}"><span class="n">${cp.allPass.table.bothFail}</span><span class="l">fail both</span></div>
</div>
<p class="small soft">McNemar exact on the ${cp.allPass.table.regressed + cp.allPass.table.improved} discordant goldens: p = ${cp.allPass.mcnemar.pValue < 0.0001 ? '< 0.0001' : fixed(cp.allPass.mcnemar.pValue, 4)}. Effect, baseline minus candidate: ${pointsText(cp.allPass.effect.estimate)} points, interval ${pointsText(cp.allPass.effect.lower)} to ${pointsText(cp.allPass.effect.upper)} (Newcombe, paired). Drift per golden: baseline ${fixed(cp.drift.baselineMean, 2)}, candidate ${fixed(cp.drift.candidateMean, 2)} drifting blocks per run.</p>
${goldenList('Regressed', regressed, p)}
${goldenList('Improved', improved, p)}
${goldenList('Fail in both', bothFail, p)}
<details><summary class="small"><b>${p.pairs.filter((x) => x.state === 'both pass').length} goldens pass in both</b> (open the list)</summary>${goldenList(
    '',
    p.pairs.filter((x) => x.state === 'both pass'),
    p,
  )}</details>
</section>

<details class="expert" id="expert"><summary><span class="kicker">Expert detail</span> <span class="small soft">criteria, per mode, recovery, method: open</span></summary>
<section id="criteria" style="margin-top:16px">
<h2>Criteria</h2>
<p class="lead">A criterion is one machine check family or one judged criterion. The effect is the baseline pass rate minus the candidate's, in points; the dashed line is the margin of ${fixed(cp.margin * 100, 1)} points. Benjamini-Hochberg across ${cp.criteria.length} criteria at a false discovery rate of ${cp.q}.</p>
<div style="overflow-x:auto"><table class="table table--tight"><thead><tr><th>criterion</th><th class="r">goldens</th><th class="r">regressed</th><th class="r">improved</th><th class="r">effect</th><th>interval, points</th><th class="r">q</th><th>verdict</th></tr></thead><tbody>${criteriaRows.join('')}</tbody></table></div>
</section>

<section id="modes">
<h2>Per mode</h2>
<div style="overflow-x:auto"><table class="table"><thead><tr><th>mode</th><th class="r">goldens</th><th class="r">runs</th><th>runs passing</th><th>block accuracy</th><th>drifting blocks per run</th><th>drift classes</th></tr></thead><tbody>${c.modes
    .map(
      (m) =>
        `<tr><td>${m.mode}, ${MODE_NAMES[m.mode]}</td><td class="r">${m.lines}</td><td class="r">${m.runs}</td><td>${m.runPass ? rateCell(m.runPass) : 'none'}</td><td>${m.blockAccuracy ? rateCell(m.blockAccuracy) : 'none'}</td><td class="num">${m.driftCount ? `${fixed(m.driftCount.estimate, 2)} <span class="soft small">${intervalText(m.driftCount, (v) => fixed(v, 2))}</span>` : ''}</td><td class="small">${
          Object.entries(m.classes)
            .filter(([, n]) => (n ?? 0) > 0)
            .map(([k, n]) => `${DRIFT_NAMES[k as keyof typeof DRIFT_NAMES]} ${n}`)
            .join(', ') || 'none'
        }</td></tr>`,
    )
    .join('')}</tbody></table></div>
${c.recovery ? recoveryTable(p) : ''}
</section>

</details>
<section id="conversations">
<h2>The conversations</h2>
<p class="lead">Failing runs first and open: every block with what was sent, what the agent said and called, which checks failed and why. Passing runs follow, closed. The strip shows one square per block; the ringed square is the first drifting block.</p>
${failingRuns.map((run) => runCard(run, true)).join('')}
<h3 class="kicker" style="margin:32px 0 8px">${passingRuns.length} passing runs</h3>
${passingRuns.map((run) => runCard(run, false)).join('')}
</section>

<details class="expert"><summary><span class="kicker">How the numbers are made</span> <span class="small soft">open</span></summary>
<section id="method" style="margin-top:16px">
<h2>How the numbers are made</h2>
<ul class="method small soft">
<li>Every interval is two-sided at 95%.</li>
<li>Wilson: the score interval on k of n, for a rate over independent units.</li>
<li>Wilson, design effect: a pass rate over the repeats of several goldens, on the effective number of runs, with the Student t quantile.</li>
<li>Cluster bootstrap: 2000 percentile resamples of whole conversations, seed 1, so the same store gives the same page.</li>
<li>Newcombe: the paired difference of two rates, baseline against candidate.</li>
<li>A run passes when it completes, every block passes and the end state matches. A golden passes when every repeat passes.</li>
</ul>
</section>
</details>
${glossary()}
</main>`;
  return page(`Scorecard ${c.campaign.campaignId}`, CSS, body, 'driftbench scorecard, option A: the brief');
}

function li(text: string, links = '', weak = false): string {
  return `<li class="${weak ? 'weak' : ''}"><div>${text}</div>${links ? `<div class="links">${links}</div>` : ''}</li>`;
}

function slug(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function num(
  label: string,
  e: Estimate,
  show: (v: number) => string,
  note: string,
  scale: { lo?: number; hi?: number } = {},
): string {
  const head = countFirst(label, e, show);
  return `<div class="nx-num"><span class="n num">${head.big}</span>${intervalBar(e, scale)}<span class="ci">${esc(head.second)}</span><span class="l">${esc(label)}</span><span class="s">${esc(note)} · ${esc(methodWord(e))}</span></div>`;
}

function rateCell(e: Estimate): string {
  return `<span class="num">${pct(e.estimate)}</span> <span class="small soft num">${intervalText(e)}</span>${intervalBar(e)}`;
}

function goldenList(title: string, items: Prepared['pairs'], p: Prepared): string {
  if (items.length === 0) return '';
  return `${title ? `<h3 class="kicker" style="margin:24px 0 4px">${esc(title)}, ${items.length}</h3>` : ''}${items
    .map((x) => {
      const run = x.runs.find((r) => !r.pass) ?? x.runs[0];
      const first = run?.succession.firstDriftBlock;
      return `<div class="golden" id="golden-${slug(x.pair.unit)}"><div><div class="name">${esc(p.titles.get(x.pair.specId) ?? x.pair.specId)}</div><div class="sub"><span class="mono">${esc(x.pair.unit)}</span>${x.lost.length > 0 ? ` · lost ${esc(x.lost.join(', '))}` : ''}${x.gained.length > 0 ? ` · gained ${esc(x.gained.join(', '))}` : ''}${first !== undefined ? ` · first drift at block ${first + 1}` : ''}</div></div><div>${x.runs.map((r) => `<a href="#${runId(r)}" title="repeat ${r.repeat + 1}">${blockStrip(r, false)}</a>`).join('<br>')}</div></div>`;
    })
    .join('')}`;
}

function recoveryTable(p: Prepared): string {
  const c = p.card;
  const row = (label: string, rec: NonNullable<typeof c.recovery>) =>
    `<tr><td>${esc(label)}</td><td class="r">${rec.measured}</td><td class="r">${rec.labels.immediate} / ${rec.labels.late} / ${rec.labels.never}</td><td>${rec.immediate ? rateCell(rec.immediate) : ''}</td><td>${rec.recovered ? rateCell(rec.recovered) : ''}</td><td>${rec.clarified ? rateCell(rec.clarified) : ''}</td></tr>`;
  return `<h3 class="kicker" style="margin:24px 0 4px">Recovery after a deviation, per class</h3>
<div style="overflow-x:auto"><table class="table"><thead><tr><th>class</th><th class="r">injections</th><th class="r">immediate / late / never</th><th>immediate</th><th>came back</th><th>asked first</th></tr></thead><tbody>${c.recoveryByClass.map((e) => row(e.deviation, e.summary)).join('')}${c.recovery ? row('every injection', c.recovery).replace('<tr>', '<tr class="total">') : ''}</tbody></table></div>`;
}

function runCard(run: RunDetail, open: boolean): string {
  const s = run.succession;
  const facts = [
    `${run.blocks.length} blocks`,
    `first drift ${s.firstDriftBlock === undefined ? 'none' : `block ${s.firstDriftBlock + 1}`}`,
    `${s.driftCount} drifting`,
    ...(run.deviation ? [`deviation ${run.deviation}`] : []),
    ...(run.recovery ? [`recovery ${run.recovery.label}, collateral ${run.recovery.collateral}`] : []),
    ...(run.endState ? [`end state ${run.endState.match ? 'matches' : 'differs'}`] : []),
    `latency ${ms(run.latencyMs)}`,
    `cost ${usd(run.cost)}`,
    `status ${run.status}`,
  ];
  return `<details class="run" id="${runId(run)}"${open ? ' open' : ''}>
<summary><span class="chip ${run.pass ? 'chip--ok' : 'chip--fail'}">${run.pass ? 'pass' : 'fail'}</span><span><span class="title">${esc(run.title ?? run.specId)}</span><br><span class="sub mono">${esc(runName(run))} · ${esc(run.target)}</span></span>${blockStrip(run)}</summary>
<div class="body">
<p class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>
${run.error ? `<p class="chip chip--fail">${esc(run.error)}</p>` : ''}
${run.blocks.map((b) => block(run, b)).join('')}
</div>
</details>`;
}

function block(run: RunDetail, b: (typeof run.blocks)[number]): string {
  const stageBad =
    b.expectedStage !== undefined && b.observedStage !== undefined && b.expectedStage !== b.observedStage;
  return `<div class="block ${b.pass ? '' : 'fail'}" id="${blockId(run, b)}">
<div class="rail"><b>Block ${b.index + 1}</b>${b.injected ? '<span class="chip chip--neutral chip--plain">injected</span>' : `spec block ${(b.specBlock ?? 0) + 1}`}<div class="stage ${stageBad ? 'bad' : ''}">stage: ${esc(stageText(b))}</div>${b.drift.length > 0 ? `<div class="stage bad">${esc(b.drift.map((d) => DRIFT_NAMES[d]).join(', '))}</div>` : ''}<div class="stage num">${ms(b.latencyMs)}${b.costUsd !== undefined ? ` · ${usd(b.costUsd)}` : ''}${b.retries > 0 ? ` · ${b.retries} retries` : ''}</div></div>
<div class="turns">
${b.stimulus === undefined ? '' : `<div><div class="who">User</div><p class="msg msg--user">${esc(b.stimulus)}</p></div>`}
<div><div class="who">Agent</div><p class="msg msg--agent">${esc(b.text || '(no text)')}</p></div>
<div><div class="who">Tools${b.runtimeEvents && b.runtimeEvents.length > 0 ? ' and runtime' : ''}</div><div class="tools">${toolChips(b)}${(b.runtimeEvents ?? []).map((e) => `<span class="tool">${esc(e.kind)} ${esc(e.name)}${e.verdict ? ` · ${esc(e.verdict)}` : ''}</span>`).join('')}</div></div>
<div class="checks"><div class="who">Checks, ${b.verdicts.filter((v) => v.outcome === 'pass').length} of ${b.verdicts.length} pass</div>${checksOf(b)}</div>
</div>
</div>`;
}
