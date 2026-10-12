import { canonicalJson, compareTranscripts, type RunResult } from '@driftbench/core';
import * as report from '@driftbench/report';
import * as stats from '@driftbench/stats';
import { SYSTEM_COMPONENTS } from '../components';
import { between, rngFor } from '../random';
import { type BankItem, expectAll, fail, type Tier } from './types';
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
  for (const cls of [...classes, 'X4_format', 'D6_instruction_in_data', 'D4_loose_confirmation'] as const) {
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
          if (!diff)
            return fail(
              'report.diff is not built: add it to packages/report/src/index.ts with the contract in packages/validators/src/ladders/system/bank/version.ts',
            );
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
    }
  }
  return out;
}

export function versionItems(): BankItem[] {
  return versionDrift();
}
