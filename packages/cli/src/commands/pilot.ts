import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench pilot`. Owned by its lane; this stub only says the command is not built yet. */
export function registerPilotCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('pilot')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench pilot is not built yet.\n');
      setExit(2);
    });
}
