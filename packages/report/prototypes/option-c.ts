/**
 * Option C, "The trace": conversation first. A thin verdict strip and a numbers rail at the top; then
 * "where it breaks", the stage rail of every spec with the blocks where candidate runs first drift; then
 * one dossier per golden: the baseline's repeats beside the candidate's, the stage rail of the run with the
 * expected and reached stage per block, the diverging block side by side (baseline reply, candidate reply),
 * and the whole candidate conversation. The structure diagram sits in "how to read this page".
 */

import type { Estimate } from '../src/estimate';
import type { BlockDetail, RunDetail } from '../src/scorecard';
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
  type PairView,
  type Prepared,
  page,
  pct,
  pointsText,
  reasonGroups,
  runId,
  runName,
  structureDiagram,
  toolChips,
  usd,
  VERDICT_WORD,
  verdictSentence,
} from './shared';

const CSS = `
main{max-width:1100px;margin:0 auto;padding:40px 24px 96px}
.top{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;padding-bottom:24px;border-bottom:1px solid var(--nx-line);margin-bottom:32px}
.top h1{font-size:clamp(28px,3.4vw,40px);line-height:1.08;margin:10px 0 0}
.rail-nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px 20px;margin-top:8px}
.rn .n{font-family:var(--nx-serif-text);font-size:28px;line-height:1.05;white-space:nowrap}
.rn .l{font-size:13px;color:var(--nx-ink-2);margin-top:4px;line-height:1.3}
.rn .ci{font-size:12.5px;color:var(--nx-ink-3);font-variant-numeric:tabular-nums}
.rn .ibar{margin-top:4px}
h2{font-family:var(--nx-serif);font-weight:400;letter-spacing:-.012em;font-size:28px;line-height:1.1;margin:0 0 6px}
.lead{font-size:15.5px;color:var(--nx-ink-2);margin-bottom:18px;max-width:70ch}
section{margin:0 0 44px}
.why{margin:0;padding-left:20px;font-size:15px}
.why li{margin:4px 0}
.why li a{margin-left:6px;font-size:13.5px}
.stagerail{display:grid;grid-template-columns:220px 1fr;gap:10px 20px;align-items:center;padding:10px 0;border-top:1px solid var(--nx-line)}
.stagerail .name{font-size:14px;line-height:1.3}
.stagerail .name .mono{display:block;font-size:12px;color:var(--nx-ink-3)}
.rail{display:flex;align-items:center;gap:0;flex-wrap:wrap}
.rail .st{position:relative;display:flex;align-items:center}
.rail .st .dot{width:12px;height:12px;border-radius:50%;border:1px solid var(--nx-line-2);background:var(--nx-card);flex:none}
.rail .st .lbl{font:400 12px/1.2 var(--nx-mono);color:var(--nx-ink-2);margin:0 6px 0 6px;white-space:nowrap}
.rail .st .ln{width:28px;height:2px;background:var(--nx-ill-edge)}
.rail .st.hit .dot{background:var(--nx-fail);border-color:var(--nx-fail)}
.rail .st .cnt{position:absolute;left:-2px;top:-18px;font:500 11px/1 var(--nx-mono);color:var(--nx-fail-ink);white-space:nowrap}
.golden{background:var(--nx-card);border:1px solid var(--nx-line);border-radius:20px;margin:16px 0;overflow:hidden}
.golden>summary{padding:18px 24px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px 18px;align-items:center}
.golden>summary .title{font-weight:500;font-size:16px}
.golden>summary .sub{font-size:13.5px;color:var(--nx-ink-2)}
.sides{display:grid;grid-template-columns:auto auto;gap:4px 14px;align-items:center;font:400 12px/1.2 var(--nx-mono);color:var(--nx-ink-2)}
.dots{display:inline-flex;gap:4px}
.dots i{width:12px;height:12px;border-radius:50%;background:var(--nx-ok);display:block}
.dots i.f{background:var(--nx-fail)}
.body{border-top:1px solid var(--nx-line);padding:20px 24px 24px}
.blockrail{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 18px}
.br{border:1px solid var(--nx-line);border-radius:12px;padding:8px 10px;min-width:118px;font-size:12.5px;line-height:1.3;color:var(--nx-ink-2);position:relative}
.br b{display:block;font:500 11px/1.2 var(--nx-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--nx-ink);margin-bottom:4px}
.br.fail{border-color:var(--nx-fail);background:color-mix(in srgb,var(--nx-fail) 6%,var(--nx-card))}
.br .obs{color:var(--nx-fail-ink);font-weight:500}
.br.inj{border-style:dashed}
.br a{position:absolute;inset:0}
.diverge{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:8px 0 20px}
.side{border-radius:14px;padding:12px 14px;background:var(--nx-card-2)}
.side.bad{background:color-mix(in srgb,var(--nx-fail) 7%,var(--nx-card-2))}
.side .who{font:500 11px/1.2 var(--nx-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--nx-ink-3);margin-bottom:6px;display:flex;justify-content:space-between;gap:8px}
.side .msg{background:none;padding:0;max-width:none;font-size:14px}
.side .tools{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.side .lost{font-size:13px;color:var(--nx-fail-ink);margin-top:8px}
.conv{display:grid;gap:14px}
.turn{display:grid;grid-template-columns:40px minmax(0,1fr);gap:0 12px;align-items:start}
.turn .idx{font:500 11px/1.2 var(--nx-mono);letter-spacing:.08em;color:var(--nx-ink-3);padding-top:10px;text-align:right}
.turn .idx.bad{color:var(--nx-fail-ink)}
.turn .u{justify-self:start}
.turn .a{grid-column:2;justify-self:end;max-width:min(62ch,100%)}
.turn .a .msg--agent{background:var(--nx-card-2)}
.turn .meta{grid-column:2;font-size:12.5px;color:var(--nx-ink-2);margin:4px 0 0;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}
.turn .meta .bad{color:var(--nx-fail-ink)}
.turn .chk{grid-column:2;margin-top:6px;border-left:3px solid var(--nx-fail);padding-left:12px}
.turn .chk.ok{border-left-color:var(--nx-line)}
.turn .chk .who{font:500 11px/1.2 var(--nx-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--nx-ink-3);margin-bottom:2px}
.runpick{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px;font-size:13px}
.runpick a{padding:4px 10px;border:1px solid var(--nx-line-2);border-radius:999px;color:var(--nx-ink)}
.crit{width:100%;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums}
.crit th{font:500 11.5px/1.2 var(--nx-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--nx-ink-2);text-align:left;padding:8px 10px;border-bottom:1px solid var(--nx-ink)}
.crit td{padding:7px 10px;border-bottom:1px solid var(--nx-line)}
.crit .r{text-align:right}
.crit tr.bad td:first-child{box-shadow:inset 3px 0 0 var(--nx-fail)}
.card{background:var(--nx-card);border:1px solid var(--nx-line);border-radius:20px;padding:20px 24px}
@media (max-width:760px){main{padding:24px 16px 64px}.stagerail{grid-template-columns:1fr}.diverge{grid-template-columns:1fr}.golden>summary{grid-template-columns:1fr}.turn{grid-template-columns:1fr}.turn .idx{text-align:left;padding:0}.turn .a,.turn .meta,.turn .chk{grid-column:auto}.msg--user,.msg--agent{max-width:100%}}
`;

export function renderOptionC(p: Prepared): string {
  const c = p.card;
  const cp = p.compare;
  const g = reasonGroups(p);
  const t = cp.allPass.table;

  const nums: string[] = [];
  nums.push(
    rn(
      'Goldens passing, candidate',
      cp.allPass.candidate,
      pct,
      `${cp.allPass.candidate.k} of ${cp.allPass.candidate.n}; baseline ${cp.allPass.baseline.k} of ${cp.allPass.baseline.n}`,
    ),
  );
  nums.push(
    rn(
      'Regression effect',
      cp.allPass.effect,
      (v) => `${pointsText(v)} pts`,
      `margin ${fixed(cp.margin * 100, 1)} pts`,
      { lo: -1, hi: 1, margin: cp.margin },
    ),
  );
  const f = c.modes.find((m) => m.mode === 'F') ?? c.modes[0];
  if (f?.runPass) nums.push(rn(`Runs passing, ${MODE_NAMES[f.mode]}`, f.runPass, pct, `${f.runs} runs`));
  if (f?.blockAccuracy)
    nums.push(
      rn(`Block accuracy, ${MODE_NAMES[f.mode]}`, f.blockAccuracy, pct, `${f.blockAccuracy.n} blocks`),
    );
  if (c.endState) nums.push(rn('End state match', c.endState, pct, `${c.endState.n} runs`));
  if (c.tools.f1)
    nums.push(rn('Tool F1', c.tools.f1, pct, `${c.tools.matched} of ${c.tools.expected} calls`));
  if (c.recovery?.immediate)
    nums.push(rn('Immediate recovery', c.recovery.immediate, pct, `${c.recovery.measured} injections`));
  const ov = c.compounding.overall;
  if (ov?.interval)
    nums.push(
      rn(
        'Compounding index',
        { ...ov.interval, estimate: ov.index, method: 'cluster bootstrap', n: ov.blocks },
        (v) => `${pointsText(v)} pts`,
        'T minus F',
        { lo: -0.5, hi: 0.5 },
      ),
    );
  if (c.cost.perBlockUsd)
    nums.push(
      rn('Cost per block', c.cost.perBlockUsd, usd, `total ${usd(c.cost.totalUsd)}`, {
        lo: 0,
        hi: Math.max(0.01, c.cost.perBlockUsd.upper * 1.5),
      }),
    );
  if (c.cost.latencyMsPerBlock)
    nums.push(
      rn('Latency per block', c.cost.latencyMsPerBlock, ms, `${c.cost.latencyMsPerBlock.n} blocks`, {
        lo: 0,
        hi: c.cost.latencyMsPerBlock.upper * 1.5,
      }),
    );

  const why: string[] = [];
  if (g.drop) why.push(`<li>${esc(g.drop)}</li>`);
  for (const line of g.criteria) {
    const fam = p.families.find((x) => x.family === line.split(':')[0]);
    why.push(
      `<li>${esc(line)}${fam ? `<a href="#${`block-${(fam.blocks[0] as { runId: string }).runId}-${(fam.blocks[0] as { index: number }).index}`}">first block</a>` : ''}</li>`,
    );
  }
  for (const flag of g.flags)
    why.push(
      `<li>A new gating flag, ${esc(flag.family)}, fires in ${flag.units.length} goldens for the candidate and none for the baseline.<a href="#golden-${slug(flag.units[0] as string)}">first golden</a></li>`,
    );
  for (const line of g.wide) why.push(`<li class="soft">${esc(line)}</li>`);
  if (g.thin.length > 0)
    why.push(`<li class="soft">Underpowered, left out of the parity test: ${esc(g.thin.join(', '))}.</li>`);
  if (g.parity) why.push(`<li>${esc(g.parity)}</li>`);

  // where it breaks: per spec, the stage rail and how many candidate runs first drift at each stage
  const specs = [...new Set(c.drilldown.map((r) => r.specId))];
  const rails = specs
    .map((spec) => {
      const stages = p.stages.get(spec) ?? [];
      const runs = c.drilldown.filter((r) => r.specId === spec);
      const hits = new Map<string, number>();
      for (const run of runs) {
        const first = run.succession.firstDriftBlock;
        if (first === undefined) continue;
        const block = run.blocks.find((b) => b.index === first);
        const stage = block?.expectedStage ?? 'unknown';
        hits.set(stage, (hits.get(stage) ?? 0) + 1);
      }
      const failing = runs.filter((r) => !r.pass).length;
      return `<div class="stagerail"><div class="name">${esc(p.titles.get(spec) ?? spec)}<span class="mono">${esc(spec)} · ${failing} of ${runs.length} runs fail</span></div><div class="rail">${stages
        .map((s, i) => {
          const n = hits.get(s) ?? 0;
          return `<span class="st ${n > 0 ? 'hit' : ''}">${i > 0 ? '<span class="ln"></span>' : ''}<span class="dot" title="${esc(s)}"></span>${n > 0 ? `<span class="cnt">${n} drift here</span>` : ''}<span class="lbl">${esc(s)}</span></span>`;
        })
        .join('')}</div></div>`;
    })
    .join('');

  const order: PairView['state'][] = ['regressed', 'both fail', 'improved', 'both pass'];
  const dossiers = order
    .map((state) => {
      const items = p.pairs.filter((x) => x.state === state);
      if (items.length === 0) return '';
      return `<h3 class="kicker" style="margin:28px 0 4px">${esc(state)}, ${items.length} golden${items.length === 1 ? '' : 's'}</h3>${items.map((x) => dossier(x, p)).join('')}`;
    })
    .join('');

  const critRows = cp.criteria
    .map(
      (r) =>
        `<tr class="${r.significantRegression ? 'bad' : ''}"><td class="mono">${esc(r.criterion)}</td><td class="r">${r.units}</td><td class="r">${r.regressed}</td><td class="r">${r.improved}</td><td class="r">${pointsText(r.effect.estimate)}</td><td class="r">${pointsText(r.effect.lower)} to ${pointsText(r.effect.upper)}</td><td class="r">${r.adjusted < 0.0001 ? '< 0.0001' : fixed(r.adjusted, 4)}</td><td>${r.significantRegression ? '<span class="chip chip--fail">regressed</span>' : r.gating ? (r.nonInferior ? '<span class="chip chip--ok">in margin</span>' : r.underpowered ? '<span class="chip chip--neutral chip--plain">underpowered</span>' : '<span class="chip chip--wait">not in margin</span>') : '<span class="chip chip--neutral chip--plain">not gating</span>'}</td></tr>`,
    )
    .join('');

  const body = `<main>
<header class="top">
<div>
<p class="kicker kicker--dot">driftbench scorecard · ${esc(cp.candidate.campaignId)} against ${esc(cp.baseline.campaignId)}</p>
<h1 class="serif">${esc(VERDICT_WORD[cp.verdict])}. <span class="soft">${esc(verdictSentence(p))}</span></h1>
<p class="note" style="margin-top:8px">${c.campaign.runs} runs of ${c.campaign.specs} specs, modes ${c.campaign.modes.join(', ')}, ${Math.max(...Object.values(c.campaign.repeats))} repeats, margin ${fixed(cp.margin * 100, 1)} points, spent ${usd(c.cost.totalUsd)}, created ${esc(c.campaign.createdAt.slice(0, 16).replace('T', ' '))}. Targets: ${esc(c.campaign.targets.join(', '))}.</p>
</div>
<div class="rail-nums">${nums.join('')}</div>
</header>

<section id="why"><h2>Why</h2><ol class="why">${why.join('')}</ol>
<p class="note" style="margin-top:10px">Paired goldens: ${t.bothPass} pass both, ${t.regressed} regressed, ${t.improved} improved, ${t.bothFail} fail both. McNemar exact p = ${cp.allPass.mcnemar.pValue < 0.0001 ? '< 0.0001' : fixed(cp.allPass.mcnemar.pValue, 4)}.</p></section>

<section id="breaks"><h2>Where it breaks</h2><p class="lead">Each spec declares its stages. The rail shows them in order; a red stage is where a candidate run first drifted, with the count of runs that did.</p>${rails}</section>

<section id="goldens"><h2>Golden by golden</h2><p class="lead">A golden is one spec in one mode, with one perturbation in P. Its dots are the repeats of the baseline (top) and of the candidate (bottom). Open one: the stage rail of the failing run, the block where the two agents part ways, side by side, then the whole conversation with its checks.</p>${dossiers}</section>

<section id="criteria"><h2>Criteria</h2><p class="lead">Effect in points, baseline pass rate minus the candidate's, with its Newcombe interval; q is the Benjamini-Hochberg adjusted p across ${cp.criteria.length} criteria at a false discovery rate of ${cp.q}.</p><div style="overflow-x:auto"><table class="crit"><thead><tr><th>criterion</th><th class="r">goldens</th><th class="r">regressed</th><th class="r">improved</th><th class="r">effect</th><th class="r">interval, pts</th><th class="r">q</th><th>verdict</th></tr></thead><tbody>${critRows}</tbody></table></div></section>

<section id="structure"><h2>How to read this page</h2><p class="lead">The run's structure: ${p.totals.specs} specs become ${p.totals.lines} goldens, each run ${p.totals.repeats} times, ${p.totals.runs} conversations of ${p.totals.blocks} blocks read by ${p.totals.verdicts} checks; the baseline and the candidate pair on the same goldens.</p><div class="card">${structureDiagram(p)}</div>
<ul class="note" style="margin:16px 0 0;padding-left:18px"><li>Every interval is two-sided at 95%: Wilson on k of n; Wilson with a design effect over the repeats of several goldens; a cluster bootstrap of 2000 resamples of whole conversations, seed 1; Newcombe for the paired difference.</li><li>A run passes when it completes, every block passes and the end state matches. A golden passes when every repeat passes.</li></ul></section>
</main>`;
  return page(`Scorecard ${c.campaign.campaignId}`, CSS, body, 'driftbench scorecard, option C: the trace');
}

function slug(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function rn(
  label: string,
  e: Estimate,
  show: (v: number) => string,
  note: string,
  scale: { lo?: number; hi?: number; margin?: number } = {},
): string {
  return `<div class="rn"><div class="n num">${esc(show(e.estimate))}</div>${intervalBar(e, { ...scale, height: 8 })}<div class="ci">${esc(intervalText(e, show))}</div><div class="l">${esc(label)}, ${esc(note)} <span class="soft">· ${esc(methodWord(e))}</span></div></div>`;
}

function dots(runs: RunDetail[]): string {
  return `<span class="dots">${runs.map((r) => `<i class="${r.pass ? '' : 'f'}" title="repeat ${r.repeat + 1}: ${r.pass ? 'pass' : 'fail'}"></i>`).join('')}</span>`;
}

function dossier(x: PairView, p: Prepared): string {
  const open = x.state === 'regressed' || x.state === 'both fail';
  const shown = x.runs.find((r) => !r.pass) ?? x.runs[0];
  if (!shown) return '';
  const first = shown.succession.firstDriftBlock;
  const base = x.baselineRuns[shown.repeat] ?? x.baselineRuns[0];
  const rail = shown.blocks
    .map((b) => {
      const bad =
        b.expectedStage !== undefined && b.observedStage !== undefined && b.expectedStage !== b.observedStage;
      return `<div class="br ${b.pass ? '' : 'fail'} ${b.injected ? 'inj' : ''}"><b>Block ${b.index + 1}${b.injected ? ' · injected' : ''}</b>${b.expectedStage ? `expect ${esc(b.expectedStage)}` : 'no stage expected'}<br>${bad ? `<span class="obs">reached ${esc(b.observedStage ?? 'none')}</span>` : `reached ${esc(b.observedStage ?? 'none')}`}${b.drift.length > 0 ? `<br><span class="obs">${esc(b.drift.join(', '))}</span>` : ''}<a href="#${blockId(shown, b)}" aria-label="open block ${b.index + 1}"></a></div>`;
    })
    .join('');
  const divergeBlock = first === undefined ? undefined : shown.blocks.find((b) => b.index === first);
  const baseBlock =
    divergeBlock && base ? base.blocks.find((b) => b.index === divergeBlock.index) : undefined;
  const diverge =
    divergeBlock === undefined
      ? ''
      : `<p class="kicker" style="margin:8px 0 8px">Block ${divergeBlock.index + 1}, where they part ways</p>
${divergeBlock.stimulus === undefined ? '' : `<p class="msg msg--user" style="margin-bottom:10px">${esc(divergeBlock.stimulus)}</p>`}
<div class="diverge">
<div class="side"><div class="who"><span>Baseline, ${esc(p.compare.baseline.campaignId)}</span><span class="chip ${baseBlock?.pass === false ? 'chip--fail' : 'chip--ok'}">${baseBlock ? (baseBlock.pass ? 'pass' : 'fail') : 'no run'}</span></div><p class="msg">${esc(baseBlock?.text ?? '(no baseline run of this block)')}</p>${baseBlock ? `<div class="tools">${baseBlock.toolCalls.length === 0 ? '<span class="small soft">no tool call</span>' : baseBlock.toolCalls.map((call) => `<span class="tool">${esc(call.label)}</span>`).join('')}</div><div class="note" style="margin-top:6px">stage ${esc(baseBlock.observedStage ?? 'none')}</div>` : ''}</div>
<div class="side ${divergeBlock.pass ? '' : 'bad'}"><div class="who"><span>Candidate, ${esc(p.compare.candidate.campaignId)}</span><span class="chip ${divergeBlock.pass ? 'chip--ok' : 'chip--fail'}">${divergeBlock.pass ? 'pass' : 'fail'}</span></div><p class="msg">${esc(divergeBlock.text || '(no text)')}</p><div class="tools">${divergeBlock.toolCalls.length === 0 ? '<span class="small soft">no tool call</span>' : divergeBlock.toolCalls.map((call) => `<span class="tool${call.error ? ' err' : ''}">${esc(call.label)}</span>`).join('')}</div><div class="note" style="margin-top:6px">stage ${esc(divergeBlock.observedStage ?? 'none')}${divergeBlock.expectedStage && divergeBlock.expectedStage !== divergeBlock.observedStage ? `, expected ${esc(divergeBlock.expectedStage)}` : ''}</div><div class="lost">${esc(
          divergeBlock.verdicts
            .filter((v) => v.outcome === 'fail' && v.gating)
            .map((v) => v.id)
            .join(', '),
        )}</div></div>
</div>`;
  const others = x.runs.filter((r) => r !== shown);
  return `<details class="golden" id="golden-${slug(x.pair.unit)}"${open ? ' open' : ''}>
<summary><span class="chip ${x.state === 'regressed' || x.state === 'both fail' ? 'chip--fail' : 'chip--ok'}">${esc(x.state)}</span><span><span class="title">${esc(p.titles.get(x.pair.specId) ?? x.pair.specId)}</span><br><span class="sub"><span class="mono">${esc(x.pair.unit)}</span> · ${esc(MODE_NAMES[x.pair.mode])}${x.lost.length > 0 ? ` · lost ${esc(x.lost.join(', '))}` : ''}${x.gained.length > 0 ? ` · gained ${esc(x.gained.join(', '))}` : ''}</span></span><span class="sides"><span>baseline</span>${dots(x.baselineRuns)}<span>candidate</span>${dots(x.runs)}</span></summary>
<div class="body">
<p class="kicker">Stage rail of repeat ${shown.repeat + 1}${first === undefined ? '' : `, first drift at block ${first + 1}`}</p>
<div class="blockrail">${rail}</div>
${diverge}
<p class="kicker" style="margin:4px 0 8px">The whole conversation, repeat ${shown.repeat + 1}</p>
<div class="runpick"><span class="soft">other repeats:</span>${others.map((r) => `<a href="#${runId(r)}">repeat ${r.repeat + 1}, ${r.pass ? 'pass' : 'fail'}</a>`).join('')}${others.length === 0 ? '<span class="soft">none</span>' : ''}</div>
${conversation(shown, p)}
${others.map((r) => `<details id="${runId(r)}" style="margin-top:12px"><summary class="small"><span class="chip ${r.pass ? 'chip--ok' : 'chip--fail'}">${r.pass ? 'pass' : 'fail'}</span> ${esc(runName(r))} ${blockStrip(r)}</summary><div style="margin-top:12px">${conversation(r, p)}</div></details>`).join('')}
</div>
</details>`;
}

function conversation(run: RunDetail, _p: Prepared): string {
  return `<div class="conv" id="${runId(run)}-conv">${run.blocks.map((b) => turn(run, b)).join('')}
<p class="note">latency ${ms(run.latencyMs)} · cost ${usd(run.cost)} · status ${esc(run.status)}${run.endState ? ` · end state ${run.endState.match ? 'matches' : 'differs'}` : ''}${run.recovery ? ` · recovery ${esc(run.recovery.label)}, collateral ${run.recovery.collateral}` : ''}</p></div>`;
}

function turn(run: RunDetail, b: BlockDetail): string {
  const bad =
    b.expectedStage !== undefined && b.observedStage !== undefined && b.expectedStage !== b.observedStage;
  const fails = b.verdicts.filter((v) => v.outcome !== 'pass' || v.kind === 'judge');
  return `<div class="turn" id="${blockId(run, b)}">
<div class="idx ${b.pass ? '' : 'bad'}">${b.index + 1}${b.pass ? '' : ' ✕'}</div>
<div class="u">${b.stimulus === undefined ? '<span class="small soft">no stimulus</span>' : `<p class="msg msg--user">${esc(b.stimulus)}</p>`}</div>
<div class="a"><p class="msg msg--agent">${esc(b.text || '(no text)')}</p></div>
<div class="meta"><span class="${bad ? 'bad' : ''}">stage ${esc(b.observedStage ?? 'none')}${bad ? `, expected ${esc(b.expectedStage ?? 'none')}` : ''}</span>${toolChips(b)}${(b.runtimeEvents ?? []).map((e) => `<span class="tool">${esc(e.kind)} ${esc(e.name)}${e.verdict ? ` · ${esc(e.verdict)}` : ''}</span>`).join('')}<span class="num">${ms(b.latencyMs)}${b.costUsd !== undefined ? ` · ${usd(b.costUsd)}` : ''}</span>${b.drift.length > 0 ? `<span class="bad">${esc(b.drift.map((d) => DRIFT_NAMES[d]).join(', '))}</span>` : ''}</div>
<div class="chk ${fails.length === 0 ? 'ok' : ''}"><div class="who">checks, ${b.verdicts.filter((v) => v.outcome === 'pass').length} of ${b.verdicts.length} pass</div>${checksOf(b)}</div>
</div>`;
}
