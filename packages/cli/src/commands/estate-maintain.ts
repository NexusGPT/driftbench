import type { Command } from 'commander';
import type { Io } from '../io';

/** Adds the `estate diff and impact` subcommands to `driftbench estate`. Owned by its lane; this stub says they are not built yet. */
export function registerEstateMaintainCommands(
  estate: Command,
  io: Io,
  setExit: (code: number) => void,
): void {
  for (const name of 'diff and impact'.split(' and ')) {
    estate
      .command(name)
      .description('Not built yet.')
      .action(() => {
        io.err(`driftbench estate ${name} is not built yet.\n`);
        setExit(2);
      });
  }
}
