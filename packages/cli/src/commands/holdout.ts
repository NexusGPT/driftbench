import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench holdout`. Owned by its lane; this stub only says the command is not built yet. */
export function registerHoldoutCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('holdout')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench holdout is not built yet.\n');
      setExit(2);
    });
}
