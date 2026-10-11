import type { DriftClass, Verdict } from '@driftbench/core';
import type { CompareResult } from './compare';
import type { Estimate } from './estimate';
import { count, esc, fixed, interval, json, pct, points, pValue, usd } from './format';
import type { PilotReport } from './pilot';
import type { RecoverySummary, ReliabilityLine } from './reliability';
import type { BlockDetail, RunDetail, Scorecard } from './scorecard';
import type { CellSpread, Spread } from './spread';

const DRIFT_NAMES: Record<DriftClass, string> = {
  X1_local: 'X1 local error',
  X2_contradiction: 'X2 contradiction',
  X3_flow: 'X3 flow drift',
  X4_format: 'X4 format or persona',
  X5_tool: 'X5 tool drift',
};

/**
 * The scorecard as one HTML file: inline styles, no script, no external asset, light and dark themes. The
 * same scorecard gives the same bytes.
 */
export function renderHtml(card: Scorecard): string {
  const c = card.campaign;
  const sections = [
    header(card),
    summary(card),
    card.compare ? compareSection(card.compare) : '',
    reliabilitySection(card.lines),
    successionSection(card),
    compoundingSection(card),
    recoverySection(card),
    spreadSection(card.spread),
    card.pilot ? pilotSection(card.pilot) : '',
    drilldownSection(card),
    methodSection(),
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="driftbench report">
<title>Scorecard ${esc(c.campaignId)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${sections.filter((section) => section !== '').join('\n')}
</main>
</body>
</html>
`;
}

function header(card: Scorecard): string {
  const c = card.campaign;
  const repeats = c.modes.map((mode) => `${mode} ${c.repeats[mode]}`).join(', ');
  return `<header>
<p class="eyebrow">driftbench scorecard</p>
<h1>${esc(c.campaignId)}</h1>
<dl class="facts">
${fact('Created', c.createdAt)}
${fact('Targets', c.targets.join(', ') || 'none')}
${fact('Modes', c.modes.join(', '))}
${fact('Repeats', repeats)}
${fact('Specs', String(c.specs))}
${fact('Runs', `${c.runs}: ${c.passing} pass, ${c.failing} fail, ${c.broken} did not complete`)}
${fact('Spent', usd(card.cost.totalUsd))}
</dl>
</header>`;
}

function fact(label: string, value: string): string {
  return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function summary(card: Scorecard): string {
  const tiles: string[] = [];
  for (const mode of card.modes) {
    if (mode.runPass) tiles.push(tile(`Runs passing, ${mode.mode}`, mode.runPass, pct, `${mode.runs} runs`));
    if (mode.blockAccuracy)
      tiles.push(tile(`Block accuracy, ${mode.mode}`, mode.blockAccuracy, pct, 'blocks'));
  }
  if (card.endState)
    tiles.push(tile('End state match', card.endState, pct, `${card.endState.n} runs compared`));
  if (card.tools.f1) {
    tiles.push(
      tile(
        'Tool F1',
        card.tools.f1,
        pct,
        `${card.tools.matched} of ${card.tools.expected} expected calls made`,
      ),
    );
  }
  if (card.recovery?.immediate) {
    tiles.push(
      tile('Immediate recovery', card.recovery.immediate, pct, `${card.recovery.measured} injections`),
    );
  }
  const overall = card.compounding.overall;
  if (overall?.interval) {
    tiles.push(
      tile(
        'Compounding index',
        { ...overall.interval, estimate: overall.index, method: 'cluster bootstrap', n: overall.blocks },
        points,
        'T minus F, points',
      ),
    );
  }
  if (card.cost.perBlockUsd) tiles.push(tile('Cost per block', card.cost.perBlockUsd, usd, 'US dollars'));
  if (card.cost.latencyMsPerBlock) {
    tiles.push(
      tile('Latency per block', card.cost.latencyMsPerBlock, (v) => `${fixed(v, 0)} ms`, 'milliseconds'),
    );
  }
  const verdict = card.compare ? verdictBanner(card.compare) : '';
  return `<section id="summary">
<h2>Summary</h2>
${verdict}
<div class="tiles">
${tiles.join('\n')}
</div>
</section>`;
}

function tile(label: string, estimate: Estimate, show: (value: number) => string, note: string): string {
  return `<div class="tile">
<p class="tile-label">${esc(label)}</p>
<p class="tile-value">${esc(show(estimate.estimate))}</p>
<p class="tile-ci">${esc(interval(estimate, show))}</p>
<p class="tile-note">${esc(note)}</p>
</div>`;
}

function verdictBanner(compare: CompareResult): string {
  const label =
    compare.verdict === 'non-inferior'
      ? 'Non-inferior'
      : compare.verdict === 'regressed'
        ? 'Regressed'
        : 'Not shown non-inferior';
  return `<div class="verdict verdict-${compare.verdict}">
<p class="verdict-label">${esc(label)}</p>
<p>Candidate ${esc(compare.candidate.campaignId)} against baseline ${esc(compare.baseline.campaignId)}, margin ${esc(fixed(compare.margin * 100, 1))} points, ${count(compare.pairs.length, 'paired golden')}.</p>
</div>`;
}

/** A rate cell: the value, its interval, and a bar drawn to scale on [0, 1]. */
function rateCell(estimate: Estimate | undefined): string {
  if (!estimate) return '<td class="num muted">none</td>';
  return `<td class="num"><span class="val">${esc(pct(estimate.estimate))}</span> <span class="ci">${esc(interval(estimate, pct))}</span>${bar(estimate)}</td>`;
}

function bar(estimate: Estimate): string {
  const x = (value: number) => fixed(Math.max(0, Math.min(1, value)) * 100, 1);
  const lower = estimate.method === 'none' ? estimate.estimate : estimate.lower;
  const upper = estimate.method === 'none' ? estimate.estimate : estimate.upper;
  return `<svg class="bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-track" x="0" y="2" width="100" height="2"/><rect class="bar-ci" x="${x(lower)}" y="1" width="${fixed(Math.max(0.6, (upper - lower) * 100), 1)}" height="4"/><rect class="bar-pt" x="${x(estimate.estimate)}" y="0" width="0.8" height="6"/></svg>`;
}

function numCell(text: string, extra = ''): string {
  return `<td class="num${extra ? ` ${extra}` : ''}">${esc(text)}</td>`;
}

function textCell(text: string, extra = ''): string {
  return `<td${extra ? ` class="${extra}"` : ''}>${esc(text)}</td>`;
}

function table(caption: string, head: string[], rows: string[], note = ''): string {
  if (rows.length === 0) return `<p class="muted">${esc(caption)}: none.</p>`;
  return `<div class="table-wrap"><table>
<caption>${esc(caption)}</caption>
<thead><tr>${head.map((cell) => `<th scope="col">${esc(cell)}</th>`).join('')}</tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table></div>${note ? `\n<p class="note">${esc(note)}</p>` : ''}`;
}

function compareSection(compare: CompareResult): string {
  const all = compare.allPass;
  const allRows = [
    `<tr>${textCell('baseline')}${textCell(compare.baseline.campaignId, 'mono')}${rateCell(all.baseline)}${numCell(`${all.baseline.k} of ${all.baseline.n}`)}</tr>`,
    `<tr>${textCell('candidate')}${textCell(compare.candidate.campaignId, 'mono')}${rateCell(all.candidate)}${numCell(`${all.candidate.k} of ${all.candidate.n}`)}</tr>`,
  ];
  const t = all.table;
  const tests = `<ul class="stats">
<li>Paired goldens: ${t.bothPass} pass in both, ${t.regressed} regressed (baseline passes, candidate fails), ${t.improved} improved, ${t.bothFail} fail in both.</li>
<li>McNemar exact on the discordant goldens: p = ${esc(pValue(all.mcnemar.pValue))}.</li>
<li>Effect, baseline rate minus candidate rate: ${esc(points(all.effect.estimate))} points, 95% interval ${esc(interval(all.effect, points))} (Newcombe, paired). ${all.nonInferior ? 'The upper bound is below the margin.' : 'The upper bound is not below the margin.'}</li>
<li>Drift count per golden, mean over repeats: baseline ${esc(fixed(compare.drift.baselineMean, 2))}, candidate ${esc(fixed(compare.drift.candidateMean, 2))}. Wilcoxon signed-rank (${esc(compare.drift.wilcoxon.method)}): p = ${esc(pValue(compare.drift.wilcoxon.pValue))} over ${count(compare.drift.wilcoxon.n, 'golden')} that differ.</li>
</ul>`;
  const criteriaRows = compare.criteria.map(
    (row) =>
      `<tr class="${row.significantRegression ? 'row-bad' : row.gating && row.nonInferior === false ? 'row-warn' : ''}">${textCell(row.criterion, 'mono')}${textCell(row.gating ? 'yes' : 'no')}${numCell(String(row.units))}${numCell(String(row.baselinePass))}${numCell(String(row.candidatePass))}${numCell(String(row.regressed))}${numCell(String(row.improved))}${numCell(pValue(row.pValue))}${numCell(pValue(row.adjusted))}${numCell(points(row.effect.estimate))}${numCell(interval(row.effect, points))}${textCell(row.gating ? (row.nonInferior ? 'within margin' : 'not within margin') : 'not gating')}${textCell(row.significantRegression ? 'regressed' : '')}</tr>`,
  );
  const changed = compare.pairs.filter(
    (pair) =>
      pair.baseline.allPass !== pair.candidate.allPass || pair.baseline.drift !== pair.candidate.drift,
  );
  const unitRows = changed.map((pair) => {
    const lost = [...pair.baseline.criteria.entries()]
      .filter(([name, entry]) => entry.pass && pair.candidate.criteria.get(name)?.pass === false)
      .map(([name]) => name);
    const gained = [...pair.candidate.criteria.entries()]
      .filter(([name, entry]) => entry.pass && pair.baseline.criteria.get(name)?.pass === false)
      .map(([name]) => name);
    return `<tr>${textCell(pair.unit, 'mono')}${textCell(pair.baseline.allPass ? 'pass' : 'fail')}${textCell(pair.candidate.allPass ? 'pass' : 'fail', pair.candidate.allPass ? '' : 'bad')}${numCell(fixed(pair.baseline.drift, 2))}${numCell(fixed(pair.candidate.drift, 2))}${textCell(lost.join(', ') || 'none', 'mono')}${textCell(gained.join(', ') || 'none', 'mono')}</tr>`;
  });
  const flagRows = compare.newFlags.map(
    (flag) => `<tr>${textCell(flag.unit, 'mono')}${textCell(flag.family, 'mono')}</tr>`,
  );
  const unpairedRows = compare.unpaired.map(
    (entry) => `<tr>${textCell(entry.unit, 'mono')}${textCell(entry.reason)}</tr>`,
  );
  return `<section id="compare">
<h2>Baseline and candidate</h2>
<p>Paired on the goldens both campaigns ran, one golden in one mode (one perturbation in P) per pair, modes ${esc(compare.modes.join(', '))}. A golden passes when every repeat passes. Margin ${esc(fixed(compare.margin * 100, 1))} points, interval level ${esc(fixed((1 - compare.alpha) * 100, 0))}%, false discovery rate ${esc(fixed(compare.q, 2))} across criteria. Gating flags: ${esc(compare.flagFamilies.join(', '))}.</p>
${reasonList(compare.reasons)}
${table('All-pass rate per campaign', ['side', 'campaign', 'goldens passing', 'count'], allRows)}
${tests}
${table(
  'Criteria, Benjamini-Hochberg across them',
  [
    'criterion',
    'gating',
    'goldens',
    'baseline pass',
    'candidate pass',
    'regressed',
    'improved',
    'p (McNemar)',
    'q (BH)',
    'effect',
    'interval',
    'margin',
    'verdict',
  ],
  criteriaRows,
  'A criterion is a machine verdict family or one judged criterion. It passes in a golden when every decided occurrence over every repeat passes; inconclusive verdicts are not counted.',
)}
${table('New gating flags: fire for the candidate, not for the baseline', ['golden', 'family'], flagRows)}
${table('Goldens that changed', ['golden', 'baseline', 'candidate', 'drift baseline', 'drift candidate', 'criteria lost', 'criteria gained'], unitRows)}
${unpairedRows.length > 0 ? table('Not paired', ['golden', 'reason'], unpairedRows) : ''}
</section>`;
}

/** The verdict's reasons: the first eight in view, the rest folded. */
function reasonList(reasons: readonly string[]): string {
  const item = (reason: string) => `<li>${esc(reason)}</li>`;
  const shown = reasons.slice(0, 8).map(item).join('');
  const rest = reasons.slice(8);
  return `<ul class="reasons">${shown}</ul>${rest.length > 0 ? `<details><summary>${count(rest.length, 'more reason')}</summary><ul class="reasons">${rest.map(item).join('')}</ul></details>` : ''}`;
}

function atKText(line: ReliabilityLine, which: 'passK' | 'passAtK'): string {
  const last = line[which][line[which].length - 1];
  if (!last) return '';
  return `${pct(last.value)} [${pct(last.lower)}, ${pct(last.upper)}]`;
}

function reliabilitySection(lines: readonly ReliabilityLine[]): string {
  const rows = lines.map(
    (line) =>
      `<tr${line.passRate.k < line.passRate.n ? ' class="row-warn"' : ''}>${textCell(line.specId, 'mono')}${textCell(lineTarget(line), 'mono')}${textCell(line.mode)}${textCell(line.perturbationId ?? '', 'mono')}${numCell(`${line.passRate.k} of ${line.runs}`)}${rateCell(line.passRate)}${numCell(`k=${line.runs}: ${atKText(line, 'passK')}`)}${numCell(`k=${line.runs}: ${atKText(line, 'passAtK')}`)}${numCell(`${pct(line.unreliability.estimate)} ${interval(line.unreliability, pct)}`)}${rateCell(line.blockAccuracy)}</tr>`,
  );
  const ks = lines.flatMap((line) =>
    line.runs < 2
      ? []
      : [
          `<tr>${textCell(line.specId, 'mono')}${textCell(line.mode)}${textCell(line.perturbationId ?? '', 'mono')}${line.passK
            .map((entry) => numCell(`k=${entry.k}: ${pct(entry.value)}`))
            .join('')}</tr>`,
        ],
  );
  const maxK = Math.max(0, ...lines.map((line) => line.runs));
  return `<section id="reliability">
<h2>Reliability per golden</h2>
<p>One line is one golden on one target in one mode (one perturbation in P), over its repeats. pass^k is the chance that k repeats all pass, pass@k that one of k passes; their interval is the Wilson interval of the per-run rate raised the same way. Unreliability is the 90th minus the 10th percentile of the share of passing blocks across repeats.</p>
${table(
  'Reliability',
  [
    'golden',
    'target',
    'mode',
    'perturbation',
    'passing runs',
    'pass rate',
    'pass^k',
    'pass@k',
    'unreliability',
    'block accuracy',
  ],
  rows,
)}
${ks.length > 0 ? table('pass^k for every k', ['golden', 'mode', 'perturbation', ...Array.from({ length: maxK }, (_, i) => `k=${i + 1}`)], ks) : ''}
</section>`;
}

function lineTarget(line: ReliabilityLine): string {
  const t = line.target;
  return t.agent === undefined ? t.adapter : `${t.adapter}:${t.agent}${t.variant ? ` (${t.variant})` : ''}`;
}

function classes(mix: Partial<Record<DriftClass, number>>): string {
  const entries = (Object.keys(DRIFT_NAMES) as DriftClass[]).filter((cls) => (mix[cls] ?? 0) > 0);
  return entries.length === 0 ? 'none' : entries.map((cls) => `${cls} ${mix[cls]}`).join(', ');
}

function successionSection(card: Scorecard): string {
  const rows = card.lines.map((line) => {
    const s = line.succession;
    return `<tr>${textCell(line.specId, 'mono')}${textCell(line.mode)}${textCell(line.perturbationId ?? '', 'mono')}${numCell(String(s.runs))}${rateCell(s.driftRate)}${numCell(s.driftCount ? `${fixed(s.driftCount.estimate, 2)} ${interval(s.driftCount, (v) => fixed(v, 2))}` : '')}${numCell(s.firstDrift.map((entry) => `${entry.block === 'none' ? 'none' : `block ${entry.block}`}: ${entry.runs}`).join(', '))}${numCell(s.longestClean === undefined ? '' : fixed(s.longestClean, 1))}${rateCell(s.allBlocksPass)}${textCell(classes(s.classes), 'mono')}</tr>`;
  });
  const total = Object.values(card.drift).reduce((a, b) => a + (b ?? 0), 0);
  const mix = (Object.keys(DRIFT_NAMES) as DriftClass[]).map((cls) => {
    const n = card.drift[cls] ?? 0;
    const width = total === 0 ? 0 : (n / total) * 100;
    return `<tr>${textCell(DRIFT_NAMES[cls])}${numCell(String(n))}<td class="num"><svg class="bar wide" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-track" x="0" y="2" width="100" height="2"/><rect class="bar-ci" x="0" y="1" width="${fixed(width, 1)}" height="4"/></svg> ${esc(total === 0 ? '' : pct(n / total))}</td></tr>`;
  });
  const modeRows = card.modes.map(
    (mode) =>
      `<tr>${textCell(mode.mode)}${numCell(String(mode.lines))}${numCell(String(mode.runs))}${rateCell(mode.runPass)}${rateCell(mode.blockAccuracy)}${rateCell(mode.allBlocksPass)}${numCell(mode.passK ? `k=${mode.passK.k}: ${pct(mode.passK.mean)}` : '')}${numCell(mode.driftCount ? `${fixed(mode.driftCount.estimate, 2)} ${interval(mode.driftCount, (v) => fixed(v, 2))}` : '')}${textCell(classes(mode.classes), 'mono')}</tr>`,
  );
  return `<section id="succession">
<h2>Blocks and their succession</h2>
${table(
  'Per mode',
  [
    'mode',
    'goldens',
    'runs',
    'runs passing',
    'block accuracy',
    'every block passes',
    'mean pass^k',
    'drifting blocks per run',
    'drift classes',
  ],
  modeRows,
  'Runs passing and every block passes: the repeats of one golden form one cluster. Block accuracy and drift per run: one run, one conversation, is one cluster.',
)}
${table('Drift class mix, blocks over every run', ['class', 'blocks', 'share'], mix)}
${table(
  'Succession per golden',
  [
    'golden',
    'mode',
    'perturbation',
    'runs',
    'drift rate',
    'drifting blocks per run',
    'first drift',
    'longest clean (mean)',
    'every block passes',
    'drift classes',
  ],
  rows,
)}
</section>`;
}

function compoundingSection(card: Scorecard): string {
  const comp = card.compounding;
  const rows = comp.specs.map(
    (line) =>
      `<tr>${textCell(line.specId, 'mono')}${numCell(String(line.blocks.length))}${numCell(`${line.runsT}/${line.runsF}`)}${numCell(pct(line.passT))}${numCell(pct(line.passF))}${numCell(points(line.index))}${numCell(line.interval ? `[${points(line.interval.lower)}, ${points(line.interval.upper)}]` : 'no interval')}</tr>`,
  );
  if (comp.overall) {
    const o = comp.overall;
    rows.push(
      `<tr class="row-total">${textCell('every golden')}${numCell(String(o.blocks))}${numCell('')}${numCell(pct(o.passT))}${numCell(pct(o.passF))}${numCell(points(o.index))}${numCell(o.interval ? `[${points(o.interval.lower)}, ${points(o.interval.upper)}]` : 'no interval: one golden')}</tr>`,
    );
  }
  return `<section id="compounding">
<h2>Compounding index</h2>
<p>The teacher-forced pass rate minus the free-running pass rate over the blocks both modes ran. Positive: each block is right on its own and the agent loses it across the succession. Interval: blocks resampled within a golden, goldens across the campaign.</p>
${table('Compounding index', ['golden', 'shared blocks', 'runs T/F', 'T', 'F', 'index (points)', 'interval'], rows)}
</section>`;
}

function recoveryRow(label: string, rec: RecoverySummary, mono = false): string {
  return `<tr>${textCell(label, mono ? 'mono' : '')}${numCell(String(rec.measured))}${numCell(`${rec.labels.immediate} / ${rec.labels.late} / ${rec.labels.never}`)}${rateCell(rec.immediate)}${rateCell(rec.recovered)}${numCell(rec.medianTurns === undefined ? 'none' : fixed(rec.medianTurns, 1))}${numCell(rec.collateral ? `${fixed(rec.collateral.estimate, 2)} ${interval(rec.collateral, (v) => fixed(v, 2))}` : '')}${rateCell(rec.safeAction)}${rateCell(rec.clarified)}</tr>`;
}

function recoverySection(card: Scorecard): string {
  const head = [
    '',
    'injections',
    'immediate / late / never',
    'immediate',
    'came back',
    'median blocks to recover',
    'collateral per run',
    'safe action',
    'clarified',
  ];
  const byClass = card.recoveryByClass.map((entry) => recoveryRow(entry.deviation, entry.summary, true));
  if (card.recovery)
    byClass.push(recoveryRow('every injection', card.recovery).replace('<tr>', '<tr class="row-total">'));
  const byLine = card.lines.flatMap((line) =>
    line.recovery ? [recoveryRow(`${line.specId} · ${line.perturbationId ?? ''}`, line.recovery, true)] : [],
  );
  return `<section id="recovery">
<h2>Recovery after a deviation</h2>
<p>For every perturbed run whose perturbation sets a recovery: immediate when the agent passes at its stage within the blocks allowed, late after, never when it does not come back. Collateral counts the blocks after the injection that fail what passed in the free-running reference. Safe action: no forbidden or unnamed consequential act during the detour. Clarified: a question before the first consequential act.</p>
${table('Recovery per deviation class', ['class', ...head.slice(1)], byClass)}
${table('Recovery per golden and perturbation', ['golden · perturbation', ...head.slice(1)], byLine)}
</section>`;
}

function cellRow(cell: CellSpread): string {
  const w = cell.wording;
  const wording = w
    ? `${pct(w.maxRange)} max over ${count(w.conversations, 'conversation')}${w.flagged ? ', flagged' : ''}`
    : 'one wording';
  return `<tr class="${cell.status === 'below' ? 'row-bad' : cell.status === 'undecided' ? 'row-warn' : ''}">${textCell(cell.cell, 'mono')}${numCell(String(cell.conversations))}${numCell(String(cell.runs))}${rateCell(cell.rate)}${numCell(pct(cell.reference))}${textCell(cell.status)}${textCell(wording)}</tr>`;
}

function spreadSection(s: Spread): string {
  const head = [
    'cell',
    'conversations',
    'runs',
    'pass rate',
    'reference',
    'against reference minus margin',
    'wording range',
  ];
  const q = s.quantiles;
  const quantiles = q
    ? `<div class="table-wrap"><table class="compact"><caption>Cell pass rates, quantiles across ${count(s.cells.length, 'cell')}</caption><thead><tr>${['min', 'p10', 'p25', 'median', 'p75', 'p90', 'max'].map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody><tr>${[q.min, q.p10, q.p25, q.p50, q.p75, q.p90, q.max].map((v) => numCell(pct(v))).join('')}</tr></tbody></table></div>`
    : '';
  const noise = s.noise
    ? `<ul class="stats">
<li>Run-to-run variance of the pass flag, pooled over ${count(s.noise.lines, 'golden')} with repeats (median ${s.noise.repeats} repeats): ${esc(fixed(s.noise.variance, 4))}.</li>
<li>Noise floor of a difference between two versions: ${esc(fixed(s.noise.perGolden * 100, 1))} points on one golden, ${esc(fixed(s.noise.perCampaign * 100, 1))} points on the pass rate of the mode. A difference under the floor is noise.</li>
<li>Blocks that flip between repeats: ${s.noise.blockFlip ? `${esc(pct(s.noise.blockFlip.estimate))} ${esc(interval(s.noise.blockFlip, pct))}, ${s.noise.blockFlip.k} of ${s.noise.blockFlip.n}` : 'no block ran twice'}.</li>
<li>Repeats per golden for a 5-point floor: ${s.noise.repeatsFor5Points}.</li>
</ul>`
    : '<p class="muted">One repeat per golden: no run-to-run noise floor can be read from this campaign.</p>';
  const judgeRows = s.judgeFlip.map(
    (entry) =>
      `<tr>${textCell(entry.criterion, 'mono')}${numCell(String(entry.verdicts))}${rateCell(entry.flip)}${numCell(String(entry.inconclusive))}</tr>`,
  );
  const source =
    s.source === 'pilot'
      ? 'cells from the pilot factors (metadata.pilot)'
      : s.source === 'generated'
        ? `cells from metadata.generated.cell, by ${s.by.join(', ')}`
        : 'no generated cell in these specs: one golden is one cell';
  return `<section id="spread">
<h2>Spread</h2>
<p>Mode ${esc(s.mode)}, ${esc(source)}. A cell rate takes its conversations as clusters when it holds two or more, else the Wilson interval over its runs. A cell is undecided when its interval straddles its reference minus the margin (${esc(fixed(s.margin * 100, 1))} points); the reference is the baseline cell rate when a baseline is given, else 100%.</p>
${quantiles}
${table('Five worst cells', head, s.worst.map(cellRow))}
${table('Undecided cells', head, s.undecided.map(cellRow))}
<h3>Run-to-run noise</h3>
${noise}
<h3>Judge flip rate</h3>
${judgeRows.length > 0 ? table('Judged verdicts whose votes disagree, per criterion', ['criterion', 'verdicts with two votes or more', 'flip rate', 'inconclusive'], judgeRows) : '<p class="muted">No judged verdict with two votes or more in this campaign.</p>'}
<details>
<summary>Every cell (${s.cells.length})</summary>
${table('Every cell', head, s.cells.map(cellRow), 'Wording range: per conversation run in two wordings or more, the highest minus the lowest wording pass rate. A cell is flagged when its largest range is above 20 points and above its run-to-run noise floor.')}
</details>
</section>`;
}

function pilotSection(p: PilotReport): string {
  const a = p.analysis;
  const levels = a.pooled.levels.map(
    (level) =>
      `<tr>${textCell(level.level)}${numCell(level.groups === undefined ? '' : String(level.groups))}${numCell(pct(level.share))}${numCell(level.shareInterval ? `[${pct(level.shareInterval.lower)}, ${pct(level.shareInterval.upper)}]` : '')}${numCell(String(a.pooled.icc?.find((entry) => entry.level === level.level)?.icc.toFixed(3) ?? ''))}</tr>`,
  );
  const cells = a.cells.map(
    (cell) =>
      `<tr>${textCell(cell.cell, 'mono')}${numCell(String(cell.conversations))}${numCell(String(cell.runs))}${numCell(`${pct(cell.passRate)}${cell.passInterval ? ` [${pct(cell.passInterval.lower)}, ${pct(cell.passInterval.upper)}]` : ''}`)}${numCell(cell.wording?.maxRange === undefined ? '' : pct(cell.wording.maxRange))}${textCell(cell.wording?.flagged ? 'flagged' : '')}${numCell(cell.flip ? pct(cell.flip.mean) : '')}${numCell(cell.allocation ? String(cell.allocation.allocated) : '')}</tr>`,
  );
  const nf = a.noiseFloor;
  const target = p.target.agent === undefined ? p.target.adapter : `${p.target.adapter}:${p.target.agent}`;
  return `<section id="pilot">
<h2>Variance pilot</h2>
<p>Pilot ${esc(p.campaignId)} on ${esc(target)}: ${p.design.cells} cells, up to ${p.design.conversations} conversations per cell, ${p.design.wordings} wordings, ${p.design.repeats} repeats; ${a.observations} runs. Pass rate ${esc(pct(a.passRate.estimate))}${a.passRate.interval ? ` [${esc(pct(a.passRate.interval.lower))}, ${esc(pct(a.passRate.interval.upper))}]` : ''}.</p>
${table('Share of the variance per level (cell > conversation > wording > repeat)', ['level', 'groups', 'share', 'interval', 'intraclass correlation'], levels)}
<ul class="stats">
${a.designEffect ? `<li>Design effect ${esc(fixed(a.designEffect.value, 2))} (cluster size ${esc(fixed(a.designEffect.m, 2))}, rho ${esc(fixed(a.designEffect.rho, 3))}).</li>` : ''}
${nf ? `<li>Noise floor target ${esc(pct(nf.floor))}: run-to-run variance ${esc(fixed(nf.variance, 4))}${nf.perBlock ? `, ${nf.perBlock.repeats} repeats per block` : ''}${nf.perCell ? `, ${nf.perCell.repeats} for a cell figure over ${nf.perCell.blocks} blocks` : ''}.</li>` : ''}
${a.flip ? `<li>Blocks flipping between repeats: ${a.flip.flipping} of ${a.flip.blocks}, mean flip rate ${esc(pct(a.flip.mean))}.</li>` : ''}
${a.wording ? `<li>Wording-sensitive cells (range above ${esc(pct(a.wording.threshold))} and the F test at false discovery rate ${esc(fixed(a.wording.q, 2))}): ${esc(a.wording.flagged.join(', ') || 'none')}.</li>` : ''}
</ul>
${table('Pilot cells', ['cell', 'conversations', 'runs', 'pass rate', 'wording range', 'wording', 'mean flip', 'allocated'], cells)}
</section>`;
}

function verdictRow(v: Verdict): string {
  const votes = v.judge?.votes ?? [];
  const reasoning = [
    ...(v.reasoning ? [v.reasoning] : []),
    ...votes.map((vote) => `${vote.judge}: ${vote.outcome}${vote.reasoning ? `. ${vote.reasoning}` : ''}`),
  ];
  const cls =
    v.outcome === 'fail'
      ? v.gating
        ? 'row-bad'
        : 'row-warn'
      : v.outcome === 'inconclusive'
        ? 'row-warn'
        : '';
  return `<tr class="${cls}">${textCell(v.outcome)}${textCell(v.id, 'mono')}${textCell(v.kind)}${textCell(v.gating ? 'yes' : 'no')}${textCell(v.evidence, 'evidence')}${textCell(reasoning.join('\n'), 'evidence')}</tr>`;
}

/**
 * One block of a run. Failing verdicts and every judged verdict carry their evidence and reasoning; the
 * machine verdicts that passed are listed by id only, so a long campaign stays a readable file.
 */
function blockDetail(block: BlockDetail): string {
  const shown = block.verdicts.filter((v) => v.outcome !== 'pass' || v.kind === 'judge');
  const passed = block.verdicts.filter((v) => v.outcome === 'pass' && v.kind !== 'judge');
  const where = block.specBlock === undefined ? 'injected block' : `spec block ${block.specBlock}`;
  const calls =
    block.toolCalls.length === 0
      ? '<p class="muted">No tool call.</p>'
      : block.toolCalls
          .map(
            (call) =>
              `<div class="call"><p class="mono">${esc(call.label)}${call.error ? ` <span class="bad">error: ${esc(call.error)}</span>` : ''}</p><pre>${esc(json({ input: call.input, output: call.output }, 1200))}</pre></div>`,
          )
          .join('');
  const tools =
    block.pass && block.toolCalls.length > 0
      ? `<details><summary>${esc(block.toolCalls.map((call) => call.label).join(', '))}</summary>${calls}</details>`
      : calls;
  const verdictHead = ['outcome', 'verdict', 'kind', 'gating', 'evidence', 'judge reasoning'];
  return `<div class="block ${block.pass ? 'block-pass' : 'block-fail'}">
<p class="block-head"><span class="badge ${block.pass ? 'ok' : 'bad'}">${block.pass ? 'pass' : 'fail'}</span> Block ${block.index}, ${esc(where)}${block.drift.length > 0 ? `, drift ${esc(block.drift.join(', '))}` : ''}. Stage expected ${esc(block.expectedStage ?? 'none')}, observed ${esc(block.observedStage ?? 'none')}.</p>
${block.stimulus === undefined ? '' : `<p class="label">User</p><pre class="msg">${esc(block.stimulus)}</pre>`}
<p class="label">Agent</p><pre class="msg">${esc(block.text || '(no text)')}</pre>
<p class="label">Tool calls</p>${tools}
${shown.length > 0 ? table('Verdicts with evidence: every one that did not pass, every judged one', verdictHead, shown.map(verdictRow)) : ''}
${passed.length > 0 ? `<p class="passed"><span class="label">Machine verdicts passed:</span> <span class="mono">${esc(passed.map((v) => v.id).join(', '))}</span></p>` : ''}
</div>`;
}

/** A passing run in brief: per block, the user turn, the reply and the tool labels. */
function blockBrief(block: BlockDetail): string {
  const where = block.specBlock === undefined ? 'injected block' : `spec block ${block.specBlock}`;
  const tools =
    block.toolCalls.length === 0 ? 'no tool call' : block.toolCalls.map((call) => call.label).join(', ');
  const judged = block.verdicts.filter((v) => v.kind === 'judge');
  return `<div class="block block-pass">
<p class="block-head">Block ${block.index}, ${esc(where)}, stage ${esc(block.observedStage ?? 'none')}, ${count(block.verdicts.length, 'verdict')} passed. Tools: <span class="mono">${esc(tools)}</span>.</p>
${block.stimulus === undefined ? '' : `<pre class="msg">${esc(block.stimulus)}</pre>`}
<pre class="msg">${esc(block.text || '(no text)')}</pre>
${judged.length > 0 ? table('Judged verdicts', ['outcome', 'verdict', 'kind', 'gating', 'evidence', 'judge reasoning'], judged.map(verdictRow)) : ''}
</div>`;
}

function runDetail(run: RunDetail): string {
  const name = [
    run.specId,
    run.target,
    run.mode,
    `repeat ${run.repeat}`,
    ...(run.perturbationId ? [run.perturbationId] : []),
  ].join(' · ');
  const s = run.succession;
  const facts = [
    `status ${run.status}`,
    `${count(run.blocks.length, 'block')}`,
    `first drift ${s.firstDriftBlock === undefined ? 'none' : `block ${s.firstDriftBlock}`}`,
    `${s.driftCount} drifting`,
    ...(run.deviation ? [`deviation ${run.deviation}`] : []),
    ...(run.recovery
      ? [
          `recovery ${run.recovery.label}${run.recovery.turnsToRecover === undefined ? '' : ` after ${run.recovery.turnsToRecover}`}, collateral ${run.recovery.collateral}`,
        ]
      : []),
    ...(run.endState ? [`end state ${run.endState.match ? 'matches' : 'differs'}`] : []),
  ];
  const diff =
    run.endState && !run.endState.match
      ? table(
          'End state differences',
          ['field', 'expected', 'observed'],
          run.endState.diff.map(
            (entry) =>
              `<tr>${textCell(entry.field, 'mono')}${textCell(JSON.stringify(entry.expected) ?? 'undefined', 'mono')}${textCell(JSON.stringify(entry.observed) ?? 'undefined', 'mono')}</tr>`,
          ),
        )
      : '';
  return `<details class="run ${run.pass ? 'run-pass' : 'run-fail'}" id="run-${esc(run.runId)}"${run.pass ? '' : ' open'}>
<summary><span class="badge ${run.pass ? 'ok' : 'bad'}">${run.pass ? 'pass' : 'fail'}</span> <span class="mono">${esc(name)}</span></summary>
<p class="run-facts">${esc(facts.join(', '))}.${run.title ? ` ${esc(run.title)}.` : ''}</p>
${run.error ? `<p class="bad">${esc(run.error)}</p>` : ''}
${diff}
${run.blocks.map(run.pass ? blockBrief : blockDetail).join('\n')}
</details>`;
}

function drilldownSection(card: Scorecard): string {
  const failing = card.drilldown.filter((run) => !run.pass).length;
  const passing = card.drilldown.length - failing;
  return `<section id="drilldown">
<h2>Drilldown</h2>
<p>Failing runs first, open and in full: each block with what the user sent, what the agent said and called, every verdict that did not pass and every judged verdict with its evidence and the judge's reasoning. Passing runs follow in brief. Shown: ${count(failing, 'failing run')} and ${count(passing, 'passing run')}.${card.omittedRuns > 0 ? ` ${count(card.omittedRuns, 'more run')} left out by the run limit.` : ''}</p>
${card.drilldown.map(runDetail).join('\n')}
</section>`;
}

function methodSection(): string {
  return `<section id="method">
<h2>How the numbers are made</h2>
<ul>
<li>Every interval is two-sided at 95%.</li>
<li>Wilson: the score interval on k of n, used for a rate over independent units (the repeats of one golden, the goldens of a campaign).</li>
<li>Cluster bootstrap: 2000 percentile resamples of whole clusters, seed 1, so the same store gives the same page. Anything pooled over blocks takes one run (one conversation) as one cluster; anything pooled over the runs of a mode takes one golden as one cluster.</li>
<li>Wilson over clusters: a pass rate whose values all agree (every block passes, or none does) leaves a bootstrap no width, so it takes the Wilson interval with each cluster counted once.</li>
<li>Newcombe: the paired difference of two rates, for baseline against candidate.</li>
<li>No interval: a bootstrap over a single cluster has none; the page says so instead of drawing one.</li>
<li>A run passes when it completes, every block passes and the end state matches.</li>
</ul>
</section>`;
}

const STYLE = `
:root{--bg:#fbfbfa;--panel:#ffffff;--ink:#1d1f23;--muted:#61656e;--line:#e3e4e8;--accent:#3a5bd9;--ok:#1d7a46;--ok-bg:#e6f4ec;--bad:#b42318;--bad-bg:#fdecea;--warn:#8a5a00;--warn-bg:#fff6e0;--track:#e3e4e8;--ci:#9db0f0;--pt:#1d1f23;color-scheme:light}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#121316;--panel:#1a1c20;--ink:#e8e9ec;--muted:#a1a5ae;--line:#2c2f36;--accent:#8ea6ff;--ok:#5cc98a;--ok-bg:#16301f;--bad:#ff8a7a;--bad-bg:#3a1a17;--warn:#f0c060;--warn-bg:#33290f;--track:#2c2f36;--ci:#4a5ea8;--pt:#e8e9ec;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121316;--panel:#1a1c20;--ink:#e8e9ec;--muted:#a1a5ae;--line:#2c2f36;--accent:#8ea6ff;--ok:#5cc98a;--ok-bg:#16301f;--bad:#ff8a7a;--bad-bg:#3a1a17;--warn:#f0c060;--warn-bg:#33290f;--track:#2c2f36;--ci:#4a5ea8;--pt:#e8e9ec;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;margin:4px 0 12px;word-break:break-all}
h2{font-size:18px;margin:0 0 8px}
h3{font-size:15px;margin:16px 0 6px}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
.eyebrow{margin:0;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-size:12px}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px 16px;margin:0}
.facts dt{color:var(--muted);font-size:12px}.facts dd{margin:0}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.tile{border:1px solid var(--line);border-radius:8px;padding:10px}
.tile p{margin:0}.tile-label{color:var(--muted);font-size:12px}.tile-value{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
.tile-ci{font-size:12px;font-variant-numeric:tabular-nums}.tile-note{color:var(--muted);font-size:12px}
.verdict{border-radius:8px;padding:10px 12px;margin:0 0 12px}.verdict p{margin:0}.verdict-label{font-weight:700;font-size:16px}
.verdict-non-inferior{background:var(--ok-bg);color:var(--ok)}.verdict-regressed{background:var(--bad-bg);color:var(--bad)}.verdict-unproven{background:var(--warn-bg);color:var(--warn)}
.table-wrap{overflow-x:auto;margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:13px}
caption{text-align:left;font-weight:600;padding:4px 0}
th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:500;white-space:nowrap}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.ci{color:var(--muted);font-size:12px}
.mono,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
td.mono{overflow-wrap:anywhere;min-width:12ch}
.evidence{white-space:pre-wrap;max-width:420px;word-break:break-word}
.muted,.note{color:var(--muted)}.note{font-size:12px}
.row-bad td{background:var(--bad-bg)}.row-warn td{background:var(--warn-bg)}.row-total td{font-weight:600}
.bad{color:var(--bad)}
.bar{display:block;width:96px;height:6px;margin-top:2px}.bar.wide{display:inline-block;width:160px;vertical-align:middle}
.bar-track{fill:var(--track)}.bar-ci{fill:var(--ci)}.bar-pt{fill:var(--pt)}
table.compact{width:auto}
.stats,.reasons{margin:8px 0;padding-left:20px}
details.run{border:1px solid var(--line);border-radius:8px;padding:6px 10px;margin:6px 0}
details.run>summary{cursor:pointer}
.run-facts{color:var(--muted);margin:6px 0}
.badge{display:inline-block;border-radius:4px;padding:0 6px;font-size:12px;font-weight:600}
.badge.ok{background:var(--ok-bg);color:var(--ok)}.badge.bad{background:var(--bad-bg);color:var(--bad)}
.block{border-left:3px solid var(--line);padding:4px 0 4px 10px;margin:10px 0}
.block-fail{border-left-color:var(--bad)}.block-pass{border-left-color:var(--ok)}
.block-head{margin:0 0 4px}.passed{margin:6px 0;font-size:12px;word-break:break-word}.label{margin:6px 0 2px;color:var(--muted);font-size:12px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:6px 8px;margin:0;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto}
.call{margin:4px 0}.call p{margin:0 0 2px}
@media (max-width:600px){main{padding:16px 16px 48px}section{padding:12px}.tile-value{font-size:18px}}
`;
