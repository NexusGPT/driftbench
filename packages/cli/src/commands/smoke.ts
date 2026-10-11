import { compareTranscripts, type RunResult, runSpec } from '@driftbench/core';
import type { Command } from 'commander';
import type { Io } from '../io';
import { type CampaignDeps, defaultDeps, loadValidSpecs, parseTarget, showTarget } from './campaign';

type SmokeOptions = { target: string; runs: string; json?: boolean };

/**
 * `driftbench smoke <spec> --target <adapter[:agent]> [--runs 3]`: the determinism check. Runs one spec
 * several times in mode F with the cache off and compares the transcripts block by block. Exit 0 when
 * they are identical, 1 when they differ or a run fails, 2 on bad input.
 */
export function registerSmokeCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  program
    .command('smoke')
    .description('Run one spec several times with the cache off and report whether the transcripts differ')
    .argument('<spec>', 'one spec file')
    .requiredOption('--target <adapter[:agent]>', 'the target to run on, such as function:acme')
    .option('--runs <n>', 'how many runs to compare, at least 2', '3')
    .option('--json', 'print one JSON document')
    .action(async (path: string, options: SmokeOptions) => {
      setExit(await smokeCommand(path, options, io, deps));
    });
}

export async function smokeCommand(
  path: string,
  options: SmokeOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const runs = Number(options.runs);
  if (!Number.isInteger(runs) || runs < 2) {
    io.err(`--runs takes a whole number of at least 2, not "${options.runs}".\n`);
    return 2;
  }
  const loaded = await loadValidSpecs([path], io);
  if (!loaded) return 2;
  const [entry, ...others] = loaded;
  if (!entry || others.length > 0) {
    io.err(`smoke takes one spec; ${path} holds ${loaded.length}.\n`);
    return 2;
  }
  const target = parseTarget(options.target);
  const adapter = await deps.adapterFor(target);
  if (!adapter) {
    io.err(
      `No adapter is set up for ${showTarget(target)}. The CLI reaches function:acme, the Acme example agent.\n`,
    );
    return 2;
  }

  const results: RunResult[] = [];
  for (let run = 0; run < runs; run++) {
    results.push(
      await runSpec(entry.spec, {
        adapter,
        driver: deps.driver(),
        checks: [],
        mode: 'F',
        repeat: 0,
        target,
        now: () => deps.now(),
      }),
    );
  }
  const comparison = compareTranscripts(results);
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
          })),
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
  }
  return comparison.identical && failed.length === 0 ? 0 : 1;
}
