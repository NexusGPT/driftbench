import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench compare`. Owned by its lane; this stub only says the command is not built yet. */
export function registerCompareCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('compare')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench compare is not built yet.\n');
      setExit(2);
    });
}
