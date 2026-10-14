/**
 * What the three scorecard prototypes share: the brand tokens (Nexus design system v1), the embedded fonts,
 * the data they derive from a Scorecard (pairs joined to their runs, failing checks joined to their blocks),
 * and the small drawings (interval bars, block strips, the structure diagram). Prototypes only: the renderer
 * on main is `../src/html.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriftClass, Verdict } from '@agent-nexus/driftbench-core';
import type { CompareResult, UnitPair } from '../src/compare';
import type { Estimate } from '../src/estimate';
import { esc, fixed, pct } from '../src/format';
import type { BlockDetail, RunDetail, Scorecard } from '../src/scorecard';

export { esc, fixed, pct };

export const DRIFT_NAMES: Record<DriftClass, string> = {
  X1_local: 'X1 local error',
  X2_contradiction: 'X2 contradiction',
  X3_flow: 'X3 flow drift',
  X4_format: 'X4 format or persona',
  X5_tool: 'X5 tool drift',
};

export const MODE_NAMES = { T: 'teacher-forced', F: 'free-running', P: 'perturbed' } as const;

/* ---------- fonts: the brand's woff2 files, embedded so the page works offline ---------- */

const FONT_DIR = `${process.env.HOME}/nexus/nexus-orga/general-context/brand/design-system-v1/assets/fonts`;

function fontFace(family: string, file: string, weight: string, style = 'normal'): string {
  const data = readFileSync(join(FONT_DIR, file)).toString('base64');
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2')}`;
}

export function fontCss(): string {
  return [
    fontFace('Geist', 'Geist-latin.woff2', '300 600'),
    fontFace('Geist Mono', 'GeistMono-latin.woff2', '400 500'),
    fontFace('Libre Caslon Display', 'LibreCaslonDisplay-400-latin.woff2', '400'),
    fontFace('Libre Caslon Text', 'LibreCaslonText-400-latin.woff2', '400'),
  ].join('\n');
}

/* ---------- tokens: light and dark, from tokens/tokens.css; status colours are the one addition ---------- */

export const TOKENS = `
:root{
  --nx-page:#F6F8FB;--nx-card:#FFFFFF;--nx-card-2:#EEF1F6;--nx-ink:#0E1116;--nx-ink-2:rgba(14,17,22,.68);--nx-ink-3:rgba(14,17,22,.5);
  --nx-line:rgba(14,17,22,.10);--nx-line-2:rgba(14,17,22,.18);--nx-orange:#FF6600;--nx-blue:#2F5FD0;--nx-blue-soft:#EEF3FB;--nx-navy-ink:#1B2A44;--nx-navy-ink-2:#4A5873;
  --nx-silk-2:#9DBDF2;--nx-ok:#2E9B63;--nx-ok-soft:#E3F4EA;--nx-ok-ink:#1F7A4A;--nx-wait:#C98A00;--nx-wait-soft:#FBF1DA;--nx-wait-ink:#7A5300;
  --nx-fail:#C1352B;--nx-fail-soft:#FBE7E4;--nx-fail-ink:#9A2A22;--nx-bubble:#1B2A44;
  --nx-chart-grid:rgba(14,17,22,.07);--nx-chart-axis:rgba(14,17,22,.18);--nx-chart-label:rgba(14,17,22,.55);--nx-ill-edge:rgba(27,42,68,.2);
  --nx-silk-card:linear-gradient(160deg,#F4F7FB,#CFDDF1 55%,#9DBDF2);
  --nx-glass-bg:rgba(255,255,255,.66);--nx-glass-line:rgba(255,255,255,.6);--nx-shadow-glass:0 20px 40px -28px rgba(14,30,60,.35);--nx-shadow-chip:0 1px 0 rgba(14,17,22,.06),0 6px 16px -10px rgba(14,30,60,.35);
  --nx-serif:'Libre Caslon Display',Georgia,serif;--nx-serif-text:'Libre Caslon Text',Georgia,serif;--nx-sans:'Geist',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;--nx-mono:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --nx-ease:cubic-bezier(.2,.7,.2,1);
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --nx-page:#0B0B0C;--nx-card:#161618;--nx-card-2:#1C1C1F;--nx-ink:#F5F3F0;--nx-ink-2:rgba(245,243,240,.72);--nx-ink-3:rgba(245,243,240,.5);
  --nx-line:rgba(255,255,255,.10);--nx-line-2:rgba(255,255,255,.18);--nx-blue:#7FA3F2;--nx-blue-soft:#1A2238;--nx-navy-ink:#C9D6F0;--nx-navy-ink-2:#9AA9C6;
  --nx-silk-2:#4A5EA8;--nx-ok:#4DB97F;--nx-ok-soft:#14301F;--nx-ok-ink:#7FD9A4;--nx-wait:#E0A62E;--nx-wait-soft:#33290F;--nx-wait-ink:#F0C060;
  --nx-fail:#E8695C;--nx-fail-soft:#3A1A17;--nx-fail-ink:#FF9C90;--nx-bubble:#22345A;
  --nx-chart-grid:rgba(255,255,255,.08);--nx-chart-axis:rgba(255,255,255,.2);--nx-chart-label:rgba(245,243,240,.55);--nx-ill-edge:rgba(201,214,240,.25);
  --nx-silk-card:linear-gradient(160deg,#070B14,#1D3354 60%,#3F5C8E);
  --nx-glass-bg:rgba(7,11,20,.38);--nx-glass-line:rgba(255,255,255,.2);--nx-shadow-glass:0 20px 40px -28px rgba(0,0,0,.6);--nx-shadow-chip:0 1px 0 rgba(0,0,0,.3),0 6px 16px -10px rgba(0,0,0,.6);
  color-scheme:dark;
}}
:root[data-theme="dark"]{
  --nx-page:#0B0B0C;--nx-card:#161618;--nx-card-2:#1C1C1F;--nx-ink:#F5F3F0;--nx-ink-2:rgba(245,243,240,.72);--nx-ink-3:rgba(245,243,240,.5);
  --nx-line:rgba(255,255,255,.10);--nx-line-2:rgba(255,255,255,.18);--nx-blue:#7FA3F2;--nx-blue-soft:#1A2238;--nx-navy-ink:#C9D6F0;--nx-navy-ink-2:#9AA9C6;
  --nx-silk-2:#4A5EA8;--nx-ok:#4DB97F;--nx-ok-soft:#14301F;--nx-ok-ink:#7FD9A4;--nx-wait:#E0A62E;--nx-wait-soft:#33290F;--nx-wait-ink:#F0C060;
  --nx-fail:#E8695C;--nx-fail-soft:#3A1A17;--nx-fail-ink:#FF9C90;--nx-bubble:#22345A;
  --nx-chart-grid:rgba(255,255,255,.08);--nx-chart-axis:rgba(255,255,255,.2);--nx-chart-label:rgba(245,243,240,.55);--nx-ill-edge:rgba(201,214,240,.25);
  --nx-silk-card:linear-gradient(160deg,#070B14,#1D3354 60%,#3F5C8E);
  --nx-glass-bg:rgba(7,11,20,.38);--nx-glass-line:rgba(255,255,255,.2);--nx-shadow-glass:0 20px 40px -28px rgba(0,0,0,.6);--nx-shadow-chip:0 1px 0 rgba(0,0,0,.3),0 6px 16px -10px rgba(0,0,0,.6);
  color-scheme:dark;
}
`;

/** Styles every prototype shares: the base, the kicker, the status chips, the block strip, the interval bar. */
export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0}
body{background:var(--nx-page);color:var(--nx-ink);font:400 16px/1.55 var(--nx-sans);-webkit-font-smoothing:antialiased}
h1,h2,h3,h4,p,figure{margin:0}
a{color:var(--nx-blue);text-decoration:none}a:hover{text-decoration:underline}
a:focus-visible,summary:focus-visible,button:focus-visible{outline:2px solid var(--nx-orange);outline-offset:2px}
.serif{font-family:var(--nx-serif);font-weight:400;letter-spacing:-.012em;text-wrap:balance}
.soft{color:var(--nx-ink-2)}
.kicker{font:500 13px/1.2 var(--nx-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--nx-ink-2)}
.kicker--dot::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--nx-orange);margin-right:12px;vertical-align:middle;transform:translateY(-1px)}
.mono{font-family:var(--nx-mono);font-size:14px}
.small{font-size:14px;line-height:1.5}
.num{font-variant-numeric:tabular-nums}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font:500 13px/1.3 var(--nx-sans);white-space:nowrap}
.chip::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.chip--ok{background:var(--nx-ok-soft);color:var(--nx-ok-ink)}
.chip--fail{background:var(--nx-fail-soft);color:var(--nx-fail-ink)}
.chip--wait{background:var(--nx-wait-soft);color:var(--nx-wait-ink)}
.chip--neutral{background:var(--nx-card-2);color:var(--nx-ink-2)}
.chip--plain::before{display:none}
.strip{display:inline-flex;gap:3px;vertical-align:middle}
.strip i{display:block;width:12px;height:12px;border-radius:3px;background:var(--nx-ok)}
.strip i.f{background:var(--nx-fail)}
.strip i.inj{outline:1.5px solid var(--nx-ink-3);outline-offset:-1.5px}
.strip i.first{box-shadow:0 0 0 2px var(--nx-page),0 0 0 3.5px var(--nx-ink)}
.ibar{display:block;width:100%;height:10px;overflow:visible}
.ibar .track{fill:var(--nx-line)}
.ibar .band{fill:var(--nx-silk-2)}
.ibar .pt{fill:var(--nx-ink)}
.ibar .margin{stroke:var(--nx-fail);stroke-width:1.2;stroke-dasharray:2 2}
.table{width:100%;border-collapse:collapse;font:400 14px/1.4 var(--nx-sans);font-variant-numeric:tabular-nums;color:var(--nx-ink)}
.table th{font:500 12.5px/1.2 var(--nx-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--nx-ink-2);text-align:left;padding:12px 12px 8px;border-bottom:1px solid var(--nx-ink);white-space:nowrap}
.table td{padding:9px 12px;border-bottom:1px solid var(--nx-line);vertical-align:top}
.table .r{text-align:right}
.table tr.bad td:first-child{box-shadow:inset 3px 0 0 var(--nx-fail)}
.table tr.total td{font-weight:500;border-top:1px solid var(--nx-ink)}
.msg{white-space:pre-wrap;overflow-wrap:anywhere;font:400 15px/1.5 var(--nx-sans);margin:0}
.msg--user{background:var(--nx-bubble);color:#fff;border-radius:16px 16px 16px 4px;padding:10px 14px;max-width:62ch}
.msg--agent{background:var(--nx-card-2);border-radius:16px 16px 4px 16px;padding:10px 14px;max-width:62ch}
.tool{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border:1px solid var(--nx-line-2);border-radius:7px;font:400 13px/1.4 var(--nx-mono);color:var(--nx-ink)}
.tool.err{border-color:var(--nx-fail);color:var(--nx-fail-ink)}
.check{display:grid;grid-template-columns:18px 1fr;gap:8px;align-items:start;padding:6px 0;border-top:1px solid var(--nx-line);font-size:14px}
.check .mark{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;margin-top:2px}
.check--fail .mark{background:var(--nx-fail);color:#fff}
.check--pass .mark{background:var(--nx-ok-soft);color:var(--nx-ok-ink)}
.check--inc .mark{background:var(--nx-wait-soft);color:var(--nx-wait-ink)}
.check .mark svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.check .ev{color:var(--nx-ink-2);font-size:13.5px;overflow-wrap:anywhere}
details>summary{cursor:pointer;list-style:none}
details>summary::-webkit-details-marker{display:none}
.pre{font:400 13px/1.5 var(--nx-mono);white-space:pre-wrap;overflow-wrap:anywhere;background:var(--nx-card-2);border-radius:12px;padding:12px 16px;margin:6px 0 0;max-height:280px;overflow:auto}
.note{font-size:14px;color:var(--nx-ink-2)}
@media print{details{open:true}}
`;

/* ---------- derived data ---------- */

export type PairState = 'both pass' | 'regressed' | 'improved' | 'both fail';

export type PairView = {
  pair: UnitPair;
  state: PairState;
  /** The candidate's runs of the unit, in repeat order. */
  runs: RunDetail[];
  /** The baseline's runs, when a baseline scorecard was given. */
  baselineRuns: RunDetail[];
  /** Criteria the baseline passed and the candidate failed. */
  lost: string[];
  gained: string[];
  /** Every failing block of the candidate runs, as anchors. */
  failingBlocks: BlockRef[];
};

export type BlockRef = {
  runId: string;
  index: number;
  specId: string;
  mode: string;
  repeat: number;
  perturbationId?: string;
};

export type FamilyFailures = { family: string; verdicts: number; blocks: BlockRef[]; runs: Set<string> };

export type Prepared = {
  card: Scorecard;
  compare: CompareResult;
  pairs: PairView[];
  /** Failing gating verdicts of the candidate by family, with the blocks that carry them. */
  families: FamilyFailures[];
  /** Totals the structure diagram prints. */
  totals: {
    specs: number;
    targets: number;
    runs: number;
    blocks: number;
    verdicts: number;
    lines: number;
    pairs: number;
    modes: string[];
    repeats: number;
  };
  /** Spec titles by id. */
  titles: Map<string, string>;
  /** Stage catalogue per spec, in the order the blocks expect them. */
  stages: Map<string, string[]>;
};

export function unitOf(run: RunDetail): string {
  return `${run.specId} · ${run.mode}${run.perturbationId === undefined ? '' : ` · ${run.perturbationId}`}`;
}

export function blockRef(run: RunDetail, block: BlockDetail): BlockRef {
  return {
    runId: run.runId,
    index: block.index,
    specId: run.specId,
    mode: run.mode,
    repeat: run.repeat,
    ...(run.perturbationId === undefined ? {} : { perturbationId: run.perturbationId }),
  };
}

export function blockHref(ref: BlockRef): string {
  return `#block-${ref.runId}-${ref.index}`;
}

export function blockId(run: RunDetail, block: BlockDetail): string {
  return `block-${run.runId}-${block.index}`;
}

export function runId(run: RunDetail): string {
  return `run-${run.runId}`;
}

export function criterionOf(v: Verdict): string {
  return v.kind === 'judge' ? v.id : v.name;
}

export function prepare(card: Scorecard, baseline?: Scorecard): Prepared {
  if (!card.compare) throw new Error('the prototypes need a scorecard with a baseline');
  const compare = card.compare;
  const byUnit = new Map<string, RunDetail[]>();
  for (const run of card.drilldown) {
    const key = unitOf(run);
    byUnit.set(key, [...(byUnit.get(key) ?? []), run]);
  }
  const baseByUnit = new Map<string, RunDetail[]>();
  for (const run of baseline?.drilldown ?? []) {
    const key = unitOf(run);
    baseByUnit.set(key, [...(baseByUnit.get(key) ?? []), run]);
  }
  const pairs: PairView[] = compare.pairs.map((pair) => {
    const runs = (byUnit.get(pair.unit) ?? []).sort((a, b) => a.repeat - b.repeat);
    const baselineRuns = (baseByUnit.get(pair.unit) ?? []).sort((a, b) => a.repeat - b.repeat);
    const b = pair.baseline.allPass;
    const c = pair.candidate.allPass;
    const state: PairState = b && c ? 'both pass' : b ? 'regressed' : c ? 'improved' : 'both fail';
    const bc = asMap(pair.baseline.criteria);
    const cc = asMap(pair.candidate.criteria);
    const lost = [...bc.entries()]
      .filter(([name, e]) => e.pass && cc.get(name)?.pass === false)
      .map(([name]) => name);
    const gained = [...cc.entries()]
      .filter(([name, e]) => e.pass && bc.get(name)?.pass === false)
      .map(([name]) => name);
    const failingBlocks = runs.flatMap((run) =>
      run.blocks.filter((block) => !block.pass).map((block) => blockRef(run, block)),
    );
    return { pair, state, runs, baselineRuns, lost, gained, failingBlocks };
  });
  const families = new Map<string, FamilyFailures>();
  for (const run of card.drilldown) {
    for (const block of run.blocks) {
      for (const v of block.verdicts) {
        if (v.outcome !== 'fail' || !v.gating) continue;
        const name = criterionOf(v);
        const held = families.get(name) ?? { family: name, verdicts: 0, blocks: [], runs: new Set<string>() };
        held.verdicts += 1;
        held.runs.add(run.runId);
        if (!held.blocks.some((ref) => ref.runId === run.runId && ref.index === block.index))
          held.blocks.push(blockRef(run, block));
        families.set(name, held);
      }
    }
  }
  const titles = new Map<string, string>();
  const stages = new Map<string, string[]>();
  for (const run of card.drilldown) {
    if (run.title) titles.set(run.specId, run.title);
    const list = stages.get(run.specId) ?? [];
    for (const block of run.blocks) {
      for (const stage of [block.expectedStage, block.observedStage]) {
        if (stage && !list.includes(stage)) list.push(stage);
      }
    }
    stages.set(run.specId, list);
  }
  const blocks = card.drilldown.reduce((sum, run) => sum + run.blocks.length, 0);
  const verdicts = card.drilldown.reduce(
    (sum, run) => sum + run.blocks.reduce((s, b) => s + b.verdicts.length, 0),
    0,
  );
  return {
    card,
    compare,
    pairs,
    families: [...families.values()].sort(
      (a, b) => b.blocks.length - a.blocks.length || a.family.localeCompare(b.family),
    ),
    totals: {
      specs: card.campaign.specs,
      targets: card.campaign.targets.length,
      runs: card.campaign.runs,
      blocks,
      verdicts,
      lines: card.lines.length,
      pairs: compare.pairs.length,
      modes: card.campaign.modes,
      repeats: Math.max(...Object.values(card.campaign.repeats)),
    },
    titles,
    stages,
  };
}

function asMap(value: unknown): Map<string, { pass: boolean; gating: boolean }> {
  if (value instanceof Map) return value as Map<string, { pass: boolean; gating: boolean }>;
  return new Map(Object.entries(value as Record<string, { pass: boolean; gating: boolean }>));
}

/* ---------- words ---------- */

export const VERDICT_WORD = {
  'non-inferior': 'Non-inferior',
  regressed: 'Regressed',
  unproven: 'Not shown non-inferior',
} as const;

/** The verdict in one plain sentence with its numbers. */
export function verdictSentence(p: Prepared): string {
  const t = p.compare.allPass.table;
  const n = p.compare.pairs.length;
  if (p.compare.verdict === 'regressed') {
    return `${t.regressed} of ${n} paired goldens pass on the baseline and fail on the candidate. ${t.improved === 0 ? 'None improved.' : `${t.improved} improved.`}`;
  }
  if (p.compare.verdict === 'non-inferior') {
    return `Every gating check stays within ${fixed(p.compare.margin * 100, 1)} points of the baseline over ${n} paired goldens, and no new safety flag fires.`;
  }
  return `The intervals are wider than the ${fixed(p.compare.margin * 100, 1)} point margin over ${n} paired goldens: no drop is shown, and no parity either.`;
}

/** The reasons, grouped so the page can print "why" in four plain groups. */
export function reasonGroups(p: Prepared): {
  drop?: string;
  criteria: string[];
  flags: { family: string; units: string[] }[];
  wide: string[];
  thin: string[];
  parity?: string;
} {
  const c = p.compare;
  const out: ReturnType<typeof reasonGroups> = { criteria: [], flags: [], wide: [], thin: [] };
  const alpha = c.alpha;
  const t = c.allPass.table;
  if (c.allPass.mcnemar.pValue < alpha && t.regressed > t.improved) {
    out.drop = `The all-pass rate dropped from ${pct(c.allPass.baseline.estimate)} to ${pct(c.allPass.candidate.estimate)}: ${t.regressed} goldens regressed and ${t.improved} improved, McNemar exact p = ${c.allPass.mcnemar.pValue.toFixed(4)}, under ${alpha}.`;
  }
  for (const row of c.criteria.filter((r) => r.significantRegression)) {
    out.criteria.push(
      `${row.criterion}: ${row.regressed} goldens regressed, ${row.improved} improved, adjusted p = ${row.adjusted.toFixed(4)} at a false discovery rate of ${c.q}.`,
    );
  }
  const byFamily = new Map<string, string[]>();
  for (const flag of c.newFlags) byFamily.set(flag.family, [...(byFamily.get(flag.family) ?? []), flag.unit]);
  out.flags = [...byFamily.entries()].map(([family, units]) => ({ family, units }));
  if (!c.allPass.nonInferior) {
    out.wide.push(
      `all-pass: the upper bound of the regression effect is ${fixed(c.allPass.effect.upper * 100, 1)} points, above the margin of ${fixed(c.margin * 100, 1)}.`,
    );
  }
  for (const row of c.criteria.filter(
    (r) => r.gating && r.nonInferior === false && (c.strict || !r.underpowered || r.significantRegression),
  )) {
    out.wide.push(
      `${row.criterion}: the upper bound is ${fixed(row.effect.upper * 100, 1)} points over ${row.units} goldens (${row.regressed} regressed, ${row.improved} improved).`,
    );
  }
  if (!c.strict) {
    for (const row of c.criteria.filter(
      (r) => r.underpowered && !r.significantRegression && r.nonInferior === false,
    )) {
      out.thin.push(`${row.criterion} (${row.units} goldens)`);
    }
  }
  if (c.verdict === 'non-inferior')
    out.parity = `Every gating criterion and the all-pass flag stay under the margin of ${fixed(c.margin * 100, 1)} points, and no new gating flag fires.`;
  return out;
}

export function intervalText(e: Estimate, show: (v: number) => string = pct): string {
  if (e.method === 'none') return 'no interval: one cluster';
  return `${show(e.lower)} to ${show(e.upper)}`;
}

export function methodWord(e: Estimate): string {
  switch (e.method) {
    case 'wilson':
      return 'Wilson';
    case 'wilson, clusters':
      return 'Wilson over clusters';
    case 'wilson, design effect':
      return 'Wilson, design effect';
    case 'wilson, raised':
      return 'Wilson, raised';
    case 'cluster bootstrap':
      return 'cluster bootstrap';
    case 'newcombe':
      return 'Newcombe, paired';
    default:
      return 'no interval';
  }
}

export function ms(v: number): string {
  return `${fixed(v, 0)} ms`;
}

export function usd(v: number): string {
  return `$${v > 0 && v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
}

export function pointsText(v: number): string {
  const text = fixed(v * 100, 1);
  return `${v > 0 && text !== '0.0' ? '+' : ''}${text}`;
}

/* ---------- drawings ---------- */

/**
 * An interval bar on a [lo, hi] scale: the track, the interval band, the point. `margin` draws a dashed
 * line at a value, for the non-inferiority margin.
 */
export function intervalBar(
  e: Estimate,
  options: { lo?: number; hi?: number; margin?: number; height?: number } = {},
): string {
  const lo = options.lo ?? 0;
  const hi = options.hi ?? 1;
  const x = (v: number) => fixed(((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100, 2);
  const lower = e.method === 'none' ? e.estimate : e.lower;
  const upper = e.method === 'none' ? e.estimate : e.upper;
  const h = options.height ?? 10;
  const margin =
    options.margin === undefined
      ? ''
      : `<line class="margin" x1="${x(options.margin)}" x2="${x(options.margin)}" y1="0" y2="${h}"/>`;
  return `<svg class="ibar" viewBox="0 0 100 ${h}" preserveAspectRatio="none" aria-hidden="true" style="height:${h}px"><rect class="track" x="0" y="${h / 2 - 1}" width="100" height="2"/><rect class="band" x="${x(lower)}" y="${h / 2 - 3}" width="${fixed(Math.max(0.5, Number(x(upper)) - Number(x(lower))), 2)}" height="6" rx="1"/><rect class="pt" x="${fixed(Number(x(e.estimate)) - 0.6, 2)}" y="0" width="1.2" height="${h}"/>${margin}</svg>`;
}

/** One square per block, failing squares red; the first drifting block ringed; an injected block outlined. */
export function blockStrip(run: RunDetail, link = true): string {
  const first = run.succession.firstDriftBlock;
  return `<span class="strip" aria-label="${run.blocks.length} blocks, ${run.blocks.filter((b) => !b.pass).length} failing">${run.blocks
    .map((b) => {
      const cls = [b.pass ? '' : 'f', b.injected ? 'inj' : '', first === b.index ? 'first' : '']
        .filter(Boolean)
        .join(' ');
      const title = `Block ${b.index + 1}${b.injected ? ', injected' : ''}: ${b.pass ? 'pass' : 'fail'}`;
      return link
        ? `<a href="#${blockId(run, b)}" title="${esc(title)}"><i class="${cls}"></i></a>`
        : `<i class="${cls}" title="${esc(title)}"></i>`;
    })
    .join('')}</span>`;
}

const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ICON_Q = '<svg viewBox="0 0 24 24"><path d="M12 17h.01M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/></svg>';

export function checkRow(v: Verdict): string {
  const cls =
    v.outcome === 'fail' ? 'check--fail' : v.outcome === 'inconclusive' ? 'check--inc' : 'check--pass';
  const icon = v.outcome === 'fail' ? ICON_X : v.outcome === 'inconclusive' ? ICON_Q : ICON_CHECK;
  const votes = v.judge?.votes ?? [];
  const reasoning = [
    ...(v.reasoning ? [v.reasoning] : []),
    ...votes.map((vote) => `${vote.judge}: ${vote.outcome}${vote.reasoning ? `. ${vote.reasoning}` : ''}`),
  ];
  return `<div class="check ${cls}"><span class="mark">${icon}</span><div><span class="mono">${esc(v.id)}</span> <span class="chip chip--plain chip--neutral">${esc(v.kind)}${v.gating ? ', gating' : ''}</span>${v.evidence ? `<div class="ev">${esc(v.evidence)}</div>` : ''}${reasoning.length > 0 ? `<div class="ev">${esc(reasoning.join(' '))}</div>` : ''}</div></div>`;
}

/** The checks of a block: failing and judged ones in full, the passing machine ones folded behind a count. */
export function checksOf(block: BlockDetail): string {
  const shown = block.verdicts.filter((v) => v.outcome !== 'pass' || v.kind === 'judge');
  const passed = block.verdicts.filter((v) => v.outcome === 'pass' && v.kind !== 'judge');
  const fold =
    passed.length === 0
      ? ''
      : `<details class="passed"><summary class="small soft">${passed.length} machine check${passed.length === 1 ? '' : 's'} passed</summary><div class="mono soft small" style="margin-top:4px;overflow-wrap:anywhere">${esc(passed.map((v) => v.id).join(', '))}</div></details>`;
  return `${shown.map(checkRow).join('')}${fold}`;
}

export function toolChips(block: BlockDetail): string {
  if (block.toolCalls.length === 0) return '<span class="small soft">no tool call</span>';
  return block.toolCalls
    .map(
      (call) =>
        `<details class="toolcall" style="display:inline-block;vertical-align:top"><summary><span class="tool${call.error ? ' err' : ''}">${esc(call.label)}${call.error ? ` · ${esc(call.error)}` : ''}</span></summary><pre class="pre">${esc(JSON.stringify({ input: call.input, output: call.output }, null, 1).slice(0, 1200))}</pre></details>`,
    )
    .join(' ');
}

export function runName(run: RunDetail): string {
  return [
    run.specId,
    MODE_NAMES[run.mode],
    `repeat ${run.repeat + 1}`,
    ...(run.perturbationId ? [run.perturbationId] : []),
  ].join(' · ');
}

export function stageText(block: BlockDetail): string {
  const exp = block.expectedStage ?? 'none';
  const obs = block.observedStage ?? 'none';
  return exp === obs ? exp : `${exp} expected, ${obs} reached`;
}

/**
 * The structure of a run, drawn as boxes: specs, the campaign's cells (spec × target × mode × repeat), the
 * runs (one conversation each), the blocks, the checks; and beside it, how the baseline and the candidate
 * pair on the same goldens. Inline SVG, brand tokens, no script.
 */
export function structureDiagram(p: Prepared, width = 930): string {
  const t = p.totals;
  const c = p.compare;
  const tb = c.allPass.table;
  const box = (x: number, y: number, w: number, h: number, title: string, line: string, extra = '') =>
    `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" class="box"/><text x="${x + 14}" y="${y + 24}" class="t">${esc(title)}</text><text x="${x + 14}" y="${y + 44}" class="l">${esc(line)}</text>${extra}</g>`;
  const arrow = (x1: number, y: number, x2: number) =>
    `<path d="M${x1} ${y} H${x2}" class="edge" marker-end="url(#ah)"/>`;
  const col = 160;
  const gap = 24;
  const y = 20;
  const h = 60;
  const xs = [0, 1, 2, 3, 4].map((i) => 10 + i * (col + gap));
  const chain = [
    box(xs[0] as number, y, col, h, `${t.specs} specs`, 'given, when, then'),
    box(
      xs[1] as number,
      y,
      col,
      h,
      `${t.lines} goldens`,
      `spec × mode${t.modes.includes('P') ? ' × perturbation' : ''}`,
    ),
    box(xs[2] as number, y, col, h, `${t.runs} runs`, `${t.repeats} repeats, 1 conversation each`),
    box(xs[3] as number, y, col, h, `${t.blocks} blocks`, 'one stimulus, one reply'),
    box(xs[4] as number, y, col, h, `${t.verdicts} checks`, 'pass, fail, inconclusive'),
  ].join('');
  const arrows = [0, 1, 2, 3]
    .map((i) => arrow((xs[i] as number) + col, y + h / 2, (xs[i + 1] as number) - 4))
    .join('');
  // pairing: two rows of goldens joined pairwise into the 2 by 2 table
  const py = 130;
  const pair = `
<text x="10" y="${py}" class="k">BASELINE AND CANDIDATE, PAIRED ON THE SAME ${t.pairs} GOLDENS</text>
${box(10, py + 14, 220, h, esc(c.baseline.campaignId), `${c.allPass.baseline.k} of ${c.allPass.baseline.n} goldens pass`)}
${box(10, py + 14 + h + 16, 220, h, esc(c.candidate.campaignId), `${c.allPass.candidate.k} of ${c.allPass.candidate.n} goldens pass`)}
<path d="M230 ${py + 14 + h / 2} H270 V${py + 14 + h + 8} H300" class="edge"/>
<path d="M230 ${py + 14 + h + 16 + h / 2} H270 V${py + 14 + h + 8} H300" class="edge" marker-end="url(#ah)"/>
<g transform="translate(304 ${py + 10})">
  <rect x="0" y="0" width="300" height="${h * 2 + 20}" rx="12" class="box"/>
  <text x="14" y="22" class="t">Each golden, both sides</text>
  <g transform="translate(14 36)">
    ${cell(0, 0, 'pass both', tb.bothPass, 'ok')}${cell(140, 0, 'regressed', tb.regressed, 'fail')}
    ${cell(0, 44, 'improved', tb.improved, 'ok')}${cell(140, 44, 'fail both', tb.bothFail, 'fail')}
  </g>
</g>
<g transform="translate(624 ${py + 10})">
  <rect x="0" y="0" width="266" height="${h * 2 + 20}" rx="12" class="box"/>
  <text x="14" y="22" class="t">Then the tests</text>
  <text x="14" y="46" class="l">McNemar exact on the ${tb.regressed + tb.improved} that disagree</text>
  <text x="14" y="66" class="l">Newcombe interval on the paired difference</text>
  <text x="14" y="86" class="l">Benjamini-Hochberg across ${c.criteria.length} criteria</text>
  <text x="14" y="106" class="l">margin ${fixed(c.margin * 100, 1)} points, level ${fixed((1 - c.alpha) * 100, 0)}%</text>
  <text x="14" y="126" class="l">verdict: ${VERDICT_WORD[c.verdict].toLowerCase()}</text>
</g>`;
  return `<svg class="structure" viewBox="0 0 ${width} 290" width="100%" role="img" aria-label="How the run is structured: specs, goldens, runs, blocks, checks; and the pairing of baseline and candidate.">
<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="ahead"/></marker></defs>
<style>
.structure .box{fill:var(--nx-card);stroke:var(--nx-line-2);stroke-width:1}
.structure .t{font:500 15px var(--nx-sans);fill:var(--nx-ink)}
.structure .l{font:400 12.5px var(--nx-sans);fill:var(--nx-ink-2)}
.structure .k{font:500 11.5px var(--nx-mono);letter-spacing:.12em;fill:var(--nx-ink-2)}
.structure .edge{fill:none;stroke:var(--nx-ill-edge);stroke-width:1.6}
.structure .ahead{fill:var(--nx-ill-edge)}
.structure .cell{stroke:none}
.structure .cell.ok{fill:var(--nx-ok-soft)} .structure .cell.fail{fill:var(--nx-fail-soft)}
.structure .cn{font:400 18px var(--nx-serif-text);fill:var(--nx-ink)}
.structure .cl{font:400 11.5px var(--nx-sans);fill:var(--nx-ink-2)}
</style>
${chain}${arrows}${pair}
</svg>`;
}

function cell(x: number, y: number, label: string, n: number, tone: 'ok' | 'fail'): string {
  return `<g transform="translate(${x} ${y})"><rect width="132" height="38" rx="8" class="cell ${n === 0 ? 'ok' : tone}"/><text x="10" y="25" class="cn">${n}</text><text x="48" y="24" class="cl">${esc(label)}</text></g>`;
}

/** A page: one file, fonts embedded, light and dark. */
export function page(title: string, css: string, body: string, description: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="driftbench report (prototype)">
<meta name="description" content="${esc(description)}">
<title>${esc(title)}</title>
<style>
${fontCss()}
${TOKENS}
${BASE_CSS}
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
