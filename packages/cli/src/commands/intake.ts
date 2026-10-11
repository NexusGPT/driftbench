import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench intake`. Owned by the intake lane; this stub only says the command is not built yet. */
export function registerIntakeCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('intake')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench intake is not built yet.\n');
      setExit(2);
    });
}
