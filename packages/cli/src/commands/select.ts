import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench select`. Owned by its lane; this stub only says the command is not built yet. */
export function registerSelectCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('select')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench select is not built yet.\n');
      setExit(2);
    });
}
