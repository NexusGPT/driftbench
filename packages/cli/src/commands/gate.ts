import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench gate`. Owned by its lane; this stub only says the command is not built yet. */
export function registerGateCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('gate')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench gate is not built yet.\n');
      setExit(2);
    });
}
