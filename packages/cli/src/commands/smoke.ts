import { compareTranscripts, type RunResult, runSpec } from '@agent-nexus/driftbench-core';
import type { Command } from 'commander';
import type { Io } from '../io';
import { addJudgeOptions, type JudgeFlags, optionalJudgeFrom } from '../judge-options';
import { optionNumber } from '../number';
import {
  type CampaignDeps,
  defaultDeps,
  loadValidSpecs,
  parseTarget,
  resolveAdapter,
  showTarget,
  specRuns,
} from './campaign';

type SmokeOptions = { target?: string; runs: string; json?: boolean } & JudgeFlags;

/**
 * `driftbench smoke <spec> [--target <adapter[:agent]>] [--runs 3]`: the determinism check. Runs one spec
 * several times in mode F with the cache off and compares the transcripts block by block. Without
 * --target the spec runs on its own target. Exit 0 when they are identical, 1 when they differ or a run
 * fails, 2 on bad input. With a judge (`--judge`, `--judges`), each run's judged criteria are judged too and
 * their verdicts listed per run; they never change the exit code, which is about determinism.
 */
export function registerSmokeCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  const smoke = program
    .command('smoke')
    .description('Run one spec several times with the cache off and report whether the transcripts differ')
    .argument('<spec>', 'one spec file')
    .option(
      '--target <adapter[:agent]>',
      "the target to run on, such as function:acme-sales; without it, the spec's own target",
    )
    .option('--runs <n>', 'how many runs to compare, at least 2', '3')
    .option('--json', 'print one JSON document');
  addJudgeOptions(smoke).action(async (path: string, options: SmokeOptions) => {
    setExit(await smokeCommand(path, options, io, deps));
  });
}

export async function smokeCommand(
  path: string,
  options: SmokeOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const runs = optionNumber(options.runs);
  if (!Number.isInteger(runs) || runs < 2) {
    io.err(`--runs takes a whole number of at least 2, not "${options.runs}".\n`);
    return 2;
  }
  const judge = await optionalJudgeFrom(options, io);
  if (judge === null) return 2;
  const loaded = await loadValidSpecs([path], io);
  if (!loaded) return 2;
  const [entry, ...others] = loaded;
  if (!entry || others.length > 0) {
    io.err(`smoke takes one spec; ${path} holds ${loaded.length}.\n`);
    return 2;
  }
  const given = options.target === undefined ? [] : [parseTarget(options.target)];
  const [run] = specRuns([entry], given, io) ?? [];
  const target = run?.targets[0];
  if (run === undefined || target === undefined) return 2;
  const adapter = await resolveAdapter(
    target,
    () => deps.adapterFor(target),
    io,
    run.pinned === undefined ? [] : [entry.spec.id],
  );
  if (!adapter) {
    return 2;
  }

  const results: RunResult[] = [];
  for (let run = 0; run < runs; run++) {
    results.push(
      await runSpec(entry.spec, {
        adapter,
        driver: deps.driver(),
        checks: judge ? [judge.check] : [],
        mode: 'F',
        repeat: 0,
        target,
        now: () => deps.now(),
      }),
    );
  }
  await judge?.save();
  const comparison = compareTranscripts(results);
  const judged = (result: RunResult) =>
    result.blocks.flatMap((block) =>
      block.verdicts
        .filter((verdict) => verdict.kind === 'judge')
        .map((verdict) => ({ block: block.index, criterion: verdict.name, outcome: verdict.outcome })),
    );
  const deterministic = adapter.capabilities().deterministic;
  const failed = results.filter((result) => result.status !== 'completed');

  if (options.json) {
    io.out(
      `${JSON.stringify(
        {
          specId: entry.spec.id,
          target,
          runs: results.map((result) => ({
            status: result.status,
            blocks: result.blocks.length,
            ...(result.error ? { error: result.error } : {}),
            ...(judge ? { judged: judged(result) } : {}),
          })),
          ...(judge ? { judge: judge.label, judgeCostUsd: judge.spend.usd } : {}),
          deterministicClaim: deterministic,
          ...comparison,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    io.out(`Smoke: ${entry.spec.id} on ${showTarget(target)}, ${runs} runs, cache off.\n`);
    results.forEach((result, index) => {
      const error = result.error ? `  ${result.error}` : '';
      io.out(
        `  run ${index + 1}  ${result.status}  ${result.blocks.length} block${result.blocks.length === 1 ? '' : 's'}  transcript ${comparison.hashes[index]}${error}\n`,
      );
      if (judge) {
        for (const verdict of judged(result))
          io.out(`    judged ${verdict.criterion} (block ${verdict.block}): ${verdict.outcome}\n`);
      }
    });
    const difference = comparison.firstDifference;
    if (!difference) {
      io.out('✓ The transcripts are identical.\n');
    } else {
      const block = `block ${difference.block}${difference.blockId === undefined ? '' : ` (${difference.blockId})`}`;
      io.out(`✗ The transcripts differ: run ${difference.run + 1} first differs from run 1 at ${block}.\n`);
      io.out(
        deterministic
          ? `  The adapter claims to be deterministic, so the difference at ${block} fails that claim.\n`
          : '  The adapter does not claim to be deterministic.\n',
      );
    }
    if (failed.length > 0) io.out(`✗ ${failed.length} of ${runs} runs did not complete.\n`);
    if (judge) io.out(`Judge ${judge.label}, ${judge.spend.usd.toFixed(4)} USD.\n`);
  }
  return comparison.identical && failed.length === 0 ? 0 : 1;
}
