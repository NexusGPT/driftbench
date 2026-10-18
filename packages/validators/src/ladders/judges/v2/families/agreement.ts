import {
  type CalibrationReport,
  FakeJudge,
  type JudgeAnswer,
  type JudgeRequest,
  type LabelledBlock,
  type LoadedCriterion,
} from '@agent-nexus/driftbench-judges';
import { type BankItem, fn, type JudgesApi, type Tier } from '../bank';

/**
 * Agreement metrics a calibration report must carry for each judge, beside kappa (research: the survey's
 * annotation-based judge validation; Drift-Bench's kappa with its interval; MT-Bench-101's human agreement). A
 * judge's job is to catch failures, so the positive class is the fail label. Per judge, under
 * `labels.metrics`: the confusion counts `tp` (fail judged fail), `fp` (pass judged fail or inconclusive),
 * `tn` (pass judged pass), `fn` (fail judged pass or inconclusive); `sensitivity` tp/(tp+fn), `specificity`
 * tn/(tn+fp), `balancedAccuracy` their mean, `ppv` tp/(tp+fp), `npv` tn/(tn+fn), `f1` 2tp/(2tp+fp+fn), `mcc`
 * Matthews' correlation, `youden` sensitivity+specificity-1, `scottPi` Scott's pi, `prevalenceIndex`
 * |tp-tn|/n, `biasIndex` |fp-fn|/n, `accuracy` (tp+tn)/n, `falsePositiveRate` fp/(fp+tn) and `falseNegativeRate`
 * fn/(fn+tp). Per criterion, `fleissKappa` across every judge's verdicts on the labelled
 * blocks (three categories: pass, fail, inconclusive). And the inputs are checked: two blocks with the same slice
 * and opposite labels are named in `labelConflicts`, a labelled block equal to a fixture in `fixtureLeaks`, a
 * labels entry for a criterion calibration does not run in the report's `unknownLabels`, and a class with fewer
 * than 5 labelled blocks in the criterion's `warnings` as `few-labels`.
 */

const COMPONENT = 'packages/judges/src/calibration.ts';
type Calibrate = (config: Record<string, unknown>) => Promise<CalibrationReport>;
type Verdict = 'pass' | 'fail' | 'inconclusive';

const fixture = (text: string) => ({ transcript: [{ role: 'agent' as const, text }] });
function criterion(name = 'bank_rule'): LoadedCriterion {
  return {
    path: `${name}.yaml`,
    def: {
      name,
      rubric: 'The reply says yes.',
      pass: 'yes',
      fail: 'no',
      gating: true,
    } as LoadedCriterion['def'],
    fixtures: { pass: fixture('yes'), fail: fixture('no') },
  };
}

/** A seeded labelled set and three judges, each wrong on its own seeded blocks. */
function setup(random: () => number) {
  const n = 40 + Math.floor(random() * 40);
  const blocks: LabelledBlock[] = [];
  const verdicts: Verdict[][] = [[], [], []];
  for (let i = 0; i < n; i += 1) {
    const label = random() < 0.4 ? 'fail' : 'pass';
    blocks.push({ id: `b${i}`, label, transcript: [{ role: 'agent', text: `block ${i}` }] });
    for (const v of verdicts) {
      const x = random();
      v.push(x < 0.08 ? 'inconclusive' : x < 0.2 ? (label === 'pass' ? 'fail' : 'pass') : label);
    }
  }
  const judges = verdicts.map(
    (v, j) =>
      new FakeJudge(
        `j${j + 1}`,
        [
          (q: JudgeRequest): JudgeAnswer => {
            const text = q.transcript[0]?.text ?? '';
            if (text === 'yes') return { outcome: 'pass', reasoning: 'fixture' };
            if (text === 'no') return { outcome: 'fail', reasoning: 'fixture' };
            const i = Number(text.split(' ')[1]);
            const out = (v[i] ?? 'pass') as Verdict;
            return { outcome: out, reasoning: 'scripted' };
          },
        ],
        { cls: 'system1', cost: j + 1, family: `f${j + 1}` },
      ),
  );
  return { blocks, verdicts, judges };
}

/** The oracle: every metric of the spec from labels and one judge's verdicts. */
export function metricsOf(labels: readonly string[], judged: readonly Verdict[]): Record<string, number> {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  labels.forEach((label, i) => {
    const v = judged[i];
    if (label === 'fail') {
      if (v === 'fail') tp += 1;
      else fn += 1;
    } else if (v === 'pass') tn += 1;
    else fp += 1;
  });
  const n = labels.length;
  const sensitivity = tp / (tp + fn);
  const specificity = tn / (tn + fp);
  const po = (tp + tn) / n;
  const pFail = (tp + fn + tp + fp) / (2 * n);
  const pe = pFail ** 2 + (1 - pFail) ** 2;
  return {
    tp,
    fp,
    tn,
    fn,
    sensitivity,
    specificity,
    balancedAccuracy: (sensitivity + specificity) / 2,
    ppv: tp / (tp + fp),
    npv: tn / (tn + fn),
    f1: (2 * tp) / (2 * tp + fp + fn),
    mcc: (tp * tn - fp * fn) / Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn)),
    youden: sensitivity + specificity - 1,
    scottPi: (po - pe) / (1 - pe),
    prevalenceIndex: Math.abs(tp - tn) / n,
    biasIndex: Math.abs(fp - fn) / n,
    accuracy: (tp + tn) / n,
    falsePositiveRate: fp / (fp + tn),
    falseNegativeRate: fn / (fn + tp),
  };
}

/** Fleiss' kappa over items rated by every judge, categories pass, fail, inconclusive. */
export function fleissOf(verdicts: readonly (readonly Verdict[])[]): number {
  const raters = verdicts.length;
  const items = verdicts[0]?.length ?? 0;
  const cats: Verdict[] = ['pass', 'fail', 'inconclusive'];
  const totals = cats.map(() => 0);
  let pBar = 0;
  for (let i = 0; i < items; i += 1) {
    const counts = cats.map((c) => verdicts.filter((v) => v[i] === c).length);
    counts.forEach((c, k) => {
      totals[k] = (totals[k] ?? 0) + c;
    });
    pBar += (counts.reduce((s, c) => s + c * c, 0) - raters) / (raters * (raters - 1));
  }
  pBar /= items;
  const pe = totals.reduce((s, t) => s + (t / (items * raters)) ** 2, 0);
  return (pBar - pe) / (1 - pe);
}

async function run(api: JudgesApi, random: () => number) {
  const s = setup(random);
  const report = await fn<Calibrate>(
    api,
    'calibrate',
  )({
    judges: s.judges,
    criteria: [criterion()],
    labels: new Map([['bank_rule', s.blocks]]),
    mode: 'system1',
  });
  return { ...s, report };
}

function item(
  id: string,
  tier: Tier,
  check: (api: JudgesApi, random: () => number) => Promise<string | undefined>,
): BankItem {
  return {
    id: `calibration/${id}`,
    family: 'calibration',
    tier,
    level: 'calibration',
    component: COMPONENT,
    async run({ api, random }) {
      const problem = await check(api, random);
      return problem === undefined ? { pass: true, detail: '' } : { pass: false, detail: problem };
    },
  };
}

const METRICS: readonly (readonly [string, Tier])[] = [
  ['confusion', 2],
  ['sensitivity', 2],
  ['specificity', 2],
  ['balancedAccuracy', 3],
  ['ppv', 3],
  ['npv', 3],
  ['f1', 3],
  ['mcc', 4],
  ['youden', 3],
  ['scottPi', 4],
  ['prevalenceIndex', 4],
  ['biasIndex', 4],
  ['accuracy', 1],
  ['falsePositiveRate', 2],
  ['falseNegativeRate', 2],
];

export function agreementItems(): BankItem[] {
  const out: BankItem[] = METRICS.map(([metric, tier]) =>
    item(`metric-${metric}`, tier, async (api, random) => {
      const { blocks, verdicts, report } = await run(api, random);
      const labels = blocks.map((b) => b.label);
      for (const [j, row] of (report.criteria[0]?.judges ?? []).entries()) {
        const got = (row.labels as unknown as { metrics?: Record<string, number> }).metrics ?? {};
        const want = metricsOf(labels, verdicts[j] as Verdict[]);
        const keys = metric === 'confusion' ? ['tp', 'fp', 'tn', 'fn'] : [metric];
        for (const key of keys) {
          if (!(Math.abs((got[key] ?? Number.NaN) - (want[key] as number)) < 1e-9)) {
            return `${row.judge}: labels.metrics.${key} is ${got[key]}, the formula gives ${want[key]} (fail is the positive class)`;
          }
        }
      }
      return undefined;
    }),
  );
  out.push(
    item('fleiss-kappa-across-judges', 4, async (api, random) => {
      const { verdicts, report } = await run(api, random);
      const got = (report.criteria[0] as unknown as { fleissKappa?: number }).fleissKappa;
      const want = fleissOf(verdicts);
      return Math.abs((got ?? Number.NaN) - want) < 1e-9
        ? undefined
        : `fleissKappa ${got}, the formula gives ${want}`;
    }),
    item('labels-conflicting-duplicates', 3, async (api) => {
      const blocks: LabelledBlock[] = [
        { id: 'a', label: 'pass', transcript: [{ role: 'agent', text: 'same slice' }] },
        { id: 'b', label: 'fail', transcript: [{ role: 'agent', text: 'same slice' }] },
        ...Array.from(
          { length: 10 },
          (_, i): LabelledBlock => ({
            id: `c${i}`,
            label: i % 2 ? 'pass' : 'fail',
            transcript: [{ role: 'agent', text: `other ${i}` }],
          }),
        ),
      ];
      const report = await fn<Calibrate>(
        api,
        'calibrate',
      )({
        judges: setup(() => 0.5).judges,
        criteria: [criterion()],
        labels: new Map([['bank_rule', blocks]]),
        mode: 'system1',
      });
      const got = (report.criteria[0] as unknown as { labelConflicts?: string[][] }).labelConflicts;
      return JSON.stringify(got) === JSON.stringify([['a', 'b']])
        ? undefined
        : `labelConflicts ${JSON.stringify(got)}, expected [["a","b"]]`;
    }),
    item('labels-fixture-leak', 3, async (api) => {
      const blocks: LabelledBlock[] = [
        { id: 'leak', label: 'pass', transcript: [{ role: 'agent', text: 'yes' }] },
        ...Array.from(
          { length: 10 },
          (_, i): LabelledBlock => ({
            id: `c${i}`,
            label: i % 2 ? 'pass' : 'fail',
            transcript: [{ role: 'agent', text: `other ${i}` }],
          }),
        ),
      ];
      const report = await fn<Calibrate>(
        api,
        'calibrate',
      )({
        judges: setup(() => 0.5).judges,
        criteria: [criterion()],
        labels: new Map([['bank_rule', blocks]]),
        mode: 'system1',
      });
      const got = (report.criteria[0] as unknown as { fixtureLeaks?: string[] }).fixtureLeaks;
      return JSON.stringify(got) === JSON.stringify(['leak'])
        ? undefined
        : `fixtureLeaks ${JSON.stringify(got)}, expected ["leak"]: a labelled block equal to a fixture inflates agreement`;
    }),
    item('labels-for-an-unknown-criterion', 2, async (api) => {
      const blocks: LabelledBlock[] = [
        { id: 'x', label: 'pass', transcript: [{ role: 'agent', text: 'x' }] },
      ];
      const report = await fn<Calibrate>(
        api,
        'calibrate',
      )({
        judges: setup(() => 0.5).judges,
        criteria: [criterion()],
        labels: new Map([
          ['bank_rule', []],
          ['ghost_rule', blocks],
        ]),
        mode: 'system1',
      });
      const got = (report as unknown as { unknownLabels?: string[] }).unknownLabels;
      return JSON.stringify(got) === JSON.stringify(['ghost_rule'])
        ? undefined
        : `unknownLabels ${JSON.stringify(got)}, expected ["ghost_rule"]`;
    }),
    item('labels-few-in-a-class', 2, async (api, random) => {
      const fails = 1 + Math.floor(random() * 4);
      const blocks: LabelledBlock[] = Array.from(
        { length: 20 },
        (_, i): LabelledBlock => ({
          id: `c${i}`,
          label: i < fails ? 'fail' : 'pass',
          transcript: [{ role: 'agent', text: `other ${i}` }],
        }),
      );
      const report = await fn<Calibrate>(
        api,
        'calibrate',
      )({
        judges: setup(() => 0.5).judges,
        criteria: [criterion()],
        labels: new Map([['bank_rule', blocks]]),
        mode: 'system1',
      });
      const got = (report.criteria[0] as unknown as { warnings?: string[] }).warnings ?? [];
      return got.includes('few-labels')
        ? undefined
        : `warnings ${JSON.stringify(got)} with ${fails} fail labels: expected few-labels`;
    }),
  );
  return out;
}
