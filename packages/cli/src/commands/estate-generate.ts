import type { Command } from 'commander';
import type { Io } from '../io';

/** Adds `estate generate` to `driftbench estate`. Owned by the estate-tests lane; this stub says it is not built yet. */
export function registerEstateGenerateCommand(
  estate: Command,
  io: Io,
  setExit: (code: number) => void,
): void {
  estate
    .command('generate')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench estate generate is not built yet.\n');
      setExit(2);
    });
}
