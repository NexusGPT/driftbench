import {
  canonicalJson,
  compareTranscripts,
  type LoadedSpec,
  type RunResult,
} from '@agent-nexus/driftbench-core';
import { type CampaignData, compareCampaigns } from '@agent-nexus/driftbench-report';
import * as stats from '@agent-nexus/driftbench-stats';
import { SYSTEM_COMPONENTS } from '../components';
import { between, rngFor } from '../random';
import { type BankItem, type Draft, expectAll, type Tier, withCauses } from './types';
import { behavioursFor, type Faults, plantedFlow, runScenario } from './world';

/**
 * Level 8: drift between two versions is reported at the right cell: the paired verdict names the regressed
 * spec, the transcript comparison names the first block that differs, and the report package's
 * compareCampaigns counts exactly that unit as regressed (docs/comparison.md). The report's own numbers are
 * checked against a brute-force recomputation in claims/report.ts.
 */

const REPORT = 'packages/report/src/compare.ts';

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

function versionDrift(): Draft[] {
  const out: Draft[] = [];
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
        id: `version/compare/${cls.toLowerCase().replace('_', '-')}/${where}`,
        family: 'version-drift',
        tier: 3,
        level: 8,
        component: REPORT,
        source: 'contract',
        title: `compareCampaigns pairs two versions spec by spec and counts exactly the spec the candidate broke with ${cls} at its ${where} block as regressed (docs/comparison.md)`,
        cause:
          'compareCampaigns pairs units by spec and mode and counts a unit regressed when the baseline passes every repeat and the candidate does not',
        async check({ seed }) {
          const { baseline, candidate, bad } = await twoVersions(
            seed,
            `compare-${cls}-${where}`,
            4,
            cls,
            where,
          );
          const data = (runs: RunResult[], campaignId: string) => {
            const specs = new Map<string, LoadedSpec>();
            for (const run of runs)
              specs.set(`${run.specId}@${run.specHash}`, {
                ok: true,
                path: 'bank',
                spec: { id: run.specId } as never,
                hash: run.specHash,
                warnings: [],
              } as never);
            return {
              campaign: {
                campaignId,
                specs: runs.map((run) => ({ id: run.specId, hash: run.specHash })),
                targets: [runs[0]?.target ?? { adapter: 'function' }],
                modes: ['F'],
                repeats: { T: 0, F: 1, P: 0 },
                budgetUsd: 0,
                judge: { mode: 'system1', judges: [] },
                createdAt: '2026-10-11T00:00:00.000Z',
              },
              specs,
              runs,
            } as unknown as CampaignData;
          };
          const result = compareCampaigns(data(baseline, 'c-base'), data(candidate, 'c-cand'), {
            margin: 0.1,
          });
          const regressed = result.pairs
            .filter((pair) => pair.baseline.allPass && !pair.candidate.allPass)
            .map((pair) => pair.specId);
          return expectAll([
            [
              result.pairs.length === baseline.length,
              `${result.pairs.length} pairs, ${baseline.length} specs`,
            ],
            [
              canonicalJson(regressed) === canonicalJson([baseline[bad]?.specId]),
              `regressed units ${canonicalJson(regressed)}, planted ${baseline[bad]?.specId}`,
            ],
            [
              result.allPass.table.regressed === 1 && result.allPass.table.improved === 0,
              `table ${canonicalJson(result.allPass.table)}`,
            ],
          ]);
        },
      });
    }
  }
  return out;
}

export function versionItems(): BankItem[] {
  return withCauses(versionDrift(), (item) =>
    item.id.startsWith('version/paired/')
      ? 'the paired verdict names the regressed spec and the transcript comparison names its first differing block'
      : undefined,
  );
}
