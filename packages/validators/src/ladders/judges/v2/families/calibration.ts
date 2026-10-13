import {
  type CalibrationReport,
  FakeJudge,
  type JudgeAnswer,
  type JudgeRequest,
  type LabelledBlock,
  type LoadedCriterion,
} from '@agent-nexus/driftbench-judges';
import { cohenKappa } from '@agent-nexus/driftbench-stats';
import { type BankItem, fn, type Tier } from '../bank';

/**
 * Calibration (packages/judges/src/calibration.ts): a judge earns a criterion from its agreement with hand
 * labels. The bank holds the agreement interval to its coverage, exactly: for a true agreement rate p and n
 * labelled blocks, coverage is the sum over k of P(k agreements) for every k whose interval contains p. The
 * package exports `agreementInterval(agree, n)` and calibration reports it; coverage must be at least 0.93
 * (nominal 0.95) at every cell, n from 5 to 500, p balanced or skewed to 0.995. Under skewed prevalence kappa
 * collapses even when a judge agrees almost always (the kappa paradox), so the report also carries the
 * prevalence-adjusted kappa (PABAK = 2 * agree / n - 1) and Gwet's AC1, checked against their formulas.
 */

const COMPONENT = 'packages/judges/src/calibration.ts';
const COVERAGE_MIN = 0.93;

type Interval = { lower: number; upper: number };
type AgreementInterval = (agree: number, n: number) => Interval;

function logChoose(n: number, k: number): number {
  let out = 0;
  for (let i = 1; i <= k; i += 1) out += Math.log(n - k + i) - Math.log(i);
  return out;
}

/** The Wilson score interval at 95 percent, written out: the oracle of the interval items. */
export function wilson95(agree: number, n: number): { lower: number; upper: number } {
  const z = 1.959963984540054;
  const p = agree / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

/** The exact coverage of an interval method at (n, p). */
export function exactCoverage(method: AgreementInterval, n: number, p: number): number {
  let coverage = 0;
  for (let k = 0; k <= n; k += 1) {
    const { lower, upper } = method(k, n);
    if (lower <= p && p <= upper) {
      const logP =
        logChoose(n, k) + (k === 0 ? 0 : k * Math.log(p)) + (n - k === 0 ? 0 : (n - k) * Math.log(1 - p));
      coverage += Math.exp(logP);
    }
  }
  return coverage;
}

const CELLS: readonly { n: number; low: number; high: number; tier: Tier }[] = [
  { n: 5, low: 0.4, high: 0.6, tier: 2 },
  { n: 5, low: 0.85, high: 0.95, tier: 3 },
  { n: 5, low: 0.97, high: 0.995, tier: 4 },
  { n: 20, low: 0.4, high: 0.6, tier: 2 },
  { n: 20, low: 0.85, high: 0.95, tier: 3 },
  { n: 20, low: 0.97, high: 0.995, tier: 4 },
  { n: 100, low: 0.4, high: 0.6, tier: 2 },
  { n: 100, low: 0.85, high: 0.95, tier: 3 },
  { n: 100, low: 0.97, high: 0.995, tier: 4 },
  { n: 500, low: 0.4, high: 0.6, tier: 2 },
  { n: 500, low: 0.85, high: 0.95, tier: 3 },
  { n: 500, low: 0.985, high: 0.999, tier: 5 },
];

/** A criterion for calibration runs, with a fixture pair every scripted judge separates. */
function criterion(): LoadedCriterion {
  const fixture = (text: string) => ({ transcript: [{ role: 'agent' as const, text }] });
  return {
    path: 'bank.yaml',
    def: {
      name: 'bank_rule',
      rubric: 'The reply says yes.',
      pass: 'yes',
      fail: 'no',
      gating: true,
    } as LoadedCriterion['def'],
    fixtures: { pass: fixture('yes'), fail: fixture('no') },
  };
}

/** n labelled blocks with a given prevalence of pass labels, and a judge that agrees on `agree` of them. */
function labelled(
  n: number,
  passes: number,
  agree: number,
): { blocks: LabelledBlock[]; judged: Map<string, 'pass' | 'fail'> } {
  const blocks: LabelledBlock[] = [];
  const judged = new Map<string, 'pass' | 'fail'>();
  for (let i = 0; i < n; i += 1) {
    const label = i < passes ? 'pass' : 'fail';
    const text = `block ${i}`;
    blocks.push({ id: `b${i}`, label, transcript: [{ role: 'agent', text }] });
    const wrong = i >= n - (n - agree);
    judged.set(text, wrong ? (label === 'pass' ? 'fail' : 'pass') : label);
  }
  return { blocks, judged };
}

type Calibrate = (config: Record<string, unknown>) => Promise<CalibrationReport>;

async function calibrateOnce(
  api: Parameters<BankItem['run']>[0]['api'],
  n: number,
  passes: number,
  agree: number,
) {
  const { blocks, judged } = labelled(n, passes, agree);
  const answer = (request: JudgeRequest): JudgeAnswer => {
    const text = request.transcript[0]?.text ?? '';
    if (text === 'yes') return { outcome: 'pass', reasoning: 'fixture' };
    if (text === 'no') return { outcome: 'fail', reasoning: 'fixture' };
    return { outcome: judged.get(text) ?? 'fail', reasoning: 'scripted' };
  };
  const judges = [1, 2, 3].map(
    (i) => new FakeJudge(`j${i}`, [answer], { cls: 'system1', cost: i, family: `f${i}` }),
  );
  const criteria = [criterion()];
  const report = await fn<Calibrate>(
    api,
    'calibrate',
  )({ judges, criteria, labels: new Map([['bank_rule', blocks]]), mode: 'system1' });
  return { report, blocks, judged };
}

/** Gwet's AC1 for two raters with two categories. */
function ac1(labels: readonly string[], judged: readonly string[]): number {
  const n = labels.length;
  const po = labels.filter((l, i) => judged[i] === l).length / n;
  const pi =
    (labels.filter((l) => l === 'pass').length + judged.filter((l) => l === 'pass').length) / (2 * n);
  const pe = 2 * pi * (1 - pi);
  return (po - pe) / (1 - pe);
}

export function calibrationItems(): BankItem[] {
  const out: BankItem[] = CELLS.map(
    (cell): BankItem => ({
      id: `calibration/coverage-n${cell.n}-p${cell.low}-${cell.high}`,
      family: 'calibration',
      tier: cell.tier,
      level: 'calibration',
      component: COMPONENT,
      run({ api, random }) {
        const method = fn<AgreementInterval>(api, 'agreementInterval');
        const p = cell.low + random() * (cell.high - cell.low);
        const coverage = exactCoverage(method, cell.n, p);
        return coverage >= COVERAGE_MIN
          ? { pass: true, detail: '' }
          : {
              pass: false,
              detail: `n ${cell.n}, true agreement ${p.toFixed(4)}: exact coverage ${coverage.toFixed(4)} under ${COVERAGE_MIN}`,
            };
      },
    }),
  );
  const reportItem = (
    id: string,
    tier: Tier,
    make: (random: () => number) => { n: number; passes: number; agree: number },
    check: (
      r: Awaited<ReturnType<typeof calibrateOnce>>,
      api: Parameters<BankItem['run']>[0]['api'],
    ) => string | undefined,
  ): BankItem => ({
    id: `calibration/${id}`,
    family: 'calibration',
    tier,
    level: 'calibration',
    component: COMPONENT,
    async run({ api, random }) {
      const { n, passes, agree } = make(random);
      const result = await calibrateOnce(api, n, passes, agree);
      const problem = check(result, api);
      return problem === undefined
        ? { pass: true, detail: '' }
        : { pass: false, detail: `n ${n}, ${passes} pass labels, ${agree} agreements: ${problem}` };
    },
  });
  const firstJudge = (r: Awaited<ReturnType<typeof calibrateOnce>>) => r.report.criteria[0]?.judges[0];
  const labelsOf = (r: Awaited<ReturnType<typeof calibrateOnce>>) => r.blocks.map((b) => b.label);
  const judgedOf = (r: Awaited<ReturnType<typeof calibrateOnce>>) =>
    r.blocks.map((b) => r.judged.get(b.transcript[0]?.text ?? '') ?? 'fail');
  const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-9;
  for (const [n, tier] of [
    [5, 2],
    [50, 1],
    [500, 2],
  ] as const) {
    out.push(
      reportItem(
        `kappa-matches-reference-n${n}`,
        tier,
        (r) => {
          const passes = Math.max(1, Math.round(n * (0.3 + r() * 0.4)));
          return { n, passes, agree: n - Math.floor(r() * Math.max(1, n / 5)) };
        },
        (r) => {
          const expected = cohenKappa(labelsOf(r), judgedOf(r)).kappa;
          const got = firstJudge(r)?.labels.kappa;
          return near(got, expected) ? undefined : `kappa ${got}, reference ${expected}`;
        },
      ),
      reportItem(
        `interval-is-wilson-n${n}`,
        tier + 1 > 5 ? 5 : ((tier + 1) as Tier),
        (r) => ({ n, passes: Math.ceil(n / 2), agree: n - Math.floor(r() * Math.max(1, n / 4)) }),
        (r) => {
          const own = firstJudge(r)?.labels;
          if (!own) return 'no calibration row';
          // docs/concepts/judges.md, calibration: "a Wilson 95% interval on the share of blocks it agrees on".
          const expected = wilson95(own.agree, own.n);
          return Math.abs(own.agreement.lower - expected.lower) < 1e-6 &&
            Math.abs(own.agreement.upper - expected.upper) < 1e-6
            ? undefined
            : `report [${own.agreement.lower}, ${own.agreement.upper}], Wilson 95% [${expected.lower}, ${expected.upper}]`;
        },
      ),
    );
  }
  for (const [prevalence, tier] of [
    [0.5, 2],
    [0.9, 3],
    [0.95, 3],
    [0.98, 4],
    [0.995, 5],
  ] as const) {
    const make = (r: () => number) => {
      const n = 200;
      return { n, passes: Math.round(n * prevalence), agree: n - 1 - Math.floor(r() * 4) };
    };
    out.push(
      reportItem(`pabak-prevalence-${prevalence}`, tier, make, (r) => {
        const own = firstJudge(r)?.labels as
          | (Record<string, unknown> & { agree: number; n: number })
          | undefined;
        const expected = own ? (2 * own.agree) / own.n - 1 : Number.NaN;
        return near(own?.pabak as number | undefined, expected)
          ? undefined
          : `pabak ${own?.pabak}, formula ${expected}`;
      }),
      reportItem(`ac1-prevalence-${prevalence}`, (tier + 1 > 5 ? 5 : tier + 1) as Tier, make, (r) => {
        const own = firstJudge(r)?.labels as Record<string, unknown> | undefined;
        const expected = ac1(labelsOf(r), judgedOf(r));
        return near(own?.ac1 as number | undefined, expected)
          ? undefined
          : `ac1 ${own?.ac1}, formula ${expected}`;
      }),
    );
  }
  out.push(
    reportItem(
      'one-label-class-has-no-kappa',
      3,
      () => ({ n: 40, passes: 40, agree: 39 }),
      (r) => {
        const kappa = firstJudge(r)?.labels.kappa;
        return kappa === undefined ? undefined : `kappa ${kappa} reported with only pass labels`;
      },
    ),
    reportItem(
      'bar-needs-kappa',
      1,
      () => ({ n: 40, passes: 20, agree: 30 }),
      (r) => (firstJudge(r)?.meetsBar === false ? undefined : 'met the bar at kappa 0.5'),
    ),
    reportItem(
      'bar-met-at-full-agreement',
      1,
      () => ({ n: 40, passes: 20, agree: 40 }),
      (r) =>
        firstJudge(r)?.meetsBar === true ? undefined : `missed the bar: ${firstJudge(r)?.misses.join('; ')}`,
    ),
    reportItem(
      'assignment-goes-to-cheapest',
      1,
      () => ({ n: 30, passes: 15, agree: 30 }),
      (r) => {
        const a = r.report.criteria[0]?.assignment;
        return a?.status === 'assigned' && a.owner === 'j1' ? undefined : `assignment ${JSON.stringify(a)}`;
      },
    ),
  );
  return out;
}
