import type { Command } from 'commander';
import type { Io } from '../io';

/** Registers `driftbench replay`. Owned by the replay lane; this stub only says the command is not built yet. */
export function registerReplayCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('replay')
    .description('Not built yet.')
    .action(() => {
      io.err('driftbench replay is not built yet.\n');
      setExit(2);
    });
}
