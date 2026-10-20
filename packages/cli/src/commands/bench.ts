import type { Command } from 'commander';
import type { Io } from '../io';

/**
 * `driftbench bench`: the judge benchmark of the repository (`pnpm bench`), from the CLI. `bench replay`
 * replays the committed cassettes against the versioned slices, `bench record` records one model under a
 * spend cap, and `bench floors` shows or raises the floors. The slices, cassettes, evidence and floors live
 * in `benchmarks/` of a repository checkout: `--root` names it, else the checkout around the working folder.
 * The options are those of `pnpm bench`; the commands run the same code.
 */
export function registerBenchCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  const bench = program
    .command('bench')
    .description(
      'The judge benchmark: replay the committed cassettes, record a model, show or raise the floors. Reads benchmarks/ of a checkout (--root).',
    );
  const common = (command: Command) =>
    command
      .option('--slice <name>', 'slice name or all', 'all')
      .option('--model <id>', 'one model; all active models for replay')
      .option('--root <path>', 'repository holding benchmarks/')
      .option('--store <file>', 'also register the exact dataset versions in this store')
      .option('--json', 'print a JSON report');
  common(bench.command('replay').description('Replay committed cassettes without network or credentials.'))
    .option('--check-floor', 'fail below the absolute or paired floor')
    .action(async (options) => {
      const { benchReplay } = await import('../../../../benchmarks/cli');
      setExit(await benchReplay(options, io));
    });
  common(bench.command('record').description('Record a maintainer run with a required USD spend cap.'))
    .requiredOption(
      '--spend-cap-usd <usd>',
      'maximum charged spend for this invocation, including in-flight reservations',
    )
    .option('--spend-ledger <path>', 'append each metered call to this ledger')
    .option('--concurrency <n>', 'parallel calls, 1..16', '4')
    .option('--resume', 'reuse matching successful recordings and resume partial slices')
    .action(async (options) => {
      const { benchRecord } = await import('../../../../benchmarks/cli');
      setExit(await benchRecord(options, io));
    });
  bench
    .command('floors')
    .description('Show floors or raise one from current replay evidence.')
    .option('--root <path>', 'repository holding benchmarks/')
    .option('--raise <slice>', 'slice whose floor rises')
    .argument('[model]', 'model for --raise')
    .option('--evidence <json>', 'bench replay --json output, or record evidence')
    .option('--json', 'print JSON')
    .action(async (model: string | undefined, options) => {
      const { benchFloors } = await import('../../../../benchmarks/cli');
      setExit(await benchFloors(model, options, io));
    });
}
