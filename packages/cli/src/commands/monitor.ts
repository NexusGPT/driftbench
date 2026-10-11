import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench monitor`. Owned by its lane; this stub only says the command is not built yet. */
export function registerMonitorCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('monitor')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench monitor is not built yet.\n');
      setExit(2);
    });
}
