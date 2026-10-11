import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench validate`. Owned by the validators lane; this stub only says the command is not built yet. */
export function registerValidateCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('validate')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench validate is not built yet.\n');
      setExit(2);
    });
}
