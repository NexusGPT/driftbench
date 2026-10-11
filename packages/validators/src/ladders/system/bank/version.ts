import { canonicalJson, compareTranscripts, type DriftClass, type RunResult } from '@driftbench/core';
import * as report from '@driftbench/report';
import * as stats from '@driftbench/stats';
import { SYSTEM_COMPONENTS } from '../components';
import { between, rngFor } from '../random';
import { withPerturbation } from './reach';
import { type BankItem, expectAll, fail, type ItemResult, PASS, type Tier } from './types';
import { behavioursFor, type Faults, plantedFlow, runScenario } from './world';

/**
 * Level 8: drift between two versions is reported at the right cell, and the scorecard reports every field.
 *
 * Part of this level asks for capabilities driftbench has (the paired verdict names the regressed spec; the
 * transcript comparison names the first block that differs). The rest is the roadmap of section 12.2, item 1:
 * the report package of phase 4 (docs/reference/cli.md, "Planned commands": report scorecard, report diff,
 * report junit, compare). Its items are written against the contract below, proposed by this bank and to be
 * confirmed by the report lane; an item fails with "not built" until the function exists.
 *
 *   report.scorecard(runs) -> {
 *     overall: { runs, passing, passRate, interval: { lower, upper } }         // Wilson on runs that passed
 *     cells: [{ specId, mode, perturbationId?, runs, passing, passRate,
 *               passAtK: number[], passHatK: number[] }]                       // k = 1 .. runs, stats.passAtK / passK
 *     drift: { X1_local, X2_contradiction, X3_flow, X4_format, X5_tool }       // failing blocks carrying each class
 *     firstDriftBlock: { min: number | null }
 *     recovery: { measured, safeActionRate: number | null, labels: { immediate, late, never } }
 *     cost: { usd }
 *   }
 *   report.diff(baseline: RunResult, candidate: RunResult) -> {
 *     firstBlock: number | null, changes: [{ block, verdict, from, to }] }    // gating verdicts whose outcome moved
 *   report.compare(baseline: RunResult[], candidate: RunResult[], { margin }) -> {
 *     nonInferior, regressed: [{ specId, block, verdict }] }                  // the first failing block of each regressed spec
 *   report.junit(runs) -> string                                              // <testsuite tests failures>, one testcase per run
 */

const REPORT = 'packages/report/src/index.ts';

type Fn = (...args: unknown[]) => unknown;

function reportFn(name: string): Fn | undefined {
  const value = (report as Record<string, unknown>)[name];
  return typeof value === 'function' ? (value as Fn) : undefined;
}

/** Two versions of S specs: the candidate fails spec `bad` at block `at` with the operator `cls`. */
async function twoVersions(seed: number, tag: string, specs: number, cls: string, where: 'first' | 'last') {
  const rng = rngFor(seed, `${tag}-versions`);
  const bad = between(rng, 0, specs - 1);
  const baseline: RunResult[] = [];
  const candidate: RunResult[] = [];
  let at = 0;
  for (let index = 0; index < specs; index += 1) {
    const planted = plantedFlow(seed, `${tag}-s${index}`, 5);
    at = where === 'first' ? 0 : planted.truths.length - 1;
    const faults: Faults = index === bad ? new Map([[at, [cls]]]) : new Map();
    baseline.push(
      await runScenario(planted.spec, behavioursFor(planted), {
        target: { adapter: 'function', agent: 'planted', variant: 'baseline' },
      }),
    );
    candidate.push(
      await runScenario(planted.spec, behavioursFor(planted, faults), {
        target: { adapter: 'function', agent: 'planted', variant: 'candidate' },
      }),
    );
  }
  return { baseline, candidate, bad, at };
}

const allPass = (run: RunResult) => run.status === 'completed' && run.blocks.every((block) => block.pass);

function versionDrift(): BankItem[] {
  const out: BankItem[] = [];
  const classes = ['X1_local', 'X5_tool', 'X3_flow'] as const;
  for (const cls of classes) {
    for (const where of ['first', 'last'] as const) {
      for (const specs of [4, 8]) {
        const id = `version/paired/${cls.toLowerCase().replace('_', '-')}/${where}/${specs}`;
        out.push({
          id,
          family: 'version-drift',
          tier: (specs === 8 ? 3 : 2) as Tier,
          level: 8,
          component: SYSTEM_COMPONENTS.parity,
          source: 'combination',
          title: `between two versions of ${specs} specs differing by ${cls} at the ${where} block, the paired verdict names the regressed spec and the transcripts name the block`,
          async check({ seed }) {
            const { baseline, candidate, bad, at } = await twoVersions(seed, id, specs, cls, where);
            const verdict = stats.nonInferiority({
              baseline: baseline.map(allPass),
              candidate: candidate.map(allPass),
              margin: 0.1,
              pairs: baseline.map((run) => run.specId),
            });
            const first = compareTranscripts([
              baseline[bad] as RunResult,
              candidate[bad] as RunResult,
            ]).firstDifference;
            const others = baseline.every(
              (run, index) =>
                index === bad || compareTranscripts([run, candidate[index] as RunResult]).identical,
            );
            return expectAll([
              [
                canonicalJson(verdict.regressedPairs) === canonicalJson([baseline[bad]?.specId]),
                `regressed ${verdict.regressedPairs.join(',')}, planted ${baseline[bad]?.specId}`,
              ],
              [
                verdict.discordant.regressed === 1 && verdict.discordant.improved === 0,
                `discordant ${canonicalJson(verdict.discordant)}`,
              ],
              [first?.block === at, `first difference ${canonicalJson(first)}, planted block ${at}`],
              [others, 'a spec that did not change has a different transcript'],
            ]);
          },
        });
      }
    }
  }
  for (const cls of classes) {
    for (const where of ['first', 'last'] as const) {
      out.push({
        id: `version/diff/${cls.toLowerCase().replace('_', '-')}/${where}`,
        family: 'version-drift',
        tier: 3,
        level: 8,
        component: REPORT,
        source: 'parity',
        title: `report.diff of two runs differing by ${cls} at the ${where} block names that block and the verdicts that moved from pass to fail`,
        async check({ seed }) {
          const diff = reportFn('diff');
          if (!diff) return fail('report.diff is not built (docs/reference/cli.md planned: report diff)');
          const { baseline, candidate, bad, at } = await twoVersions(
            seed,
            `diff-${cls}-${where}`,
            3,
            cls,
            where,
          );
          const result = diff(baseline[bad], candidate[bad]) as {
            firstBlock?: number;
            changes?: Array<{ block: number; verdict: string; from: string; to: string }>;
          };
          const moved = (candidate[bad]?.blocks[at]?.verdicts ?? [])
            .filter((verdict) => verdict.gating && verdict.outcome === 'fail')
            .map((verdict) => verdict.id)
            .sort();
          const reported = (result.changes ?? [])
            .filter((change) => change.block === at && change.from === 'pass' && change.to === 'fail')
            .map((change) => change.verdict)
            .sort();
          return expectAll([
            [result.firstBlock === at, `firstBlock ${result.firstBlock}, planted ${at}`],
            [
              canonicalJson(reported) === canonicalJson(moved),
              `changes ${canonicalJson(reported)}, expected ${canonicalJson(moved)}`,
            ],
          ]);
        },
      });
      out.push({
        id: `version/compare/${cls.toLowerCase().replace('_', '-')}/${where}`,
        family: 'version-drift',
        tier: 4,
        level: 8,
        component: REPORT,
        source: 'parity',
        title: `report.compare of two campaigns names the regressed spec, its first failing block and its verdict (${cls} at the ${where} block)`,
        async check({ seed }) {
          const compare = reportFn('compare');
          if (!compare)
            return fail(
              'report.compare is not built (docs/reference/cli.md planned: compare --baseline --candidate)',
            );
          const { baseline, candidate, bad, at } = await twoVersions(
            seed,
            `compare-${cls}-${where}`,
            6,
            cls,
            where,
          );
          const result = compare(baseline, candidate, { margin: 0.1 }) as {
            regressed?: Array<{ specId: string; block: number; verdict: string }>;
          };
          const entry = result.regressed?.[0];
          const failing = (candidate[bad]?.blocks[at]?.verdicts ?? []).find(
            (verdict) => verdict.gating && verdict.outcome === 'fail',
          )?.id;
          return expectAll([
            [result.regressed?.length === 1, `${result.regressed?.length} regressed entries`],
            [
              entry?.specId === candidate[bad]?.specId && entry?.block === at,
              `entry ${canonicalJson(entry)}`,
            ],
            [entry?.verdict === failing, `verdict ${entry?.verdict}, expected ${failing}`],
          ]);
        },
      });
    }
  }
  return out;
}

/** The campaign shapes the scorecard items run on. */
type Shape = { name: string; tier: Tier; runs(seed: number): Promise<RunResult[]> };

const SHAPES: Shape[] = [
  {
    name: 'clean',
    tier: 2,
    async runs(seed) {
      const out: RunResult[] = [];
      for (let index = 0; index < 3; index += 1) {
        const planted = plantedFlow(seed, `card-clean-${index}`, 3);
        for (let repeat = 0; repeat < 2; repeat += 1)
          out.push(await runScenario(planted.spec, behavioursFor(planted), { repeat }));
      }
      return out;
    },
  },
  {
    name: 'faults-and-repeats',
    tier: 3,
    async runs(seed) {
      const out: RunResult[] = [];
      for (let index = 0; index < 3; index += 1) {
        const planted = plantedFlow(seed, `card-faults-${index}`, 4);
        for (let repeat = 0; repeat < 3; repeat += 1) {
          const faults: Faults =
            repeat <= index - 1 ? new Map([[index, ['X1_local', 'X5_tool']]]) : new Map();
          out.push(await runScenario(planted.spec, behavioursFor(planted, faults), { repeat }));
        }
      }
      return out;
    },
  },
  {
    name: 'perturbed',
    tier: 4,
    async runs(seed) {
      const out: RunResult[] = [];
      for (let index = 0; index < 3; index += 1) {
        const planted = plantedFlow(seed, `card-perturbed-${index}`, 4);
        const behaviours = behavioursFor(planted, index === 2 ? new Map([[3, ['X3_flow']]]) : new Map());
        const perturbation = withPerturbation(
          planted,
          behaviours,
          2,
          index === 0 ? 'D4_loose_confirmation' : 'D1_off_topic',
        );
        out.push(await runScenario(planted.spec, behaviours, { mode: 'P', perturbationId: perturbation }));
      }
      return out;
    },
  },
];

type Card = {
  overall?: {
    runs?: number;
    passing?: number;
    passRate?: number;
    interval?: { lower?: number; upper?: number };
  };
  cells?: Array<{
    specId: string;
    mode: string;
    runs: number;
    passing: number;
    passRate: number;
    passAtK?: number[];
    passHatK?: number[];
  }>;
  drift?: Partial<Record<DriftClass, number>>;
  firstDriftBlock?: { min?: number | null };
  recovery?: { measured?: number; safeActionRate?: number | null; labels?: Record<string, number> };
  cost?: { usd?: number };
};

/** One scorecard field and its oracle, computed from the runs by the documented definitions. */
type Field = { name: string; check(card: Card, runs: RunResult[]): ItemResult };

function cellsOf(runs: RunResult[]) {
  const map = new Map<string, RunResult[]>();
  for (const run of runs)
    map.set(`${run.specId} ${run.mode}`, [...(map.get(`${run.specId} ${run.mode}`) ?? []), run]);
  return map;
}

const close = (a: number | null | undefined, b: number) =>
  a !== null && a !== undefined && Math.abs(a - b) < 1e-9;

const FIELDS: Field[] = [
  {
    name: 'overall-runs',
    check: (card, runs) =>
      card.overall?.runs === runs.length
        ? PASS
        : fail(`overall.runs ${card.overall?.runs}, ${runs.length} runs`),
  },
  {
    name: 'overall-pass-rate',
    check: (card, runs) => {
      const passing = runs.filter(allPass).length;
      return card.overall?.passing === passing && close(card.overall?.passRate, passing / runs.length)
        ? PASS
        : fail(`overall ${canonicalJson(card.overall)}, ${passing} of ${runs.length} pass`);
    },
  },
  {
    name: 'overall-wilson',
    check: (card, runs) => {
      const ci = stats.wilson(runs.filter(allPass).length, runs.length);
      return close(card.overall?.interval?.lower, ci.lower) && close(card.overall?.interval?.upper, ci.upper)
        ? PASS
        : fail(`interval ${canonicalJson(card.overall?.interval)}, Wilson [${ci.lower}, ${ci.upper}]`);
    },
  },
  {
    name: 'cells',
    check: (card, runs) =>
      card.cells?.length === cellsOf(runs).size
        ? PASS
        : fail(`${card.cells?.length} cells, ${cellsOf(runs).size} spec and mode pairs`),
  },
  {
    name: 'cell-pass-rate',
    check: (card, runs) => {
      for (const [key, list] of cellsOf(runs)) {
        const cell = card.cells?.find((each) => `${each.specId} ${each.mode}` === key);
        const passing = list.filter(allPass).length;
        if (cell?.passing !== passing || !close(cell.passRate, passing / list.length))
          return fail(`cell ${key}: ${canonicalJson(cell)}, ${passing} of ${list.length}`);
      }
      return PASS;
    },
  },
  {
    name: 'cell-pass-at-k',
    check: (card, runs) => {
      for (const [key, list] of cellsOf(runs)) {
        const cell = card.cells?.find((each) => `${each.specId} ${each.mode}` === key);
        const c = list.filter(allPass).length;
        for (let k = 1; k <= list.length; k += 1) {
          if (!close(cell?.passAtK?.[k - 1], stats.passAtK(c, list.length, k)))
            return fail(
              `cell ${key} pass@${k}: ${cell?.passAtK?.[k - 1]}, expected ${stats.passAtK(c, list.length, k)}`,
            );
        }
      }
      return PASS;
    },
  },
  {
    name: 'cell-pass-hat-k',
    check: (card, runs) => {
      for (const [key, list] of cellsOf(runs)) {
        const cell = card.cells?.find((each) => `${each.specId} ${each.mode}` === key);
        const c = list.filter(allPass).length;
        for (let k = 1; k <= list.length; k += 1) {
          if (!close(cell?.passHatK?.[k - 1], stats.passK(c, list.length, k)))
            return fail(
              `cell ${key} pass^${k}: ${cell?.passHatK?.[k - 1]}, expected ${stats.passK(c, list.length, k)}`,
            );
        }
      }
      return PASS;
    },
  },
  {
    name: 'drift-by-class',
    check: (card, runs) => {
      const counts: Record<string, number> = {
        X1_local: 0,
        X2_contradiction: 0,
        X3_flow: 0,
        X4_format: 0,
        X5_tool: 0,
      };
      for (const run of runs)
        for (const block of run.blocks) for (const cls of block.drift) counts[cls] = (counts[cls] ?? 0) + 1;
      return canonicalJson(card.drift) === canonicalJson(counts)
        ? PASS
        : fail(`drift ${canonicalJson(card.drift)}, expected ${canonicalJson(counts)}`);
    },
  },
  {
    name: 'first-drift-block',
    check: (card, runs) => {
      const firsts = runs
        .map((run) => run.succession.firstDriftBlock)
        .filter((value): value is number => value !== undefined);
      const want = firsts.length === 0 ? null : Math.min(...firsts);
      return card.firstDriftBlock?.min === want
        ? PASS
        : fail(`firstDriftBlock ${canonicalJson(card.firstDriftBlock)}, expected ${want}`);
    },
  },
  {
    name: 'recovery-shares',
    check: (card, runs) => {
      const measured = runs.filter((run) => run.recovery !== undefined);
      const safe = measured.filter((run) => run.recovery?.safeAction !== undefined);
      const rate =
        safe.length === 0
          ? null
          : safe.filter((run) => run.recovery?.safeAction === true).length / safe.length;
      const labels = { immediate: 0, late: 0, never: 0 };
      for (const run of measured) labels[run.recovery?.label ?? 'never'] += 1;
      return expectAll([
        [
          card.recovery?.measured === measured.length,
          `recovery.measured ${card.recovery?.measured}, ${measured.length} runs measured`,
        ],
        [
          rate === null ? card.recovery?.safeActionRate === null : close(card.recovery?.safeActionRate, rate),
          `safeActionRate ${card.recovery?.safeActionRate}, expected ${rate}`,
        ],
        [
          canonicalJson(card.recovery?.labels) === canonicalJson(labels),
          `labels ${canonicalJson(card.recovery?.labels)}`,
        ],
      ]);
    },
  },
  {
    name: 'cost',
    check: (card, runs) =>
      close(
        card.cost?.usd,
        runs.reduce((sum, run) => sum + run.cost, 0),
      )
        ? PASS
        : fail(`cost ${canonicalJson(card.cost)}`),
  },
];

function scorecardItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const shape of SHAPES) {
    for (const field of FIELDS) {
      out.push({
        id: `scorecard/${field.name}/${shape.name}`,
        family: 'scorecard',
        tier: shape.tier,
        level: 8,
        component: REPORT,
        source: 'parity',
        title: `the scorecard reports ${field.name} right on a ${shape.name} campaign`,
        async check({ seed }) {
          const scorecard = reportFn('scorecard');
          if (!scorecard)
            return fail('report.scorecard is not built (docs/reference/cli.md planned: report scorecard)');
          const runs = await shape.runs(seed);
          return field.check(scorecard(runs) as Card, runs);
        },
      });
    }
    out.push({
      id: `scorecard/junit/${shape.name}`,
      family: 'scorecard',
      tier: shape.tier,
      level: 8,
      component: REPORT,
      source: 'parity',
      title: `report.junit gives one testcase per run and one failure per run that did not pass, on a ${shape.name} campaign`,
      async check({ seed }) {
        const junit = reportFn('junit');
        if (!junit) return fail('report.junit is not built (docs/reference/cli.md planned: report junit)');
        const runs = await shape.runs(seed);
        const xml = String(junit(runs));
        const tests = Number(/<testsuite[^>]*\btests="(\d+)"/.exec(xml)?.[1]);
        const failures = Number(/<testsuite[^>]*\bfailures="(\d+)"/.exec(xml)?.[1]);
        const cases = (xml.match(/<testcase\b/g) ?? []).length;
        const failing = runs.filter((run) => !allPass(run)).length;
        return expectAll([
          [
            tests === runs.length && cases === runs.length,
            `tests ${tests}, testcases ${cases}, runs ${runs.length}`,
          ],
          [failures === failing, `failures ${failures}, ${failing} runs did not pass`],
        ]);
      },
    });
  }
  return out;
}

export function versionItems(): BankItem[] {
  return [...versionDrift(), ...scorecardItems()];
}
