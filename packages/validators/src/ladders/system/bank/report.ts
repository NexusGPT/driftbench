import { canonicalJson, type DriftClass, type RunResult } from '@driftbench/core';
import * as report from '@driftbench/report';
import * as stats from '@driftbench/stats';
import { between, rngFor } from '../random';
import { withPerturbation } from './reach';
import { type BankItem, fail, type ItemResult, PASS, type Tier } from './types';
import { behavioursFor, type Faults, plantedFlow, runScenario } from './world';

/**
 * Level 8, the report roadmap (docs/validators.md section 12.6, system: "every report field", "variance
 * reported within its interval"; docs/reference/cli.md, planned: report scorecard, report junit). The report
 * package is a stub on main; these items are written against the contract below, which this bank proposes and
 * the report lane confirms or amends in a maintainer commit. One item is one field of one grouping; it runs
 * on three campaign shapes, so one fix in the report moves one item.
 *
 *   report.scorecard(runs: RunResult[]) -> {
 *     overall: Group,
 *     bySpec: Record<specId, Group>,
 *     byMode: Record<'F' | 'T' | 'P', Group>,
 *     byTarget: Record<'<adapter>[:<agent>][@<variant>]', Group>,
 *     cells: Array<{ specId, mode, target, runs, passing, passRate, passAtK: number[], passHatK: number[],
 *                    unreliability: number }>,
 *   }
 *   Group = {
 *     runs, passing, passRate,                                  // a run passes: completed, every block passed
 *     interval: { lower, upper },                               // stats.wilson(passing, runs)
 *     clustered: { lower, upper },                              // stats.bootstrapCI(0/1 per run, clusters: specId, seed 1, iterations 2000)
 *     designEffect,                                             // stats.designEffect(runs / specs, max(0, icc by spec))
 *     drift: { X1_local, X2_contradiction, X3_flow, X4_format, X5_tool },   // failing blocks carrying each class
 *     firstDriftBlock: { min: number | null, median: number | null },      // over runs that drifted
 *     driftRate: number,                                        // mean of succession.driftRate
 *     longestClean: number,                                     // min of succession.longestClean
 *     recovery: { measured, labels: { immediate, late, never }, safeActionRate: number | null,
 *                 clarificationGain: number | null, turnsToRecover: number | null },  // mean over recovered runs
 *     cost: { usd, perBlock },                                  // sum of run.cost; usd over blocks
 *     latency: { p50, p90, max },                               // stats.quantile of run.latencyMs, and the largest
 *   }
 *   report.compare(baseline: RunResult[], candidate: RunResult[], { margin }) -> {   // runs paired by spec
 *     nonInferior, table: { bothPass, regressed, improved, bothFail },             // stats.nonInferiority on all-pass flags
 *     effect: { estimate, lower, upper },                                          // stats.pairedRateDifference(table)
 *     regressed: [{ specId, block, verdict }],  // first failing block of each regressed spec, its first failing gating verdict
 *     improved: string[], newFlags: string[] }  // newFlags: specs whose candidate fails a forbidden or guards verdict the baseline passed
 *   report.junit(runs) -> string   // <testsuite tests failures skipped errors>, one <testcase name="<spec>/<mode>/<repeat>">
 *                                  // per run; a failing run carries <failure message="block <i> <verdict id>">
 */

const REPORT = 'packages/report/src/index.ts';

type Fn = (...args: unknown[]) => unknown;
function reportFn(name: string): Fn | undefined {
  const value = (report as Record<string, unknown>)[name];
  return typeof value === 'function' ? (value as Fn) : undefined;
}

const passed = (run: RunResult) =>
  run.status === 'completed' && run.blocks.length > 0 && run.blocks.every((block) => block.pass);

/** Three campaign shapes: two targets and modes F and T, failures with repeats, perturbed runs. */
async function shapeRuns(seed: number, shape: number): Promise<RunResult[]> {
  const out: RunResult[] = [];
  for (let index = 0; index < 3; index += 1) {
    const planted = plantedFlow(seed, `report-${shape}-${index}`, 4);
    if (shape === 0) {
      for (const [mode, variant] of [
        ['F', 'a'],
        ['T', 'a'],
        ['F', 'b'],
      ] as const) {
        out.push(
          await runScenario(planted.spec, behavioursFor(planted), {
            mode,
            target: { adapter: 'function', agent: 'planted', variant },
          }),
        );
      }
    } else if (shape === 1) {
      for (let repeat = 0; repeat < 3; repeat += 1) {
        const faults: Faults = repeat < index ? new Map([[index, ['X1_local', 'X5_tool']]]) : new Map();
        out.push(
          await runScenario(planted.spec, behavioursFor(planted, faults), {
            repeat,
            target: { adapter: 'function', agent: 'planted' },
          }),
        );
      }
    } else {
      const behaviours = behavioursFor(planted, index === 2 ? new Map([[3, ['X3_flow']]]) : new Map());
      const perturbation = withPerturbation(
        planted,
        behaviours,
        2,
        index === 0 ? 'D4_loose_confirmation' : 'D3_contradiction',
      );
      out.push(await runScenario(planted.spec, behaviours, { mode: 'P', perturbationId: perturbation }));
      out.push(await runScenario(planted.spec, behavioursFor(planted), { mode: 'F' }));
    }
  }
  return out;
}

const close = (a: unknown, b: number | null) =>
  b === null ? a === null : typeof a === 'number' && Math.abs(a - b) < 1e-9;

function targetKey(run: RunResult): string {
  return `${run.target.adapter}${run.target.agent ? `:${run.target.agent}` : ''}${run.target.variant ? `@${run.target.variant}` : ''}`;
}

const GROUPINGS: Array<{ name: string; key?: (run: RunResult) => string; field?: string }> = [
  { name: 'overall' },
  { name: 'by-spec', field: 'bySpec', key: (run) => run.specId },
  { name: 'by-mode', field: 'byMode', key: (run) => run.mode },
  { name: 'by-target', field: 'byTarget', key: targetKey },
];

function groupsOf(runs: RunResult[], grouping: (typeof GROUPINGS)[number]): Map<string, RunResult[]> {
  if (!grouping.key) return new Map([['overall', runs]]);
  const out = new Map<string, RunResult[]>();
  for (const run of runs) {
    const key = grouping.key(run);
    out.set(key, [...(out.get(key) ?? []), run]);
  }
  return out;
}

type Group = Record<string, unknown>;

/** One group field: its family, tier and oracle on the runs of the group. */
type Field = {
  name: string;
  family: string;
  tier: Tier;
  check(group: Group, runs: RunResult[]): string | undefined;
};

const mean = (values: number[]) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values: number[]) => (values.length === 0 ? null : stats.quantile(values, 0.5));
const get = (group: Group, path: string) =>
  path
    .split('.')
    .reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], group);

function numberField(
  name: string,
  family: string,
  tier: Tier,
  path: string,
  want: (runs: RunResult[]) => number | null,
): Field {
  return {
    name,
    family,
    tier,
    check: (group, runs) => {
      const expected = want(runs);
      return close(get(group, path), expected)
        ? undefined
        : `${path} is ${canonicalJson(get(group, path))}, expected ${expected}`;
    },
  };
}

const FIELDS: Field[] = [
  numberField('runs', 'scorecard', 1, 'runs', (runs) => runs.length),
  numberField('passing', 'scorecard', 1, 'passing', (runs) => runs.filter(passed).length),
  numberField('pass-rate', 'scorecard', 1, 'passRate', (runs) => runs.filter(passed).length / runs.length),
  numberField(
    'wilson-lower',
    'scorecard',
    2,
    'interval.lower',
    (runs) => stats.wilson(runs.filter(passed).length, runs.length).lower,
  ),
  numberField(
    'wilson-upper',
    'scorecard',
    2,
    'interval.upper',
    (runs) => stats.wilson(runs.filter(passed).length, runs.length).upper,
  ),
  numberField(
    'clustered-interval',
    'scorecard',
    4,
    'clustered.lower',
    (runs) =>
      stats.bootstrapCI(
        runs.map((run) => (passed(run) ? 1 : 0)),
        { clusters: runs.map((run) => run.specId), seed: 1, iterations: 2000 },
      ).lower,
  ),
  numberField('design-effect', 'scorecard', 4, 'designEffect', (runs) => {
    const specs = new Set(runs.map((run) => run.specId)).size;
    if (specs < 2) return 1;
    const components = stats.varianceComponents(
      runs.map((run) => ({ value: passed(run), path: [run.specId] })),
      { levels: ['spec'] },
    );
    return stats.designEffect(runs.length / specs, Math.max(0, stats.icc(components)[0]?.icc ?? 0));
  }),
  {
    name: 'drift-by-class',
    family: 'scorecard-drift',
    tier: 2,
    check: (group, runs) => {
      const counts: Record<DriftClass, number> = {
        X1_local: 0,
        X2_contradiction: 0,
        X3_flow: 0,
        X4_format: 0,
        X5_tool: 0,
      };
      for (const run of runs) for (const block of run.blocks) for (const cls of block.drift) counts[cls] += 1;
      return canonicalJson(group.drift) === canonicalJson(counts)
        ? undefined
        : `drift is ${canonicalJson(group.drift)}, expected ${canonicalJson(counts)}`;
    },
  },
  numberField('first-drift-min', 'scorecard-drift', 2, 'firstDriftBlock.min', (runs) => {
    const values = runs.flatMap((run) =>
      run.succession.firstDriftBlock === undefined ? [] : [run.succession.firstDriftBlock],
    );
    return values.length === 0 ? null : Math.min(...values);
  }),
  numberField('first-drift-median', 'scorecard-drift', 3, 'firstDriftBlock.median', (runs) =>
    median(
      runs.flatMap((run) =>
        run.succession.firstDriftBlock === undefined ? [] : [run.succession.firstDriftBlock],
      ),
    ),
  ),
  numberField('drift-rate', 'scorecard-drift', 2, 'driftRate', (runs) =>
    mean(runs.map((run) => run.succession.driftRate)),
  ),
  numberField('longest-clean', 'scorecard-drift', 3, 'longestClean', (runs) =>
    Math.min(...runs.map((run) => run.succession.longestClean)),
  ),
  numberField(
    'recovery-measured',
    'scorecard-recovery',
    2,
    'recovery.measured',
    (runs) => runs.filter((run) => run.recovery).length,
  ),
  {
    name: 'recovery-labels',
    family: 'scorecard-recovery',
    tier: 2,
    check: (group, runs) => {
      const labels = { immediate: 0, late: 0, never: 0 };
      for (const run of runs) if (run.recovery) labels[run.recovery.label] += 1;
      return canonicalJson(get(group, 'recovery.labels')) === canonicalJson(labels)
        ? undefined
        : `recovery.labels is ${canonicalJson(get(group, 'recovery.labels'))}, expected ${canonicalJson(labels)}`;
    },
  },
  numberField('safe-action-rate', 'scorecard-recovery', 3, 'recovery.safeActionRate', (runs) => {
    const safe = runs.flatMap((run) =>
      run.recovery?.safeAction === undefined ? [] : [run.recovery.safeAction ? 1 : 0],
    );
    return mean(safe);
  }),
  numberField('clarification-gain', 'scorecard-recovery', 3, 'recovery.clarificationGain', (runs) => {
    const asked = runs.flatMap((run) =>
      run.recovery?.clarified === undefined ? [] : [run.recovery.clarified ? 1 : 0],
    );
    return mean(asked);
  }),
  numberField('turns-to-recover', 'scorecard-recovery', 3, 'recovery.turnsToRecover', (runs) =>
    mean(
      runs.flatMap((run) =>
        run.recovery?.turnsToRecover === undefined ? [] : [run.recovery.turnsToRecover],
      ),
    ),
  ),
  numberField('cost-usd', 'scorecard-cost', 1, 'cost.usd', (runs) =>
    runs.reduce((sum, run) => sum + run.cost, 0),
  ),
  numberField('cost-per-block', 'scorecard-cost', 2, 'cost.perBlock', (runs) => {
    const blocks = runs.reduce((sum, run) => sum + run.blocks.length, 0);
    return blocks === 0 ? null : runs.reduce((sum, run) => sum + run.cost, 0) / blocks;
  }),
  numberField('latency-p50', 'scorecard-cost', 2, 'latency.p50', (runs) =>
    stats.quantile(
      runs.map((run) => run.latencyMs),
      0.5,
    ),
  ),
  numberField('latency-p90', 'scorecard-cost', 3, 'latency.p90', (runs) =>
    stats.quantile(
      runs.map((run) => run.latencyMs),
      0.9,
    ),
  ),
  numberField('latency-max', 'scorecard-cost', 2, 'latency.max', (runs) =>
    Math.max(...runs.map((run) => run.latencyMs)),
  ),
];

async function eachShape(
  seed: number,
  check: (runs: RunResult[], card: Record<string, unknown>) => string | undefined,
): Promise<ItemResult> {
  const scorecard = reportFn('scorecard');
  if (!scorecard)
    return fail(
      'report.scorecard is not built: add it to packages/report/src/index.ts with the contract in packages/validators/src/ladders/system/bank/report.ts',
    );
  for (let shape = 0; shape < 3; shape += 1) {
    const runs = await shapeRuns(seed, shape);
    const problem = check(runs, scorecard(runs) as Record<string, unknown>);
    if (problem) return fail(`campaign shape ${shape}: ${problem}`);
  }
  return PASS;
}

function groupItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const field of FIELDS) {
    for (const grouping of GROUPINGS) {
      out.push({
        id: `scorecard/${grouping.name}/${field.name}`,
        family: field.family,
        tier: (grouping.name === 'overall' ? field.tier : Math.min(5, field.tier + 1)) as Tier,
        level: 8,
        component: REPORT,
        source: 'parity',
        title: `report.scorecard gives ${field.name} for each ${grouping.name === 'overall' ? 'campaign' : grouping.name.replace('by-', '')} group as the contract defines it`,
        check: ({ seed }) =>
          eachShape(seed, (runs, card) => {
            for (const [key, members] of groupsOf(runs, grouping)) {
              const group = (
                grouping.field
                  ? (card[grouping.field] as Record<string, Group> | undefined)?.[key]
                  : card.overall
              ) as Group | undefined;
              if (!group) return `no ${grouping.field ?? 'overall'} group ${key}`;
              const problem = field.check(group, members);
              if (problem) return `${grouping.field ?? 'overall'} ${key}: ${problem}`;
            }
            return undefined;
          }),
      });
    }
  }
  return out;
}

function cellItems(): BankItem[] {
  const fields: Array<{
    name: string;
    tier: Tier;
    check(cell: Record<string, unknown> | undefined, runs: RunResult[]): string | undefined;
  }> = [
    {
      name: 'pass-rate',
      tier: 2,
      check: (cell, runs) =>
        close(cell?.passRate, runs.filter(passed).length / runs.length)
          ? undefined
          : `passRate ${cell?.passRate}`,
    },
    {
      name: 'pass-at-k',
      tier: 3,
      check: (cell, runs) => {
        const c = runs.filter(passed).length;
        const want = runs.map((_, k) => stats.passAtK(c, runs.length, k + 1));
        return canonicalJson(cell?.passAtK) === canonicalJson(want)
          ? undefined
          : `passAtK ${canonicalJson(cell?.passAtK)}, expected ${canonicalJson(want)}`;
      },
    },
    {
      name: 'pass-hat-k',
      tier: 3,
      check: (cell, runs) => {
        const c = runs.filter(passed).length;
        const want = runs.map((_, k) => stats.passK(c, runs.length, k + 1));
        return canonicalJson(cell?.passHatK) === canonicalJson(want)
          ? undefined
          : `passHatK ${canonicalJson(cell?.passHatK)}, expected ${canonicalJson(want)}`;
      },
    },
    {
      name: 'unreliability',
      tier: 4,
      check: (cell, runs) =>
        close(cell?.unreliability, stats.unreliability(runs.map((run) => run.succession.driftRate)))
          ? undefined
          : `unreliability ${cell?.unreliability}`,
    },
  ];
  return fields.map((field) => ({
    id: `scorecard/cell/${field.name}`,
    family: 'scorecard',
    tier: field.tier,
    level: 8,
    component: REPORT,
    source: 'parity',
    title: `report.scorecard gives each cell (spec, mode, target) its ${field.name}`,
    check: ({ seed }) =>
      eachShape(seed, (runs, card) => {
        const cells = (card.cells ?? []) as Array<Record<string, unknown>>;
        const keyed = new Map<string, RunResult[]>();
        for (const run of runs)
          keyed.set(`${run.specId} ${run.mode} ${targetKey(run)}`, [
            ...(keyed.get(`${run.specId} ${run.mode} ${targetKey(run)}`) ?? []),
            run,
          ]);
        if (cells.length !== keyed.size) return `${cells.length} cells, expected ${keyed.size}`;
        for (const [key, members] of keyed) {
          const cell = cells.find((each) => `${each.specId} ${each.mode} ${each.target}` === key);
          const problem = field.check(cell, members);
          if (problem) return `cell ${key}: ${problem}`;
        }
        return undefined;
      }),
  }));
}

function junitItems(): BankItem[] {
  const fields: Array<{
    name: string;
    tier: Tier;
    check(xml: string, runs: RunResult[]): string | undefined;
  }> = [
    {
      name: 'tests',
      tier: 1,
      check: (xml, runs) =>
        Number(/<testsuite[^>]*\btests="(\d+)"/.exec(xml)?.[1]) === runs.length
          ? undefined
          : `tests attribute, ${runs.length} runs`,
    },
    {
      name: 'failures',
      tier: 2,
      check: (xml, runs) =>
        Number(/<testsuite[^>]*\bfailures="(\d+)"/.exec(xml)?.[1]) ===
        runs.filter((run) => run.status === 'completed' && !passed(run)).length
          ? undefined
          : 'failures attribute',
    },
    {
      name: 'testcase-names',
      tier: 2,
      check: (xml, runs) =>
        runs.every((run) => xml.includes(`name="${run.specId}/${run.mode}/${run.repeat}"`))
          ? undefined
          : 'a run has no testcase named <spec>/<mode>/<repeat>',
    },
    {
      name: 'failure-message',
      tier: 3,
      check: (xml, runs) => {
        for (const run of runs.filter((each) => each.status === 'completed' && !passed(each))) {
          const block = run.blocks.find((each) => !each.pass);
          const verdict = block?.verdicts.find((each) => each.gating && each.outcome !== 'pass');
          if (block && verdict && !xml.includes(`block ${block.index} ${verdict.id}`))
            return `no failure message names block ${block.index} ${verdict.id}`;
        }
        return undefined;
      },
    },
    {
      name: 'escaping',
      tier: 4,
      check: (xml) =>
        /<testsuite[\s\S]*<\/testsuite>/.test(xml) && !/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml)
          ? undefined
          : 'the XML is not well formed',
    },
  ];
  return fields.map((field) => ({
    id: `scorecard/junit/${field.name}`,
    family: 'scorecard',
    tier: field.tier,
    level: 8,
    component: REPORT,
    source: 'parity',
    title: `report.junit gets ${field.name} right`,
    async check({ seed }) {
      const junit = reportFn('junit');
      if (!junit)
        return fail(
          'report.junit is not built: add it to packages/report/src/index.ts with the contract in packages/validators/src/ladders/system/bank/report.ts',
        );
      for (let shape = 0; shape < 3; shape += 1) {
        const runs = await shapeRuns(seed, shape);
        const problem = field.check(String(junit(runs)), runs);
        if (problem) return fail(`campaign shape ${shape}: ${problem}`);
      }
      return PASS;
    },
  }));
}

export function reportItems(): BankItem[] {
  return [...groupItems(), ...cellItems(), ...junitItems()];
}

/** Two versions over six specs; the candidate breaks spec `bad` at one block with one operator, and may fix spec `good`. */
async function versions(seed: number, tag: string, cls: string, where: 'first' | 'last', improve = false) {
  const rng = rngFor(seed, `${tag}-pick`);
  const bad = between(rng, 0, 5);
  const good = (bad + 1 + between(rng, 0, 4)) % 6;
  const baseline: RunResult[] = [];
  const candidate: RunResult[] = [];
  let at = 0;
  for (let index = 0; index < 6; index += 1) {
    const planted = plantedFlow(seed, `${tag}-${index}`, 4);
    at = where === 'first' ? 0 : 3;
    const baseFaults: Faults = improve && index === good ? new Map([[1, ['X1_local']]]) : new Map();
    const candFaults: Faults = index === bad ? new Map([[at, [cls]]]) : new Map();
    baseline.push(
      await runScenario(planted.spec, behavioursFor(planted, baseFaults), {
        target: { adapter: 'function', variant: 'baseline' },
      }),
    );
    candidate.push(
      await runScenario(planted.spec, behavioursFor(planted, candFaults), {
        target: { adapter: 'function', variant: 'candidate' },
      }),
    );
  }
  return { baseline, candidate, bad, good, at };
}

type Comparison = {
  nonInferior?: boolean;
  table?: Record<string, number>;
  effect?: { estimate?: number; lower?: number; upper?: number };
  regressed?: Array<{ specId: string; block: number; verdict: string }>;
  improved?: string[];
  newFlags?: string[];
};

function compareItems(): BankItem[] {
  const out: BankItem[] = [];
  const notBuilt = fail(
    'report.compare is not built: add it to packages/report/src/index.ts with the contract in packages/validators/src/ladders/system/bank/report.ts',
  );
  const kinds = [
    'X1_local',
    'X3_flow',
    'X4_format',
    'X5_tool',
    'D2_goal_shift',
    'D4_loose_confirmation',
    'D6_instruction_in_data',
    'D9_out_of_scope',
  ];
  for (const cls of kinds) {
    for (const where of ['first', 'last'] as const) {
      out.push({
        id: `compare/cell/${cls.split('_')[0]?.toLowerCase()}/${where}`,
        family: 'compare-cells',
        tier: (where === 'first' ? 3 : 4) as Tier,
        level: 8,
        component: REPORT,
        source: 'parity',
        title: `report.compare names the regressed spec, its block and verdict when the candidate breaks a spec with ${cls} at the ${where} block`,
        async check({ seed }) {
          const compare = reportFn('compare');
          if (!compare) return notBuilt;
          const { baseline, candidate, bad, at } = await versions(
            seed,
            `compare-${cls}-${where}`,
            cls,
            where,
          );
          const result = compare(baseline, candidate, { margin: 0.1 }) as Comparison;
          const verdict = candidate[bad]?.blocks[at]?.verdicts.find(
            (each) => each.gating && each.outcome !== 'pass',
          )?.id;
          const entry = result.regressed?.[0];
          if (result.regressed?.length !== 1)
            return fail(`regressed holds ${result.regressed?.length} entries, expected 1`);
          if (!entry || entry.specId !== candidate[bad]?.specId || entry.block !== at)
            return fail(`regressed ${canonicalJson(entry)}, expected ${candidate[bad]?.specId} block ${at}`);
          return entry.verdict === verdict ? PASS : fail(`verdict ${entry.verdict}, expected ${verdict}`);
        },
      });
    }
  }
  const summary = (
    name: string,
    tier: Tier,
    title: string,
    check: (result: Comparison, v: Awaited<ReturnType<typeof versions>>) => string | undefined,
    cls = 'X1_local',
    improve = false,
  ) =>
    out.push({
      id: `compare/summary/${name}`,
      family: 'compare-cells',
      tier,
      level: 8,
      component: REPORT,
      source: 'parity',
      title,
      async check({ seed }) {
        const compare = reportFn('compare');
        if (!compare) return notBuilt;
        const v = await versions(seed, `compare-summary-${name}`, cls, 'last', improve);
        const problem = check(compare(v.baseline, v.candidate, { margin: 0.1 }) as Comparison, v);
        return problem ? fail(problem) : PASS;
      },
    });
  const flags = (v: Awaited<ReturnType<typeof versions>>) => ({
    baseline: v.baseline.map(passed),
    candidate: v.candidate.map(passed),
  });
  summary(
    'table',
    2,
    'report.compare gives the paired table of all-pass flags',
    (result, v) => {
      const f = flags(v);
      const count = (b: boolean, c: boolean) =>
        f.baseline.filter((value, index) => value === b && f.candidate[index] === c).length;
      const want = {
        bothPass: count(true, true),
        regressed: count(true, false),
        improved: count(false, true),
        bothFail: count(false, false),
      };
      return canonicalJson(result.table) === canonicalJson(want)
        ? undefined
        : `table ${canonicalJson(result.table)}, expected ${canonicalJson(want)}`;
    },
    'X1_local',
    true,
  );
  summary(
    'effect',
    3,
    'report.compare gives the effect and its paired interval as stats.pairedRateDifference',
    (result, v) => {
      const r = stats.nonInferiority({ ...flags(v), margin: 0.1 });
      return close(result.effect?.estimate, r.effect.estimate) &&
        close(result.effect?.upper, r.effect.upper) &&
        close(result.effect?.lower, r.effect.lower)
        ? undefined
        : `effect ${canonicalJson(result.effect)}, expected ${canonicalJson(r.effect)}`;
    },
  );
  summary('verdict', 2, 'report.compare gives the non-inferiority verdict at the margin', (result, v) => {
    const r = stats.nonInferiority({ ...flags(v), margin: 0.1 });
    return result.nonInferior === r.nonInferior
      ? undefined
      : `nonInferior ${result.nonInferior}, expected ${r.nonInferior}`;
  });
  summary(
    'improved',
    3,
    'report.compare lists the spec the candidate fixed',
    (result, v) =>
      canonicalJson(result.improved) === canonicalJson([v.candidate[v.good]?.specId])
        ? undefined
        : `improved ${canonicalJson(result.improved)}`,
    'X1_local',
    true,
  );
  summary(
    'new-flags',
    4,
    'report.compare names a spec whose candidate fails a forbidden verdict the baseline passed as a new gating flag',
    (result, v) =>
      canonicalJson(result.newFlags) === canonicalJson([v.candidate[v.bad]?.specId])
        ? undefined
        : `newFlags ${canonicalJson(result.newFlags)}`,
    'D4_loose_confirmation',
  );
  return out;
}

export function reportRoadmapItems(): BankItem[] {
  return [...reportItems(), ...compareItems()];
}
