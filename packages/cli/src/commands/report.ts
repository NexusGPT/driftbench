import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench report`. Owned by its lane; this stub only says the command is not built yet. */
export function registerReportCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('report')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench report is not built yet.\n');
      setExit(2);
    });
}
