import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench family`. Owned by its lane; this stub only says the command is not built yet. */
export function registerFamilyCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('family')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench family is not built yet.\n');
      setExit(2);
    });
}
