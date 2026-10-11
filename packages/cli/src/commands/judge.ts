import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench judge`. Owned by its lane; this stub only says the command is not built yet. */
export function registerJudgeCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('judge')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench judge is not built yet.\n');
      setExit(2);
    });
}
