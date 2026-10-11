import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench estate`. Owned by the estate lane; this stub only says the command is not built yet. */
export function registerEstateCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('estate')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench estate is not built yet.\n');
      setExit(2);
    });
}
