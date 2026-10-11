import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench generate`. Owned by the generate lane; this stub only says the command is not built yet. */
export function registerGenerateCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('generate')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench generate is not built yet.\n');
      setExit(2);
    });
}
