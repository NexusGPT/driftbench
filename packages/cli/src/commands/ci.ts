import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench ci`. Owned by its lane; this stub only says the command is not built yet. */
export function registerCiCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('ci')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench ci is not built yet.\n');
      setExit(2);
    });
}
